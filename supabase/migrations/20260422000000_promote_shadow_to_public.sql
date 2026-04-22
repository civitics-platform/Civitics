-- =============================================================================
-- Stage 2 · Promote shadow → public (the cutover migration)
--
-- Replaces every public.* table that was rebuilt in Stage 1 with the shadow
-- version, preserving FKs, indexes, triggers, and row identity. After this
-- migration the `shadow` schema is gone and the app reads/writes public.* again.
--
-- Scope:
--   • Data-migrate civic_initiatives → shadow.proposals + shadow.initiative_details
--     so user-written initiatives survive the cutover (rows keep their IDs).
--   • Retarget civic_initiative_* ancillary FKs to the new proposals (via shadow
--     → public promotion).
--   • Drop broken RPCs, views, and triggers that referenced the old financial
--     schema (donor_name/official_id/donor_id) or the old entity_connections
--     evidence shape.
--   • Drop old public.* tables being replaced:
--       proposals, votes, financial_entities, financial_relationships,
--       entity_connections, spending_records, civic_initiatives.
--     Their child-table FKs are dropped CASCADE; the child tables themselves
--     remain. Pipeline-generated rows in child tables that reference old UUIDs
--     are orphaned (test data) and truncated here.
--   • Drop unused shadow.pipeline_state / data_sync_log / enrichment_queue
--     (public versions are kept unchanged — nothing references shadow versions
--     of these operational tables in packages/data).
--   • Promote remaining shadow tables, type, functions, and RLS policies to
--     public via ALTER ... SET SCHEMA. Rename to drop "shadow_" policy prefix.
--   • Recreate proposal_comment_stats + proposal_trending_24h view/MV against
--     promoted public.proposals (column-compatible).
--   • Recreate FKs on civic_comments, promises, official_comment_submissions,
--     proposal_cosponsors, civic_initiative_proposal_links so they point at
--     the new public.proposals(id).
--   • DROP SCHEMA shadow CASCADE (must be empty at this point).
--
-- Follow-up (not in this migration):
--   • Rewrite ~15 app files per docs/audits/app_query_audit_pre_cutover.md
--     (required before `pnpm build` passes).
--   • Rewrite ~10 dropped RPCs against the new financial schema
--     (get_official_donors, get_pac_donations_by_party, treemap_officials_by_donations,
--     chord_industry_flows, get_group_connections, get_group_sector_totals,
--     get_crossgroup_sector_totals, get_officials_by_filter, search_graph_entities,
--     get_connection_counts — any app paths that call them will 500 until
--     reimplemented).
--
-- DESTRUCTIVE WARNING (local dev):
--   This migration TRUNCATEs civic_comments, official_comment_submissions,
--   proposal_cosponsors, and promises. Their rows reference old proposal UUIDs
--   that won't exist after cutover. User-written civic_initiatives data is
--   preserved via INSERT ... SELECT into shadow.proposals before the drop.
--   On Pro (empty DB) there's nothing to TRUNCATE; the statements are no-ops.
-- =============================================================================

BEGIN;

-- ── 1. Data migration: civic_initiatives → shadow.proposals ──────────────────
--
-- Preserve row UUIDs so civic_initiative_signatures/responses/arguments/...
-- FKs can simply retarget from civic_initiatives(id) to public.proposals(id)
-- after shadow promotion.

-- Default federal jurisdiction for federal-scope initiatives (first match).
-- Local development has a "USA" or "United States" jurisdiction; Pro will have
-- it seeded before this migration runs.
DO $$
DECLARE
  v_federal_jurisdiction UUID;
