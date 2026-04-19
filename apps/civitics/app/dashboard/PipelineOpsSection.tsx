"use client";

/**
 * PipelineOpsSection — expandable Pipeline Operations dashboard section.
 *
 * Collapsed by default; expands to show:
 *   1. Cron status (last run time, duration, next scheduled run)
 *   2. Last night's results (per-pipeline status, AI costs)
 *   3. 7-day AI cost trend (CSS bar chart)
 *   4. Manual pipeline triggers (admin only — hidden for non-admins)
 *   5. Alert history
 *
 * Admin access: shown only when isAdmin prop is true (server-checked via ADMIN_EMAIL).
 */

import React, { useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types (mirror /api/dashboard/pipeline-ops response shape)
// ---------------------------------------------------------------------------

interface NightlyPipelineResult {
  status: "complete" | "failed" | "skipped" | "not_scheduled";
  rows_added?: number;
  duration_ms?: number;
  error?: string;
}

interface NightlyAiResult {
  status: "complete" | "failed" | "skipped";
  entities?: number;
  cost_usd?: number;
  skip_reason?: string;
}

interface NightlySyncResults {
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  is_weekly: boolean;
  pipelines: {
    regulations?: NightlyPipelineResult;
    fec?: NightlyPipelineResult;
    usaspending?: NightlyPipelineResult;
    courtlistener?: NightlyPipelineResult;
    openstates?: NightlyPipelineResult;
    connections?: NightlyPipelineResult;
  };
  ai: {
    tag_rules?: NightlyAiResult;
    tag_ai?: NightlyAiResult;
  };
  total_ai_cost_usd: number;
}

interface CronState {
  last_run: { status: string; started_at: string; completed_at?: string; results?: NightlySyncResults } | null;
  last_started: { started_at: string; status: string } | null;
  next_run_at: string;
  last_run_ago_ms: number | null;
  status: "healthy" | "warning" | "failed" | "unknown";
}

interface DailyTotal {
  date: string;
  cost_usd: number;
  runs: number;
}

interface PipelineOpsData {
  cron: CronState;
  tonight: { is_weekly: boolean; scheduled: string[] };
  ai_costs: { daily_7: DailyTotal[]; tonight_usd: number };
  recent_runs: Array<{
    pipeline_name: string;
    run_at: string;
    entity_count: number;
    estimated_cost_usd: number;
    actual_cost_usd: number | null;
    variance_ratio: number | null;
    status: string;
    notes: string | null;
  }>;
  latest_alert: { level: string; message: string; created_at: string } | null;
  alerts: Array<{ pipeline: string; run_at: string; variance_pct: number; status: string }>;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  isAdmin: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtTimeAgo(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function fmtCountdown(target: string): string {
  const ms = new Date(target).getTime() - Date.now();
  if (ms <= 0) return "now";
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return `in ${h}h ${m}m`;
}

function fmtUtc(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    timeZone: "UTC", timeZoneName: "short",
  });
}

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function pipelineIcon(status?: string): string {
  if (status === "complete") return "✓";
  if (status === "failed")   return "✗";
  if (status === "skipped")  return "⏭";
  return "—";
}

function pipelineColor(status?: string): string {
  if (status === "complete") return "text-emerald-600";
  if (status === "failed")   return "text-red-600";
  if (status === "skipped")  return "text-gray-400";
  return "text-gray-300";
}

function cronStatusColor(status: string): string {
  if (status === "healthy")  return "bg-emerald-500";
  if (status === "warning")  return "bg-yellow-400";
  if (status === "failed")   return "bg-red-500";
  return "bg-gray-300";
}

// ---------------------------------------------------------------------------
// Admin pipeline buttons config
// ---------------------------------------------------------------------------

const DATA_PIPELINES: Array<{ id: string; label: string }> = [
  { id: "congress",      label: "Congress" },
  { id: "regulations",   label: "Regulations" },
  { id: "fec-bulk",      label: "FEC (bulk)" },
  { id: "usaspending",   label: "USASpending" },
  { id: "courtlistener", label: "Courts" },
  { id: "openstates",    label: "OpenStates" },
  { id: "elections",     label: "Elections" },
  { id: "agencies-hierarchy", label: "Agency Hierarchy" },
  { id: "connections",   label: "Connections" },
];

const AI_PIPELINES: Array<{ id: string; label: string }> = [
  { id: "tag-rules",    label: "Tag Rules" },
  { id: "tag-ai",       label: "Tag AI (new)" },
  { id: "tag-industry", label: "Tag Industry" },
  { id: "ai-summaries", label: "AI Summaries (new)" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PipelineOpsSection({ isAdmin }: Props) {
  const [expanded, setExpanded]   = useState(false);
  const [data, setData]           = useState<PipelineOpsData | null>(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  // Per-button run state: { [pipelineId]: 'idle' | 'confirm' | 'running' | 'done' | 'error' }
  const [runStates, setRunStates] = useState<Record<string, string>>({});
  const [runResults, setRunResults] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (data) return; // already loaded
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/pipeline-ops");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as PipelineOpsData;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [data]);

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) load();
  };

  const triggerPipeline = async (pipelineId: string) => {
    const state = runStates[pipelineId] ?? "idle";
    if (state === "confirm") {
      // User confirmed — execute
      setRunStates((s) => ({ ...s, [pipelineId]: "running" }));
      try {
        const res = await fetch("/api/admin/run-pipeline", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pipeline: pipelineId }),
        });
        const json = await res.json() as { run_id?: string; message?: string; error?: string };
        if (!res.ok) throw new Error(json.error ?? "Unknown error");
        setRunStates((s) => ({ ...s, [pipelineId]: "done" }));
        setRunResults((r) => ({ ...r, [pipelineId]: json.message ?? "Queued" }));
      } catch (err) {
        setRunStates((s) => ({ ...s, [pipelineId]: "error" }));
        setRunResults((r) => ({
          ...r,
          [pipelineId]: err instanceof Error ? err.message : "Error",
        }));
      }
    } else if (state === "idle" || state === "done" || state === "error") {
      // Move to confirm state
      setRunStates((s) => ({ ...s, [pipelineId]: "confirm" }));
    } else if (state === "confirm") {
      // Already at confirm — shouldn't reach here
    }
  };

  const cancelConfirm = (pipelineId: string) => {
    setRunStates((s) => ({ ...s, [pipelineId]: "idle" }));
  };

  // Summary line for collapsed header
  const lastRunAgo = data?.cron?.last_run_ago_ms != null
    ? fmtTimeAgo(data.cron.last_run_ago_ms)
    : null;
  const lastRunStatus = data?.cron?.status ?? "unknown";

  const headerStatus = lastRunStatus === "healthy" ? "✓"
    : lastRunStatus === "warning" ? "⚠"
    : lastRunStatus === "failed"  ? "✗"
    : "?";

  const nextCountdown = data?.cron?.next_run_at
    ? fmtCountdown(data.cron.next_run_at)
    : "2am UTC";

  return (
    <section>
      {/* Collapsible header */}
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between rounded-lg border border-gray-200 bg-white px-5 py-3 hover:bg-gray-50 transition-colors"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-900">
            {expanded ? "▼" : "▶"} Pipeline Operations
          </span>
          {!loading && data && (
            <span className="text-xs text-gray-500">
              {lastRunAgo ? (
                <>
                  Last run: {lastRunAgo}{" "}
                  <span className={
                    lastRunStatus === "healthy" ? "text-emerald-600"
                    : lastRunStatus === "failed" ? "text-red-600"
                    : "text-yellow-600"
                  }>{headerStatus}</span>
                  {" · "}Next: {nextCountdown}
                </>
              ) : (
                `Next: ${nextCountdown}`
              )}
            </span>
          )}
          {loading && <span className="text-xs text-gray-400">Loading…</span>}
        </div>
        <span className="text-xs text-gray-400">
          {expanded ? "Collapse" : "Expand"}
        </span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="mt-2 space-y-4">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              Failed to load pipeline data: {error}
            </div>
          )}

          {loading && !data && (
            <div className="rounded-lg border border-gray-200 bg-white px-5 py-6 text-center text-sm text-gray-400">
              Loading pipeline data…
            </div>
          )}

          {data && (
            <>
              {/* ── 1. CRON STATUS ─────────────────────────────────────────── */}
              <div className="rounded-lg border border-gray-200 bg-white p-5 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Nightly Sync Schedule
                </p>
                <div className="grid gap-2 sm:grid-cols-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${cronStatusColor(data.cron.status)}`} />
                    <span className="text-gray-700 font-medium">
                      {data.cron.status.charAt(0).toUpperCase() + data.cron.status.slice(1)}
                    </span>
                  </div>
                  {data.cron.last_run?.completed_at && (
                    <div className="text-gray-500 text-xs">
                      Last run: {fmtUtc(data.cron.last_run.completed_at)}
                      {data.cron.last_run.results?.duration_ms != null && (
                        <span className="text-gray-400">
                          {" · "}{fmtDuration(data.cron.last_run.results.duration_ms)}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="text-gray-500 text-xs">
                    Next: {fmtUtc(data.cron.next_run_at)} ({fmtCountdown(data.cron.next_run_at)})
                  </div>
                  <div className="text-gray-400 text-xs">
                    {data.tonight.is_weekly ? "Tonight: Full weekly sync (Sun)" : "Tonight: Daily sync"}
                  </div>
                </div>
              </div>

              {/* ── 2. LAST NIGHT'S RESULTS ────────────────────────────────── */}
              {data.cron.last_run?.results && (
                <div className="rounded-lg border border-gray-200 bg-white p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Last Night's Results
                    </p>
                    {data.cron.last_run.started_at && (
                      <span className="text-xs text-gray-400">
                        {fmtUtc(data.cron.last_run.started_at)}
                      </span>
                    )}
                  </div>

                  {/* Data pipelines */}
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">
                      Data Synced
                    </p>
                    <div className="space-y-1">
                      {(
                        [
                          ["regulations",        "Regulations.gov"],
                          ["congress_officials", "Congress Officials"],
                          ["congress_votes",     "Congress Votes"],
                          ["connections",        "Connections"],
                          ["fec_bulk",           "FEC Campaign Finance"],
                          ["usaspending",        "USASpending"],
                          ["courtlistener",      "CourtListener"],
                          ["openstates",         "OpenStates"],
                        ] as const
                      ).map(([key, label]) => {
                        const r = data.cron.last_run!.results!.pipelines[key as keyof NightlySyncResults["pipelines"]];
                        const isWeekly = ["fec_bulk", "usaspending", "courtlistener", "openstates"].includes(key);
                        if (isWeekly && !data.cron.last_run!.results!.is_weekly) {
                          return (
                            <div key={key} className="flex items-center gap-2 text-xs">
                              <span className="text-gray-300 w-3 text-center">—</span>
                              <span className="text-gray-300">{label}</span>
                              <span className="text-gray-300">(weekly, Sun)</span>
                            </div>
                          );
                        }
                        return (
                          <div key={key} className="flex items-center gap-2 text-xs">
                            <span className={`w-3 text-center font-medium ${pipelineColor(r?.status)}`}>
                              {pipelineIcon(r?.status)}
                            </span>
                            <span className="text-gray-700">{label}</span>
                            {r?.rows_added != null && r.rows_added > 0 && (
                              <span className="text-gray-400">+{r.rows_added.toLocaleString()}</span>
                            )}
                            {r?.error && (
                              <span className="text-red-500 truncate max-w-[180px]" title={r.error}>
                                {r.error}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* AI pipelines */}
                  <div className="border-t border-gray-100 pt-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">
                      AI Enrichment
                    </p>
                    <div className="space-y-1">
                      {(
                        [
                          ["tag_rules", "Tag Rules"],
                          ["tag_ai",    "AI Tagger"],
                        ] as const
                      ).map(([key, label]) => {
                        const r = data.cron.last_run!.results!.ai[key as keyof NightlySyncResults["ai"]];
                        return (
                          <div key={key} className="flex items-center gap-2 text-xs">
                            <span className={`w-3 text-center font-medium ${pipelineColor(r?.status)}`}>
                              {pipelineIcon(r?.status)}
                            </span>
                            <span className="text-gray-700">{label}</span>
                            {r?.entities != null && (
                              <span className="text-gray-400">
                                {r.entities > 0 ? `+${r.entities} tagged` : "0 new"}
                              </span>
                            )}
                            {r?.cost_usd != null && r.cost_usd > 0 && (
                              <span className="text-gray-400">${r.cost_usd.toFixed(4)}</span>
                            )}
                            {r?.skip_reason && (
                              <span className="text-gray-400 italic truncate max-w-[180px]" title={r.skip_reason}>
                                {r.skip_reason}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {data.cron.last_run.results.total_ai_cost_usd > 0 && (
                      <p className="mt-2 text-xs text-gray-500 border-t border-gray-100 pt-2">
                        Total AI cost last night:{" "}
                        <span className="font-medium tabular-nums">
                          ${data.cron.last_run.results.total_ai_cost_usd.toFixed(4)}
                        </span>
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* ── 3. 7-DAY AI COST CHART ─────────────────────────────────── */}
              {data.ai_costs.daily_7.length > 0 && (
                <div className="rounded-lg border border-gray-200 bg-white p-5 space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    AI Cost — Last 7 Days
                  </p>
                  <CostBarChart days={data.ai_costs.daily_7} />
                  <p className="text-[11px] text-gray-400 italic">
                    Nightly runs typically &lt;$0.01. Spikes indicate bulk operations.
                  </p>
                </div>
              )}

              {/* ── 4. ALERT HISTORY ───────────────────────────────────────── */}
              <div className="rounded-lg border border-gray-200 bg-white p-5 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Alert History
                </p>
                {data.latest_alert && (
                  <div className={`rounded border px-3 py-2 text-xs ${
                    data.latest_alert.level === "blocked" ? "border-red-200 bg-red-50 text-red-700"
                    : data.latest_alert.level === "urgent" ? "border-orange-200 bg-orange-50 text-orange-700"
                    : data.latest_alert.level === "warning" ? "border-yellow-200 bg-yellow-50 text-yellow-700"
                    : "border-blue-200 bg-blue-50 text-blue-700"
                  }`}>
                    {data.latest_alert.level === "blocked" ? "🚫"
                      : data.latest_alert.level === "urgent" ? "🚨"
                      : data.latest_alert.level === "warning" ? "⚠️"
                      : "💡"}{" "}
                    {data.latest_alert.message}
                  </div>
                )}
                {data.alerts.length > 0 ? (
                  <div className="space-y-1">
                    {data.alerts.map((a, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-gray-500">
                        <span className="text-yellow-600">⚠</span>
                        <span className="text-gray-400">{a.run_at?.slice(0, 10)}</span>
                        <span>{a.pipeline}</span>
                        <span className="text-orange-600">+{a.variance_pct}% variance</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  !data.latest_alert && (
                    <p className="text-xs text-gray-400">✓ No active alerts</p>
                  )
                )}
              </div>

              {/* ── 5. ADMIN CONTROLS ──────────────────────────────────────── */}
              {isAdmin && (
                <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-5 space-y-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
                    Manual Pipeline Controls — Admin Only
                  </p>
                  <p className="text-[11px] text-indigo-600">
                    Triggers are queued — the standalone scheduler picks them up within minutes.
                    Cost gate applies (autonomous limit: $0.10).
                  </p>

                  <div>
                    <p className="text-[11px] font-medium text-gray-600 mb-2">Data Pipelines</p>
                    <div className="flex flex-wrap gap-2">
                      {DATA_PIPELINES.map(({ id, label }) => (
                        <PipelineButton
                          key={id}
                          pipelineId={id}
                          label={label}
                          state={runStates[id] ?? "idle"}
                          result={runResults[id]}
                          onTrigger={triggerPipeline}
                          onCancel={cancelConfirm}
                        />
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-[11px] font-medium text-gray-600 mb-2">AI Pipelines</p>
                    <div className="flex flex-wrap gap-2">
                      {AI_PIPELINES.map(({ id, label }) => (
                        <PipelineButton
                          key={id}
                          pipelineId={id}
                          label={label}
                          state={runStates[id] ?? "idle"}
                          result={runResults[id]}
                          onTrigger={triggerPipeline}
                          onCancel={cancelConfirm}
                        />
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-[11px] font-medium text-gray-600 mb-2">Full Nightly Sync</p>
                    <PipelineButton
                      pipelineId="nightly"
                      label="Run Nightly Now"
                      state={runStates["nightly"] ?? "idle"}
                      result={runResults["nightly"]}
                      onTrigger={triggerPipeline}
                      onCancel={cancelConfirm}
                      variant="primary"
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PipelineButton({
  pipelineId,
  label,
  state,
  result,
  onTrigger,
  onCancel,
  variant = "default",
}: {
  pipelineId: string;
  label:      string;
  state:      string;
  result?:    string;
  onTrigger:  (id: string) => void;
  onCancel:   (id: string) => void;
  variant?:   "default" | "primary";
}) {
  if (state === "confirm") {
    return (
      <div className="flex items-center gap-1">
        <button
          onClick={() => onTrigger(pipelineId)}
          className="text-xs px-2 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700"
        >
          Confirm
        </button>
        <button
          onClick={() => onCancel(pipelineId)}
          className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-50"
        >
          Cancel
        </button>
        <span className="text-[11px] text-gray-500">Run {label}?</span>
      </div>
    );
  }

  if (state === "running") {
    return (
      <span className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-400 cursor-not-allowed">
        ⟳ Running…
      </span>
    );
  }

  if (state === "done") {
    return (
      <div className="flex items-center gap-1">
        <span className="text-xs px-2 py-1 rounded border border-emerald-200 bg-emerald-50 text-emerald-700">
          ✓ Queued
        </span>
        {result && <span className="text-[11px] text-gray-400 max-w-[200px] truncate">{result}</span>}
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="flex items-center gap-1">
        <button
          onClick={() => onTrigger(pipelineId)}
          className="text-xs px-2 py-1 rounded border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
        >
          ✗ Retry {label}
        </button>
        {result && <span className="text-[11px] text-red-500">{result}</span>}
      </div>
    );
  }

  return (
    <button
      onClick={() => onTrigger(pipelineId)}
      className={`text-xs px-2 py-1 rounded border transition-colors ${
        variant === "primary"
          ? "border-indigo-300 bg-indigo-100 text-indigo-700 hover:bg-indigo-200"
          : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
      }`}
    >
      ▶ {label}
    </button>
  );
}

function CostBarChart({ days }: { days: DailyTotal[] }) {
  const maxCost = Math.max(...days.map((d) => d.cost_usd), 0.001);

  return (
    <div className="flex items-end gap-1 h-16">
      {days.map((d) => {
        const heightPct = maxCost > 0 ? (d.cost_usd / maxCost) * 100 : 0;
        const dayLabel = new Date(d.date + "T12:00:00Z").toLocaleDateString("en-US", {
          weekday: "short", timeZone: "UTC",
        });
        return (
          <div key={d.date} className="flex flex-col items-center gap-1 flex-1" title={
            `${d.date}: $${d.cost_usd.toFixed(4)} (${d.runs} runs)`
          }>
            <div className="w-full flex items-end justify-center" style={{ height: "48px" }}>
              <div
                className={`w-full rounded-t transition-all ${
                  d.cost_usd > maxCost * 0.5 ? "bg-indigo-400" : "bg-indigo-200"
                }`}
                style={{ height: `${Math.max(heightPct, d.cost_usd > 0 ? 4 : 0)}%` }}
              />
            </div>
            <span className="text-[9px] text-gray-400">{dayLabel}</span>
          </div>
        );
      })}
    </div>
  );
}
