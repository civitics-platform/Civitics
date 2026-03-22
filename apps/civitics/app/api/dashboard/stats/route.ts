export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

/**
 * Removed — replaced by /api/claude/status which returns the same data
 * plus pipeline status, quality metrics, AI costs, and self-tests.
 */
export async function GET() {
  return NextResponse.json(
    { error: "This endpoint has been removed. Use /api/claude/status instead." },
    { status: 410 }
  );
}