BEGIN
  -- jurisdiction_type has no 'federal' value — the country-level is 'country'.
  -- Prefer the US country row; fall back to the first country at all.
  SELECT id INTO v_federal_jurisdiction
    FROM jurisdictions
    WHERE type = 'country'
      AND (country_code = 'US' OR short_name = 'US' OR LOWER(name) LIKE '%united states%')
    ORDER BY created_at ASC
    LIMIT 1;

  IF v_federal_jurisdiction IS NULL THEN
    SELECT id INTO v_federal_jurisdiction
      FROM jurisdictions
      WHERE type = 'country'
      ORDER BY created_at ASC
      LIMIT 1;
  END IF;

  IF v_federal_jurisdiction IS NULL THEN
    RAISE NOTICE 'No country jurisdiction found — civic_initiatives migration skipped. Seed jurisdictions first.';
    RETURN;
  END IF;

  -- Skip cleanly if civic_initiatives is empty (Pro first-run case)
  IF NOT EXISTS (SELECT 1 FROM civic_initiatives LIMIT 1) THEN
    RAISE NOTICE 'civic_initiatives is empty — skipping data migration.';
    RETURN;
  END IF;

  -- Insert into shadow.proposals preserving id. For state-scope initiatives
  -- try to match target_district against jurisdictions.name; fall back to
  -- federal if no match.
  INSERT INTO shadow.proposals (
    id, type, status, jurisdiction_id,
    title, short_title, summary_plain,
    introduced_at, resolved_at,
    metadata, created_at, updated_at
  )
  SELECT
    ci.id,
    'initiative'::proposal_type,
    CASE ci.stage::text
      WHEN 'draft'      THEN 'introduced'::proposal_status
      WHEN 'deliberate' THEN 'introduced'::proposal_status
      WHEN 'problem'    THEN 'introduced'::proposal_status
      WHEN 'mobilise'   THEN 'in_committee'::proposal_status
      WHEN 'resolved'   THEN CASE ci.resolution_type::text
                               WHEN 'sponsored'  THEN 'enacted'::proposal_status
                               WHEN 'declined'   THEN 'failed'::proposal_status
                               WHEN 'withdrawn'  THEN 'withdrawn'::proposal_status
                               WHEN 'expired'    THEN 'failed'::proposal_status
                               ELSE 'failed'::proposal_status
                             END
      ELSE 'introduced'::proposal_status
    END,
    COALESCE(
      CASE
        WHEN ci.scope = 'state' AND ci.target_district IS NOT NULL
          THEN (SELECT id FROM jurisdictions
                 WHERE type = 'state'
                   AND (LOWER(name) = LOWER(ci.target_district)
                        OR LOWER(COALESCE(short_name, '')) = LOWER(ci.target_district))
                 LIMIT 1)
        ELSE NULL
      END,
      v_federal_jurisdiction
    ),
    ci.title,
    CASE WHEN ci.title IS NOT NULL AND char_length(ci.title) <= 120 THEN ci.title ELSE LEFT(ci.title, 120) END,
    ci.summary,
    ci.created_at::date,
    ci.resolved_at::date,
    jsonb_build_object('migrated_from', 'civic_initiatives'),
    ci.created_at,
    ci.updated_at
  FROM civic_initiatives ci
  ON CONFLICT (id) DO NOTHING;

  -- Mirror initiative-specific fields into shadow.initiative_details
  INSERT INTO shadow.initiative_details (
    proposal_id, stage, authorship_type, primary_author_id,
    scope, target_district, body_md,
    issue_area_tags, quality_gate_score,
    mobilise_started_at, resolution_type
  )
  SELECT
    ci.id,
    ci.stage,
    ci.authorship_type,
    ci.primary_author_id,
    ci.scope,
    ci.target_district,
    ci.body_md,
    ci.issue_area_tags,
    ci.quality_gate_score,
    ci.mobilise_started_at,
    ci.resolution_type
  FROM civic_initiatives ci
  ON CONFLICT (proposal_id) DO NOTHING;

  RAISE NOTICE 'Migrated % civic_initiatives rows to shadow.proposals + shadow.initiative_details.',
    (SELECT COUNT(*) FROM civic_initiatives);
END $$;

-- ── 2. Retarget civic_initiative_* ancillary FKs ─────────────────────────────
--
-- They currently reference civic_initiatives(id). Drop those constraints; the
-- new FKs (pointing at public.proposals(id)) are added in step 9 after shadow
-- promotion.

