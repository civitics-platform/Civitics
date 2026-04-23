/**
 * Master pipeline orchestrator.
 *
 * Runs all Phase 1 ingestion pipelines in sequence within the 270 MB
 * storage budget. After each pipeline logs inserted rows, estimated MB,
 * and any errors. Produces a final storage report.
 *
 * Run standalone:
 *   pnpm --filter @civitics/data data:sync
 */

import { createAdminClient } from "@civitics/db";
import { getDbSizeMb, getLastSync } from "./sync-log";
import { runRegulationsPipeline } from "./regulations";
import { runFecBulkPipeline } from "./fec-bulk";
import { runUsaSpendingPipeline } from "./usaspending";
import { runCourtListenerPipeline } from "./courtlistener";
import { runOpenStatesPipeline } from "./openstates";
import { runOfficialsPipeline, runVotesPipeline } from "./congress";
import { runConnectionsDelta } from "./connections/delta";
import { runRuleBasedTagger } from "./tags/rules";
import { runAiTagger } from "./tags/ai-tagger";
import { runAiSummariesPipeline } from "./ai-summaries";
import { runAgenciesHierarchyPipeline } from "./agencies-hierarchy";
import { runElectionsPipeline } from "./elections";
import { seedJurisdictions, seedGoverningBodies } from "../jurisdictions/us-states";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_BUDGET_MB = 270;

// ---------------------------------------------------------------------------
// Status reporter
// ---------------------------------------------------------------------------

