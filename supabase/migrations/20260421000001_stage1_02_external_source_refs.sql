-- =============================================================================
-- Stage 1 · 02 · external_source_refs
--
-- Canonical binding between external source IDs and local entities. Replaces
-- the current pattern of using `source_ids->>X` JSONB path filters as primary
-- dedup keys — which can't be backed by unique indexes and cause races.
--
-- Polymorphic FK enforcement is app-level (see L2 decision) with a periodic
-- orphan cleanup job. Triggers were rejected on write-cost grounds.
-- =============================================================================

CREATE TABLE IF NOT EXISTS shadow.external_source_refs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The source this ref came from, qualified when one source has multiple
  -- deployments (Legistar per-city, Socrata per-portal)
  source          TEXT NOT NULL,            -- 'congress_gov' | 'openstates' | 'courtlistener' | 'legistar:seattle' | 'dc_lims' | 'fec' | 'ballotpedia' | ...
  external_id     TEXT NOT NULL,            -- exact source PK string

  -- The local entity this ref points at (polymorphic)
  entity_type     TEXT NOT NULL,            -- 'proposal' | 'official' | 'meeting' | 'agenda_item' | 'financial_entity' | 'financial_relationship' | etc.
  entity_id       UUID NOT NULL,

  -- Human-readable backlink
  source_url      TEXT,

  -- Operational
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(source, external_id)
);

CREATE INDEX IF NOT EXISTS external_source_refs_entity
  ON shadow.external_source_refs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS external_source_refs_source
  ON shadow.external_source_refs(source);
CREATE INDEX IF NOT EXISTS external_source_refs_last_seen_at
  ON shadow.external_source_refs(last_seen_at);
CREATE INDEX IF NOT EXISTS external_source_refs_metadata_gin
  ON shadow.external_source_refs USING GIN(metadata);

COMMENT ON TABLE shadow.external_source_refs IS
  'Canonical (source, external_id) → (entity_type, entity_id) mapping. Pipelines check this table BEFORE creating entities. Replaces source_ids JSONB path filters.';

-- ── RLS: operational data, service-role only ─────────────────────────────────

ALTER TABLE shadow.external_source_refs ENABLE ROW LEVEL SECURITY;
-- No public policies. service_role bypasses RLS.

-- DOWN:
--   DROP TABLE IF EXISTS shadow.external_source_refs CASCADE;
