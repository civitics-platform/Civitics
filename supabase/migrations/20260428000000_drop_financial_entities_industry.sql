-- =============================================================================
-- FIX-167 — drop financial_entities.industry; entity_tags is the only source of truth
--
-- The `financial_entities.industry` column was being populated by the FEC bulk
-- pipeline with the FEC committee master file's `CONNECTED_ORG_NM` field — the
-- "connected organization name", not a sector code. Verified on prod: 896
-- distinct values across 1,000 PAC/party_committee rows ('NONE', 'WELLS FARGO
-- AND COMPANY', 'OMAR', 'BYRON DONALDS VICTORY FUND', etc.). The "PAC Money by
-- Sector" treemap and several search subtitles surfaced these as if they were
-- sector tags.
--
-- Clean industry tags already live in `entity_tags` (`tag_category='industry'`)
-- written by the AI classifier and the rule-based tagger — that's where this
-- column should have been pulling from all along.
--
-- This migration:
--   1. Re-creates the three RPCs that referenced fe.industry, joining
--      entity_tags instead.
--   2. Drops the index `financial_entities_industry`.
--   3. Drops the column `financial_entities.industry`.
--
-- The TypeScript writer in packages/data/src/pipelines/fec-bulk/writer.ts has
-- already been updated to stop writing the column and to preserve the FEC
-- CONNECTED_ORG_NM value in `metadata.fec_connected_org_nm` instead.
-- =============================================================================

-- ── 1. search_graph_entities (rewrite) ───────────────────────────────────────
-- Subtitle for financial_entities now joins entity_tags rather than reading
-- the dropped column.
CREATE OR REPLACE FUNCTION public.search_graph_entities(
  q   TEXT,
  lim INTEGER DEFAULT 5
)
RETURNS TABLE(
  id          UUID,
  label       TEXT,
  entity_type TEXT,
  subtitle    TEXT,
  party       TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  -- Officials: active only, fuzzy name match. Last-name exact match → sim=1.0.
  SELECT sub.id, sub.label, sub.entity_type, sub.subtitle, sub.party
  FROM (
    SELECT
      o.id::UUID,
      o.full_name                                                      AS label,
      'official'::TEXT                                                 AS entity_type,
      NULLIF(CONCAT_WS(' · ', o.metadata->>'state', o.role_title), '') AS subtitle,
      o.party::TEXT                                                    AS party,
      CASE
        WHEN LOWER(
          (string_to_array(o.full_name, ' '))[
            array_upper(string_to_array(o.full_name, ' '), 1)
          ]
        ) = LOWER(q)
          THEN 1.0::REAL
        ELSE similarity(o.full_name, q)
      END                                                              AS sim
    FROM public.officials o
    WHERE o.is_active = true
      AND (
        o.full_name ILIKE '%' || q || '%'
        OR similarity(o.full_name, q) > 0.3
      )
    ORDER BY sim DESC, o.full_name
    LIMIT lim
  ) sub

  UNION ALL

  SELECT sub.id, sub.label, sub.entity_type, sub.subtitle, sub.party
  FROM (
    SELECT
      a.id::UUID,
      a.name                  AS label,
      'agency'::TEXT          AS entity_type,
      a.acronym               AS subtitle,
      NULL::TEXT              AS party
    FROM public.agencies a
    WHERE a.name    ILIKE '%' || q || '%'
       OR a.acronym ILIKE '%' || q || '%'
    ORDER BY a.name
    LIMIT lim
  ) sub

  UNION ALL

  SELECT sub.id, sub.label, sub.entity_type, sub.subtitle, sub.party
  FROM (
    SELECT
      p.id::UUID,
      p.title           AS label,
      'proposal'::TEXT  AS entity_type,
      p.status::TEXT    AS subtitle,
      NULL::TEXT        AS party
    FROM public.proposals p
    WHERE p.title ILIKE '%' || q || '%'
    ORDER BY p.title
    LIMIT lim
  ) sub

  UNION ALL

  -- Financial entities: subtitle now joins entity_tags for the industry label.
  SELECT sub.id, sub.label, sub.entity_type, sub.subtitle, sub.party
  FROM (
    SELECT
      f.id::UUID,
      f.display_name                                                          AS label,
      'financial_entity'::TEXT                                                AS entity_type,
      NULLIF(
        CONCAT_WS(' · ', f.entity_type, COALESCE(et.display_label, et.tag)),
        ''
      )                                                                       AS subtitle,
      NULL::TEXT                                                              AS party,
      similarity(f.display_name, q)                                           AS sim
    FROM public.financial_entities f
    LEFT JOIN public.entity_tags et
      ON et.entity_id    = f.id
     AND et.entity_type  = 'financial_entity'
     AND et.tag_category = 'industry'
    WHERE f.display_name ILIKE '%' || q || '%'
       OR similarity(f.display_name, q) > 0.3
    ORDER BY sim DESC, f.total_donated_cents DESC
    LIMIT lim
  ) sub;
$$;

GRANT EXECUTE ON FUNCTION public.search_graph_entities(TEXT, INTEGER) TO anon, authenticated, service_role;

-- ── 2. get_official_donors (rewrite) ─────────────────────────────────────────
-- industry_category now comes from entity_tags; falls back to 'Other'.
CREATE OR REPLACE FUNCTION public.get_official_donors(p_official_id UUID)
RETURNS TABLE(
  financial_entity_id UUID,
  entity_name         TEXT,
  entity_type         TEXT,
  industry_category   TEXT,
  total_amount_usd    NUMERIC,
  transaction_count   BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    fe.id                                                  AS financial_entity_id,
    fe.display_name                                        AS entity_name,
    fe.entity_type                                         AS entity_type,
    COALESCE(et.display_label, et.tag, 'Other')            AS industry_category,
    SUM(fr.amount_cents) / 100.0                           AS total_amount_usd,
    COUNT(*)::BIGINT                                       AS transaction_count
  FROM public.financial_relationships fr
  JOIN public.financial_entities      fe ON fe.id = fr.from_id
  LEFT JOIN public.entity_tags        et
    ON et.entity_id    = fe.id
   AND et.entity_type  = 'financial_entity'
   AND et.tag_category = 'industry'
  WHERE fr.relationship_type = 'donation'
    AND fr.from_type         = 'financial_entity'
    AND fr.to_type           = 'official'
    AND fr.to_id             = p_official_id
  GROUP BY fe.id, fe.display_name, fe.entity_type, et.display_label, et.tag
  ORDER BY total_amount_usd DESC
  LIMIT 100;
$$;

GRANT EXECUTE ON FUNCTION public.get_official_donors(UUID) TO anon, authenticated, service_role;

-- ── 3. treemap_recipients_by_contracts (rewrite) ─────────────────────────────
-- Drop the fe.industry fallback; entity_tags is the only source.
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
    COALESCE(et.tag, 'Other')                AS industry,
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
  GROUP BY fe.id, fe.display_name, et.tag
  ORDER BY total_cents DESC
  LIMIT lim;
$$;

GRANT EXECUTE ON FUNCTION public.treemap_recipients_by_contracts(INTEGER) TO anon, authenticated, service_role;

-- ── 4. Drop the index and column ─────────────────────────────────────────────
DROP INDEX IF EXISTS public.financial_entities_industry;
ALTER TABLE public.financial_entities DROP COLUMN IF EXISTS industry;
