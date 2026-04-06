-- GIN trigram index on financial_entities.name for fast ILIKE search.
-- Requires: pg_trgm extension (already enabled via migration 0008).
-- Mirrors pattern used for officials.full_name and proposals.title.

CREATE INDEX IF NOT EXISTS idx_financial_entities_name_trgm
  ON financial_entities
  USING GIN (name gin_trgm_ops);
