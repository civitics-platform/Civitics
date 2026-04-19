-- =============================================================================
-- proposal_cosponsors — Phase 2 onramp (GovTrack cosponsorship)
-- =============================================================================
-- Populated by a future pipeline (packages/data/src/pipelines/govtrack-cosponsors).
-- Feeds a new "cosponsor" edge type in entity_connections.
-- =============================================================================

CREATE TABLE IF NOT EXISTS proposal_cosponsors (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id           UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  official_id           UUID NOT NULL REFERENCES officials(id) ON DELETE CASCADE,
  is_original_cosponsor BOOLEAN NOT NULL DEFAULT false,
  date_added            DATE,
  date_withdrawn        DATE,
  source                TEXT NOT NULL DEFAULT 'govtrack',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS proposal_cosponsors_unique
  ON proposal_cosponsors(proposal_id, official_id);

CREATE INDEX IF NOT EXISTS proposal_cosponsors_official_id
  ON proposal_cosponsors(official_id);

CREATE INDEX IF NOT EXISTS proposal_cosponsors_proposal_id
  ON proposal_cosponsors(proposal_id);
