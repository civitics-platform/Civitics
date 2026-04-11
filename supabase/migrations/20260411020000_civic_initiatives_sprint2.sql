-- =============================================================================
-- 20260411020000_civic_initiatives_sprint2.sql
-- Civic Initiatives Sprint 2: version history + upvotes tables
-- =============================================================================

-- ── Table: civic_initiative_versions ─────────────────────────────────────────
-- One row per edit to the proposal body_md. Created automatically on PATCH.

CREATE TABLE IF NOT EXISTS civic_initiative_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id   UUID NOT NULL REFERENCES civic_initiatives(id) ON DELETE CASCADE,
  version_number  INTEGER NOT NULL,
  body_md         TEXT NOT NULL,
  title           TEXT NOT NULL,
  edited_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(initiative_id, version_number)
);

CREATE INDEX IF NOT EXISTS civic_versions_initiative ON civic_initiative_versions(initiative_id);
CREATE INDEX IF NOT EXISTS civic_versions_editor     ON civic_initiative_versions(edited_by);

-- ── Table: civic_initiative_upvotes ──────────────────────────────────────────
-- One row per user per initiative. Toggle pattern (insert/delete).

CREATE TABLE IF NOT EXISTS civic_initiative_upvotes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id   UUID NOT NULL REFERENCES civic_initiatives(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(initiative_id, user_id)
);

CREATE INDEX IF NOT EXISTS civic_upvotes_initiative ON civic_initiative_upvotes(initiative_id);
CREATE INDEX IF NOT EXISTS civic_upvotes_user       ON civic_initiative_upvotes(user_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE civic_initiative_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE civic_initiative_upvotes  ENABLE ROW LEVEL SECURITY;

-- Versions: read-only for all; no direct insert (done via API)
CREATE POLICY "civic_versions_select_all"
  ON civic_initiative_versions FOR SELECT
  USING (true);

-- Upvotes: read-only for all
CREATE POLICY "civic_upvotes_select_all"
  ON civic_initiative_upvotes FOR SELECT
  USING (true);

-- Upvotes: authenticated users can insert their own row
CREATE POLICY "civic_upvotes_insert_own"
  ON civic_initiative_upvotes FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Upvotes: users can delete their own row (unsign pattern)
CREATE POLICY "civic_upvotes_delete_own"
  ON civic_initiative_upvotes FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