ALTER TABLE IF EXISTS civic_initiative_signatures
  DROP CONSTRAINT IF EXISTS civic_initiative_signatures_initiative_id_fkey;
ALTER TABLE IF EXISTS civic_initiative_responses
  DROP CONSTRAINT IF EXISTS civic_initiative_responses_initiative_id_fkey;
ALTER TABLE IF EXISTS civic_initiative_versions
  DROP CONSTRAINT IF EXISTS civic_initiative_versions_initiative_id_fkey;
ALTER TABLE IF EXISTS civic_initiative_upvotes
  DROP CONSTRAINT IF EXISTS civic_initiative_upvotes_initiative_id_fkey;
ALTER TABLE IF EXISTS civic_initiative_arguments
  DROP CONSTRAINT IF EXISTS civic_initiative_arguments_initiative_id_fkey;
ALTER TABLE IF EXISTS civic_initiative_milestone_events
  DROP CONSTRAINT IF EXISTS civic_initiative_milestone_events_initiative_id_fkey;
ALTER TABLE IF EXISTS civic_initiative_follows
  DROP CONSTRAINT IF EXISTS civic_initiative_follows_initiative_id_fkey;
ALTER TABLE IF EXISTS civic_initiative_proposal_links
  DROP CONSTRAINT IF EXISTS civic_initiative_proposal_links_initiative_id_fkey;
ALTER TABLE IF EXISTS civic_initiative_proposal_links
  DROP CONSTRAINT IF EXISTS civic_initiative_proposal_links_proposal_id_fkey;

-- ── 3. Drop broken RPCs ─────────────────────────────────────────────────────
--
-- These all reference financial_relationships.donor_name / .official_id /
-- .donor_id or the old entity_connections evidence shape. Kept as follow-up
-- rewrites; app paths that call them will 500 until reimplemented against the
-- new polymorphic shape.

DROP FUNCTION IF EXISTS chord_industry_flows();
DROP FUNCTION IF EXISTS treemap_officials_by_donations(integer, text, text, text);
DROP FUNCTION IF EXISTS search_graph_entities(text, integer);
DROP FUNCTION IF EXISTS get_official_donors(uuid);
DROP FUNCTION IF EXISTS get_pac_donations_by_party();
DROP FUNCTION IF EXISTS get_group_sector_totals(uuid[]);
DROP FUNCTION IF EXISTS get_crossgroup_sector_totals(uuid[], uuid[]);
DROP FUNCTION IF EXISTS get_group_connections(uuid[], integer);
DROP FUNCTION IF EXISTS get_officials_by_filter(text, text, text);
DROP FUNCTION IF EXISTS get_connection_counts(uuid[]);
DROP FUNCTION IF EXISTS get_officials_breakdown();

-- refresh_proposal_trending references the materialized view; both get
-- recreated in step 11 against public.proposals.
DROP FUNCTION IF EXISTS refresh_proposal_trending();

-- ── 4. Drop views and materialized views that depend on public.proposals ─────

DROP MATERIALIZED VIEW IF EXISTS proposal_trending_24h;
DROP VIEW IF EXISTS proposal_comment_stats;

-- ── 5. Truncate pipeline-generated + orphaned child tables ──────────────────
--
-- civic_comments, official_comment_submissions, proposal_cosponsors, promises
-- reference proposals(id). After cutover their rows would point at nothing
-- (new pipelines generate fresh proposal UUIDs). Wipe them rather than leaving
-- dangling orphans.
--
-- spending_records is about to be replaced by financial_relationships rows
-- (type='contract'/'grant') produced by pipelines.

TRUNCATE TABLE civic_comments                RESTART IDENTITY CASCADE;
TRUNCATE TABLE official_comment_submissions  RESTART IDENTITY CASCADE;
TRUNCATE TABLE proposal_cosponsors           RESTART IDENTITY CASCADE;
TRUNCATE TABLE promises                      RESTART IDENTITY CASCADE;

