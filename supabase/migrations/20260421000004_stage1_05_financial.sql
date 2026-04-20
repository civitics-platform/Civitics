-- =============================================================================
-- Stage 1 · 05 · financial_entities + polymorphic financial_relationships
--
-- Clean-slate rewrite per Decisions #4 (FEC donations rebuild from scratch) and
-- L7 (keep `financial_relationships` name, make polymorphic with a
-- relationship_type enum). Replaces the current donations-only shape with one
-- table that handles campaign contributions, gifts, honoraria, loans, equity
-- holdings, bonds, real-estate, contracts, grants, and lobbying spend.
--
-- Per E.4: spending_records migrates in — government contracts/grants become
-- financial_relationships rows with type='contract'/'grant', NAICS/CFDA/subagency
-- ride in metadata. Volume control (2010+ as line items, pre-2010 aggregated)
-- is a pipeline-level concern, not a schema concern.
--
-- Temporal model:
--   One-off events (donation, gift, honorarium, loan, contract, grant) use
--     occurred_at.
--   Stateful relationships (owns_stock, owns_bond, property, lobbying_spend)
--     use started_at / ended_at.
--   CHECK constraint enforces exactly one of (occurred_at) OR (started_at).
-- =============================================================================

-- ── financial_entities ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shadow.financial_entities (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Canonical (lowercased, normalized) name for dedup matching
  canonical_name       TEXT NOT NULL,
  -- Display name preserves source-casing for UI
  display_name         TEXT NOT NULL,

  entity_type          TEXT NOT NULL CHECK (entity_type IN (
                         'individual', 'pac', 'super_pac', 'corporation',
                         'union', 'party_committee', 'small_donor_aggregate',
                         'tribal', '527', 'other'
                       )),

  -- One canonical FEC ID where it exists; other source IDs live in
  -- external_source_refs so the same entity can carry FEC + OpenSecrets +
  -- Socrata per-metro donor IDs without column explosion.
  fec_committee_id     TEXT UNIQUE,

  industry             TEXT,                   -- OpenSecrets industry / NAICS sector
  parent_entity_id     UUID REFERENCES shadow.financial_entities(id),  -- subsidiary → parent corp

  -- Aggregates refreshed by nightly jobs, not computed live.
  total_donated_cents  BIGINT NOT NULL DEFAULT 0,
  total_received_cents BIGINT NOT NULL DEFAULT 0,

  metadata             JSONB NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(canonical_name, entity_type)
);

CREATE INDEX IF NOT EXISTS financial_entities_canonical
  ON shadow.financial_entities(canonical_name);
