-- =============================================================================
-- Stage 1 · 07 · enrichment_queue, claim_queue, pipeline_state, data_sync_log
--
-- Operational plumbing. Not citizen-facing data.
--
--   - enrichment_queue: prioritized AI-summarization / tagging / embedding
--     queue. Decision #6 resolved: parallel agents drain it (Craig on Pro/Max).
--   - claim_queue: user-driven "cover my district" requests. Schema exists in
--     Stage 1; Phase 2 wires up the processor (per Stage 0 decisions).
--   - pipeline_state: single key/value table for all pipeline cursors, egress
--     meters, rate-limit windows.
--   - data_sync_log: append-only audit trail. Stage 0 finding #11 fixed by
--     using the single canonical column name `pipeline` (not pipeline_name).
-- =============================================================================

-- ── enrichment_queue ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shadow.enrichment_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What needs enrichment (polymorphic, app-level FK)
  entity_type     TEXT NOT NULL,                 -- 'proposal' | 'official' | 'meeting' | 'donation_burst'
  entity_id       UUID NOT NULL,
  enrichment_type TEXT NOT NULL,                 -- 'summarize' | 'tag' | 'embed' | 'detect_revolving_door'

  -- Priority: lower number = higher priority
  priority        INTEGER NOT NULL DEFAULT 100,
  reason          TEXT,                          -- 'new_proposal' | 'comment_period_opening' | 'high_traffic' | 'manual'

  -- State machine
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'skipped')),
  attempt_count   INTEGER NOT NULL DEFAULT 0,

  -- Worker tracking (populated during claim)
  worker_id       TEXT,
  claimed_at      TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  failed_reason   TEXT,

  -- Cost / model accounting
  model_used      TEXT,
  cost_cents      INTEGER,

  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotency: don't queue the same job twice while one is pending or
-- in-progress. Partial unique index is cleaner than a DEFERRABLE full
-- constraint because it lets completed / failed rows accumulate as history.
CREATE UNIQUE INDEX IF NOT EXISTS enrichment_queue_active_unique
  ON shadow.enrichment_queue(entity_type, entity_id, enrichment_type)
  WHERE status IN ('pending', 'in_progress');

-- Worker dispatch index: parallel agents claim by (priority, created_at)
CREATE INDEX IF NOT EXISTS enrichment_queue_pending
  ON shadow.enrichment_queue(status, priority, created_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS enrichment_queue_worker
  ON shadow.enrichment_queue(worker_id, status)
  WHERE status = 'in_progress';
CREATE INDEX IF NOT EXISTS enrichment_queue_entity
  ON shadow.enrichment_queue(entity_type, entity_id);

COMMENT ON TABLE shadow.enrichment_queue IS
  'Prioritized queue for AI enrichment (summarize, tag, embed). Workers claim with SELECT ... FOR UPDATE SKIP LOCKED. Partial unique index enforces one active job per (entity, type).';

-- ── claim_queue (Decision #3, schema-only) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS shadow.claim_queue (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  jurisdiction_id  UUID NOT NULL REFERENCES public.jurisdictions(id),
  requested_by     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reason           TEXT,                          -- free text

  -- Rough demand signal; aggregation job rolls per-jurisdiction want-counts
  upvote_count     INTEGER NOT NULL DEFAULT 1,

  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'in_progress', 'completed', 'rejected')),
  rejection_reason TEXT,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at      TIMESTAMPTZ,

  -- One request per (jurisdiction, user); upvote count tracked separately
  UNIQUE(jurisdiction_id, requested_by)
);

CREATE INDEX IF NOT EXISTS claim_queue_status_priority
  ON shadow.claim_queue(status, upvote_count DESC, created_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS claim_queue_jurisdiction
  ON shadow.claim_queue(jurisdiction_id);
CREATE INDEX IF NOT EXISTS claim_queue_requester
  ON shadow.claim_queue(requested_by);

COMMENT ON TABLE shadow.claim_queue IS
  'User-submitted requests to add coverage for a jurisdiction. Stage 1: schema only. Phase 2: processor ingests top-demand jurisdictions and spins up scrapers.';

-- ── pipeline_state (single key/value) ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS shadow.pipeline_state (
  pipeline        TEXT NOT NULL,                 -- 'congress.bills' | 'fec.bulk' | 'legistar:seattle' | ...
  key             TEXT NOT NULL,                 -- 'cursor' | 'last_run' | 'egress_cents_today' | 'rate_limit_remaining'
  value_text      TEXT,
  value_int       BIGINT,
  value_jsonb     JSONB,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (pipeline, key)
);

CREATE INDEX IF NOT EXISTS pipeline_state_updated_at
  ON shadow.pipeline_state(updated_at DESC);

COMMENT ON TABLE shadow.pipeline_state IS
  'Unified key/value store for all pipeline state (cursors, rate limits, egress meters). Replaces ad-hoc per-pipeline state tables.';

-- ── data_sync_log (append-only, canonical column name) ──────────────────────

CREATE TABLE IF NOT EXISTS shadow.data_sync_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline         TEXT NOT NULL,                -- canonical column name — Stage 0 #11 fix
  started_at       TIMESTAMPTZ NOT NULL,
  finished_at      TIMESTAMPTZ,
  status           TEXT NOT NULL CHECK (status IN ('running', 'success', 'partial', 'failed', 'skipped')),
  records_inserted INTEGER NOT NULL DEFAULT 0,
  records_updated  INTEGER NOT NULL DEFAULT 0,
  records_skipped  INTEGER NOT NULL DEFAULT 0,
  records_failed   INTEGER NOT NULL DEFAULT 0,
  api_calls        INTEGER NOT NULL DEFAULT 0,
  bytes_egress     BIGINT NOT NULL DEFAULT 0,
  cost_cents       INTEGER NOT NULL DEFAULT 0,
  error_summary    TEXT,
  metadata         JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS data_sync_log_pipeline
  ON shadow.data_sync_log(pipeline, started_at DESC);
CREATE INDEX IF NOT EXISTS data_sync_log_status
  ON shadow.data_sync_log(status);
CREATE INDEX IF NOT EXISTS data_sync_log_started_at
  ON shadow.data_sync_log(started_at DESC);

COMMENT ON TABLE shadow.data_sync_log IS
  'Append-only audit trail for every pipeline run. Canonical column is pipeline (not pipeline_name) — Stage 0 finding #11 fixed.';

-- DOWN:
--   DROP TABLE IF EXISTS shadow.data_sync_log;
--   DROP TABLE IF EXISTS shadow.pipeline_state;
--   DROP TABLE IF EXISTS shadow.claim_queue;
--   DROP TABLE IF EXISTS shadow.enrichment_queue;
