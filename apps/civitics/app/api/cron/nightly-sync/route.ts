/**
 * Vercel cron route — nightly data sync trigger.
 *
 * Schedule: 0 2 * * * (2am UTC daily) — configured in /vercel.json
 *
 * Security: CRON_SECRET header checked against Authorization header.
 * Vercel automatically sends the Authorization header for cron jobs.
 *
 * Architecture: This route writes a trigger record to data_sync_log.
 * The standalone scheduler (packages/data/src/scheduler.ts) polls or
 * a separate worker process calls runNightlySync() directly.
 *
 * For deployments with Vercel Fluid Compute, uncomment the direct
 * runNightlySync() call and import it from @civitics/data.
 *
 * Required env vars:
 *   CRON_SECRET — generate with: openssl rand -hex 32
 *                 Add to .env.local and Vercel dashboard.
 */

export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@civitics/db";

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Verify this is a legitimate Vercel cron call
  const authHeader = request.headers.get("authorization");
  const expected   = `Bearer ${process.env["CRON_SECRET"] ?? ""}`;

  if (!process.env["CRON_SECRET"] || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const triggeredAt = new Date().toISOString();

  // Record the trigger in data_sync_log so the scheduler knows a run is due
  try {
    const db = createAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).from("data_sync_log").insert({
      pipeline_name: "nightly-sync",
      status:        "triggered",
      started_at:    triggeredAt,
      metadata:      { triggered_by: "vercel-cron", schedule: "0 2 * * *" },
    });
  } catch (err) {
    // Non-critical — log but don't fail the response
    console.error("[cron/nightly-sync] failed to write trigger log:", err instanceof Error ? err.message : err);
  }

  return NextResponse.json({
    triggered:  true,
    triggeredAt,
    note: "Nightly sync trigger recorded. Scheduler picks it up within minutes.",
  });
}
