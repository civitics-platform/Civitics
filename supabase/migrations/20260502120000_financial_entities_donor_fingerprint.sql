-- 20260502120000_financial_entities_donor_fingerprint.sql
-- FIX-181 (FEC indiv ingest): enable batched upsert of individual donors.
--
-- Background: FIX-101 (20260423000000) dropped UNIQUE(canonical_name, entity_type)
-- because real PAC committees with colliding canonical names were causing
-- batched upserts to fail. PACs dedup on `fec_committee_id` UNIQUE instead.
--
-- Individuals have no FEC ID. Their dedup key is donor_fingerprint =
-- upper(NAME) + "|" + ZIP5 — FEC's standard near-duplicate convention. We
-- add this as a dedicated nullable column with a non-partial UNIQUE INDEX:
--   - PAC / corp / etc. rows leave it NULL → multiple NULLs allowed under
--     default NULL-distinct semantics, no interference with PAC dedup.
--   - Individual rows populate it → fingerprint collisions merge.
--   - Non-partial index satisfies PostgREST's column-list ON CONFLICT arbiter
--     (the same constraint that ruled out partial indexes in FIX-101).

ALTER TABLE public.financial_entities
  ADD COLUMN IF NOT EXISTS donor_fingerprint TEXT;

COMMENT ON COLUMN public.financial_entities.donor_fingerprint IS
  'Individual-donor dedup key: upper(NAME) + "|" + ZIP5. NULL for non-individual entities. Used as the ON CONFLICT target by the FEC indiv pipeline.';

CREATE UNIQUE INDEX IF NOT EXISTS financial_entities_donor_fingerprint_unique
  ON public.financial_entities (donor_fingerprint);

COMMENT ON INDEX public.financial_entities_donor_fingerprint_unique IS
  'Enables ON CONFLICT batched upsert of individual donors. NULLs are distinct, so PAC / corp / union rows (which leave donor_fingerprint NULL) do not collide.';
