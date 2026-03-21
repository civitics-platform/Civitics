export const dynamic = "force-dynamic";

/**
 * GET /api/dashboard/pipeline-ops
 *
 * Returns pipeline operations data for the dashboard Pipeline Operations section.
 *
 * Data sources:
 *  - pipeline_state key 'cron_last_run'      — last nightly sync results
 *  - pipeline_state key 'cron_last_started'  — cron trigger timestamp
 *  - pipeline_state key 'cost_alert_latest'  — most recent cost alert
 *  - pipeline_state keys LIKE 'cost_alert_%' — recent alert history
 *  - pipeline_cost_history                    — 7-day AI cost trend
 */

import { createAdminClient } from "@civitics/db";
import { NextResponse } from "next/server";

/** Calculate the next 2am UTC from now. */
function nextCronRun(): Date {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(2, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

export async function GET(): Promise<NextResponse> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any;

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString();

    const [stateRows, costHistory, recentRunHistory] = await Promise.all([
      // pipeline_state: cron tracking + latest alert
      db
        .from("pipeline_state")
        .select("key, value, updated_at")
        .in("key", ["cron_last_run", "cron_last_started", "cost_alert_latest"]),

      // 7-day daily AI cost totals for the bar chart
      db.rpc
        ? db.rpc("get_ai_cost_by_day", { days_back: 7 }).catch(() => ({ data: null }))
        : { data: null },

      // Last 10 pipeline cost history rows for alert history
      db
        .from("pipeline_cost_history")
        .select("pipeline_name, run_at, entity_count, estimated_cost_usd, actual_cost_usd, variance_ratio, status, notes")
        .order("run_at", { ascending: false })
        .limit(10),
    ]);

    type StateRow = { key: string; value: unknown; updated_at: string };
    const stateMap: Record<string, unknown> = {};
    for (const row of ((stateRows.data ?? []) as StateRow[])) {
      stateMap[row.key] = row.value;
    }

    const lastRun      = stateMap["cron_last_run"]     as Record<string, unknown> | null ?? null;
    const lastStarted  = stateMap["cron_last_started"] as Record<string, unknown> | null ?? null;
    const latestAlert  = stateMap["cost_alert_latest"] as Record<string, unknown> | null ?? null;

    // Determine cron health status
    let cronStatus: "healthy" | "warning" | "failed" | "unknown" = "unknown";
    if (lastRun) {
      const runStatus = lastRun["status"] as string;
      if (runStatus === "complete") cronStatus = "healthy";
      else if (runStatus === "partial") cronStatus = "warning";
      else if (runStatus === "failed") cronStatus = "failed";
    }

    // Last run summary duration
    let lastRunAgoMs: number | null = null;
    if (lastRun?.["completed_at"]) {
      lastRunAgoMs = Date.now() - new Date(lastRun["completed_at"] as string).getTime();
    } else if (lastStarted?.["started_at"]) {
      lastRunAgoMs = Date.now() - new Date(lastStarted["started_at"] as string).getTime();
    }

    const nextRun = nextCronRun();

    // 7-day cost chart — fall back to manual bucketing from cost history if RPC unavailable
    type CostHistoryRow = {
      pipeline_name: string;
      run_at: string;
      entity_count: number;
      estimated_cost_usd: number;
      actual_cost_usd: number | null;
      variance_ratio: number | null;
      status: string;
      notes: string | null;
    };
    const historyRows: CostHistoryRow[] = (recentRunHistory.data ?? []) as CostHistoryRow[];

    // Build 7-day daily cost buckets from pipeline_cost_history
    const dailyCosts: Array<{ date: string; cost_usd: number; runs: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400_000);
      const dateStr = d.toISOString().slice(0, 10);
      const dayRows = historyRows.filter(
        (r) => r.run_at?.slice(0, 10) === dateStr && r.status === "complete"
      );
      dailyCosts.push({
        date:     dateStr,
        cost_usd: dayRows.reduce((s, r) => s + (r.actual_cost_usd ?? 0), 0),
        runs:     dayRows.length,
      });
    }

    // Recent alerts from cost history (high variance rows)
    const alerts = historyRows
      .filter((r) => r.variance_ratio != null && r.variance_ratio > 1.3)
      .slice(0, 5)
      .map((r) => ({
        pipeline:      r.pipeline_name,
        run_at:        r.run_at,
        variance_pct:  Math.round(((r.variance_ratio ?? 1) - 1) * 100),
        status:        r.status,
      }));

    // Tonight's scheduled pipelines
    const isWeekly = new Date().getUTCDay() === 0;
    const scheduledTonight = [
      "regulations",
      "connections",
      "tag-rules",
      "tag-ai",
      ...(isWeekly ? ["fec", "usaspending", "courtlistener", "openstates"] : []),
    ];

    return NextResponse.json(
      {
        cron: {
          last_run:       lastRun,
          last_started:   lastStarted,
          next_run_at:    nextRun.toISOString(),
          last_run_ago_ms: lastRunAgoMs,
          status:         cronStatus,
        },
        tonight: {
          is_weekly:  isWeekly,
          scheduled:  scheduledTonight,
        },
        ai_costs: {
          daily_7:           dailyCosts,
          tonight_usd:       dailyCosts[6]?.cost_usd ?? 0,
        },
        recent_runs:   historyRows.slice(0, 10),
        latest_alert:  latestAlert,
        alerts,
        fetched_at:    new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
