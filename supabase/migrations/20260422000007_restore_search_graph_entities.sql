-- =============================================================================
-- FIX-099 — restore search_graph_entities() against the polymorphic schema
--
-- Dropped in cutover migration. The financial_entities branch referenced
-- `f.name`, which became `f.display_name` in the polymorphic rewrite (L7).
-- Other branches (officials, agencies, proposals) are unchanged from the
-- original 2026-02 definition.
--
-- Returns one merged result set across the four searchable entity types.
-- Last-name exact match boosts officials to similarity 1.0; financial
-- entities also support trigram-based fuzzy match.
--
-- Used directly by `/api/claude/status` (entity_search_finds_warren self-test)
-- and as a single-call alternative to the inlined search in `/api/graph/search`.
-- =============================================================================

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

  -- Agencies: name or acronym ILIKE
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

  -- Proposals: title ILIKE.
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

  -- Financial entities (polymorphic): display_name fuzzy match.
  -- Was f.name pre-cutover; now f.display_name per L7 rewrite.
  SELECT sub.id, sub.label, sub.entity_type, sub.subtitle, sub.party
  FROM (
    SELECT
      f.id::UUID,
      f.display_name                                                  AS label,
      'financial_entity'::TEXT                                        AS entity_type,
      NULLIF(CONCAT_WS(' · ', f.entity_type, f.industry), '')         AS subtitle,
      NULL::TEXT                                                      AS party,
      similarity(f.display_name, q)                                   AS sim
    FROM public.financial_entities f
    WHERE f.display_name ILIKE '%' || q || '%'
       OR similarity(f.display_name, q) > 0.3
    ORDER BY sim DESC, f.total_donated_cents DESC
    LIMIT lim
  ) sub;
$$;

GRANT EXECUTE ON FUNCTION public.search_graph_entities(TEXT, INTEGER) TO anon, authenticated, service_role;
