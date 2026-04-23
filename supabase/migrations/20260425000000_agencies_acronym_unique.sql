-- 20260425000000_agencies_acronym_unique.sql
-- FIX-101 (regulations.gov rewrite): add UNIQUE on agencies.acronym so the
-- batched regulations writer can upsert new agencies via `ON CONFLICT
-- (acronym)` in one statement instead of SELECT→INSERT per row.
--
-- Acronym is already treated as the de-facto dedup key across the codebase
-- (regulations writer looks up by acronym, agency-names map is keyed on
-- acronym, the @civitics/db agencyFullName(acronym) helper assumes
-- uniqueness). Pro + local both verified zero duplicates prior to this
-- migration.
--
-- Full unique, not partial: PostgREST's column-list `ON CONFLICT` arbiter
-- inference has proven unreliable for partial indexes across our stack —
-- the donation tuple and usaspending_award_id indexes both hit the same
-- "no unique or exclusion constraint matching" error until converted to
-- full unique. Postgres's default NULL-distinct semantics still allow
-- multiple rows with NULL acronym to coexist, so the semantic behaviour
-- for sub-bureau rows without an acronym is preserved.

CREATE UNIQUE INDEX IF NOT EXISTS agencies_acronym_unique
  ON public.agencies (acronym);

COMMENT ON INDEX public.agencies_acronym_unique IS
  'Enables ON CONFLICT (acronym) batched upsert from regulations.gov + agencies-hierarchy pipelines.';
