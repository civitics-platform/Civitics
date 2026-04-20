-- =============================================================================
-- Stage 1 · 06 · entity_connections (derivation-only per L5)
--
-- The current entity_connections table is written by 3+ pipelines with
-- inconsistent evidence shapes. Per L5, Phase 1 rebuilds it as a DERIVED table
-- populated by deterministic rules from the underlying source tables. No
-- pipeline writes to entity_connections directly in Phase 1; a nightly job
-- rebuilds the graph.
--
-- Manual edges, user-flagged connections, and ad-hoc edits are Phase 2.
--
-- Uses the existing public.connection_type enum, which was extended in
-- migration 01 to include 'holds_position', 'gift_received', 'contract_award'.
-- =============================================================================

CREATE TABLE IF NOT EXISTS shadow.entity_connections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  from_type       TEXT NOT NULL,
  from_id         UUID NOT NULL,
  to_type         TEXT NOT NULL,
  to_id           UUID NOT NULL,
  connection_type public.connection_type NOT NULL,

  -- Numeric weight for graph rendering / ranking. Log-scaled for money edges.
  strength        NUMERIC(4,3) NOT NULL DEFAULT 0.5,

  -- Aggregated money (donation total, contract award total, gift value sum)
  amount_cents    BIGINT,

  -- Temporal window this derived edge summarizes
  occurred_at     DATE,
  ended_at        DATE,

  -- Structured evidence (replaces the old free-form "evidence" blob)
  evidence_count  INTEGER NOT NULL DEFAULT 1,
  evidence_source TEXT NOT NULL,                -- 'financial_relationships' | 'votes' | 'cosponsorship' | 'career_history' | 'agency_oversight'
  evidence_ids    UUID[] NOT NULL DEFAULT '{}', -- IDs in the evidence_source table

  -- When this edge was last rebuilt — allows stale-sweep
  derived_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  metadata        JSONB NOT NULL DEFAULT '{}',

  -- One edge per (from, to, connection_type). Derivation upserts by this key.
  UNIQUE(from_type, from_id, to_type, to_id, connection_type)
);

CREATE INDEX IF NOT EXISTS entity_connections_from
  ON shadow.entity_connections(from_type, from_id);
CREATE INDEX IF NOT EXISTS entity_connections_to
  ON shadow.entity_connections(to_type, to_id);
CREATE INDEX IF NOT EXISTS entity_connections_type
  ON shadow.entity_connections(connection_type);
CREATE INDEX IF NOT EXISTS entity_connections_strength
  ON shadow.entity_connections(strength DESC);
CREATE INDEX IF NOT EXISTS entity_connections_evidence_source
  ON shadow.entity_connections(evidence_source);
CREATE INDEX IF NOT EXISTS entity_connections_derived_at
  ON shadow.entity_connections(derived_at);
CREATE INDEX IF NOT EXISTS entity_connections_amount
  ON shadow.entity_connections(amount_cents DESC)
  WHERE amount_cents IS NOT NULL;

COMMENT ON TABLE shadow.entity_connections IS
  'Derived graph edges rebuilt from source tables (financial_relationships, votes, cosponsorships, career_history, oversight). Phase 1: derivation-only. No direct pipeline writes. Nightly job rebuilds; per-edge upsert by (from, to, connection_type).';

-- ── Derivation function stub ─────────────────────────────────────────────────
--
-- The actual derivation job lives in application code (packages/data) and runs
-- nightly. This stub documents the intended interface so a human (or a future
-- pg_cron job) can call it after Stage 1C read-switchover. Body left TODO in
-- this migration — implementing it requires the pipeline refactor to be done.

CREATE OR REPLACE FUNCTION shadow.rebuild_entity_connections()
RETURNS TABLE(connection_type TEXT, edges_upserted BIGINT)
LANGUAGE plpgsql
AS $$
BEGIN
  -- TODO(phase1): implement derivation rules:
  --
  --  donation          ← financial_relationships (type='donation')
  --                      aggregate by (from, to, cycle_year)
  --  vote_yes/vote_no  ← votes (one edge per official → bill_proposal)
  --  co_sponsorship    ← cosponsorships
  --  appointment       ← career_history (is_government)
  --  revolving_door    ← career_history (revolving_door_flag)
  --  oversight         ← static agencies × governing_bodies lookup
  --  holds_position    ← financial_relationships (type IN
  --                        ('owns_stock','owns_bond','property'))
  --                      WHERE ended_at IS NULL
  --  gift_received     ← financial_relationships (type IN ('gift','honorarium'))
  --  contract_award    ← financial_relationships (type IN ('contract','grant'))
  --  lobbying          ← financial_relationships (type='lobbying_spend')
  --
  -- Each rule upserts into shadow.entity_connections with the matching
  -- connection_type, refreshing strength and evidence_count.
  --
  -- For now, return empty result set so the signature is callable during
  -- dual-write window without erroring.
  RETURN;
END;
$$;

COMMENT ON FUNCTION shadow.rebuild_entity_connections() IS
  'Stub for the nightly derivation job. Body is implemented in packages/data (TS) during Stage 1 pipeline refactor; this SQL stub exists so references compile during dual-write.';

-- DOWN:
--   DROP FUNCTION IF EXISTS shadow.rebuild_entity_connections();
--   DROP TABLE    IF EXISTS shadow.entity_connections CASCADE;
