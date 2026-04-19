-- =============================================================================
-- Lobbying disclosures — Phase 2 onramp (OpenSecrets bulk)
-- =============================================================================
-- Lobbying filings + industry code reference table. Feeds a new "lobbying"
-- edge type in entity_connections in Phase 2.
-- =============================================================================

CREATE TABLE IF NOT EXISTS industry_codes (
  code   TEXT PRIMARY KEY,
  label  TEXT NOT NULL,
  sector TEXT,
  source TEXT NOT NULL DEFAULT 'opensecrets'
);

CREATE TABLE IF NOT EXISTS lobbying_disclosures (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filing_year     INT  NOT NULL,
  filing_period   TEXT,
  client_name     TEXT NOT NULL,
  registrant_name TEXT NOT NULL,
  amount_cents    BIGINT,
  industry_code   TEXT REFERENCES industry_codes(code),
  official_id     UUID REFERENCES officials(id),
  source          TEXT NOT NULL DEFAULT 'opensecrets',
  source_url      TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS lobbying_disclosures_unique
  ON lobbying_disclosures(filing_year, client_name, registrant_name, COALESCE(filing_period, ''));

CREATE INDEX IF NOT EXISTS lobbying_disclosures_industry ON lobbying_disclosures(industry_code);
CREATE INDEX IF NOT EXISTS lobbying_disclosures_client   ON lobbying_disclosures(client_name);
CREATE INDEX IF NOT EXISTS lobbying_disclosures_year     ON lobbying_disclosures(filing_year DESC);

ALTER TABLE financial_relationships
  ADD COLUMN IF NOT EXISTS opensecrets_industry_code TEXT REFERENCES industry_codes(code);
