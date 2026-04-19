-- =============================================================================
-- Comment aggregations — FIX-029 Trending / Most Commented / New tabs
-- =============================================================================
-- Adds a lightweight view with per-proposal comment counts and a materialized
-- view scoring the last 24h of activity. The trending score is weighted so
-- recent activity dominates: 0.7 * recent_24h + 0.3 * total_count.
-- Refreshed from the nightly connections step.
-- =============================================================================

CREATE OR REPLACE VIEW proposal_comment_stats AS
SELECT
  c.proposal_id,
  COUNT(*)::int                                                   AS comment_count,
  COUNT(DISTINCT c.user_id)::int                                  AS distinct_commenters,
  MAX(c.created_at)                                               AS last_commented_at,
  COUNT(*) FILTER (WHERE c.created_at >= NOW() - INTERVAL '24 hours')::int AS comments_24h,
  COUNT(*) FILTER (WHERE c.created_at >= NOW() - INTERVAL '7 days')::int   AS comments_7d
FROM civic_comments c
WHERE c.is_deleted = false
GROUP BY c.proposal_id;

-- Materialized view for the Trending tab. Refreshed nightly.
CREATE MATERIALIZED VIEW IF NOT EXISTS proposal_trending_24h AS
SELECT
  p.id                                                                          AS proposal_id,
  p.title,
  p.type,
  p.status,
  COALESCE(s.comments_24h, 0)                                                   AS comments_24h,
  COALESCE(s.comment_count, 0)                                                  AS total_comments,
  COALESCE(s.last_commented_at, p.created_at)                                   AS last_activity_at,
  -- Weighted score: recent activity dominates
  (COALESCE(s.comments_24h, 0) * 0.7 + COALESCE(s.comment_count, 0) * 0.3)::float AS trending_score
FROM proposals p
LEFT JOIN proposal_comment_stats s ON s.proposal_id = p.id
WHERE p.status NOT IN ('withdrawn', 'tabled', 'failed')
ORDER BY trending_score DESC NULLS LAST;

CREATE UNIQUE INDEX IF NOT EXISTS proposal_trending_24h_pk ON proposal_trending_24h(proposal_id);
CREATE INDEX IF NOT EXISTS proposal_trending_24h_score ON proposal_trending_24h(trending_score DESC NULLS LAST);

-- Helper for the nightly orchestrator.
CREATE OR REPLACE FUNCTION refresh_proposal_trending() RETURNS void
LANGUAGE SQL
AS $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY proposal_trending_24h;
$$;
