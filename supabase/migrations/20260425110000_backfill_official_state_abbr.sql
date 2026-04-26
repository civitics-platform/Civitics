-- =============================================================================
-- FIX-124 — Backfill officials.metadata.state_abbr (and .state) for federal reps
--
-- Federal Senators/Representatives were ingested with empty metadata. State
-- only lives in jurisdictions.short_name (always populated for them) and, as
-- a fallback, in source_ids->>'fec_candidate_id' positions 3-4 (e.g. "S4MT…"
-- → "MT"). This means /api/graph/treemap?groupBy=state buckets the entire
-- Senate as "Unknown", and any code reading metadata->>'state_abbr' (USER
-- node alignment, /api/profile/districts, /api/graph/my-representatives)
-- silently returns nothing for federal officials.
--
-- Strategy: write both `state_abbr` (the canonical field per CLAUDE.md and
-- the new code paths) AND `state` (the legacy field still read by
-- /api/graph/treemap, /api/graph/group, /api/search, /api/initiatives) so
-- both consumer styles work without a coordinated rename. fec_id (the
-- filing/committee ID) is intentionally NOT used — it can encode the wrong
-- state (e.g. Tammy Baldwin's fec_id="S0VA00070" but she represents WI).
--
-- Idempotent: only updates rows where state_abbr is currently missing AND a
-- valid 2-letter state can be derived. Re-running is a no-op.
-- =============================================================================

WITH derived AS (
  SELECT
    o.id,
    COALESCE(
      -- If state_abbr is already populated, use it as the source of truth.
      NULLIF(o.metadata->>'state_abbr', ''),
      -- Primary: the official's actual jurisdiction.
      CASE
        WHEN LENGTH(j.short_name) = 2
         AND j.short_name = ANY (ARRAY[
               'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID',
               'IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS',
               'MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK',
               'OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV',
               'WI','WY','DC','PR','GU','VI','AS','MP'
             ])
        THEN j.short_name
      END,
      -- Fallback: FEC candidate ID positions 3-4. Never fec_id (filing ID).
      CASE
        WHEN (o.source_ids->>'fec_candidate_id') ~ '^[SH][0-9][A-Z]{2}'
         AND SUBSTRING(o.source_ids->>'fec_candidate_id' FROM 3 FOR 2) = ANY (ARRAY[
               'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID',
               'IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS',
               'MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK',
               'OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV',
               'WI','WY'
             ])
        THEN SUBSTRING(o.source_ids->>'fec_candidate_id' FROM 3 FOR 2)
      END
    ) AS state_code
  FROM public.officials o
  LEFT JOIN public.jurisdictions j ON j.id = o.jurisdiction_id
  WHERE o.is_active
    AND (
      COALESCE(o.metadata->>'state_abbr', '') = ''
      OR COALESCE(o.metadata->>'state', '') = ''
    )
)
UPDATE public.officials o
SET metadata = COALESCE(o.metadata, '{}'::jsonb)
              || jsonb_build_object('state_abbr', d.state_code, 'state', d.state_code)
FROM derived d
WHERE o.id = d.id
  AND d.state_code IS NOT NULL
  AND (
    COALESCE(o.metadata->>'state_abbr', '') <> d.state_code
    OR COALESCE(o.metadata->>'state', '') <> d.state_code
  );
