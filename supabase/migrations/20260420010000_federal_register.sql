-- =============================================================================
-- Federal Register fields — Phase 2 onramp (Federal Register API)
-- =============================================================================
-- Extends proposals with Federal Register document identifiers so we can
-- ingest executive orders and proposed rules from federalregister.gov.
-- Complements Regulations.gov (which covers comment periods).
-- =============================================================================

ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS federal_register_document_number  TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS federal_register_publication_date DATE,
  ADD COLUMN IF NOT EXISTS executive_order_number            INT UNIQUE;

CREATE INDEX IF NOT EXISTS proposals_federal_register_pub_date
  ON proposals(federal_register_publication_date DESC NULLS LAST)
  WHERE federal_register_publication_date IS NOT NULL;
