-- =============================================================================
-- FIX-110 — Surface contract/grant flows: add chord_contract_flows() and
-- treemap_recipients_by_contracts() RPCs.
--
-- Data shape:
--   financial_relationships.relationship_type = 'contract'
--   from_type = 'agency',           from_id = agencies.id
--   to_type   = 'financial_entity', to_id   = financial_entities.id
--   metadata->>'naics_code' = NAICS code (e.g. "3812")
--
-- Sector is derived from entity_tags (tag_category='industry', written by
-- FIX-109 / tags pipeline) first, then falls back to NAICS 2-digit mapping.
-- =============================================================================

-- ── 1. chord_contract_flows() ────────────────────────────────────────────────
-- Agency → NAICS sector chord.  One row per (agency × sector) pair.
-- Aggregate view — no parameters; returns all contract data in Pro.
CREATE OR REPLACE FUNCTION public.chord_contract_flows()
RETURNS TABLE(
  agency_id      UUID,
  agency_name    TEXT,
  agency_acronym TEXT,
  sector         TEXT,
  total_cents    BIGINT,
  award_count    BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  WITH classified AS (
    SELECT
      a.id::UUID                                      AS agency_id,
      a.name                                          AS agency_name,
      COALESCE(a.acronym, a.short_name, a.name)       AS agency_acronym,
      COALESCE(
        -- FIX-109 industry tag takes priority (rule-based NAICS classifier)
        et.tag,
        -- Fallback: derive sector from NAICS 2-digit prefix in metadata
        CASE SUBSTRING(fr.metadata->>'naics_code' FROM 1 FOR 2)
          WHEN '11' THEN 'Agriculture'
          WHEN '21' THEN 'Mining'
          WHEN '22' THEN 'Utilities'
          WHEN '23' THEN 'Construction'
          WHEN '31' THEN 'Manufacturing'
          WHEN '32' THEN 'Manufacturing'
          WHEN '33' THEN 'Manufacturing'
          WHEN '42' THEN 'Wholesale Trade'
          WHEN '44' THEN 'Retail'
          WHEN '45' THEN 'Retail'
          WHEN '48' THEN 'Transportation'
          WHEN '49' THEN 'Transportation'
          WHEN '51' THEN 'Information Technology'
          WHEN '52' THEN 'Finance'
          WHEN '54' THEN 'Professional Services'
          WHEN '56' THEN 'Administrative Services'
          WHEN '61' THEN 'Education'
          WHEN '62' THEN 'Healthcare'
          WHEN '71' THEN 'Arts & Entertainment'
          WHEN '72' THEN 'Hospitality'
          WHEN '81' THEN 'Other Services'
          WHEN '92' THEN 'Government'
          ELSE 'Other'
        END,
        'Other'
      )                                               AS sector,
      fr.amount_cents
    FROM public.financial_relationships fr
    JOIN public.agencies a
      ON a.id = fr.from_id AND fr.from_type = 'agency'
    LEFT JOIN public.financial_entities fe
      ON fe.id = fr.to_id AND fr.to_type = 'financial_entity'
    LEFT JOIN public.entity_tags et
      ON et.entity_id    = fe.id
     AND et.entity_type  = 'financial_entity'
     AND et.tag_category = 'industry'
    WHERE fr.relationship_type = 'contract'
      AND fr.amount_cents > 0
  )
  SELECT
    agency_id,
    agency_name,
    agency_acronym,
    sector,
    SUM(amount_cents)::BIGINT  AS total_cents,
    COUNT(*)::BIGINT           AS award_count
  FROM classified
  GROUP BY agency_id, agency_name, agency_acronym, sector
  ORDER BY total_cents DESC;
$$;

GRANT EXECUTE ON FUNCTION public.chord_contract_flows() TO anon, authenticated, service_role;

-- ── 2. treemap_recipients_by_contracts(lim) ──────────────────────────────────
-- Top contractor companies ranked by total contract value received.
-- Industry is from entity_tags first, then financial_entities.industry column.
CREATE OR REPLACE FUNCTION public.treemap_recipients_by_contracts(
  lim INTEGER DEFAULT 100
)
RETURNS TABLE(
  entity_id   UUID,
  entity_name TEXT,
  industry    TEXT,
  naics_code  TEXT,
  total_cents BIGINT,
  award_count BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    fe.id::UUID                              AS entity_id,
    fe.display_name                          AS entity_name,
    COALESCE(et.tag, fe.industry, 'Other')   AS industry,
    MIN(fr.metadata->>'naics_code')          AS naics_code,
    SUM(fr.amount_cents)::BIGINT             AS total_cents,
    COUNT(*)::BIGINT                         AS award_count
  FROM public.financial_relationships fr
  JOIN public.financial_entities fe
    ON fe.id = fr.to_id AND fr.to_type = 'financial_entity'
  LEFT JOIN public.entity_tags et
    ON et.entity_id    = fe.id
   AND et.entity_type  = 'financial_entity'
   AND et.tag_category = 'industry'
  WHERE fr.relationship_type = 'contract'
    AND fr.amount_cents > 0
  GROUP BY fe.id, fe.display_name, fe.industry, et.tag
  ORDER BY total_cents DESC
  LIMIT lim;
$$;

GRANT EXECUTE ON FUNCTION public.treemap_recipients_by_contracts(INTEGER) TO anon, authenticated, service_role;