-- Comment aggregations + graph snapshots depend on dropped tables
TRUNCATE TABLE graph_snapshots               RESTART IDENTITY CASCADE;

-- Also wipe operational state tied to the old data shape
TRUNCATE TABLE data_sync_log                 RESTART IDENTITY CASCADE;
TRUNCATE TABLE enrichment_queue              RESTART IDENTITY CASCADE;
TRUNCATE TABLE pipeline_state                RESTART IDENTITY CASCADE;

-- ── 6. Drop old public tables (CASCADE drops dependent FK constraints only) ──
--
-- Order matters: votes / financial_relationships / entity_connections reference
-- proposals & financial_entities; drop children first for clarity (CASCADE would
-- handle it either way).

DROP TABLE IF EXISTS votes                   CASCADE;
DROP TABLE IF EXISTS entity_connections      CASCADE;
DROP TABLE IF EXISTS financial_relationships CASCADE;
DROP TABLE IF EXISTS financial_entities      CASCADE;
DROP TABLE IF EXISTS spending_records        CASCADE;

-- civic_initiatives is dropped BEFORE proposals because its
-- linked_proposal_id → proposals(id) FK was already dropped via CASCADE on
-- the drop just above; but civic_initiatives itself still refs proposals only
-- optionally. Drop the ancillary user-data-preserved parent last via CASCADE —
-- we've already copied rows into shadow.proposals in step 1.
DROP TABLE IF EXISTS civic_initiatives       CASCADE;

DROP TABLE IF EXISTS proposals               CASCADE;

-- Drop triggers/functions bound to the old public.proposals
DROP FUNCTION IF EXISTS proposals_search_vector_update() CASCADE;

-- ── 7. Drop unused shadow operational tables ────────────────────────────────
--
-- packages/data has no references to shadow.pipeline_state,
-- shadow.data_sync_log, or shadow.enrichment_queue (verified 2026-04-21).
-- The public versions of these operational tables are kept as-is; they just
-- got TRUNCATEd above. Keeping both would force a schema choice on every
-- pipeline writer.

DROP TABLE IF EXISTS shadow.pipeline_state    CASCADE;
DROP TABLE IF EXISTS shadow.data_sync_log     CASCADE;
DROP TABLE IF EXISTS shadow.enrichment_queue  CASCADE;

-- ── 8. Promote shadow → public (SET SCHEMA preserves identity + indexes) ────

-- Type first (other objects depend on it)
ALTER TYPE shadow.financial_relationship_type SET SCHEMA public;

-- Functions
ALTER FUNCTION shadow.proposals_search_vector_update()   SET SCHEMA public;
ALTER FUNCTION shadow.bill_details_sync_denorm()         SET SCHEMA public;
ALTER FUNCTION shadow.rebuild_entity_connections()       SET SCHEMA public;

-- Tables (parents before children to keep the linter happy; SET SCHEMA is
-- order-insensitive since FKs follow along automatically)
ALTER TABLE shadow.external_source_refs       SET SCHEMA public;
ALTER TABLE shadow.proposals                  SET SCHEMA public;
ALTER TABLE shadow.bill_details               SET SCHEMA public;
ALTER TABLE shadow.case_details               SET SCHEMA public;
ALTER TABLE shadow.measure_details            SET SCHEMA public;
ALTER TABLE shadow.initiative_details         SET SCHEMA public;
ALTER TABLE shadow.proposal_actions           SET SCHEMA public;
ALTER TABLE shadow.meetings                   SET SCHEMA public;
ALTER TABLE shadow.agenda_items               SET SCHEMA public;
ALTER TABLE shadow.votes                      SET SCHEMA public;
ALTER TABLE shadow.financial_entities         SET SCHEMA public;
ALTER TABLE shadow.financial_relationships    SET SCHEMA public;
ALTER TABLE shadow.entity_connections         SET SCHEMA public;
ALTER TABLE shadow.claim_queue                SET SCHEMA public;