CREATE INDEX IF NOT EXISTS financial_entities_display_trgm
  ON shadow.financial_entities USING GIN(display_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS financial_entities_parent
  ON shadow.financial_entities(parent_entity_id)
  WHERE parent_entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS financial_entities_industry
  ON shadow.financial_entities(industry)
  WHERE industry IS NOT NULL;
CREATE INDEX IF NOT EXISTS financial_entities_type
  ON shadow.financial_entities(entity_type);

COMMENT ON TABLE shadow.financial_entities IS
  'Canonical money-flow entities (donors, PACs, corporations, unions). UNIQUE(canonical_name, entity_type) enforces dedup; source-specific IDs live in external_source_refs.';

-- ── relationship type enum ───────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE shadow.financial_relationship_type AS ENUM (
    'donation',        -- campaign contribution, one-off money transfer
    'gift',            -- personal gift to an official (reportable under ethics rules)
    'honorarium',      -- speaking fees, book advances, paid appearances
    'loan',            -- loan to or from an entity / official
    'owns_stock',      -- equity holding (stateful — has start, may have end)
    'owns_bond',       -- debt holding
    'property',        -- real estate ownership
    'contract',        -- government contract awarded to an entity (from spending_records)
    'grant',           -- government grant (from spending_records)
    'lobbying_spend',  -- lobbying expenditures for a quarter
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── financial_relationships (polymorphic) ────────────────────────────────────

CREATE TABLE IF NOT EXISTS shadow.financial_relationships (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  relationship_type   shadow.financial_relationship_type NOT NULL,

  -- Polymorphic FROM side (giver, holder, awarding authority — depends on type)
  from_type           TEXT NOT NULL CHECK (from_type IN (
                        'financial_entity', 'official', 'agency', 'governing_body'
                      )),
  from_id             UUID NOT NULL,

  -- Polymorphic TO side (recipient, subject, company)
  to_type             TEXT NOT NULL CHECK (to_type IN (
                        'financial_entity', 'official', 'agency', 'governing_body'
                      )),
  to_id               UUID NOT NULL,

  -- Amount. Semantics by type:
  --   donation/gift/honorarium/loan/contract/grant: transferred amount
  --   owns_stock/owns_bond/property: current market value (may be null)
  --   lobbying_spend: quarterly total
  amount_cents        BIGINT,

  -- Temporal model
  --   Exactly one of (occurred_at) OR (started_at) — CHECK constraint enforces.
  occurred_at         DATE,                     -- one-off events
  started_at          DATE,                     -- stateful relationships
  ended_at            DATE,                     -- stateful relationships; null = ongoing
  cycle_year          INTEGER,                  -- election cycle (donations)

  -- Type-specific external identifiers (for dedup + backlinks)
  fec_filing_id       TEXT,                     -- FEC transactions
  usaspending_award_id TEXT,                    -- government contracts/grants
  disclosure_form_id  TEXT,                     -- STOCK Act disclosures, ethics filings, LDA

  -- Flags
  is_in_kind          BOOLEAN NOT NULL DEFAULT false,
  is_bundled          BOOLEAN NOT NULL DEFAULT false,

  source_url          TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Temporal exactly-one-of constraint
  CHECK (
    (occurred_at IS NOT NULL AND started_at IS NULL AND ended_at IS NULL)  -- one-off event
    OR (occurred_at IS NULL AND started_at IS NOT NULL)                    -- stateful relationship
  ),

  -- ended_at can't precede started_at
  CHECK (ended_at IS NULL OR started_at IS NULL OR ended_at >= started_at)
);

-- External-ID uniqueness as partial unique indexes (NULL-permissive).
-- One row per FEC filing, one per USASpending award, one per disclosure.
CREATE UNIQUE INDEX IF NOT EXISTS financial_relationships_fec_filing_unique
  ON shadow.financial_relationships(fec_filing_id)
  WHERE fec_filing_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS financial_relationships_usaspending_unique
  ON shadow.financial_relationships(usaspending_award_id)
  WHERE usaspending_award_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS financial_relationships_disclosure_unique
  ON shadow.financial_relationships(disclosure_form_id)
  WHERE disclosure_form_id IS NOT NULL;

-- Lookup indexes
CREATE INDEX IF NOT EXISTS financial_relationships_type
  ON shadow.financial_relationships(relationship_type);
CREATE INDEX IF NOT EXISTS financial_relationships_from
  ON shadow.financial_relationships(from_type, from_id);
CREATE INDEX IF NOT EXISTS financial_relationships_to
  ON shadow.financial_relationships(to_type, to_id);
CREATE INDEX IF NOT EXISTS financial_relationships_occurred_at
  ON shadow.financial_relationships(occurred_at DESC)
  WHERE occurred_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS financial_relationships_started_at
  ON shadow.financial_relationships(started_at DESC)
  WHERE started_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS financial_relationships_cycle
  ON shadow.financial_relationships(cycle_year)
  WHERE cycle_year IS NOT NULL;
CREATE INDEX IF NOT EXISTS financial_relationships_amount
  ON shadow.financial_relationships(amount_cents DESC)
  WHERE amount_cents IS NOT NULL;
CREATE INDEX IF NOT EXISTS financial_relationships_metadata_gin
  ON shadow.financial_relationships USING GIN(metadata);

-- For the derivation pass that builds entity_connections (Stage 1 · 06),
-- a compound index on the most common derivation query shape speeds
-- aggregation substantially.
CREATE INDEX IF NOT EXISTS financial_relationships_derivation
  ON shadow.financial_relationships(relationship_type, from_type, from_id, to_type, to_id);

COMMENT ON TABLE shadow.financial_relationships IS
  'Polymorphic money/ownership ties. Stateful types (owns_stock/bond, property, lobbying_spend) use started_at/ended_at; one-off types (donation, gift, contract, grant, etc.) use occurred_at. Entity_connections derives from this table.';

-- DOWN:
--   DROP TABLE IF EXISTS shadow.financial_relationships CASCADE;
--   DROP TYPE  IF EXISTS shadow.financial_relationship_type;
--   DROP TABLE IF EXISTS shadow.financial_entities CASCADE;
