/**
 * GET /api/claude/status/core
 *
 * Lightweight half of the dashboard health endpoint: counts, pipeline state,
 * AI budget, activity, resource warnings, officials breakdown. No graph RPCs,
 * no semantic checks — see /api/claude/status/quality for those.
 *
 * Rate limit shared with /api/claude/status and /quality (60 req/hour/IP).
 *
 * See FIX-082 for the split rationale.
 */

export const revalidate = 300;

import { createAdminClient } from "@civitics/db";
import { NextResponse } from "next/server";
import { getIp, rateOk } from "../_lib/ratelimit";
import {
  type Db,
  section,
  getVersion,
  getDatabase,
  getConnectionTypes,
  getPipelines,
  getAiCosts,
  getActivity,
  getResourceWarnings,
  getOfficialsBreakdown,
} from "../_lib/sections";

export async function GET(request: Request) {
  const ip = getIp(request);
  if (!rateOk(ip)) {
    return NextResponse.json(
      { error: "Rate limit exceeded — 60 requests per hour per IP" },
      { status: 429 },
    );
  }

  const t0 = Date.now();
  const db = createAdminClient() as Db;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const [
    version,
    database,
    connectionTypes,
    pipelines,
    aiCosts,
    activitySection,
    resourceWarnings,
    officialsBreakdown,
  ] = await Promise.all([
    section(() => getVersion(db)),
    section(() => getDatabase(db, yesterday)),
    section(() => getConnectionTypes(db)),
    section(() => getPipelines(db)),
    section(() => getAiCosts(db, monthStart)),
    section(() => getActivity(db, yesterday)),
    section(() => getResourceWarnings(db)),
    section(() => getOfficialsBreakdown(db)),
  ]);

  const query_time_ms = Date.now() - t0;

  return NextResponse.json({
    meta: {
      query_time_ms,
      timestamp: now.toISOString(),
    },
    version,
    database,
    connection_types: connectionTypes,
    pipelines,
    ai_costs: aiCosts,
    activity: activitySection,
    resource_warnings: resourceWarnings,
    officials_breakdown: officialsBreakdown,
  });
}
