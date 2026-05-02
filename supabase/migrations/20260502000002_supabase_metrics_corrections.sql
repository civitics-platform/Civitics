-- 20260502000002_supabase_metrics_corrections.sql
-- FIX-190 follow-up: corrections discovered when first hitting the live
-- Supabase Management API with a real PAT.
--
-- (1) The analytics endpoint (usage.api-counts) caps at 7day intervals;
--     'monthly' returns 400. Renaming the metric + display label so it
--     accurately reflects what we measure.
--
-- (2) The functions.combined-stats endpoint requires a per-function ID
--     and we don't deploy any Edge Functions on this project. Drop the
--     row so it stops showing as "No data" indefinitely.

-- Rename api_requests_total → api_requests_7d
UPDATE platform_limits
   SET metric = 'api_requests_7d',
       display_label = 'API Requests (last 7 days)',
       notes = 'Sum of REST + Auth + Realtime + Storage requests over the last 7 days. The Supabase Management API analytics endpoint caps at 7day intervals.'
 WHERE service = 'supabase' AND metric = 'api_requests_total';

-- Move any prior usage rows under the new metric name. Idempotent: if
-- nothing was ever written under the old name (likely — we only just shipped),
-- this is a no-op.
UPDATE platform_usage
   SET metric = 'api_requests_7d'
 WHERE service = 'supabase' AND metric = 'api_requests_total';

-- Drop function_invocations row (we don't run any Edge Functions; the
-- combined-stats endpoint isn't usable in aggregate without function IDs).
DELETE FROM platform_usage
 WHERE service = 'supabase' AND metric = 'function_invocations';
DELETE FROM platform_limits
 WHERE service = 'supabase' AND metric = 'function_invocations';