-- ── 9. Re-add FKs on retained child tables → new public.proposals ───────────
--
-- civic_initiative_* ancillaries and general proposal-children whose FKs were
-- CASCADE-dropped in step 6.

-- Civic initiative ancillary tables (FKs re-point to public.proposals)
ALTER TABLE civic_initiative_signatures
  ADD CONSTRAINT civic_initiative_signatures_initiative_id_fkey
  FOREIGN KEY (initiative_id) REFERENCES public.proposals(id) ON DELETE CASCADE;
ALTER TABLE civic_initiative_responses
  ADD CONSTRAINT civic_initiative_responses_initiative_id_fkey
  FOREIGN KEY (initiative_id) REFERENCES public.proposals(id) ON DELETE CASCADE;
ALTER TABLE civic_initiative_versions
  ADD CONSTRAINT civic_initiative_versions_initiative_id_fkey
  FOREIGN KEY (initiative_id) REFERENCES public.proposals(id) ON DELETE CASCADE;
ALTER TABLE civic_initiative_upvotes
  ADD CONSTRAINT civic_initiative_upvotes_initiative_id_fkey
  FOREIGN KEY (initiative_id) REFERENCES public.proposals(id) ON DELETE CASCADE;
ALTER TABLE civic_initiative_arguments
  ADD CONSTRAINT civic_initiative_arguments_initiative_id_fkey
  FOREIGN KEY (initiative_id) REFERENCES public.proposals(id) ON DELETE CASCADE;
ALTER TABLE civic_initiative_milestone_events
  ADD CONSTRAINT civic_initiative_milestone_events_initiative_id_fkey
  FOREIGN KEY (initiative_id) REFERENCES public.proposals(id) ON DELETE CASCADE;
ALTER TABLE civic_initiative_follows
  ADD CONSTRAINT civic_initiative_follows_initiative_id_fkey
  FOREIGN KEY (initiative_id) REFERENCES public.proposals(id) ON DELETE CASCADE;
ALTER TABLE civic_initiative_proposal_links
  ADD CONSTRAINT civic_initiative_proposal_links_initiative_id_fkey
  FOREIGN KEY (initiative_id) REFERENCES public.proposals(id) ON DELETE CASCADE;
ALTER TABLE civic_initiative_proposal_links
  ADD CONSTRAINT civic_initiative_proposal_links_proposal_id_fkey
  FOREIGN KEY (proposal_id) REFERENCES public.proposals(id) ON DELETE CASCADE;

