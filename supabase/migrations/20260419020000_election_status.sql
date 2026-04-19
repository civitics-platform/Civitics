-- =============================================================================
-- Election status — FIX-022 Current term + upcoming election
-- =============================================================================
-- Adds term timing + next election fields to officials. Populated by the new
-- elections pipeline (OpenStates primary, Ballotpedia fallback for federal).
-- =============================================================================

ALTER TABLE officials
  ADD COLUMN IF NOT EXISTS current_term_start  DATE,
  ADD COLUMN IF NOT EXISTS current_term_end    DATE,
  ADD COLUMN IF NOT EXISTS next_election_date  DATE,
  ADD COLUMN IF NOT EXISTS next_election_type  TEXT,
  ADD COLUMN IF NOT EXISTS is_up_for_election  BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS officials_next_election_date ON officials(next_election_date) WHERE next_election_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS officials_is_up_for_election ON officials(is_up_for_election) WHERE is_up_for_election = true;
CREATE INDEX IF NOT EXISTS officials_current_term_end   ON officials(current_term_end) WHERE current_term_end IS NOT NULL;
