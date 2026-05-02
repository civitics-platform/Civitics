-- 20260502000000_supabase_live_metrics.sql
-- FIX-190: live Supabase usage in the Platform Costs card.
--
-- 1. Add platform_limits.has_public_api so the card can distinguish
--    "manual because we haven't wired the API yet" (amber/stale)
--    from "manual because the service exposes no public API" (gray/permanent).
-- 2. Mark Supabase egress_bytes as has_public_api=false — Supabase exposes no
--    public egress endpoint as of May 2026 (api.supabase.com OpenAPI spec
--    inspected; community discussion supabase/discussions/5102 confirms).
-- 3. Add new platform_limits rows for the metrics that DO have a live source:
--      storage_bytes        — SQL on storage.objects
--      api_requests_total   — Management API analytics
--      function_invocations — Management API analytics
--      disk_used_bytes      — Management API config/disk/util

ALTER TABLE platform_limits
  ADD COLUMN IF NOT EXISTS has_public_api BOOLEAN NOT NULL DEFAULT true;

UPDATE platform_limits
   SET has_public_api = false
 WHERE service = 'supabase' AND metric = 'egress_bytes';

INSERT INTO platform_limits (
  service, metric, plan, included_limit, unit,
  overage_unit_cost, overage_unit,
  display_label, display_group, sort_order, notes
) VALUES
-- File storage (Supabase Storage / storage.objects)
('supabase','storage_bytes','free', 1073741824, 'bytes',
  NULL, NULL, 'File Storage', 'Storage', 3, '1 GB hard limit'),
('supabase','storage_bytes','pro', 107374182400, 'bytes',
  0.021, 'per_gb', 'File Storage', 'Storage', 3,
  '100 GB included, $0.021/GB over'),

-- API request counts (REST + Auth + Realtime + Storage), informational on Pro
('supabase','api_requests_total','pro', -1, 'requests',
  NULL, NULL, 'API Requests (this month)', 'Networking', 5,
  'Unlimited on Pro — informational total of REST + Auth + Realtime + Storage'),

-- Edge function invocations
('supabase','function_invocations','pro', 2000000, 'requests',
  0.000002, 'per_request', 'Edge Function Invocations', 'Compute', 6,
  '2M included, $2/M over'),

-- Disk utilization (db + WAL + indexes + temp; distinct from db_size_bytes)
('supabase','disk_used_bytes','pro', 8589934592, 'bytes',
  NULL, NULL, 'Disk Utilization', 'Storage', 7,
  'Includes db + WAL + indexes + temp. Pro plan disk size is the included quota.')
ON CONFLICT (service, metric, plan) DO NOTHING;