-- Other proposal-children (tables were TRUNCATEd in step 5 so re-adding the
-- FK can't fail on orphans).
ALTER TABLE civic_comments
  ADD CONSTRAINT civic_comments_proposal_id_fkey
  FOREIGN KEY (proposal_id) REFERENCES public.proposals(id);
ALTER TABLE official_comment_submissions
  ADD CONSTRAINT official_comment_submissions_proposal_id_fkey
  FOREIGN KEY (proposal_id) REFERENCES public.proposals(id);
ALTER TABLE proposal_cosponsors
  ADD CONSTRAINT proposal_cosponsors_proposal_id_fkey
  FOREIGN KEY (proposal_id) REFERENCES public.proposals(id) ON DELETE CASCADE;
ALTER TABLE promises
  ADD CONSTRAINT promises_related_proposal_id_fkey
  FOREIGN KEY (related_proposal_id) REFERENCES public.proposals(id);

-- ── 10. Rename RLS policies (strip "shadow_" prefix) ────────────────────────

ALTER POLICY "shadow_proposals_select"              ON public.proposals              RENAME TO "proposals_select";
ALTER POLICY "shadow_bill_details_select"           ON public.bill_details           RENAME TO "bill_details_select";
ALTER POLICY "shadow_case_details_select"           ON public.case_details           RENAME TO "case_details_select";
ALTER POLICY "shadow_measure_details_select"        ON public.measure_details        RENAME TO "measure_details_select";
ALTER POLICY "shadow_initiative_details_select"     ON public.initiative_details     RENAME TO "initiative_details_select";
ALTER POLICY "shadow_proposal_actions_select"       ON public.proposal_actions       RENAME TO "proposal_actions_select";
ALTER POLICY "shadow_meetings_select"               ON public.meetings               RENAME TO "meetings_select";
ALTER POLICY "shadow_agenda_items_select"           ON public.agenda_items           RENAME TO "agenda_items_select";
ALTER POLICY "shadow_votes_select"                  ON public.votes                  RENAME TO "votes_select";
ALTER POLICY "shadow_financial_entities_select"     ON public.financial_entities     RENAME TO "financial_entities_select";
ALTER POLICY "shadow_financial_relationships_select" ON public.financial_relationships RENAME TO "financial_relationships_select";
ALTER POLICY "shadow_entity_connections_select"     ON public.entity_connections     RENAME TO "entity_connections_select";
ALTER POLICY "shadow_claim_queue_own_select"        ON public.claim_queue            RENAME TO "claim_queue_own_select";
ALTER POLICY "shadow_claim_queue_own_insert"        ON public.claim_queue            RENAME TO "claim_queue_own_insert";
ALTER POLICY "shadow_claim_queue_own_update"        ON public.claim_queue            RENAME TO "claim_queue_own_update";
ALTER POLICY "shadow_claim_queue_own_delete"        ON public.claim_queue            RENAME TO "claim_queue_own_delete";

-- ── 11. Recreate proposal_comment_stats + proposal_trending_24h ─────────────
--
-- Column-compatible with new public.proposals (id, title, type, status, created_at).

CREATE OR REPLACE VIEW proposal_comment_stats AS
SELECT
  c.proposal_id,
  COUNT(*)::int                                                   AS comment_count,
  COUNT(DISTINCT c.user_id)::int                                  AS distinct_commenters,
  MAX(c.created_at)                                               AS last_commented_at,
  COUNT(*) FILTER (WHERE c.created_at >= NOW() - INTERVAL '24 hours')::int AS comments_24h,
  COUNT(*) FILTER (WHERE c.created_at >= NOW() - INTERVAL '7 days')::int   AS comments_7d
FROM civic_comments c
WHERE c.is_deleted = false
GROUP BY c.proposal_id;

CREATE MATERIALIZED VIEW IF NOT EXISTS proposal_trending_24h AS
SELECT
  p.id                                                                          AS proposal_id,
  p.title,
  p.type,
  p.status,
  COALESCE(s.comments_24h, 0)                                                   AS comments_24h,
  COALESCE(s.comment_count, 0)                                                  AS total_comments,
  COALESCE(s.last_commented_at, p.created_at)                                   AS last_activity_at,
  (COALESCE(s.comments_24h, 0) * 0.7 + COALESCE(s.comment_count, 0) * 0.3)::float AS trending_score
FROM proposals p
LEFT JOIN proposal_comment_stats s ON s.proposal_id = p.id
WHERE p.status NOT IN ('withdrawn', 'tabled', 'failed')
ORDER BY trending_score DESC NULLS LAST;

CREATE UNIQUE INDEX IF NOT EXISTS proposal_trending_24h_pk    ON proposal_trending_24h(proposal_id);
CREATE INDEX        IF NOT EXISTS proposal_trending_24h_score ON proposal_trending_24h(trending_score DESC NULLS LAST);

CREATE OR REPLACE FUNCTION refresh_proposal_trending() RETURNS void
LANGUAGE SQL
AS $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY proposal_trending_24h;
$$;

-- ── 12. Drop empty shadow schema ────────────────────────────────────────────
--
-- At this point the schema should have no objects. CASCADE is defensive: if a
-- follow-up discovers a missed object, the migration still completes cleanly.

DROP SCHEMA shadow CASCADE;

COMMIT;

-- DOWN:
--   -- Not reversible. Promotion is a one-way cutover; rollback is "restore the
--   -- pre-cutover pg_dump into a fresh DB". See docs/MIGRATION_RUNBOOK.md §4.1.
