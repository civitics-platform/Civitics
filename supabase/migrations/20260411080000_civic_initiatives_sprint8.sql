-- ─── Civic Initiatives Sprint 8: Platform integration ────────────────────────
-- Two new tables enabling follow/watch semantics and initiative↔proposal links.

-- ── Table 1: civic_initiative_follows ──────────────────────────────────────────
-- Users who are watching an initiative. A lightweight subscription — used to
-- surface "initiatives you're following" in the user dashboard and to drive
-- future notification digests. One row per user per initiative.

CREATE TABLE IF NOT EXISTS civic_initiative_follows (
  id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id UUID    NOT NULL REFERENCES civic_initiatives(id) ON DELETE CASCADE,
  user_id       UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(initiative_id, user_id)
);

CREATE INDEX IF NOT EXISTS civic_follows_initiative ON civic_initiative_follows(initiative_id);
CREATE INDEX IF NOT EXISTS civic_follows_user       ON civic_initiative_follows(user_id);

ALTER TABLE civic_initiative_follows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "civic_follows_select_all"
  ON civic_initiative_follows FOR SELECT USING (true);

CREATE POLICY "civic_follows_insert_own"
  ON civic_initiative_follows FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "civic_follows_delete_own"
  ON civic_initiative_follows FOR DELETE
  USING (user_id = auth.uid());

-- ── Table 2: civic_initiative_proposal_links ──────────────────────────────────
-- Many-to-many link between civic initiatives and legislative proposals.
-- An initiative can reference "we want Congress to pass HR-1234" — this makes
-- that relationship explicit and surfaces related initiatives on proposal pages.
-- Only the initiative's primary_author can create/remove links.

CREATE TABLE IF NOT EXISTS civic_initiative_proposal_links (
  id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id UUID    NOT NULL REFERENCES civic_initiatives(id) ON DELETE CASCADE,
  proposal_id   UUID    NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  linked_by     UUID    NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(initiative_id, proposal_id)
);

CREATE INDEX IF NOT EXISTS civic_link_initiative ON civic_initiative_proposal_links(initiative_id);
CREATE INDEX IF NOT EXISTS civic_link_proposal   ON civic_initiative_proposal_links(proposal_id);

ALTER TABLE civic_initiative_proposal_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "civic_links_select_all"
  ON civic_initiative_proposal_links FOR SELECT USING (true);

-- Author validates via API layer (primary_author_id check) — any auth user can insert
CREATE POLICY "civic_links_insert_auth"
  ON civic_initiative_proposal_links FOR INSERT
  WITH CHECK (linked_by = auth.uid());

CREATE POLICY "civic_links_delete_own"
  ON civic_initiative_proposal_links FOR DELETE
  USING (linked_by = auth.uid());

-- DOWN:
-- DROP TABLE IF EXISTS civic_initiative_proposal_links CASCADE;
-- DROP TABLE IF EXISTS civic_initiative_follows CASCADE;
