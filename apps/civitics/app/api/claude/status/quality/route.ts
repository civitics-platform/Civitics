/**
 * GET /api/claude/status/quality
 *
 * Heavier half of the dashboard health endpoint: data quality coverage,
 * self-tests (incl. Warren search, chord industry data, derived-edge drift),
 * and chord top flows. Holds the graph RPCs and semantic checks.
 *
 * Rate limit shared with /api/claude/status and /core (60 req/hour/IP).
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
  getQuality,
  getSelfTests,
  getChord,
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

  const [quality, selfTests, chordSection] = await Promise.all([
    section(() => getQuality(db)),
    section(() => getSelfTests(db)),
    section(() => getChord(db)),
  ]);

  const query_time_ms = Date.now() - t0;

  return NextResponse.json({
    meta: {
      query_time_ms,
      timestamp: now.toISOString(),
    },
    quality,
    self_tests: selfTests,
    chord: chordSection,
  });
}
