-- =============================================================================
-- FIX-097 — restore the 6 chord/treemap RPCs against the polymorphic schema
--
-- All dropped at cutover because they joined on legacy
--   financial_relationships.official_id  (now: to_id where to_type='official')
--   financial_relationships.donor_name   (now: from_id → financial_entities.id)
--
-- Polymorphic shape:
--   financial_relationships.from_type='financial_entity', from_id=fe.id
--   financial_relationships.to_type='official',           to_id=officials.id
--   financial_relationships.relationship_type='donation'
--   financial_entities.display_name          (was financial_entities.name)
--
-- The two get_*_connections RPCs (get_connection_counts, get_group_connections)
-- read entity_connections directly and don't need polymorphic rewrites — but
-- they were dropped as collateral and need to be recreated.
--
-- These will return [] until FIX-101 re-runs FEC bulk against Pro
-- (financial_relationships, financial_entities, entity_tags all empty today);
-- function bodies are correct and verified locally.
-- =============================================================================

-- ── 1. chord_industry_flows() ────────────────────────────────────────────────
-- Industry → party_chamber chord. Joins financial_entities to read industry tag.
CREATE OR REPLACE FUNCTION public.chord_industry_flows()
RETURNS TABLE(
  industry        TEXT,
  display_label   TEXT,
  display_icon    TEXT,
  party_chamber   TEXT,
  total_cents     BIGINT,
  official_count  BIGINT,
  donor_count     BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    COALESCE(et.tag, 'untagged')                                  AS industry,
    COALESCE(et.display_label, 'Untagged')                        AS display_label,
    COALESCE(et.display_icon, '')                                 AS display_icon,
    CONCAT_WS(' ',
      INITCAP(COALESCE(o.party::TEXT, 'other')),
      CASE
        WHEN o.role_title ILIKE '%representative%' THEN 'House'
        ELSE 'Senate'
      END
    )                                                             AS party_chamber,
    SUM(fr.amount_cents)::BIGINT                                  AS total_cents,
    COUNT(DISTINCT fr.to_id)::BIGINT                              AS official_count,
    COUNT(DISTINCT fe.id)::BIGINT                                 AS donor_count
  FROM public.financial_relationships fr
  JOIN public.officials          o  ON o.id  = fr.to_id   AND fr.to_type   = 'official'
  JOIN public.financial_entities fe ON fe.id = fr.from_id AND fr.from_type = 'financial_entity'
  LEFT JOIN public.entity_tags et
    ON et.entity_id    = fe.id
   AND et.entity_type  = 'financial_entity'
   AND et.tag_category = 'industry'
  WHERE fr.relationship_type = 'donation'
    AND fr.amount_cents > 0
    AND o.source_ids->>'congress_gov' IS NOT NULL
  GROUP BY
    COALESCE(et.tag, 'untagged'),
    COALESCE(et.display_label, 'Untagged'),
    COALESCE(et.display_icon, ''),
    CONCAT_WS(' ',
      INITCAP(COALESCE(o.party::TEXT, 'other')),
      CASE
        WHEN o.role_title ILIKE '%representative%' THEN 'House'
        ELSE 'Senate'
      END
    )
  ORDER BY total_cents DESC;
$$;

GRANT EXECUTE ON FUNCTION public.chord_industry_flows() TO anon, authenticated, service_role;

-- ── 2. get_connection_counts(uuid[]) ─────────────────────────────────────────
-- Pure entity_connections query — no polymorphic rewrite needed.
CREATE OR REPLACE FUNCTION public.get_connection_counts(entity_ids UUID[])
RETURNS TABLE(entity_id UUID, connection_count BIGINT)
LANGUAGE sql STABLE
AS $$
  SELECT id AS entity_id, COUNT(*)::BIGINT AS connection_count
  FROM (
    SELECT from_id AS id FROM public.entity_connections WHERE from_id = ANY(entity_ids)
    UNION ALL
    SELECT to_id   AS id FROM public.entity_connections WHERE to_id   = ANY(entity_ids)
  ) sub
  GROUP BY id;
$$;

GRANT EXECUTE ON FUNCTION public.get_connection_counts(UUID[]) TO anon, authenticated, service_role;

-- ── 3. get_group_connections(uuid[], integer) ────────────────────────────────
-- Pure entity_connections query — no polymorphic rewrite needed.
CREATE OR REPLACE FUNCTION public.get_group_connections(
  p_member_ids UUID[],
  p_limit      INTEGER DEFAULT 500
)
RETURNS TABLE(
  connection_type TEXT,
  to_id           UUID,
  strength        NUMERIC,
  amount_cents    BIGINT,
  from_id         UUID
)
LANGUAGE sql STABLE
AS $$
  SELECT
    ec.connection_type::TEXT,
    ec.to_id,
    ec.strength::NUMERIC,
    ec.amount_cents,
    ec.from_id
  FROM public.entity_connections ec
  WHERE ec.from_id = ANY(p_member_ids)
  ORDER BY ec.amount_cents DESC NULLS LAST, ec.strength DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_group_connections(UUID[], INTEGER) TO anon, authenticated, service_role;

-- ── 4. get_group_sector_totals(uuid[], numeric) ──────────────────────────────
-- Per-sector donation totals for a group of officials. Excludes donations
-- whose donor display_name contains 'PAC/Committee' (junk roll-ups).
CREATE OR REPLACE FUNCTION public.get_group_sector_totals(
  p_member_ids UUID[],
  p_min_usd    NUMERIC DEFAULT 0
)
RETURNS TABLE(sector TEXT, total_usd NUMERIC)
LANGUAGE sql STABLE
AS $$
  SELECT
    fr.metadata->>'sector'        AS sector,
    SUM(fr.amount_cents) / 100.0  AS total_usd
  FROM public.financial_relationships fr
  LEFT JOIN public.financial_entities fe
    ON fe.id = fr.from_id AND fr.from_type = 'financial_entity'
  WHERE fr.relationship_type = 'donation'
    AND fr.to_type = 'official'
    AND fr.to_id = ANY(p_member_ids)
    AND fr.metadata->>'sector' IS NOT NULL
    AND fr.metadata->>'sector' != 'Other'
    AND (fe.display_name IS NULL OR fe.display_name NOT ILIKE '%PAC/Committee%')
  GROUP BY fr.metadata->>'sector'
  HAVING SUM(fr.amount_cents) / 100.0 >= p_min_usd
  ORDER BY total_usd DESC
  LIMIT 12;
$$;

GRANT EXECUTE ON FUNCTION public.get_group_sector_totals(UUID[], NUMERIC) TO anon, authenticated, service_role;

-- ── 5. get_crossgroup_sector_totals(uuid[], uuid[]) ──────────────────────────
-- Per-sector totals split across two groups (left/right comparison).
CREATE OR REPLACE FUNCTION public.get_crossgroup_sector_totals(
  p_group1_ids UUID[],
  p_group2_ids UUID[]
)
RETURNS TABLE(sector TEXT, group1_usd NUMERIC, group2_usd NUMERIC)
LANGUAGE sql STABLE
AS $$
  WITH agg AS (
    SELECT
      fr.metadata->>'sector' AS sector,
      SUM(CASE WHEN fr.to_id = ANY(p_group1_ids) THEN fr.amount_cents / 100.0 ELSE 0 END) AS group1_usd,
      SUM(CASE WHEN fr.to_id = ANY(p_group2_ids) THEN fr.amount_cents / 100.0 ELSE 0 END) AS group2_usd
    FROM public.financial_relationships fr
    LEFT JOIN public.financial_entities fe
      ON fe.id = fr.from_id AND fr.from_type = 'financial_entity'
    WHERE fr.relationship_type = 'donation'
      AND fr.to_type = 'official'
      AND (fr.to_id = ANY(p_group1_ids) OR fr.to_id = ANY(p_group2_ids))
      AND fr.metadata->>'sector' IS NOT NULL
      AND fr.metadata->>'sector' != 'Other'
      AND (fe.display_name IS NULL OR fe.display_name NOT ILIKE '%PAC/Committee%')
    GROUP BY fr.metadata->>'sector'
  )
  SELECT sector, group1_usd, group2_usd
  FROM agg
  ORDER BY (group1_usd + group2_usd) DESC
  LIMIT 12;
$$;

GRANT EXECUTE ON FUNCTION public.get_crossgroup_sector_totals(UUID[], UUID[]) TO anon, authenticated, service_role;

-- ── 6. treemap_officials_by_donations(lim) — simple overload ─────────────────
-- Per-official donation totals; chamber+state derived from FEC IDs as fallback.
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
    FROM public.officials o
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

-- ── 7. treemap_officials_by_donations(lim,chamber,party,state) — filtered ────
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
    FROM public.officials o
    WHERE o.is_active = true
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
