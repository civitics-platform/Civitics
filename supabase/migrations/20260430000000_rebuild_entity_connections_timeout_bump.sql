-- =============================================================================
-- FIX-171 — bump rebuild_entity_connections() statement_timeout
--
-- The function was timing out in the GitHub Actions nightly on 2026-04-30
-- with PG error 57014 ("canceling statement due to statement timeout"). Prior
-- override (from migration 20260422000005) was 120s. Function completed in
-- 96s on 2026-04-28; two days of vote/data growth tipped it past the cap.
--
-- Bump to 15min — generous headroom while we keep the same TRUNCATE + full-
-- rebuild shape. If this fires again at 15min in the future, that's the
-- signal to switch to incremental rebuilds rather than keep raising the cap.
-- =============================================================================

ALTER FUNCTION public.rebuild_entity_connections() SET statement_timeout = '15min';
