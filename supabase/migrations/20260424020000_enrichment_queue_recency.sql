-- 20260424020000_enrichment_queue_recency.sql
-- Add entity_updated_at for recency-based ordering within priority tiers.
-- Federal > State > County > City, then newest entity first within each tier.

ALTER TABLE enrichment_queue
  ADD COLUMN IF NOT EXISTS entity_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Backfill existing rows from queue creation time (best proxy we have).
UPDATE enrichment_queue SET entity_updated_at = created_at;

-- Rebuild pending index: priority DESC + entity_updated_at DESC (newest first within tier).
DROP INDEX IF EXISTS idx_enrichment_queue_pending;
CREATE INDEX idx_enrichment_queue_pending
  ON enrichment_queue (priority DESC, entity_updated_at DESC)
  WHERE status = 'pending';

-- Updated claim function: priority tier first, then most-recently-updated entity.
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
      ORDER BY priority DESC, entity_updated_at DESC NULLS LAST
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
   )
  RETURNING q.*;
END $$;

REVOKE EXECUTE ON FUNCTION claim_enrichment_batch(TEXT, INT, TEXT)
  FROM PUBLIC, anon, authenticated;

-- Drop old 4-param overload; new 6-param version handles all callers via DEFAULT params.
DROP FUNCTION IF EXISTS enqueue_enrichment(TEXT, TEXT, TEXT, JSONB);

-- Updated enqueue_enrichment: optional priority + entity_updated_at with safe defaults.
-- Existing callers that pass only 4 named params continue to work unchanged.
CREATE OR REPLACE FUNCTION enqueue_enrichment(
  p_entity_id          TEXT,
  p_entity_type        TEXT,
  p_task_type          TEXT,
  p_context            JSONB,
  p_priority           INT DEFAULT 0,
  p_entity_updated_at  TIMESTAMPTZ DEFAULT NOW()
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
    INSERT INTO enrichment_queue
      (entity_id, entity_type, task_type, context, priority, entity_updated_at)
    VALUES
      (p_entity_id, p_entity_type, p_task_type, p_context, p_priority, p_entity_updated_at);
    RETURN 'created';
  END IF;

  IF existing.status = 'done' THEN
    RETURN 'skipped_done';
  END IF;

  IF existing.status = 'failed' AND existing.retry_count < 3 THEN
    UPDATE enrichment_queue
       SET status            = 'pending',
           context           = p_context,
           priority          = p_priority,
           entity_updated_at = p_entity_updated_at,
           claimed_at        = NULL,
           claimed_by        = NULL,
           last_error        = NULL
     WHERE id = existing.id;
    RETURN 'retried';
  END IF;

  RETURN 'skipped_pending';
END $$;

REVOKE EXECUTE ON FUNCTION enqueue_enrichment(TEXT, TEXT, TEXT, JSONB, INT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