async function printStatus(): Promise<void> {
  const db = createAdminClient();

  const [officials, proposals, votes, financials, spending] = await Promise.all([
    db.from("officials").select("*", { count: "exact", head: true }),
    db.from("proposals").select("*", { count: "exact", head: true }),
    db.from("votes").select("*", { count: "exact", head: true }),
    db.from("financial_relationships").select("*", { count: "exact", head: true }),
    db.from("spending_records").select("*", { count: "exact", head: true }),
  ]);

  const pipelines = ["regulations", "fec_bulk", "usaspending", "courtlistener", "openstates", "congress_officials", "congress_votes"] as const;
  const syncTimes = await Promise.all(pipelines.map((p) => getLastSync(p)));

  console.log("\n=== Civitics Data Status ===");
  console.log(`  Officials:              ${(officials.count ?? 0).toLocaleString()}`);
  console.log(`  Proposals:              ${(proposals.count ?? 0).toLocaleString()}`);
  console.log(`  Votes:                  ${(votes.count ?? 0).toLocaleString()}`);
  console.log(`  Financial relationships: ${(financials.count ?? 0).toLocaleString()}`);
  console.log(`  Spending records:       ${(spending.count ?? 0).toLocaleString()}`);

  console.log("\n  Last sync times:");
  for (let i = 0; i < pipelines.length; i++) {
    const last = syncTimes[i];
    const ts = last ? new Date(last).toLocaleString() : "never";
    console.log(`    ${pipelines[i].padEnd(16)} ${ts}`);
  }

  const dbMb = await getDbSizeMb();
  console.log(`\n  DB size: ${dbMb} MB / ${STORAGE_BUDGET_MB} MB budget (${Math.round((dbMb / STORAGE_BUDGET_MB) * 100)}% used)`);
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export async function runAllPipelines(): Promise<void> {
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║   Civitics Phase 1 Pipeline Orchestrator  ║");
  console.log("╚══════════════════════════════════════════╝");

  const startTime = Date.now();
  const db = createAdminClient();

  // Seed jurisdictions and governing bodies first (idempotent)
  console.log("\n[0/5] Seeding jurisdictions and governing bodies...");
  const { federalId, stateIds } = await seedJurisdictions(db);
  const { senateId: senateGovBodyId, houseId: houseGovBodyId } = await seedGoverningBodies(db, federalId);

  const initialMb = await getDbSizeMb();
  console.log(`      Starting DB size: ${initialMb} MB`);

  const results: Array<{
    name: string;
    inserted: number;
    updated: number;
    failed: number;
    estimatedMb: number;
    error?: string;
  }> = [];

  // -------------------------------------------------------------------------
  // 1. Regulations.gov
  // -------------------------------------------------------------------------
  {
    const apiKey = process.env["REGULATIONS_API_KEY"];
    if (!apiKey) {
      console.warn("\n[1/5] Regulations.gov — SKIPPED (REGULATIONS_API_KEY not set)");
      results.push({ name: "regulations", inserted: 0, updated: 0, failed: 0, estimatedMb: 0, error: "API key missing" });
    } else {
      try {
        const r = await runRegulationsPipeline(apiKey, federalId);
        results.push({ name: "regulations", ...r });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("\n  Regulations pipeline threw:", msg);
        results.push({ name: "regulations", inserted: 0, updated: 0, failed: 1, estimatedMb: 0, error: msg });
      }
    }
  }

  // -------------------------------------------------------------------------
  // 2. FEC bulk (weball24 + cm24 + pas224 streaming — no API key needed)
  // -------------------------------------------------------------------------
  {
    try {
      const r = await runFecBulkPipeline();
      results.push({ name: "fec_bulk", ...r });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("\n  FEC bulk pipeline threw:", msg);
      results.push({ name: "fec_bulk", inserted: 0, updated: 0, failed: 1, estimatedMb: 0, error: msg });
    }
  }

  // -------------------------------------------------------------------------
  // 2b. Congress.gov (officials + votes)
  // -------------------------------------------------------------------------
  {
    const apiKey = process.env["CONGRESS_GOV_API_KEY"];
    if (!apiKey) {
      console.warn("\n[2b] Congress.gov — SKIPPED (CONGRESS_GOV_API_KEY not set)");
      results.push({ name: "congress_officials", inserted: 0, updated: 0, failed: 0, estimatedMb: 0, error: "API key missing" });
      results.push({ name: "congress_votes", inserted: 0, updated: 0, failed: 0, estimatedMb: 0, error: "API key missing" });
    } else {
      try {
        const r = await runOfficialsPipeline({ apiKey, stateIds, senateId: senateGovBodyId, houseId: houseGovBodyId, federalId });
        results.push({ name: "congress_officials", inserted: r.inserted, updated: r.updated, failed: r.skipped, estimatedMb: 0 });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("\n  Congress officials pipeline threw:", msg);
        results.push({ name: "congress_officials", inserted: 0, updated: 0, failed: 1, estimatedMb: 0, error: msg });
      }

      try {
        const r = await runVotesPipeline({ apiKey, federalId, senateGovBodyId, houseGovBodyId });
        results.push({ name: "congress_votes", inserted: r.votesInserted, updated: r.proposalsUpserted, failed: 0, estimatedMb: 0 });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("\n  Congress votes pipeline threw:", msg);
        results.push({ name: "congress_votes", inserted: 0, updated: 0, failed: 1, estimatedMb: 0, error: msg });
      }
    }
  }

  // -------------------------------------------------------------------------
  // 3. USASpending
  // -------------------------------------------------------------------------
  {
    try {
      const r = await runUsaSpendingPipeline(federalId);
      results.push({ name: "usaspending", ...r });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("\n  USASpending pipeline threw:", msg);
      results.push({ name: "usaspending", inserted: 0, updated: 0, failed: 1, estimatedMb: 0, error: msg });
    }
  }

  // -------------------------------------------------------------------------
  // 4. CourtListener
  // -------------------------------------------------------------------------
  {
    const apiKey = process.env["COURTLISTENER_API_KEY"];
    if (!apiKey) {
      console.warn("\n[4/5] CourtListener — SKIPPED (COURTLISTENER_API_KEY not set)");
      results.push({ name: "courtlistener", inserted: 0, updated: 0, failed: 0, estimatedMb: 0, error: "API key missing" });
    } else {
      try {
        const r = await runCourtListenerPipeline(apiKey, federalId);
        results.push({ name: "courtlistener", ...r });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("\n  CourtListener pipeline threw:", msg);
        results.push({ name: "courtlistener", inserted: 0, updated: 0, failed: 1, estimatedMb: 0, error: msg });
      }
    }
  }

  // -------------------------------------------------------------------------
  // 5. OpenStates
  // -------------------------------------------------------------------------
  {
    const apiKey = process.env["OPENSTATES_API_KEY"];
    if (!apiKey) {
      console.warn("\n[5/5] OpenStates — SKIPPED (OPENSTATES_API_KEY not set)");
      results.push({ name: "openstates", inserted: 0, updated: 0, failed: 0, estimatedMb: 0, error: "API key missing" });
    } else {
      try {
        const r = await runOpenStatesPipeline(apiKey, stateIds);
        results.push({ name: "openstates", ...r });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("\n  OpenStates pipeline threw:", msg);
        results.push({ name: "openstates", inserted: 0, updated: 0, failed: 1, estimatedMb: 0, error: msg });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Final report
  // -------------------------------------------------------------------------
  const finalMb = await getDbSizeMb();
  const elapsedMin = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║              Pipeline Report              ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log(`${"Pipeline".padEnd(16)} ${"Inserted".padStart(9)} ${"Updated".padStart(9)} ${"Failed".padStart(7)} ${"~MB".padStart(7)}`);
  console.log("─".repeat(52));

  let totalInserted = 0, totalUpdated = 0, totalFailed = 0, totalEstMb = 0;
  for (const r of results) {
    const flag = r.error ? " ⚠" : "";
    console.log(
      `${r.name.padEnd(16)} ${String(r.inserted).padStart(9)} ${String(r.updated).padStart(9)} ${String(r.failed).padStart(7)} ${r.estimatedMb.toFixed(1).padStart(7)}${flag}`
    );
    totalInserted += r.inserted;
    totalUpdated  += r.updated;
    totalFailed   += r.failed;
    totalEstMb    += r.estimatedMb;
  }

  console.log("─".repeat(52));
  console.log(
    `${"TOTAL".padEnd(16)} ${String(totalInserted).padStart(9)} ${String(totalUpdated).padStart(9)} ${String(totalFailed).padStart(7)} ${totalEstMb.toFixed(1).padStart(7)}`
  );

  const remaining = STORAGE_BUDGET_MB - finalMb;
  const pct = Math.round((finalMb / STORAGE_BUDGET_MB) * 100);

  console.log(`\n  DB size:  ${finalMb} MB → was ${initialMb} MB (+${(finalMb - initialMb).toFixed(1)} MB)`);
  console.log(`  Budget:   ${finalMb} / ${STORAGE_BUDGET_MB} MB (${pct}% used, ${remaining.toFixed(1)} MB remaining)`);
  console.log(`  Elapsed:  ${elapsedMin} minutes`);

  const failedPipelines = results.filter((r) => r.error);
  if (failedPipelines.length > 0) {
    console.log(`\n  ⚠ Failed/skipped: ${failedPipelines.map((r) => r.name).join(", ")}`);
  } else {
    console.log("\n  ✓ All pipelines completed successfully");
  }
}

// ---------------------------------------------------------------------------
// Nightly sync results type
// ---------------------------------------------------------------------------

export interface NightlyPipelineResult {
  status: "complete" | "failed" | "skipped" | "not_scheduled";
  rows_added?: number;
  duration_ms?: number;
  error?: string;
}

export interface NightlyAiResult {
  status: "complete" | "failed" | "skipped";
  entities?: number;
  cost_usd?: number;
  skip_reason?: string;
}

export interface NightlySyncResults {
  started_at: Date;
  completed_at?: Date;
  duration_ms?: number;
  is_weekly: boolean;
  pipelines: {
    regulations?: NightlyPipelineResult;
    congress_officials?: NightlyPipelineResult;
    congress_votes?: NightlyPipelineResult;
    fec_bulk?: NightlyPipelineResult;
    usaspending?: NightlyPipelineResult;
    courtlistener?: NightlyPipelineResult;
    openstates?: NightlyPipelineResult;
    agencies_hierarchy?: NightlyPipelineResult;
    elections?: NightlyPipelineResult;
    connections?: NightlyPipelineResult;
  };
  ai: {
    tag_rules?: NightlyAiResult;
    tag_ai?: NightlyAiResult;
    ai_summaries?: NightlyAiResult;
  };
  total_ai_cost_usd: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Nightly sync — used by Vercel cron and standalone scheduler
// ---------------------------------------------------------------------------

export async function runNightlySync(): Promise<NightlySyncResults> {
  const startedAt = new Date();
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║          Nightly Sync Starting            ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log(`  Started: ${startedAt.toISOString()}`);

  const apiKey = process.env["REGULATIONS_API_KEY"];
  const isWeekly = new Date().getDay() === 0; // Sunday

  const results: NightlySyncResults = {
    started_at: startedAt,
    is_weekly: isWeekly,
    pipelines: {},
    ai: {},
    total_ai_cost_usd: 0,
    errors: [],
  };

  // Seed jurisdictions (idempotent)
  const db = createAdminClient();
  const { federalId, stateIds } = await seedJurisdictions(db);
  const { senateId: senateGovBodyId, houseId: houseGovBodyId } = await seedGoverningBodies(db, federalId);

  // 1. Daily data pipelines — Regulations.gov
  {
    const t0 = Date.now();
    if (apiKey) {
      try {
        const r = await runRegulationsPipeline(apiKey, federalId);
        results.pipelines.regulations = { status: "complete", rows_added: r.inserted, duration_ms: Date.now() - t0 };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[nightly] regulations failed:", msg);
        results.pipelines.regulations = { status: "failed", error: msg };
        results.errors.push(`Regulations: ${msg}`);
      }
    } else {
      results.pipelines.regulations = { status: "skipped", error: "REGULATIONS_API_KEY not set" };
    }
  }

  // 1b. Daily data pipelines — Congress.gov (officials + votes)
  // Votes pipeline has a per-roll skip-if-exists guard, so re-running daily is cheap.
  {
    const congressKey = process.env["CONGRESS_GOV_API_KEY"];
    if (congressKey) {
      const t0 = Date.now();
      try {
        const r = await runOfficialsPipeline({ apiKey: congressKey, stateIds, senateId: senateGovBodyId, houseId: houseGovBodyId, federalId });
        results.pipelines.congress_officials = { status: "complete", rows_added: r.inserted + r.updated, duration_ms: Date.now() - t0 };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[nightly] congress officials failed:", msg);
        results.pipelines.congress_officials = { status: "failed", error: msg };
        results.errors.push(`Congress officials: ${msg}`);
      }

      const t1 = Date.now();
      try {
        const r = await runVotesPipeline({ apiKey: congressKey, federalId, senateGovBodyId, houseGovBodyId });
        results.pipelines.congress_votes = { status: "complete", rows_added: r.votesInserted, duration_ms: Date.now() - t1 };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[nightly] congress votes failed:", msg);
        results.pipelines.congress_votes = { status: "failed", error: msg };
        results.errors.push(`Congress votes: ${msg}`);
      }
    } else {
      results.pipelines.congress_officials = { status: "skipped", error: "CONGRESS_GOV_API_KEY not set" };
      results.pipelines.congress_votes = { status: "skipped", error: "CONGRESS_GOV_API_KEY not set" };
    }
  }

  // 2. Weekly pipelines (Sunday only) — FEC bulk, USASpending, CourtListener, OpenStates
  if (isWeekly) {
    const clKey  = process.env["COURTLISTENER_API_KEY"];
    const osKey  = process.env["OPENSTATES_API_KEY"];

    {
      const t0 = Date.now();
      try {
        const r = await runFecBulkPipeline();
        results.pipelines.fec_bulk = { status: "complete", rows_added: r.inserted, duration_ms: Date.now() - t0 };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[nightly] fec-bulk failed:", msg);
        results.pipelines.fec_bulk = { status: "failed", error: msg };
        results.errors.push(`FEC bulk: ${msg}`);
      }
    }

    {
      const t0 = Date.now();
      try {
        const r = await runUsaSpendingPipeline(federalId);
        results.pipelines.usaspending = { status: "complete", rows_added: r.inserted, duration_ms: Date.now() - t0 };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[nightly] usaspending failed:", msg);
        results.pipelines.usaspending = { status: "failed", error: msg };
        results.errors.push(`USASpending: ${msg}`);
      }
    }

    if (clKey) {
      const t0 = Date.now();
      try {
        const r = await runCourtListenerPipeline(clKey, federalId);
        results.pipelines.courtlistener = { status: "complete", rows_added: r.inserted, duration_ms: Date.now() - t0 };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[nightly] courtlistener failed:", msg);
        results.pipelines.courtlistener = { status: "failed", error: msg };
        results.errors.push(`CourtListener: ${msg}`);
      }
    } else {
      results.pipelines.courtlistener = { status: "skipped", error: "COURTLISTENER_API_KEY not set" };
    }

    if (osKey) {
      const t0 = Date.now();
      try {
        const r = await runOpenStatesPipeline(osKey, stateIds);
        results.pipelines.openstates = { status: "complete", rows_added: r.inserted, duration_ms: Date.now() - t0 };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[nightly] openstates failed:", msg);
        results.pipelines.openstates = { status: "failed", error: msg };
        results.errors.push(`OpenStates: ${msg}`);
      }
    } else {
      results.pipelines.openstates = { status: "skipped", error: "OPENSTATES_API_KEY not set" };
    }

    {
      const t0 = Date.now();
      try {
        const r = await runAgenciesHierarchyPipeline();
        results.pipelines.agencies_hierarchy = { status: "complete", rows_added: r.updated, duration_ms: Date.now() - t0 };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[nightly] agencies-hierarchy failed:", msg);
        results.pipelines.agencies_hierarchy = { status: "failed", error: msg };
        results.errors.push(`Agencies hierarchy: ${msg}`);
      }
    }

    {
      const t0 = Date.now();
      try {
        const r = await runElectionsPipeline();
        results.pipelines.elections = { status: "complete", rows_added: r.updated, duration_ms: Date.now() - t0 };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[nightly] elections failed:", msg);
        results.pipelines.elections = { status: "failed", error: msg };
        results.errors.push(`Elections: ${msg}`);
      }
    }
  }

  // 3. Derive connections (delta only)
  {
    const t0 = Date.now();
    try {
      const r = await runConnectionsDelta();
      results.pipelines.connections = { status: "complete", rows_added: r.inserted, duration_ms: Date.now() - t0 };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[nightly] connections-delta failed:", msg);
      results.pipelines.connections = { status: "failed", error: msg };
      results.errors.push(`Connections: ${msg}`);
    }
  }

  // 3b. Refresh comment aggregations (FIX-029 — trending tab)
  try {
    const { createAdminClient } = await import("@civitics/db");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    await admin.rpc("refresh_proposal_trending");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[nightly] refresh_proposal_trending failed:", msg);
    results.errors.push(`Trending refresh: ${msg}`);
  }

  // 3c. Rebuild entity_connections via SQL derivation (FIX-100)
  // Full rebuild from financial_relationships, votes, proposal_cosponsors,
  // career_history, agencies. ~15s today (votes only); will grow as FIX-101
  // pipelines populate the other source tables.
  {
    const t0 = Date.now();
    try {
      const { createAdminClient } = await import("@civitics/db");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const admin = createAdminClient() as any;
      const { data, error } = await admin.rpc("rebuild_entity_connections");
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const total = (data ?? []).reduce((a: number, r: any) => a + Number(r.edges_upserted ?? 0), 0);
      results.pipelines.entity_connections_rebuild = {
        status: "complete",
        rows_added: total,
        duration_ms: Date.now() - t0,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[nightly] rebuild_entity_connections failed:", msg);
      results.pipelines.entity_connections_rebuild = { status: "failed", error: msg };
      results.errors.push(`Rebuild entity_connections: ${msg}`);
    }
  }

  // 4. Rule-based tags (all new/updated entities)
  try {
    await runRuleBasedTagger();
    results.ai.tag_rules = { status: "complete" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[nightly] tag-rules failed:", msg);
    results.ai.tag_rules = { status: "failed" };
    results.errors.push(`Tag rules: ${msg}`);
  }

  // 5. AI tags (new entities only, $0.10 max per nightly run)
  try {
    const r = await runAiTagger({ maxCostCents: 10, onlyNew: true });
    const costUsd = (r.costCents ?? 0) / 100;
    results.ai.tag_ai = { status: "complete", entities: r.tagsCreated, cost_usd: costUsd };
    results.total_ai_cost_usd += costUsd;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[nightly] tag-ai failed:", msg);
    results.ai.tag_ai = { status: "failed" };
    results.errors.push(`AI tagger: ${msg}`);
  }

  // 6. AI summaries (incremental — only proposals/officials without cached summaries)
  try {
    await runAiSummariesPipeline(true);
    results.ai.ai_summaries = { status: "complete" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[nightly] ai-summaries failed:", msg);
    results.ai.ai_summaries = { status: "failed" };
    results.errors.push(`AI summaries: ${msg}`);
  }

  results.completed_at = new Date();
  results.duration_ms = results.completed_at.getTime() - startedAt.getTime();

  console.log(`\n  Nightly sync complete: ${results.completed_at.toISOString()}`);
  console.log(`  Duration: ${(results.duration_ms / 1000).toFixed(1)}s`);
  if (results.errors.length > 0) {
    console.log(`  Errors (${results.errors.length}): ${results.errors.join("; ")}`);
  }

  // Record results to pipeline_state for dashboard
  try {
    const status = results.errors.length === 0 ? "complete" : "partial";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).from("pipeline_state").upsert(
      {
        key: "cron_last_run",
        value: {
          started_at:   startedAt.toISOString(),
          completed_at: results.completed_at.toISOString(),
          status,
          results,
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );

    // Also write to data_sync_log
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).from("data_sync_log").insert({
      pipeline_name: "nightly_cron",
      status,
      started_at:    startedAt.toISOString(),
      completed_at:  results.completed_at.toISOString(),
      rows_inserted: Object.values(results.pipelines).reduce(
        (sum, p) => sum + (p?.rows_added ?? 0), 0
      ),
      metadata: results,
    });
  } catch (err) {
    console.error("[nightly] failed to record results:", err instanceof Error ? err.message : err);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Standalone entry points
// ---------------------------------------------------------------------------

if (require.main === module) {
  const command = process.argv[2];

  if (command === "status") {
    printStatus()
      .then(() => { setTimeout(() => process.exit(0), 500); })
      .catch((e) => { console.error("Pipeline failed:", e); setTimeout(() => process.exit(1), 500); });
  } else if (command === "nightly") {
    runNightlySync()
      .then(() => { setTimeout(() => process.exit(0), 500); })
      .catch((e) => { console.error("Pipeline failed:", e); setTimeout(() => process.exit(1), 500); });
  } else {
    runAllPipelines()
      .then(() => { setTimeout(() => process.exit(0), 500); })
      .catch((e) => { console.error("Pipeline failed:", e); setTimeout(() => process.exit(1), 500); });
  }
}
