/**
 * GET  /api/platform/supabase  — Live Supabase self-metrics (debug / force-refresh)
 * POST /api/platform/supabase  — Admin: clear in-memory Management API cache
 *
 * The dashboard's Platform Costs card already gets fresh Supabase values via
 * the /api/platform/usage aggregator, which calls the same helpers inline on
 * every request. This route exists for:
 *   1. Debugging — see the raw helper output without the upsert + render layers.
 *   2. Force-refresh — POST clears the 5-minute Management API in-memory cache
 *      so the next aggregator hit fetches fresh.
 *
 * Never returns 500. Failed helpers come back as { error } in the payload.
 */

export const dynamic = "force-dynamic";

import {
  createAdminClient,
  getSupabaseSqlMetrics,
  getSupabaseManagementMetrics,
  clearSupabaseManagementCache,
} from "@civitics/db";
import { NextResponse } from "next/server";

export async function GET() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createAdminClient() as any;

  const [sql, mgmt] = await Promise.all([
    getSupabaseSqlMetrics(supabase),
    getSupabaseManagementMetrics(),
  ]);

  return NextResponse.json({
    sql,
    management: mgmt,
    fetched_at: new Date().toISOString(),
  });
}

export async function POST(request: Request) {
  const adminKey = request.headers.get("X-Admin-Key");
  if (adminKey !== process.env["ADMIN_SECRET"]) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  clearSupabaseManagementCache();

  return NextResponse.json({
    success: true,
    message: "Management API cache cleared. Next /api/platform/usage hit will re-fetch.",
  });
}
