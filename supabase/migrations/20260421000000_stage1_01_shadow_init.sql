-- =============================================================================
-- Stage 1 · 01 · Shadow schema init + additive public changes
--
-- Creates the `shadow` schema for Stage 1 rebuild tables (proposals split,
-- polymorphic financial_relationships, derived entity_connections, etc.).
-- Public-schema changes here are strictly additive: new enum values, one new
-- column on jurisdictions. No existing tables are reshaped in Stage 1A.
--
-- See docs/STAGE_1_SCHEMA_DESIGN.md for full rationale.
-- =============================================================================

-- ── Shadow schema ────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS shadow;
COMMENT ON SCHEMA shadow IS
  'Stage 1 rebuild tables. Populated via dual-write during Stage 1; swapped to public at Stage 2 cutover. See docs/STAGE_1_SCHEMA_DESIGN.md.';

-- Grant usage to application roles so Stage 1C read-switchover works
GRANT USAGE ON SCHEMA shadow TO anon, authenticated, service_role;
-- Default privileges for tables we haven't created yet; grant-all for service role
ALTER DEFAULT PRIVILEGES IN SCHEMA shadow
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA shadow
  GRANT SELECT ON TABLES TO anon, authenticated;

-- ── Enum extensions (additive, safe in public) ───────────────────────────────

-- jurisdiction_type: add school_district + special_district for Stage 1 local coverage
DO $$ BEGIN
  ALTER TYPE jurisdiction_type ADD VALUE IF NOT EXISTS 'school_district';
  ALTER TYPE jurisdiction_type ADD VALUE IF NOT EXISTS 'special_district';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- connection_type: add new values derived from polymorphic financial_relationships
DO $$ BEGIN
  ALTER TYPE connection_type ADD VALUE IF NOT EXISTS 'holds_position';
  ALTER TYPE connection_type ADD VALUE IF NOT EXISTS 'gift_received';
  ALTER TYPE connection_type ADD VALUE IF NOT EXISTS 'contract_award';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── jurisdictions.coverage_status (additive column for claim-queue feature) ──

ALTER TABLE jurisdictions
  ADD COLUMN IF NOT EXISTS coverage_status TEXT NOT NULL DEFAULT 'none'
    CHECK (coverage_status IN ('none', 'claimed', 'partial', 'full'));

ALTER TABLE jurisdictions
  ADD COLUMN IF NOT EXISTS coverage_started_at TIMESTAMPTZ;
ALTER TABLE jurisdictions
  ADD COLUMN IF NOT EXISTS coverage_completed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS jurisdictions_coverage_status
  ON jurisdictions(coverage_status)
  WHERE coverage_status <> 'none';

-- DOWN:
--   DROP INDEX IF EXISTS jurisdictions_coverage_status;
--   ALTER TABLE jurisdictions DROP COLUMN IF EXISTS coverage_completed_at;
--   ALTER TABLE jurisdictions DROP COLUMN IF EXISTS coverage_started_at;
--   ALTER TABLE jurisdictions DROP COLUMN IF EXISTS coverage_status;
--   -- Enum values cannot be dropped cleanly in PG; accept that school_district etc. persist.
--   DROP SCHEMA IF EXISTS shadow CASCADE;
