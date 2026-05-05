-- =============================================================================
-- Proposal popularity (24h page views) — FIX-200, Wave D of perf push
-- =============================================================================
-- Replaces a hot-path JS aggregation in apps/civitics/app/proposals/page.tsx
-- that fetched 200 page_views rows per request and counted in JavaScript.
-- page_views is a multi-million-row table; doing the work in SQL with a
-- materialized view is ~100× faster and uses an index, not a seq scan.
--
-- Schema reference: page_views columns are viewed_at (NOT occurred_at),
-- entity_id (already UUID), is_bot. See supabase/migrations/0011_page_views.sql.
--
-- Refreshed alongside proposal_trending_24h in the nightly orchestrator.
-- =============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS proposal_popularity_24h AS
SELECT
  pv.entity_id      AS proposal_id,
  COUNT(*)::int     AS view_count,
  MAX(pv.viewed_at) AS last_viewed_at
FROM page_views pv
WHERE pv.entity_type = 'proposal'
  AND pv.is_bot = false
  AND pv.entity_id IS NOT NULL
  AND pv.viewed_at > NOW() - INTERVAL '24 hours'
GROUP BY pv.entity_id
ORDER BY view_count DESC;

CREATE UNIQUE INDEX IF NOT EXISTS proposal_popularity_24h_pk
  ON proposal_popularity_24h(proposal_id);
CREATE INDEX IF NOT EXISTS proposal_popularity_24h_count
  ON proposal_popularity_24h(view_count DESC);

CREATE OR REPLACE FUNCTION refresh_proposal_popularity() RETURNS void
LANGUAGE SQL
AS $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY proposal_popularity_24h;
$$;
