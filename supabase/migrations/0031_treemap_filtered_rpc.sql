-- 0031_treemap_filtered_rpc.sql
-- Add optional p_chamber / p_party / p_state filters to treemap_officials_by_donations.
-- Previously all filtering was done client-side after fetching 200 rows.
-- With senate+democrat that meant aggregating 8k officials to return ~50 —
-- now the DB filters first so only the relevant officials are joined.

CREATE OR REPLACE FUNCTION treemap_officials_by_donations(
  lim       INT     DEFAULT 200,
  p_chamber TEXT    DEFAULT NULL,
  p_party   TEXT    DEFAULT NULL,
  p_state   TEXT    DEFAULT NULL
)
RETURNS TABLE(
  official_id         UUID,
  official_name       TEXT,
  party               TEXT,
  state               TEXT,
  chamber             TEXT,
  total_donated_cents BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    sub.official_id,
    sub.official_name,
    sub.party,
    sub.state,
    sub.chamber,
    COALESCE(SUM(fr.amount_cents), 0)::BIGINT AS total_donated_cents
  FROM (
    SELECT
      o.id::UUID                                AS official_id,
      o.full_name                               AS official_name,
      COALESCE(o.party::TEXT, 'nonpartisan')    AS party,
      COALESCE(
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
      )                                         AS state,
      CASE
        WHEN LEFT(o.source_ids->>'fec_candidate_id', 1) = 'S' THEN 'senate'
        WHEN LEFT(o.source_ids->>'fec_candidate_id', 1) = 'H' THEN 'house'
        WHEN LEFT(o.source_ids->>'fec_id', 1) = 'S'           THEN 'senate'
        WHEN LEFT(o.source_ids->>'fec_id', 1) = 'H'           THEN 'house'
        WHEN o.role_title ILIKE '%senator%'                    THEN 'senate'
        WHEN o.role_title ILIKE '%representative%'             THEN 'house'
        ELSE 'unknown'
      END                                       AS chamber
    FROM officials o
    WHERE o.is_active = true
      -- Early filter on role_title / party — much cheaper than filtering after the JOIN
      AND (
        p_chamber IS NULL
        OR (p_chamber = 'senate'  AND (
              LEFT(o.source_ids->>'fec_candidate_id', 1) = 'S'
              OR LEFT(o.source_ids->>'fec_id', 1) = 'S'
              OR o.role_title ILIKE '%senator%'
           ))
        OR (p_chamber = 'house'   AND (
              LEFT(o.source_ids->>'fec_candidate_id', 1) = 'H'
              OR LEFT(o.source_ids->>'fec_id', 1) = 'H'
              OR o.role_title ILIKE '%representative%'
           ))
      )
      AND (p_party IS NULL OR o.party::TEXT = p_party)
      AND (
        p_state IS NULL
        OR o.metadata->>'state'      = p_state
        OR o.metadata->>'state_abbr' = p_state
      )
  ) sub
  LEFT JOIN financial_relationships fr ON fr.official_id = sub.official_id
  GROUP BY sub.official_id, sub.official_name, sub.party, sub.state, sub.chamber
  HAVING COALESCE(SUM(fr.amount_cents), 0) > 0
  ORDER BY total_donated_cents DESC
  LIMIT lim
$$;

GRANT EXECUTE ON FUNCTION treemap_officials_by_donations(INT, TEXT, TEXT, TEXT) TO anon, authenticated;
