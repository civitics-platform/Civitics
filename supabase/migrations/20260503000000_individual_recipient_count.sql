-- =============================================================================
-- FIX-194 — Pre-compute recipient_count for individual donors
--
-- Adds recipient_count SMALLINT to financial_entities. For entity_type='individual',
-- this stores how many distinct officials that donor contributed to across all cycles.
-- Used by the connection graph's connector-mode (option b of FIX-194) to efficiently
-- filter for cross-official donors without a per-request subquery.
--
-- For non-individual entities (PACs, corps, etc.) the column stays at 0.
-- Populated by rebuild_entity_connections() — see migration 20260503000001.
-- =============================================================================

ALTER TABLE public.financial_entities
  ADD COLUMN IF NOT EXISTS recipient_count SMALLINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.financial_entities.recipient_count IS
  'For entity_type=''individual'': number of distinct officials this donor contributed to (across all cycles). Updated by rebuild_entity_connections(). Always 0 for non-individual entities.';

CREATE INDEX IF NOT EXISTS financial_entities_recipient_count_idx
  ON public.financial_entities (recipient_count)
  WHERE entity_type = 'individual';

COMMENT ON INDEX public.financial_entities_recipient_count_idx IS
  'Partial index for connector-mode donor filtering: find individuals who donated to 2+ officials. Non-individual entities are excluded — they never use this column.';
