-- =============================================================================
-- FIX-098 — recreate the 4 officials/donor RPCs against the polymorphic schema
--
-- Dropped in the cutover migration (20260422000000) because the donor-shape
-- RPCs joined on legacy `financial_relationships.donor_name`/`.official_id`
-- columns that no longer exist. The two pure-officials RPCs were collateral —
-- nothing in their bodies actually changed.
--
--   get_officials_breakdown()                   — federal/state/judges counts
--   get_officials_by_filter(chamber,party,state) — id list for chord/sunburst
--   get_official_donors(uuid)                    — polymorphic donor aggregate
--   get_pac_donations_by_party()                 — polymorphic PAC aggregate
--
-- Polymorphic shape recap:
--   financial_relationships.from_type='financial_entity', from_id=fe.id
--   financial_relationships.to_type='official', to_id=officials.id
--   financial_relationships.relationship_type='donation'
--   financial_entities.display_name (not .name), .entity_type, .industry
--
-- Donors live on `financial_entities`, not in a `donor_name` column on
-- `financial_relationships` — joins must go fr.from_id → fe.id.
-- =============================================================================

-- ── 1. get_officials_breakdown ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_officials_breakdown()
RETURNS TABLE(category TEXT, count BIGINT)
LANGUAGE sql STABLE
AS $$
  SELECT
    CASE
      WHEN source_ids ? 'courtlistener_person_id' THEN 'judges'
      WHEN source_ids ? 'openstates_id'           THEN 'state'
      ELSE 'federal'
    END             AS category,
    COUNT(*)::BIGINT AS count
  FROM public.officials
  WHERE is_active = true
  GROUP BY category;
$$;

GRANT EXECUTE ON FUNCTION public.get_officials_breakdown() TO anon, authenticated, service_role;

-- ── 2. get_officials_by_filter ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_officials_by_filter(
  p_chamber TEXT DEFAULT NULL,
  p_party   TEXT DEFAULT NULL,
  p_state   TEXT DEFAULT NULL
) RETURNS TABLE(id UUID)
LANGUAGE sql STABLE
AS $$
  SELECT o.id
  FROM public.officials o
  WHERE o.is_active = true
    AND (p_chamber IS NULL OR
      CASE p_chamber
        WHEN 'senate' THEN o.role_title = 'Senator'
        WHEN 'house'  THEN o.role_title = 'Representative'
        ELSE true
      END)
    AND (p_party IS NULL OR o.party::TEXT = p_party)
    AND (p_state IS NULL
         OR o.metadata->>'state'      = p_state
         OR o.metadata->>'state_abbr' = p_state)
  LIMIT 1000;
$$;

GRANT EXECUTE ON FUNCTION public.get_officials_by_filter(TEXT, TEXT, TEXT) TO anon, authenticated, service_role;

-- ── 3. get_official_donors (polymorphic rewrite) ─────────────────────────────
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
    fe.id                              AS financial_entity_id,
    fe.display_name                    AS entity_name,
    fe.entity_type                     AS entity_type,
    COALESCE(fe.industry, 'Other')     AS industry_category,
    SUM(fr.amount_cents) / 100.0       AS total_amount_usd,
    COUNT(*)::BIGINT                   AS transaction_count
  FROM public.financial_relationships fr
  JOIN public.financial_entities      fe ON fe.id = fr.from_id
  WHERE fr.relationship_type = 'donation'
    AND fr.from_type         = 'financial_entity'
    AND fr.to_type           = 'official'
    AND fr.to_id             = p_official_id
  GROUP BY fe.id, fe.display_name, fe.entity_type, fe.industry
  ORDER BY total_amount_usd DESC
  LIMIT 100;
$$;

GRANT EXECUTE ON FUNCTION public.get_official_donors(UUID) TO anon, authenticated, service_role;

-- ── 4. get_pac_donations_by_party (polymorphic rewrite) ──────────────────────
CREATE OR REPLACE FUNCTION public.get_pac_donations_by_party()
RETURNS TABLE(
  party          TEXT,
  donor_name     TEXT,
  total_usd      NUMERIC,
  donation_count BIGINT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    COALESCE(o.party::TEXT, 'other') AS party,
    fe.display_name                  AS donor_name,
    SUM(fr.amount_cents) / 100.0     AS total_usd,
    COUNT(*)::BIGINT                 AS donation_count
  FROM public.financial_relationships fr
  JOIN public.financial_entities      fe ON fe.id = fr.from_id
  JOIN public.officials               o  ON o.id  = fr.to_id
  WHERE fr.relationship_type = 'donation'
    AND fr.from_type         = 'financial_entity'
    AND fr.to_type           = 'official'
    AND fe.entity_type IN ('pac', 'party_committee')
  GROUP BY o.party, fe.display_name
  ORDER BY total_usd DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_pac_donations_by_party() TO anon, authenticated, service_role;
