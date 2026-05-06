-- =============================================================================
-- Materialize chord_industry_flows() — FIX-207
-- =============================================================================
-- The original chord_industry_flows() RPC (migration 20260422000008) joins
-- financial_relationships (2.2 M rows) × officials × financial_entities ×
-- entity_tags, group-bys 4 derived columns and SUMs amount_cents. On prod
-- it consistently hits the 8-second authenticated-role statement_timeout
-- (verified by direct probe). With chord erroring permanently, the dashboard
-- chord-has-industry-data self-test fails and the FIX-089 Donation Flow card
-- renders $0.
--
-- Output is small — ~50–100 rows by industry × party_chamber. We materialize
-- and refresh nightly inside runNightlySync() (packages/data/src/pipelines/
-- index.ts), after rule-based + AI tagging so industry tags are current.
-- The function signature stays identical so all existing callers
-- (status/_lib/sections.ts:633, /api/graph/chord, etc.) work unchanged.
-- =============================================================================

-- The original RPC GROUP BYs included display_label and display_icon, which
-- caused multiple rows per (industry, party_chamber) when entity_tags had
-- inconsistent label variants for the same tag (e.g. "lobby"). The chord
-- consumer in status/_lib/sections.ts:getChord() already SUMs across those
-- duplicates, so collapsing them at the SQL layer matches intent and lets
-- (industry, party_chamber) be a real PK for CONCURRENT refresh.
CREATE MATERIALIZED VIEW IF NOT EXISTS public.chord_industry_flows_mv AS
SELECT
  COALESCE(et.tag, 'untagged')                                  AS industry,
  MIN(COALESCE(et.display_label, 'Untagged'))                   AS display_label,
  MIN(COALESCE(et.display_icon, ''))                            AS display_icon,
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
  CONCAT_WS(' ',
    INITCAP(COALESCE(o.party::TEXT, 'other')),
    CASE
      WHEN o.role_title ILIKE '%representative%' THEN 'House'
      ELSE 'Senate'
    END
  );

-- (industry, party_chamber) is the natural PK and is required for
-- REFRESH MATERIALIZED VIEW CONCURRENTLY.
CREATE UNIQUE INDEX IF NOT EXISTS chord_industry_flows_mv_pk
  ON public.chord_industry_flows_mv (industry, party_chamber);

-- Replace the function body to read from the MV. Same signature, same
-- column types, same DESC ordering — all callers continue to work.
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
  SELECT industry, display_label, display_icon, party_chamber,
         total_cents, official_count, donor_count
  FROM public.chord_industry_flows_mv
  ORDER BY total_cents DESC;
$$;

GRANT EXECUTE ON FUNCTION public.chord_industry_flows() TO anon, authenticated, service_role;
GRANT SELECT ON public.chord_industry_flows_mv TO anon, authenticated, service_role;

-- Refresh helper, invoked from runNightlySync() after the tagging steps.
CREATE OR REPLACE FUNCTION public.refresh_chord_industry_flows_mv()
RETURNS void
LANGUAGE sql
AS $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.chord_industry_flows_mv;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_chord_industry_flows_mv() TO authenticated, service_role;
