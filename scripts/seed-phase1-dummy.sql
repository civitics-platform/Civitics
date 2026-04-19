-- =============================================================================
-- Phase 1 dummy seed — small, local-only data for sparse-area testing.
-- Safe to re-run (idempotent-ish inserts with deterministic content).
-- =============================================================================

-- 20 civic_comments spread across 5 recent proposals so Trending /
-- Most-Commented tabs have something to render. Uses real auth.users rows.
WITH recent_proposals AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at DESC) AS rn
  FROM proposals
  WHERE status NOT IN ('withdrawn', 'tabled', 'failed')
  LIMIT 5
),
users AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) AS rn
  FROM auth.users
  LIMIT 3
),
pairs AS (
  SELECT p.id AS proposal_id, u.id AS user_id,
         (p.rn * 10 + u.rn)::int AS n
  FROM recent_proposals p
  CROSS JOIN users u
)
INSERT INTO civic_comments (proposal_id, user_id, body, position, created_at)
SELECT
  proposal_id,
  user_id,
  'Test comment #' || n || ' — seeded for trending-tab verification.',
  CASE (n % 4)
    WHEN 0 THEN 'support'
    WHEN 1 THEN 'oppose'
    WHEN 2 THEN 'neutral'
    ELSE 'question'
  END,
  NOW() - ((n % 24) || ' hours')::interval
FROM pairs
WHERE NOT EXISTS (
  SELECT 1 FROM civic_comments c
  WHERE c.proposal_id = pairs.proposal_id
    AND c.user_id = pairs.user_id
    AND c.body = 'Test comment #' || n || ' — seeded for trending-tab verification.'
);

-- Refresh the trending materialized view so the data surfaces immediately.
REFRESH MATERIALIZED VIEW CONCURRENTLY proposal_trending_24h;
