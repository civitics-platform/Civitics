-- =============================================================================
-- FIX-097 follow-up — drop the 1-arg overload of treemap_officials_by_donations
--
-- The cutover restoration recreated both pre-cutover overloads:
--   treemap_officials_by_donations(lim integer)
--   treemap_officials_by_donations(lim integer, p_chamber text, p_party text, p_state text)
--
-- PostgREST cannot disambiguate when the caller passes only `{ lim }` (the
-- bodies of the two are nearly identical and both signatures match):
--   "Could not choose the best candidate function between: ..."
--
-- The 4-arg version handles every call the 1-arg version did (NULL filters
-- become unconditional), and the only live caller (snapshot/route.ts) passes
-- only `{ lim }` — PostgREST will match the 4-arg signature with the other
-- params taking their DEFAULT NULL.
--
-- Drop the simple overload so the 4-arg version is the unambiguous match.
-- =============================================================================

DROP FUNCTION IF EXISTS public.treemap_officials_by_donations(INTEGER);
