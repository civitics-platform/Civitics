-- 20260423000000_financial_relationships_donation_unique.sql
-- FIX-101 (FEC bulk rewrite): add a unique index on the
-- (relationship_type, from_id, to_id, cycle_year) tuple so the FEC bulk
-- pipeline can batch-upsert via ON CONFLICT instead of per-row SELECT →
-- INSERT/UPDATE. Cuts ~16k × 2 Pro round-trips per run down to ~33 chunked
-- calls.
--
-- Why not partial (WHERE relationship_type = 'donation'): PostgREST's upsert
-- emits `ON CONFLICT (cols)` without WHERE; Postgres's column-list arbiter
-- rejects partial unique indexes even when the new row would satisfy the
-- predicate. A full unique index is the only shape PostgREST can target.
--
-- Null cycle_year values (contracts/grants/holdings) do not collide with
-- each other — Postgres's default NULL-distinct semantics preserve the
-- legacy behaviour for non-donation rows.
--
-- No existing rows conflict (donations are per-cycle aggregates with a
-- unique shape); the index is safe to add without a data-level dedup pass.

CREATE UNIQUE INDEX IF NOT EXISTS financial_relationships_relcycle_unique
  ON public.financial_relationships (relationship_type, from_id, to_id, cycle_year);

COMMENT ON INDEX public.financial_relationships_relcycle_unique IS
  'Enables ON CONFLICT batched upsert of donation aggregates keyed by (type, committee, candidate, cycle). Non-donation rows with NULL cycle_year do not collide under default NULL-distinct semantics.';

-- ── Drop UNIQUE(canonical_name, entity_type) on financial_entities ───────────
-- FEC canonical dedup is authoritative via fec_committee_id UNIQUE; the
-- secondary (canonical_name, entity_type) uniqueness was meant to merge
-- cross-source writes but in practice forces different FEC committees whose
-- normalised names happen to collide (subsidiaries, renamed orgs) into the
-- same row. That breaks batched upsert and costs data. Canonical-name
-- dedup, if still desired, belongs in a dedicated reconciliation pass, not
-- a blocking constraint on every write.

ALTER TABLE public.financial_entities
  DROP CONSTRAINT IF EXISTS financial_entities_canonical_name_entity_type_key;

-- Preserve the lookup index so canonical_name searches stay fast.
CREATE INDEX IF NOT EXISTS financial_entities_canonical_name_type
  ON public.financial_entities (canonical_name, entity_type);
