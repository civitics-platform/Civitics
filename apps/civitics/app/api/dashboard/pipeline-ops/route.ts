export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

/**
 * Removed — replaced by /api/claude/status which returns pipeline status
 * in the `pipelines` section (recent_runs + cron_last_run).
 */
export async function GET() {
  return NextResponse.json(
    { error: "This endpoint has been removed. Use /api/claude/status instead." },
    { status: 410 }
  );
}
