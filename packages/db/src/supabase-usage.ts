/**
 * Supabase self-metrics — for the Platform Costs card.
 *
 * Two helpers, two auth paths:
 *
 *  - getSupabaseSqlMetrics(adminClient)
 *      Calls the public.get_supabase_self_metrics() RPC. Cheap, uses the
 *      existing admin client (SUPABASE_SECRET_KEY). Returns db_size_bytes
 *      and storage_bytes.
 *
 *  - getSupabaseManagementMetrics()
 *      Hits the Supabase Management API at api.supabase.com/v1/projects/{ref}/...
 *      Needs SUPABASE_MANAGEMENT_API_KEY (Personal Access Token from
 *      supabase.com/dashboard/account/tokens). Returns api_requests_total,
 *      function_invocations, disk_used_bytes. 5-minute in-memory cache to
 *      stay well under any rate limit. Returns { error } if the env var is
 *      missing — never throws.
 *
 * Egress is not exposed by any public Supabase API as of May 2026 — that row
 * stays manual and is flagged via platform_limits.has_public_api=false so the
 * card can render it differently from "stale manual".
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// ── Project ref (matches CLAUDE.md / Vercel env) ──────────────────────────────
const PROJECT_REF = "xsazcoxinpgttgquwvuf";
const MGMT_BASE = "https://api.supabase.com/v1";

// ── Public types ──────────────────────────────────────────────────────────────

export type SupabaseSqlMetrics = {
  db_size_bytes: number;
  storage_bytes: number;
};

export type SupabaseSqlMetricsError = {
  error: string;
};

export type SupabaseManagementMetrics = {
  api_requests_total: number;
  function_invocations: number;
  disk_used_bytes: number;
  fetched_at: string;
};

export type SupabaseManagementMetricsError = {
  error: string;
};

// ── SQL metrics ───────────────────────────────────────────────────────────────

export async function getSupabaseSqlMetrics(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
): Promise<SupabaseSqlMetrics | SupabaseSqlMetricsError> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = supabase as any;
  const { data, error } = await anyDb.rpc("get_supabase_self_metrics");

  if (error) {
    return { error: error.message };
  }

  // RPC returns a single-row TABLE; PostgREST surfaces it as an array.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return { error: "RPC returned no rows" };
  }

  return {
    db_size_bytes: Number(row.db_size_bytes ?? 0),
    storage_bytes: Number(row.storage_bytes ?? 0),
  };
}

// ── Management API metrics ────────────────────────────────────────────────────

const MGMT_CACHE_TTL_MS = 5 * 60 * 1000;
let cachedMgmt: SupabaseManagementMetrics | null = null;
let cachedMgmtExpiresAt = 0;

/** Bust the in-memory Management API cache. Used by the admin force-refresh route. */
export function clearSupabaseManagementCache(): void {
  cachedMgmt = null;
  cachedMgmtExpiresAt = 0;
}

type UsageApiCountsResponse = {
  result?: Array<{
    timestamp: string;
    total_auth_requests: number;
    total_realtime_requests: number;
    total_rest_requests: number;
    total_storage_requests: number;
  }>;
  error?: unknown;
};

type FunctionsCombinedStatsResponse = {
  result?: Array<{
    // Shape is loose in the OpenAPI spec; we look for any "count" / "invocations" key.
    [k: string]: unknown;
  }>;
  error?: unknown;
};

type DiskUtilResponse = {
  timestamp: string;
  metrics: {
    fs_size_bytes: number;
    fs_avail_bytes: number;
    fs_used_bytes: number;
  };
};

async function mgmtGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${MGMT_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    // Avoid Next.js fetch caching the response — we run our own 5-min cache.
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

function sumApiRequests(json: UsageApiCountsResponse): number {
  if (!Array.isArray(json.result)) return 0;
  let total = 0;
  for (const row of json.result) {
    total +=
      (row.total_auth_requests ?? 0) +
      (row.total_realtime_requests ?? 0) +
      (row.total_rest_requests ?? 0) +
      (row.total_storage_requests ?? 0);
  }
  return total;
}

function sumFunctionInvocations(json: FunctionsCombinedStatsResponse): number {
  if (!Array.isArray(json.result)) return 0;
  // Pick the first numeric field that looks like a count. Spec is loose.
  let total = 0;
  for (const row of json.result) {
    for (const [k, v] of Object.entries(row)) {
      if (typeof v === "number" && /count|invocation|requests/i.test(k)) {
        total += v;
        break;
      }
    }
  }
  return total;
}

export async function getSupabaseManagementMetrics(): Promise<
  SupabaseManagementMetrics | SupabaseManagementMetricsError
> {
  if (cachedMgmt && Date.now() < cachedMgmtExpiresAt) {
    return cachedMgmt;
  }

  const token = process.env["SUPABASE_MANAGEMENT_API_KEY"];
  if (!token) {
    return { error: "SUPABASE_MANAGEMENT_API_KEY not set" };
  }

  try {
    const [apiCounts, fnStats, disk] = await Promise.all([
      mgmtGet<UsageApiCountsResponse>(
        `/projects/${PROJECT_REF}/analytics/endpoints/usage.api-counts?interval=monthly`,
        token,
      ),
      mgmtGet<FunctionsCombinedStatsResponse>(
        `/projects/${PROJECT_REF}/analytics/endpoints/functions.combined-stats?interval=monthly`,
        token,
      ).catch((err) => {
        // Edge Functions may not be provisioned at all on this project — the
        // endpoint can 400/404 in that case. Treat as zero invocations rather
        // than failing the whole call.
        return { error: String(err) } as FunctionsCombinedStatsResponse;
      }),
      mgmtGet<DiskUtilResponse>(`/projects/${PROJECT_REF}/config/disk/util`, token),
    ]);

    const result: SupabaseManagementMetrics = {
      api_requests_total: sumApiRequests(apiCounts),
      function_invocations: sumFunctionInvocations(fnStats),
      disk_used_bytes: Number(disk.metrics?.fs_used_bytes ?? 0),
      fetched_at: new Date().toISOString(),
    };

    cachedMgmt = result;
    cachedMgmtExpiresAt = Date.now() + MGMT_CACHE_TTL_MS;
    return result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
