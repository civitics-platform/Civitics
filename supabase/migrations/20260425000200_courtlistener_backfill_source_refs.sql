-- 20260425000200_courtlistener_backfill_source_refs.sql
-- FIX-101 (CourtListener rewrite): backfill external_source_refs for
-- officials that were dedup'd via `source_ids->>'courtlistener_person_id'`
-- in the pre-cutover pipeline. The new batched writer looks up existing
-- judges through external_source_refs exclusively; without this backfill
-- every existing federal judge would be re-inserted as a duplicate.
--
-- Idempotent (ON CONFLICT DO NOTHING on UNIQUE(source, external_id)).
-- Pro has ~365 judges from the pre-cutover run that need these refs.

INSERT INTO public.external_source_refs (source, external_id, entity_type, entity_id, metadata)
SELECT
  'courtlistener',
  source_ids->>'courtlistener_person_id',
  'official',
  id,
  jsonb_build_object('backfilled_from', 'source_ids.courtlistener_person_id')
FROM public.officials
WHERE source_ids->>'courtlistener_person_id' IS NOT NULL
ON CONFLICT (source, external_id) DO NOTHING;
