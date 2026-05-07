-- 20260506000000_agency_enrichment_columns.sql
-- FIX-208: Agency enrichment — new columns on agencies table.
-- FIX-209: Agency leadership pipeline — make governing_body_id nullable on
--          officials so appointed officials (agency heads, judges, etc.)
--          can be stored without a governing body FK.

-- ── 1. Agency enrichment columns ─────────────────────────────────────────────

ALTER TABLE agencies
  ADD COLUMN IF NOT EXISTS founded_year INTEGER,
  ADD COLUMN IF NOT EXISTS personnel_fte INTEGER,
  ADD COLUMN IF NOT EXISTS wikidata_id TEXT;

CREATE INDEX IF NOT EXISTS agencies_wikidata_id ON agencies(wikidata_id)
  WHERE wikidata_id IS NOT NULL;

-- ── 2. Make governing_body_id nullable on officials ───────────────────────────
-- Elected members always have one; appointed officials (cabinet secretaries,
-- agency directors, federal judges) don't belong to a governing body.

ALTER TABLE officials ALTER COLUMN governing_body_id DROP NOT NULL;
