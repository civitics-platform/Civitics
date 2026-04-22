-- Migration: Fix function bodies that still reference dropped shadow schema.
--
-- 20260422000000 promoted shadow.* functions to public.* via SET SCHEMA, but
-- that only changes the function's schema membership — the body text still
-- reads `shadow.proposals`. When shadow was dropped in step 12, those calls
-- started failing at runtime.
--
-- This migration CREATE OR REPLACEs the affected functions with
-- public-schema-qualified bodies.

-- Restores the BEFORE INSERT/UPDATE trigger's ability to backfill
-- bill_details.jurisdiction_id from the parent proposals row.
CREATE OR REPLACE FUNCTION public.bill_details_sync_denorm() RETURNS trigger AS $$
BEGIN
  SELECT jurisdiction_id INTO NEW.jurisdiction_id
  FROM public.proposals WHERE id = NEW.proposal_id;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
