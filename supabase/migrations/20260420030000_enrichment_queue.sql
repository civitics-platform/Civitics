-- 20260420030000_enrichment_queue.sql
-- FIX-064: Enrichment queue for offloading AI tag/summary work from the
-- Anthropic API to an external worker (Claude Code desktop routine).
-- Pipelines stage items here when CIVITICS_ENRICHMENT_MODE=queue; a worker
-- claims batches via claim_enrichment_batch() and submits results via the
-- admin submit endpoint which writes to entity_tags / ai_summary_cache.

CREATE TABLE IF NOT EXISTS enrichment_queue (
  id            BIGSERIAL PRIMARY KEY,
  entity_id     TEXT NOT NULL,
  entity_type   TEXT NOT NULL,      -- 'proposal' | 'official'
  task_type     TEXT NOT NULL,      -- 'tag' | 'summary'
  status        TEXT NOT NULL DEFAULT 'pending',
                                    -- 'pending' | 'processing' | 'done' | 'failed'
  context       JSONB,
  result        JSONB,
  retry_count   INT NOT NULL DEFAULT 0,
  last_error    TEXT,
  claimed_at    TIMESTAMPTZ,
  claimed_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,
  UNIQUE (entity_id, entity_type, task_type)
);

CREATE INDEX IF NOT EXISTS idx_enrichment_queue_pending
  ON enrichment_queue (task_type, created_at)
  WHERE status = 'pending';

ALTER TABLE enrichment_queue ENABLE ROW LEVEL SECURITY;
-- No policies: service role only. RLS on + zero policies = lockdown.


-- Idempotent upsert. Reads existing row under FOR UPDATE to avoid the
-- race where two concurrent enqueues see no row and both INSERT, both
-- then failing the unique constraint. Re-opens rows that failed with
-- retry_count<3; leaves done/processing/pending untouched.
CREATE OR REPLACE FUNCTION enqueue_enrichment(
  p_entity_id   TEXT,
  p_entity_type TEXT,
  p_task_type   TEXT,
  p_context     JSONB
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  existing enrichment_queue%ROWTYPE;
BEGIN
  SELECT * INTO existing
    FROM enrichment_queue
   WHERE entity_id = p_entity_id
     AND entity_type = p_entity_type
     AND task_type = p_task_type
   FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO enrichment_queue (entity_id, entity_type, task_type, context)
    VALUES (p_entity_id, p_entity_type, p_task_type, p_context);
    RETURN 'created';
  END IF;

  IF existing.status = 'done' THEN
    RETURN 'skipped_done';
  END IF;

  IF existing.status = 'failed' AND existing.retry_count < 3 THEN
    UPDATE enrichment_queue
       SET status = 'pending',
           context = p_context,
           claimed_at = NULL,
           claimed_by = NULL,
           last_error = NULL
     WHERE id = existing.id;
    RETURN 'retried';
  END IF;

  RETURN 'skipped_pending';  -- pending | processing | failed>=3
END $$;


-- Atomically claim up to p_limit pending rows for a task_type.
-- Single statement: SELECT ... FOR UPDATE SKIP LOCKED inside an UPDATE so
-- two concurrent workers never claim the same row.
CREATE OR REPLACE FUNCTION claim_enrichment_batch(
  p_task_type  TEXT,
  p_limit      INT,
  p_claimed_by TEXT
) RETURNS SETOF enrichment_queue
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  UPDATE enrichment_queue q
     SET status     = 'processing',
         claimed_at = NOW(),
         claimed_by = p_claimed_by
   WHERE q.id IN (
     SELECT id FROM enrichment_queue
      WHERE status = 'pending'
        AND task_type = p_task_type
      ORDER BY created_at ASC
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
   )
  RETURNING q.*;
END $$;


-- Record a failure: increment retry_count, clear claim, flip to 'failed'
-- once retry_count hits 3 (so the claim index stops surfacing it).
CREATE OR REPLACE FUNCTION record_enrichment_failure(
  p_queue_id BIGINT,
  p_error    TEXT
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  new_status TEXT;
BEGIN
  UPDATE enrichment_queue
     SET retry_count = retry_count + 1,
         last_error  = p_error,
         claimed_at  = NULL,
         claimed_by  = NULL,
         status      = CASE WHEN retry_count + 1 >= 3 THEN 'failed' ELSE 'pending' END
   WHERE id = p_queue_id
   RETURNING status INTO new_status;
  RETURN new_status;
END $$;


-- Service role only; no anon / authenticated execute.
REVOKE EXECUTE ON FUNCTION enqueue_enrichment(TEXT, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION claim_enrichment_batch(TEXT, INT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION record_enrichment_failure(BIGINT, TEXT)
  FROM PUBLIC, anon, authenticated;
