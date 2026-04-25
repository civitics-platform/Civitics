-- FIX-117: Add index on enrichment_queue(entity_type, task_type) for snapshot reads.
-- fetchQueueSnapshot() filters by (entity_type, task_type) without a covering index;
-- at >50k rows each page scan is O(N) and hits Pro's ~8s statement timeout.

CREATE INDEX IF NOT EXISTS enrichment_queue_type_task
  ON enrichment_queue (entity_type, task_type);
