-- =============================================================================
-- 20260418100000_pv_path_transitions.sql
-- Aggregate session-level page transitions for the public "browsing paths"
-- dashboard panel (FIX-047).
--
-- Privacy model:
--   * page_views already stores no PII (no user_id, no IP, ephemeral session_id).
--   * This function only ever returns aggregate transition counts, filtered by
--     a minimum-session-count threshold to prevent re-identification of any
--     single rare journey.
--   * Path normalisation strips entity UUIDs and numeric IDs so that e.g.
--     /officials/<uuid> collapses to /officials/:id — distinct journeys become
--     meaningful patterns instead of singleton noise.
-- =============================================================================

-- ── Path normaliser ─────────────────────────────────────────────────────────
-- Strips query strings, trailing slashes, UUIDs, and numeric IDs.
-- IMMUTABLE so the planner can inline it inside window functions.

CREATE OR REPLACE FUNCTION normalize_pv_path(p TEXT)
RETURNS TEXT
LANGUAGE SQL IMMUTABLE AS $$
  SELECT CASE
    WHEN p IS NULL OR p = '' THEN '/'
    ELSE regexp_replace(
           regexp_replace(
             regexp_replace(split_part(p, '?', 1), '/+$', ''),
             '/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',
             '/:id',
             'g'
           ),
           '/[0-9]{3,}',
           '/:id',
           'g'
         )
  END;
$$;

-- ── Top transitions (public, aggregate-only) ────────────────────────────────

CREATE OR REPLACE FUNCTION get_pv_top_transitions(
  lim INT DEFAULT 20,
  min_count INT DEFAULT 3,
  days INT DEFAULT 30
)
RETURNS TABLE(
  from_page TEXT,
  to_page   TEXT,
  sessions  BIGINT
)
LANGUAGE SQL STABLE AS $$
  WITH recent AS (
    SELECT
      session_id,
      viewed_at,
      normalize_pv_path(page) AS page
    FROM page_views
    WHERE is_bot = false
      AND session_id IS NOT NULL
      AND viewed_at > NOW() - make_interval(days => days)
  ),
  pairs AS (
    SELECT
      LAG(page)       OVER w AS from_page,
      page                    AS to_page,
      session_id,
      LAG(viewed_at)  OVER w AS prev_at,
      viewed_at
    FROM recent
    WINDOW w AS (PARTITION BY session_id ORDER BY viewed_at)
  )
  SELECT
    from_page,
    to_page,
    COUNT(DISTINCT session_id)::BIGINT AS sessions
  FROM pairs
  WHERE from_page IS NOT NULL
    AND from_page <> to_page
    AND viewed_at - prev_at < INTERVAL '30 minutes'
  GROUP BY from_page, to_page
  HAVING COUNT(DISTINCT session_id) >= min_count
  ORDER BY sessions DESC
  LIMIT lim;
$$;

-- ── Entry pages (public, aggregate-only) ────────────────────────────────────
-- First page seen in each session — useful for "where do visitors land".

CREATE OR REPLACE FUNCTION get_pv_entry_pages(
  lim INT DEFAULT 8,
  days INT DEFAULT 30
)
RETURNS TABLE(page TEXT, sessions BIGINT)
LANGUAGE SQL STABLE AS $$
  WITH first_per_session AS (
    SELECT DISTINCT ON (session_id)
      session_id,
      normalize_pv_path(page) AS page
    FROM page_views
    WHERE is_bot = false
      AND session_id IS NOT NULL
      AND viewed_at > NOW() - make_interval(days => days)
    ORDER BY session_id, viewed_at ASC
  )
  SELECT page, COUNT(*)::BIGINT AS sessions
  FROM first_per_session
  GROUP BY page
  ORDER BY sessions DESC
  LIMIT lim;
$$;

-- DOWN:
--   DROP FUNCTION IF EXISTS get_pv_top_transitions(INT, INT, INT);
--   DROP FUNCTION IF EXISTS get_pv_entry_pages(INT, INT);
--   DROP FUNCTION IF EXISTS normalize_pv_path(TEXT);
