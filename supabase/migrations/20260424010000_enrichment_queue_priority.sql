-- 20260424000000_enrichment_queue_priority.sql
-- Add priority column to enrichment_queue so federal items surface first.
-- Existing FIFO behaviour is preserved within each priority tier.

ALTER TABLE enrichment_queue
  ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 0;

-- Rebuild the pending index to include priority for efficient ordering.
DROP INDEX IF EXISTS idx_enrichment_queue_pending;
CREATE INDEX idx_enrichment_queue_pending
  ON enrichment_queue (priority DESC, created_at ASC)
  WHERE status = 'pending';

-- Updated claim function: order by priority DESC, then created_at ASC (FIFO within tier).
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
      ORDER BY priority DESC, created_at ASC
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
   )
  RETURNING q.*;
END $$;

REVOKE EXECUTE ON FUNCTION claim_enrichment_batch(TEXT, INT, TEXT)
  FROM PUBLIC, anon, authenticated;

-- One-time: bump existing pending federal items to priority = 1.
-- Federal officials (US Congress members, jurisdiction fips_code = '00').
UPDATE enrichment_queue eq
   SET priority = 1
 WHERE eq.entity_type = 'official'
   AND eq.status = 'pending'
   AND EXISTS (
     SELECT 1 FROM officials o
       JOIN jurisdictions j ON o.jurisdiction_id = j.id
      WHERE o.id::text = eq.entity_id
        AND j.fips_code = '00'
   );

-- Federal proposals (Congress bills + Federal Register regulations).
UPDATE enrichment_queue eq
   SET priority = 1
 WHERE eq.entity_type = 'proposal'
   AND eq.status = 'pending'
   AND EXISTS (
     SELECT 1 FROM proposals p
       JOIN jurisdictions j ON p.jurisdiction_id = j.id
      WHERE p.id::text = eq.entity_id
        AND j.fips_code = '00'
   );
