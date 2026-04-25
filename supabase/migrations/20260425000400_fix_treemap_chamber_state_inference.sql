-- =============================================================================
-- FIX-108 — Fix chamber/state inference in treemap_officials_by_donations
--
-- Root cause: FEC filing IDs (source_ids->>'fec_id') sometimes start with 'S'
-- for officials who are actually House reps (e.g. Shontel Brown, OH-11).
-- The old derivation checked FEC IDs *before* role_title, so these officials
-- were falsely labelled senate/TX.
--
-- Fix: prefer role_title ILIKE for chamber, jurisdictions.short_name for state.
-- Fall back to FEC ID parsing only when those primary signals are null/unknown.
-- =============================================================================

-- ── 1. Simple overload: treemap_officials_by_donations(lim) ──────────────────
CREATE OR REPLACE FUNCTION public.treemap_officials_by_donations(lim INTEGER DEFAULT 200)
RETURNS TABLE(
  official_id          UUID,
  official_name        TEXT,
  party                TEXT,
  state                TEXT,
  chamber              TEXT,
  total_donated_cents  BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    sub.official_id,
    sub.official_name,
    sub.party,
    sub.state,
    sub.chamber,
    COALESCE(SUM(fr.amount_cents), 0)::BIGINT AS total_donated_cents
  FROM (
    SELECT
      o.id::UUID                             AS official_id,
      o.full_name                            AS official_name,
      COALESCE(o.party::TEXT, 'nonpartisan') AS party,
      -- State: jurisdictions.short_name → metadata → FEC ID parsing
      COALESCE(
        NULLIF(j.short_name, ''),
        NULLIF(o.metadata->>'state', ''),
        NULLIF(o.metadata->>'state_abbr', ''),
        CASE
          WHEN (o.source_ids->>'fec_candidate_id') ~ '^[SH][0-9][A-Z]{2}'
            AND SUBSTRING(o.source_ids->>'fec_candidate_id' FROM 3 FOR 2)
                  = ANY(ARRAY[
                      'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID',
                      'IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS',
                      'MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK',
                      'OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV',
                      'WI','WY'
                    ])
            THEN SUBSTRING(o.source_ids->>'fec_candidate_id' FROM 3 FOR 2)
          ELSE NULL
        END,
        CASE
          WHEN (o.source_ids->>'fec_id') ~ '^[SH][0-9][A-Z]{2}'
            AND SUBSTRING(o.source_ids->>'fec_id' FROM 3 FOR 2)
                  = ANY(ARRAY[
                      'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID',
                      'IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS',
                      'MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK',
                      'OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV',
                      'WI','WY'
                    ])
            THEN SUBSTRING(o.source_ids->>'fec_id' FROM 3 FOR 2)
          ELSE NULL
        END,
        'Unknown'
      )                                      AS state,
      -- Chamber: role_title first → FEC candidate ID → FEC filing ID
      CASE
        WHEN o.role_title ILIKE '%senator%'                         THEN 'senate'
        WHEN o.role_title ILIKE '%representative%'                  THEN 'house'
        WHEN LEFT(o.source_ids->>'fec_candidate_id', 1) = 'S'      THEN 'senate'
        WHEN LEFT(o.source_ids->>'fec_candidate_id', 1) = 'H'      THEN 'house'
        WHEN LEFT(o.source_ids->>'fec_id', 1) = 'S'                THEN 'senate'
        WHEN LEFT(o.source_ids->>'fec_id', 1) = 'H'                THEN 'house'
        ELSE 'unknown'
      END                                    AS chamber
    FROM public.officials o
    LEFT JOIN public.jurisdictions j ON j.id = o.jurisdiction_id
    WHERE o.is_active = true
  ) sub
  LEFT JOIN public.financial_relationships fr
    ON fr.to_id = sub.official_id
   AND fr.to_type = 'official'
   AND fr.relationship_type = 'donation'
  GROUP BY sub.official_id, sub.official_name, sub.party, sub.state, sub.chamber
  HAVING COALESCE(SUM(fr.amount_cents), 0) > 0
  ORDER BY total_donated_cents DESC
  LIMIT lim;
$$;

GRANT EXECUTE ON FUNCTION public.treemap_officials_by_donations(INTEGER) TO anon, authenticated, service_role;

-- ── 2. Filtered overload: treemap_officials_by_donations(lim,chamber,party,state)
CREATE OR REPLACE FUNCTION public.treemap_officials_by_donations(
  lim       INTEGER DEFAULT 200,
  p_chamber TEXT DEFAULT NULL,
  p_party   TEXT DEFAULT NULL,
  p_state   TEXT DEFAULT NULL
)
RETURNS TABLE(
  official_id          UUID,
  official_name        TEXT,
  party                TEXT,
  state                TEXT,
  chamber              TEXT,
  total_donated_cents  BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    sub.official_id,
    sub.official_name,
    sub.party,
    sub.state,
    sub.chamber,
    COALESCE(SUM(fr.amount_cents), 0)::BIGINT AS total_donated_cents
  FROM (
    SELECT
      o.id::UUID                             AS official_id,
      o.full_name                            AS official_name,
      COALESCE(o.party::TEXT, 'nonpartisan') AS party,
      -- State: jurisdictions.short_name → metadata → FEC ID parsing
      COALESCE(
        NULLIF(j.short_name, ''),
        NULLIF(o.metadata->>'state', ''),
        NULLIF(o.metadata->>'state_abbr', ''),
        CASE
          WHEN (o.source_ids->>'fec_candidate_id') ~ '^[SH][0-9][A-Z]{2}'
            AND SUBSTRING(o.source_ids->>'fec_candidate_id' FROM 3 FOR 2)
                  = ANY(ARRAY[
                      'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID',
                      'IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS',
                      'MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK',
                      'OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV',
                      'WI','WY'
                    ])
            THEN SUBSTRING(o.source_ids->>'fec_candidate_id' FROM 3 FOR 2)
          ELSE NULL
        END,
        CASE
          WHEN (o.source_ids->>'fec_id') ~ '^[SH][0-9][A-Z]{2}'
            AND SUBSTRING(o.source_ids->>'fec_id' FROM 3 FOR 2)
                  = ANY(ARRAY[
                      'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID',
                      'IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS',
                      'MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK',
                      'OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV',
                      'WI','WY'
                    ])
            THEN SUBSTRING(o.source_ids->>'fec_id' FROM 3 FOR 2)
          ELSE NULL
        END,
        'Unknown'
      )                                      AS state,
      -- Chamber: role_title first → FEC candidate ID → FEC filing ID
      CASE
        WHEN o.role_title ILIKE '%senator%'                         THEN 'senate'
        WHEN o.role_title ILIKE '%representative%'                  THEN 'house'
        WHEN LEFT(o.source_ids->>'fec_candidate_id', 1) = 'S'      THEN 'senate'
        WHEN LEFT(o.source_ids->>'fec_candidate_id', 1) = 'H'      THEN 'house'
        WHEN LEFT(o.source_ids->>'fec_id', 1) = 'S'                THEN 'senate'
        WHEN LEFT(o.source_ids->>'fec_id', 1) = 'H'                THEN 'house'
        ELSE 'unknown'
      END                                    AS chamber,
      j.short_name                           AS jur_state
    FROM public.officials o
    LEFT JOIN public.jurisdictions j ON j.id = o.jurisdiction_id
    WHERE o.is_active = true
      -- Chamber filter: role_title takes priority; only fall back to FEC IDs
      -- when role_title matches neither pattern (avoids Shontel Brown false-positive).
      AND (
        p_chamber IS NULL
        OR (p_chamber = 'senate' AND (
              o.role_title ILIKE '%senator%'
              OR (o.role_title NOT ILIKE '%representative%' AND (
                    LEFT(o.source_ids->>'fec_candidate_id', 1) = 'S'
                    OR LEFT(o.source_ids->>'fec_id', 1) = 'S'
                  ))
           ))
        OR (p_chamber = 'house' AND (
              o.role_title ILIKE '%representative%'
              OR (o.role_title NOT ILIKE '%senator%' AND (
                    LEFT(o.source_ids->>'fec_candidate_id', 1) = 'H'
                    OR LEFT(o.source_ids->>'fec_id', 1) = 'H'
                  ))
           ))
      )
      AND (p_party IS NULL OR o.party::TEXT = p_party)
      -- State filter: jurisdictions.short_name → metadata fields
      AND (
        p_state IS NULL
        OR j.short_name              = p_state
        OR o.metadata->>'state'      = p_state
        OR o.metadata->>'state_abbr' = p_state
      )
  ) sub
  LEFT JOIN public.financial_relationships fr
    ON fr.to_id = sub.official_id
   AND fr.to_type = 'official'
   AND fr.relationship_type = 'donation'
  GROUP BY sub.official_id, sub.official_name, sub.party, sub.state, sub.chamber
  HAVING COALESCE(SUM(fr.amount_cents), 0) > 0
  ORDER BY total_donated_cents DESC
  LIMIT lim;
$$;

GRANT EXECUTE ON FUNCTION public.treemap_officials_by_donations(INTEGER, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
