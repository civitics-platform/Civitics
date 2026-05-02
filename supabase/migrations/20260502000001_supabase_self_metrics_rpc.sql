-- 20260502000001_supabase_self_metrics_rpc.sql
-- FIX-190: RPC the admin client can call to pull live db_size + file storage size.
--
-- pg_database_size() and the storage.objects sum aren't reachable through
-- PostgREST .from() calls. Wrap them in a SECURITY DEFINER RPC so the admin
-- client can pull them in one round-trip.

CREATE OR REPLACE FUNCTION public.get_supabase_self_metrics()
RETURNS TABLE(
  db_size_bytes BIGINT,
  storage_bytes BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pg_database_size(current_database())::BIGINT,
    COALESCE((
      SELECT SUM((metadata->>'size')::BIGINT)
        FROM storage.objects
       WHERE metadata ? 'size'
    ), 0)::BIGINT;
END;
$$;

REVOKE ALL ON FUNCTION public.get_supabase_self_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_supabase_self_metrics() TO service_role;
