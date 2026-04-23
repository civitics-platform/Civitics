-- 20260425000100_openstates_backfill_source_refs.sql
-- FIX-101 (OpenStates rewrite): backfill external_source_refs for officials
-- that were dedup'd via `source_ids->>'openstates_id'` in the pre-cutover
-- pipeline. The new batched writer looks up existing officials through
-- external_source_refs exclusively; without this backfill, every existing
-- state legislator would be re-inserted as a duplicate on the next run.
--
-- Idempotent (ON CONFLICT DO NOTHING on the (source, external_id) unique).
-- No-op on Pro until state legislators land there for the first time.

INSERT INTO public.external_source_refs (source, external_id, entity_type, entity_id, metadata)
SELECT
  'openstates',
  source_ids->>'openstates_id',
  'official',
  id,
  jsonb_build_object('backfilled_from', 'source_ids.openstates_id')
FROM public.officials
WHERE source_ids->>'openstates_id' IS NOT NULL
ON CONFLICT (source, external_id) DO NOTHING;
