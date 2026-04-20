-- =============================================================================
-- Stage 1B · Backfill: Congress bills + votes (public → shadow)
--
-- One-time copy of existing federal-legislation data from public.* tables into
-- the Stage 1 shadow.* tables. Safe to re-run; every INSERT uses
-- ON CONFLICT DO NOTHING and key columns are stable (external ID-based).
--
-- Run from psql, local Supabase:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -f supabase/scripts/stage1/01_backfill_congress.sql
--
-- Expected runtime (40k bills, ~M votes): under 2 minutes on dev.
-- All work happens server-side via INSERT ... SELECT — no client-side loops.
-- =============================================================================

\echo '============================================================'
\echo 'Stage 1 backfill: congress bills + votes'
\echo '============================================================'

BEGIN;

-- Diagnostic: baseline counts in public
\echo ''
\echo 'Baseline public.* counts:'
SELECT
  (SELECT COUNT(*) FROM public.proposals
     WHERE source_ids ? 'congress_gov_bill')                          AS proposals_with_congress_ref,
  (SELECT COUNT(*) FROM public.votes)                                 AS votes_total,
  (SELECT COUNT(*) FROM public.votes v
     JOIN public.proposals p ON p.id = v.proposal_id
     WHERE p.source_ids ? 'congress_gov_bill')                        AS votes_with_congress_bill;

-- ── Step 1: shadow.proposals ────────────────────────────────────────────────
--
-- Copy every public.proposals row keyed by congress_gov_bill.
-- `id` is preserved — shadow.proposals.id = public.proposals.id — so every
-- downstream FK (votes.proposal_id, cosponsorships, etc.) migrates without
-- needing a translation table.
--
-- Type + status enums match 1:1 (shadow.proposals reuses public.proposal_type).
-- search_vector is populated by the shadow trigger on insert — no manual fill.

\echo ''
\echo 'Step 1: shadow.proposals ...'

INSERT INTO shadow.proposals (
  id, type, status, jurisdiction_id, governing_body_id,
  title, introduced_at, last_action_at,
  external_url, metadata, created_at, updated_at
)
SELECT
  p.id,
  p.type,
  p.status,
  p.jurisdiction_id,
  p.governing_body_id,
  LEFT(p.title, 500),                                 -- defensive truncation
  p.introduced_at,
  p.last_action_at,
  p.congress_gov_url,                                 -- canonicalize into external_url
  COALESCE(p.metadata, '{}'::jsonb)
    || jsonb_build_object(
         'legacy_bill_number',  p.bill_number,
         'legacy_congress_num', p.congress_number,
         'legacy_session',      p.session
       ),
  p.created_at,
  COALESCE(p.updated_at, p.created_at)
FROM public.proposals p
WHERE p.source_ids ? 'congress_gov_bill'
ON CONFLICT (id) DO NOTHING;

\echo '  → shadow.proposals populated'
SELECT COUNT(*) AS shadow_proposals_bill_like
FROM shadow.proposals
WHERE metadata ? 'legacy_bill_number';

-- ── Step 2: shadow.bill_details ─────────────────────────────────────────────
--
-- 1:1 with shadow.proposals for bill-type rows. jurisdiction_id is set
-- automatically by shadow.bill_details_sync_denorm() trigger (reads from
-- shadow.proposals.jurisdiction_id). bill_number / session / congress_number
-- pulled straight from public.proposals.

\echo ''
\echo 'Step 2: shadow.bill_details ...'

INSERT INTO shadow.bill_details (
  proposal_id, bill_number, chamber, session, congress_number,
  congress_gov_url, jurisdiction_id
)
SELECT
  p.id,
  COALESCE(p.bill_number, 'UNKNOWN'),                 -- bill_number is NOT NULL
  CASE
    WHEN p.bill_number ILIKE 'HR%'     OR p.bill_number ILIKE 'HJRES%' THEN 'house'
    WHEN p.bill_number ILIKE 'S %'     OR p.bill_number ILIKE 'SJRES%' THEN 'senate'
    WHEN p.bill_number ILIKE 'HCONRES%'                                THEN 'house'
    WHEN p.bill_number ILIKE 'SCONRES%'                                THEN 'senate'
    ELSE NULL
  END AS chamber,
  p.session,
  p.congress_number,
  p.congress_gov_url,
  p.jurisdiction_id                                   -- trigger would overwrite, but populating is harmless
FROM public.proposals p
WHERE p.source_ids ? 'congress_gov_bill'
  AND p.type IN ('bill','resolution','amendment')
ON CONFLICT (proposal_id) DO NOTHING;

\echo '  → shadow.bill_details populated'
SELECT COUNT(*) AS shadow_bill_details_count FROM shadow.bill_details;

-- ── Step 3: shadow.external_source_refs ─────────────────────────────────────
--
-- Canonicalize the legacy `source_ids->>congress_gov_bill` JSONB pattern into
-- real indexable refs. One row per (source='congress_gov', external_id=billKey).

