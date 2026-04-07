-- RPC function to get connection counts for a batch of entity IDs.
-- Avoids the .in() large array bug (silently returns empty for 100+ IDs).
-- Usage: SELECT * FROM get_connection_counts('{uuid1,uuid2,...}'::uuid[]);

CREATE OR REPLACE FUNCTION get_connection_counts(entity_ids uuid[])
RETURNS TABLE(entity_id uuid, connection_count bigint)
LANGUAGE sql STABLE AS $$
  SELECT id AS entity_id, COUNT(*) AS connection_count
  FROM (
    SELECT from_id AS id FROM entity_connections WHERE from_id = ANY(entity_ids)
    UNION ALL
    SELECT to_id   AS id FROM entity_connections WHERE to_id   = ANY(entity_ids)
  ) sub
  GROUP BY id;
$$;
