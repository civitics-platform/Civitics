-- =============================================================================
-- 20260411010026_civic_initiatives.sql
-- Civic Initiatives: core tables for lifecycle-based community platform
-- Three tables: civic_initiatives, civic_initiative_signatures, civic_initiative_responses
-- =============================================================================

-- ── Enums ─────────────────────────────────────────────────────────────────────

CREATE TYPE initiative_stage AS ENUM ('draft', 'deliberate', 'mobilise', 'resolved');
CREATE TYPE initiative_authorship AS ENUM ('individual', 'community');
CREATE TYPE initiative_scope AS ENUM ('federal', 'state', 'local');
CREATE TYPE initiative_resolution AS ENUM ('sponsored', 'declined', 'withdrawn', 'expired');
CREATE TYPE signature_verification AS ENUM ('unverified', 'email', 'district');
CREATE TYPE official_response_type AS ENUM ('support', 'oppose', 'pledge', 'refer', 'no_response');

-- ── Table 1: civic_initiatives ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS civic_initiatives (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title                 TEXT NOT NULL CHECK (char_length(title) BETWEEN 10 AND 120),
  summary               TEXT CHECK (char_length(summary) <= 500),
  body_md               TEXT NOT NULL,
  stage                 initiative_stage NOT NULL DEFAULT 'draft',
  authorship_type       initiative_authorship NOT NULL DEFAULT 'individual',
  primary_author_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  linked_proposal_id    UUID REFERENCES proposals(id) ON DELETE SET NULL,
  scope                 initiative_scope NOT NULL DEFAULT 'federal',
  target_district       TEXT,
  issue_area_tags       TEXT[] NOT NULL DEFAULT '{}',
  quality_gate_score    JSONB NOT NULL DEFAULT '{}',
  mobilise_started_at   TIMESTAMPTZ,
  resolved_at           TIMESTAMPTZ,
  resolution_type       initiative_resolution,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS civic_initiatives_stage ON civic_initiatives(stage);
CREATE INDEX IF NOT EXISTS civic_initiatives_author ON civic_initiatives(primary_author_id);
CREATE INDEX IF NOT EXISTS civic_initiatives_proposal ON civic_initiatives(linked_proposal_id);
CREATE INDEX IF NOT EXISTS civic_initiatives_scope ON civic_initiatives(scope);
CREATE INDEX IF NOT EXISTS civic_initiatives_tags ON civic_initiatives USING GIN(issue_area_tags);

-- ── Table 2: civic_initiative_signatures ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS civic_initiative_signatures (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id     UUID NOT NULL REFERENCES civic_initiatives(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  verification_tier signature_verification NOT NULL DEFAULT 'unverified',
  district          TEXT,
  signed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(initiative_id, user_id)
);

CREATE INDEX IF NOT EXISTS civic_sigs_initiative ON civic_initiative_signatures(initiative_id);
CREATE INDEX IF NOT EXISTS civic_sigs_user ON civic_initiative_signatures(user_id);
CREATE INDEX IF NOT EXISTS civic_sigs_district ON civic_initiative_signatures(initiative_id, district);

-- ── Table 3: civic_initiative_responses ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS civic_initiative_responses (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id         UUID NOT NULL REFERENCES civic_initiatives(id) ON DELETE CASCADE,
  official_id           UUID NOT NULL REFERENCES officials(id) ON DELETE CASCADE,
  response_type         official_response_type NOT NULL DEFAULT 'no_response',
  body_text             TEXT,
  committee_referred    TEXT,
  window_opened_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  window_closes_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  responded_at          TIMESTAMPTZ,
  is_verified_staff     BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(initiative_id, official_id)
);

CREATE INDEX IF NOT EXISTS civic_responses_initiative ON civic_initiative_responses(initiative_id);
CREATE INDEX IF NOT EXISTS civic_responses_official ON civic_initiative_responses(official_id);
CREATE INDEX IF NOT EXISTS civic_responses_type ON civic_initiative_responses(response_type);

-- ── RLS Policies ──────────────────────────────────────────────────────────────

-- civic_initiatives: SELECT open to all; INSERT/UPDATE for authenticated where author is self; no DELETE
ALTER TABLE civic_initiatives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "civic_initiatives_select_all" ON civic_initiatives
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "civic_initiatives_insert_own" ON civic_initiatives
  FOR INSERT TO authenticated
  WITH CHECK (primary_author_id = auth.uid());

CREATE POLICY "civic_initiatives_update_own" ON civic_initiatives
  FOR UPDATE TO authenticated
  USING (primary_author_id = auth.uid())
  WITH CHECK (primary_author_id = auth.uid());

-- civic_initiative_signatures: SELECT open to all; INSERT/DELETE for own rows
ALTER TABLE civic_initiative_signatures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "civic_sigs_select_all" ON civic_initiative_signatures
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "civic_sigs_insert_own" ON civic_initiative_signatures
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "civic_sigs_delete_own" ON civic_initiative_signatures
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- civic_initiative_responses: SELECT open to all; INSERT/UPDATE for authenticated (staff verified at API layer); no DELETE
ALTER TABLE civic_initiative_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "civic_responses_select_all" ON civic_initiative_responses
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "civic_responses_insert_auth" ON civic_initiative_responses
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "civic_responses_update_auth" ON civic_initiative_responses
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

-- ── updated_at trigger ────────────────────────────────────────────────────────

-- QWEN-ADDED: auto-update updated_at on civic_initiatives
CREATE TRIGGER update_civic_initiatives_updated_at
  BEFORE UPDATE ON civic_initiatives
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- DOWN: DROP TABLE IF EXISTS civic_initiative_responses CASCADE;
--       DROP TABLE IF EXISTS civic_initiative_signatures CASCADE;
--       DROP TABLE IF EXISTS civic_initiatives CASCADE;
--       DROP TYPE IF EXISTS official_response_type;
--       DROP TYPE IF EXISTS signature_verification;
--       DROP TYPE IF EXISTS initiative_resolution;
--       DROP TYPE IF EXISTS initiative_scope;
--       DROP TYPE IF EXISTS initiative_authorship;
--       DROP TYPE IF EXISTS initiative_stage;