\echo ''
\echo 'Step 3: shadow.external_source_refs ...'

INSERT INTO shadow.external_source_refs (
  source, external_id, entity_type, entity_id,
  source_url, last_seen_at, metadata, created_at
)
SELECT
  'congress_gov',
  p.source_ids->>'congress_gov_bill',
  'proposal',
  p.id,
  p.congress_gov_url,
  COALESCE(p.updated_at, p.created_at),
  jsonb_build_object('backfilled_at', NOW()),
  p.created_at
FROM public.proposals p
WHERE p.source_ids ? 'congress_gov_bill'
  AND p.source_ids->>'congress_gov_bill' IS NOT NULL
ON CONFLICT (source, external_id) DO NOTHING;

\echo '  → shadow.external_source_refs populated'
SELECT COUNT(*) AS shadow_refs_congress_gov
FROM shadow.external_source_refs
WHERE source = 'congress_gov';

-- ── Step 4: shadow.votes ────────────────────────────────────────────────────
--
-- Copy public.votes → shadow.votes. Key re-mapping:
--   proposal_id          → bill_proposal_id (FK to shadow.bill_details)
--   roll_call_number +
--     source_ids.roll_call → roll_call_id (first-class, synthetic key)
--   metadata.vote_question → vote_question (first-class)
--   chamber              → chamber (preserve casing; shadow doesn't CHECK)
--   session              → session
--   voted_at             → voted_at (NOT NULL; we skip rows where it's NULL,
--                                     they were always bugs)
--
-- Only copy votes whose parent proposal has a bill_details row (ie made the
-- shadow cut). Use UNIQUE(roll_call_id, official_id) — duplicates from the
-- old (official_id, proposal_id) collision era are silently dropped via
-- ON CONFLICT.

\echo ''
\echo 'Step 4: shadow.votes ...'

INSERT INTO shadow.votes (
  id, bill_proposal_id, official_id, vote, voted_at,
  roll_call_id, vote_question, chamber, session,
  source_url, metadata, created_at, updated_at
)
SELECT
  v.id,
  v.proposal_id,
  v.official_id,
  v.vote,
  v.voted_at,
  -- roll_call_id priority: source_ids.roll_call (synthetic key), else
  -- fall back to "{chamber}-{session}-{roll_call_number}"
  COALESCE(
    v.source_ids->>'roll_call',
    LOWER(v.chamber) || '-' || COALESCE(v.session, '0') || '-' || COALESCE(v.roll_call_number, v.id::text)
  ),
  v.metadata->>'vote_question',
  v.chamber,
  v.session,
  COALESCE(v.source_ids->>'house_clerk_url', v.source_ids->>'senate_lis_url'),
  COALESCE(v.metadata, '{}'::jsonb) || jsonb_build_object(
    'legacy_source_ids', v.source_ids,
    'backfilled_at',     NOW()
  ),
  v.created_at,
  COALESCE(v.updated_at, v.created_at)
FROM public.votes v
INNER JOIN shadow.bill_details bd ON bd.proposal_id = v.proposal_id
WHERE v.voted_at IS NOT NULL
ON CONFLICT (roll_call_id, official_id) DO NOTHING;

\echo '  → shadow.votes populated'
SELECT COUNT(*) AS shadow_votes_count FROM shadow.votes;

-- ── Step 5: Summary report ──────────────────────────────────────────────────

\echo ''
\echo '============================================================'
\echo 'Backfill summary (post-backfill counts):'
\echo '============================================================'

SELECT
  (SELECT COUNT(*) FROM public.proposals
     WHERE source_ids ? 'congress_gov_bill')              AS public_proposals_congress,
  (SELECT COUNT(*) FROM shadow.proposals
     WHERE metadata ? 'legacy_bill_number')               AS shadow_proposals_congress,
  (SELECT COUNT(*) FROM shadow.bill_details)              AS shadow_bill_details,
  (SELECT COUNT(*) FROM shadow.external_source_refs
     WHERE source='congress_gov')                         AS shadow_refs_congress,
  (SELECT COUNT(*) FROM public.votes v
     JOIN public.proposals p ON p.id = v.proposal_id
     WHERE p.source_ids ? 'congress_gov_bill'
       AND v.voted_at IS NOT NULL)                        AS public_votes_eligible,
  (SELECT COUNT(*) FROM shadow.votes)                     AS shadow_votes_count,
  (SELECT COUNT(DISTINCT roll_call_id)
     FROM shadow.votes)                                   AS shadow_distinct_rolls;

-- Acceptance: shadow_votes_count should match public_votes_eligible modulo
-- rows where two officials voted twice under the same roll_call (data-entry
-- errors in the source feeds — rare; a handful per congress).
--
-- If drift > 100 rows, investigate before committing.

COMMIT;

\echo ''
\echo 'Backfill complete. Run 02_validate_congress.sql next.'
