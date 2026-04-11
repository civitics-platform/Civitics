-- ─── Sprint 9: Population-normalised quality gate ────────────────────────────
-- Adds an optional jurisdiction_id FK to civic_initiatives so the quality gate
-- can look up the district's population and scale the upvote threshold accordingly.
-- Falls back to scope-based population defaults when NULL.

ALTER TABLE civic_initiatives
  ADD COLUMN IF NOT EXISTS jurisdiction_id UUID REFERENCES jurisdictions(id) ON DELETE SET NULL;

COMMENT ON COLUMN civic_initiatives.jurisdiction_id IS
  'Optional link to a jurisdiction for population-normalised quality gate thresholds.
   When set, the upvote threshold scales with the jurisdiction population.
   Falls back to scope-based defaults (local ~75K, state ~6.5M, federal ~335M) when NULL.';
