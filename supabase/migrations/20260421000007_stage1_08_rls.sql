-- =============================================================================
-- Stage 1 · 08 · Row-Level Security policies for shadow tables
--
-- Mirrors the existing public-schema RLS pattern:
--   - Civic data (proposals, detail tables, votes, meetings, financial) =
--       public read, no public writes, service_role bypasses.
--   - Operational tables (external_source_refs, enrichment_queue,
--       pipeline_state, data_sync_log) = service-role only, no public access.
--   - User-linked tables (claim_queue) = users can CRUD their own rows.
--
-- All writes in Stage 1 come from pipelines (service_role) or the derivation
-- job (service_role). No `authenticated` INSERT/UPDATE policies for any
-- shadow table in Phase 1.
-- =============================================================================

-- ── Civic data: public SELECT, service_role writes only ─────────────────────

ALTER TABLE shadow.proposals            ENABLE ROW LEVEL SECURITY;
ALTER TABLE shadow.bill_details         ENABLE ROW LEVEL SECURITY;
ALTER TABLE shadow.case_details         ENABLE ROW LEVEL SECURITY;
ALTER TABLE shadow.measure_details      ENABLE ROW LEVEL SECURITY;
ALTER TABLE shadow.initiative_details   ENABLE ROW LEVEL SECURITY;
ALTER TABLE shadow.proposal_actions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE shadow.meetings             ENABLE ROW LEVEL SECURITY;
ALTER TABLE shadow.agenda_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE shadow.votes                ENABLE ROW LEVEL SECURITY;
ALTER TABLE shadow.financial_entities   ENABLE ROW LEVEL SECURITY;
ALTER TABLE shadow.financial_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE shadow.entity_connections   ENABLE ROW LEVEL SECURITY;

-- Public read policies (citizen-facing civic data)
DO $$ BEGIN
  CREATE POLICY "shadow_proposals_select"            ON shadow.proposals            FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "shadow_bill_details_select"         ON shadow.bill_details         FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "shadow_case_details_select"         ON shadow.case_details         FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "shadow_measure_details_select"      ON shadow.measure_details      FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "shadow_initiative_details_select"   ON shadow.initiative_details   FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "shadow_proposal_actions_select"     ON shadow.proposal_actions     FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "shadow_meetings_select"             ON shadow.meetings             FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "shadow_agenda_items_select"         ON shadow.agenda_items         FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "shadow_votes_select"                ON shadow.votes                FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "shadow_financial_entities_select"   ON shadow.financial_entities   FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "shadow_financial_relationships_select" ON shadow.financial_relationships FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "shadow_entity_connections_select"   ON shadow.entity_connections   FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Operational tables: service_role only, no public policies ───────────────
--
-- external_source_refs RLS already enabled in migration 02 with no policies.
-- The tables below follow the same pattern: RLS on, zero policies, so only
-- service_role (which bypasses RLS) can read or write.

ALTER TABLE shadow.enrichment_queue     ENABLE ROW LEVEL SECURITY;
ALTER TABLE shadow.pipeline_state       ENABLE ROW LEVEL SECURITY;
ALTER TABLE shadow.data_sync_log        ENABLE ROW LEVEL SECURITY;

-- No policies created — service_role bypasses RLS, anon/authenticated are
-- locked out by default.

-- ── claim_queue: users can CRUD their own rows ──────────────────────────────

ALTER TABLE shadow.claim_queue          ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  -- Authenticated users can see their own requests + aggregate counts for
  -- other jurisdictions is exposed via a view (not this table directly)
  CREATE POLICY "shadow_claim_queue_own_select" ON shadow.claim_queue
    FOR SELECT TO authenticated
    USING (requested_by = auth.uid());

  CREATE POLICY "shadow_claim_queue_own_insert" ON shadow.claim_queue
    FOR INSERT TO authenticated
    WITH CHECK (requested_by = auth.uid());

  CREATE POLICY "shadow_claim_queue_own_update" ON shadow.claim_queue
    FOR UPDATE TO authenticated
    USING (requested_by = auth.uid())
    WITH CHECK (requested_by = auth.uid());

  CREATE POLICY "shadow_claim_queue_own_delete" ON shadow.claim_queue
    FOR DELETE TO authenticated
    USING (requested_by = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Grants (defensive; ALTER DEFAULT PRIVILEGES in migration 01 handled most) ──
-- Explicit grants for tables that existed before ALTER DEFAULT PRIVILEGES took
-- effect are unnecessary here because shadow.* was created fresh in migrations
-- 02–07 with default privileges applied. Kept as a no-op block for clarity.

-- DOWN:
--   -- Drop policies (redundant with table drops, but explicit for reversibility)
--   DROP POLICY IF EXISTS "shadow_claim_queue_own_delete"    ON shadow.claim_queue;
--   DROP POLICY IF EXISTS "shadow_claim_queue_own_update"    ON shadow.claim_queue;
--   DROP POLICY IF EXISTS "shadow_claim_queue_own_insert"    ON shadow.claim_queue;
--   DROP POLICY IF EXISTS "shadow_claim_queue_own_select"    ON shadow.claim_queue;
--   DROP POLICY IF EXISTS "shadow_entity_connections_select" ON shadow.entity_connections;
--   DROP POLICY IF EXISTS "shadow_financial_relationships_select" ON shadow.financial_relationships;
--   DROP POLICY IF EXISTS "shadow_financial_entities_select" ON shadow.financial_entities;
--   DROP POLICY IF EXISTS "shadow_votes_select"              ON shadow.votes;
--   DROP POLICY IF EXISTS "shadow_agenda_items_select"       ON shadow.agenda_items;
--   DROP POLICY IF EXISTS "shadow_meetings_select"           ON shadow.meetings;
--   DROP POLICY IF EXISTS "shadow_proposal_actions_select"   ON shadow.proposal_actions;
--   DROP POLICY IF EXISTS "shadow_initiative_details_select" ON shadow.initiative_details;
--   DROP POLICY IF EXISTS "shadow_measure_details_select"    ON shadow.measure_details;
--   DROP POLICY IF EXISTS "shadow_case_details_select"       ON shadow.case_details;
--   DROP POLICY IF EXISTS "shadow_bill_details_select"       ON shadow.bill_details;
--   DROP POLICY IF EXISTS "shadow_proposals_select"          ON shadow.proposals;
