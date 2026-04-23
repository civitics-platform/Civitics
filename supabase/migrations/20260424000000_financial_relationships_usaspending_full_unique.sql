-- 20260424000000_financial_relationships_usaspending_full_unique.sql
-- FIX-101 (USASpending rewrite): replace the partial unique index on
-- usaspending_award_id with a full unique, same as we did for the donation
-- tuple. PostgREST's column-list `ON CONFLICT` can't target partial unique
-- indexes reliably, so batched upsert from the USASpending writer fails
-- with "no unique or exclusion constraint matching the ON CONFLICT
-- specification".
--
-- Postgres's default NULL-distinct semantics keep the behaviour correct for
-- non-USASpending rows (donations, gifts, holdings, …) that have NULL in
-- this column — multiple NULLs don't collide.

DROP INDEX IF EXISTS public.financial_relationships_usaspending_unique;

CREATE UNIQUE INDEX IF NOT EXISTS financial_relationships_usaspending_unique
  ON public.financial_relationships (usaspending_award_id);

COMMENT ON INDEX public.financial_relationships_usaspending_unique IS
  'Full unique on usaspending_award_id (was partial WHERE col IS NOT NULL). Enables ON CONFLICT batched upsert; multiple NULLs coexist under default NULL-distinct semantics.';
