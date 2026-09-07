-- FIX-928 — entity_grants' active-uniqueness learns to see NULL targets, and
-- active grants become revocable.
--
-- ============================================================================
-- WHAT FIX-928 ORIGINALLY SAID, AND WHY IT WAS THE WRONG SHAPE
-- ============================================================================
-- The bullet asked for "a partial unique index on active grants". That index
-- ALREADY EXISTS and has since 20260528010000_role_claim_spine.sql:
--
--   CREATE UNIQUE INDEX entity_grants_unique_active
--     ON public.entity_grants(user_id, role, target_type, target_id)
--     WHERE status = 'active';
--
-- Adding it would have been a no-op. It is not missing — it is UNREACHABLE for
-- global-scoped grants, because a B-tree unique index treats every NULL as
-- distinct from every other NULL, and the table's own CHECK constraint
-- (entity_grants_target_shape) FORCES target_id IS NULL whenever
-- target_type = 'global'. So the constraint holds perfectly for jurisdiction-,
-- official- and institution-scoped grants and does nothing whatsoever for
-- global ones. A uniqueness constraint is only a constraint on the rows it can
-- see.
--
-- Prod census 2026-09-06, re-confirmed 2026-09-07, active grants grouped by
-- (user_id, role, target_type, target_id): exactly ONE violating group — 13
-- rows, all NULL target_id, all one user, role staff, target_type global.
-- Shape: one row at 2026-06-19 09:41:39, then SIX PAIRS 200-250 ms apart. All
-- share granted_at 2026-05-01 12:00:00+00 and all have expires_at NULL.
--
-- ============================================================================
-- THE DOUBLE-SUBMIT PATH IS THE SEED, AND IT WAS RELYING ON THIS INDEX
-- ============================================================================
-- packages/data/src/seed/franklin/lib.ts grantStaff() inserts the global staff
-- grant with:
--
--   ON CONFLICT (user_id, role, target_type, target_id) WHERE status = 'active'
--     DO NOTHING
--
-- an arbiter that can never match, because the row it would match on has a NULL
-- target_id. So the guard reads as idempotent and is not: every call inserts.
--
-- The ~200 ms pairs are not a race and not a human clicking twice. grantStaff
-- has exactly one call site — seedInvestigation() at index.ts:1165, once per
-- investigation — and BOTH investigation fixtures
-- (data/investigations.json and data/s2/investigations.json) carry the same
-- created_by, 'cit-openledgero'. Two files, one author, one seed run: two calls
-- a few hundred milliseconds apart. Six seed runs on 2026-06-19/20 => 12 rows,
-- plus the original => 13. The arithmetic closes exactly.
--
-- The sibling insert at index.ts:980 (the answerer grant) uses the same ON
-- CONFLICT clause but passes a NON-NULL target_id, so its arbiter matches and it
-- has always been genuinely idempotent. It needs no change and gets none.
--
-- Nothing else writes entity_grants unsafely: verify-constituent/route.ts:227
-- is SELECT-then-INSERT, and officials/claim/route.ts:205 inserts a PENDING row
-- (outside this index's WHERE clause by construction).
--
-- ============================================================================
-- THE THIRD DEFECT: THERE IS NO WAY TO REVOKE AN ACTIVE GRANT
-- ============================================================================
-- The manifest recorded this as "revoking through the admin UI flips 1 of 13
-- rows". Reading the route, that understates it. apps/civitics/app/api/admin/
-- grants/[id]/route.ts accepts action 'approve' | 'reject' and 409s on anything
-- whose status is not 'pending' (line 59). 'reject' is the pending-rejection
-- branch, not a revocation. So revoking an active grant through the admin
-- surface flips ZERO rows and returns an error — there is no active-revoke path
-- at all, for any grant, duplicated or not.
--
-- That is why this migration ships revoke_grant() alongside the dedupe. Fixing
-- the uniqueness without it would leave the system unable to withdraw access it
-- has granted, which is the more serious of the two problems and the one that
-- does not announce itself.
--
-- FIX-928's severity is raised accordingly: not data hygiene. Three defects —
-- an index that cannot see the rows it is meant to constrain, a writer relying
-- on it, and no revocation path for active grants.
--
-- ============================================================================
-- ORDER OF OPERATIONS
-- ============================================================================
-- Dedupe FIRST, then the index. The reverse fails: recreating the index with
-- NULLS NOT DISTINCT against 13 conflicting live rows raises 23505 and the
-- whole migration rolls back.

-- ── 1. Retire the duplicates ─────────────────────────────────────────────────
--
-- ENV-PORTABLE BY CONSTRUCTION. No hard-coded uuids anywhere: the target set is
-- DERIVED as "every active NULL-target grant that is not the oldest of its
-- (user_id, role, target_type) group". On a clean local DB or a fresh clone this
-- selects nothing and the migration is a no-op, which is the same discipline the
-- FIX-1003/1006 migrations use.
--
-- VERIFIED BEFORE PUSH (2026-09-07): the SELECT form of this exact subquery,
-- run against prod, returned EXACTLY the 12 ids marked RETIRE in
-- docs/audits/2026-09-06-fix928-duplicate-grants.tsv — 12 of 12, diff clean. If
-- a future run of this migration touches a different number, the census moved
-- and it should be re-derived rather than trusted.
--
-- status='revoked' (an existing terminal value), never DELETE: grant_events and
-- grant_evidence reference these rows and the history is the audit trail. Keep
-- the OLDEST per key — it is the one whose grant actually took effect, and the
-- twelve after it were no-ops that believed they were doing something.

WITH doomed AS (
  SELECT g.id
  FROM public.entity_grants g
  WHERE g.status = 'active'
    AND g.target_id IS NULL
    AND g.id <> (
      SELECT k.id
      FROM public.entity_grants k
      WHERE k.status = 'active'
        AND k.target_id IS NULL
        AND k.user_id = g.user_id
        AND k.role = g.role
        AND k.target_type = g.target_type
      ORDER BY k.created_at, k.id
      LIMIT 1
    )
),
flipped AS (
  UPDATE public.entity_grants e
     SET status = 'revoked'
    FROM doomed d
   WHERE e.id = d.id
  RETURNING e.id
)
INSERT INTO public.grant_events (grant_id, event, actor_id, metadata)
SELECT id, 'revoked', NULL,
       jsonb_build_object(
         'source', 'fix928-dedupe',
         'reason', 'duplicate active grant on a NULL-target key the unique index could not see')
FROM flipped;

-- ── 2. Make the index see NULLs ──────────────────────────────────────────────
--
-- Postgres 17.6 on both prod and local, so NULLS NOT DISTINCT (PG15+) is
-- available and no fallback branch is needed. The alternative shape — a SECOND
-- partial index on (user_id, role, target_type) WHERE target_id IS NULL — was
-- rejected: it would leave two indexes expressing one rule, and the seed's ON
-- CONFLICT target would have to change to match whichever one applied. One
-- index that means what it says is better.
--
-- The table is 24 rows on prod, so the drop-and-recreate is instant and the
-- brief ACCESS EXCLUSIVE lock is not worth a CONCURRENTLY dance (which cannot
-- run inside a migration transaction anyway).

DROP INDEX IF EXISTS public.entity_grants_unique_active;

CREATE UNIQUE INDEX entity_grants_unique_active
  ON public.entity_grants (user_id, role, target_type, target_id) NULLS NOT DISTINCT
  WHERE status = 'active';

COMMENT ON INDEX public.entity_grants_unique_active IS
  'FIX-928 — NULLS NOT DISTINCT so the constraint covers global-scoped grants, '
  'whose target_id is forced NULL by entity_grants_target_shape. Without it a '
  'B-tree treats every NULL as distinct and the index silently permitted '
  'unlimited duplicate active global grants (13 accumulated for one user). '
  'This index is also the arbiter for the seed grant path''s ON CONFLICT.';

-- ── 3. A revocation path for ACTIVE grants ───────────────────────────────────
--
-- Shape mirrors expire_lapsed_grants() (20260612000100): SECURITY DEFINER, a
-- pinned search_path, its own statement_timeout, one CTE that flips and one
-- that logs, returns the count.
--
-- SET-BASED ON THE KEY, not .eq("id"). The index above now guarantees at most
-- one active row per key, so keying on the id would usually be equivalent —
-- "usually" is the problem. Revocation is the operation whose failure mode is
-- silent over-retention of access, so it revokes every active row matching the
-- key and returns how many it found. If that is ever >1 the index has been
-- dropped or bypassed, and the count says so.
--
-- IS NOT DISTINCT FROM is the whole reason this is an RPC rather than a
-- PostgREST call: PostgREST cannot express NULL-safe equality, so a
-- .eq("target_id", null) would match nothing and a global grant would once
-- again be unrevocable — the same class of bug as the index itself.

CREATE OR REPLACE FUNCTION public.revoke_grant(
  p_user_id     uuid,
  p_role        grant_role,
  p_target_type grant_target_type,
  p_target_id   uuid    DEFAULT NULL,
  p_actor_id    uuid    DEFAULT NULL,
  p_reason      text    DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
SET statement_timeout = '30s'
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH flipped AS (
    UPDATE public.entity_grants
       SET status = 'revoked'
     WHERE status = 'active'
       AND user_id = p_user_id
       AND role = p_role
       AND target_type = p_target_type
       AND target_id IS NOT DISTINCT FROM p_target_id
    RETURNING id
  ),
  logged AS (
    INSERT INTO public.grant_events (grant_id, event, actor_id, notes, metadata)
    SELECT id, 'revoked', p_actor_id, p_reason,
           jsonb_build_object('source', 'revoke_grant')
    FROM flipped
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_count FROM logged;

  RETURN COALESCE(v_count, 0);
END;
$$;

COMMENT ON FUNCTION public.revoke_grant(uuid, grant_role, grant_target_type, uuid, uuid, text) IS
  'FIX-928 — revoke every ACTIVE grant matching a (user_id, role, target_type, '
  'target_id) key, NULL-safe on target_id, and write one grant_events row per '
  'flipped grant. Returns the count. Before this, /api/admin/grants/[id] 409''d '
  'on any grant whose status was not pending, so there was no way to revoke an '
  'active grant at all.';

REVOKE ALL ON FUNCTION public.revoke_grant(uuid, grant_role, grant_target_type, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_grant(uuid, grant_role, grant_target_type, uuid, uuid, text)
  TO service_role;
