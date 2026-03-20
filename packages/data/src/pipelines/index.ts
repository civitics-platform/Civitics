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
import { runFecPipeline } from "./fec";
import { runUsaSpendingPipeline } from "./usaspending";
import { runCourtListenerPipeline } from "./courtlistener";
import { runOpenStatesPipeline } from "./openstates";
import { runConnectionsDelta } from "./connections/delta";
import { runRuleBasedTagger } from "./tags/rules";
import { runAiTagger } from "./tags/ai-tagger";
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

  const pipelines = ["regulations", "fec", "usaspending", "courtlistener", "openstates"] as const;
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
  const { senateId, houseId } = await seedGoverningBodies(db, federalId);

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
  // 2. FEC
  // -------------------------------------------------------------------------
  {
    const apiKey = process.env["FEC_API_KEY"];
    if (!apiKey) {
      console.warn("\n[2/5] FEC — SKIPPED (FEC_API_KEY not set)");
      results.push({ name: "fec", inserted: 0, updated: 0, failed: 0, estimatedMb: 0, error: "API key missing" });
    } else {
      try {
        const r = await runFecPipeline(apiKey);
        results.push({ name: "fec", ...r });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("\n  FEC pipeline threw:", msg);
        results.push({ name: "fec", inserted: 0, updated: 0, failed: 1, estimatedMb: 0, error: msg });
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
        const r = await runCourtListenerPipeline(apiKey, federalId, senateId);
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
// Nightly sync — used by Vercel cron and standalone scheduler
// ---------------------------------------------------------------------------

export async function runNightlySync(): Promise<void> {
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║          Nightly Sync Starting            ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log(`  Started: ${new Date().toISOString()}`);

  const apiKey = process.env["REGULATIONS_API_KEY"];

  // Seed jurisdictions (idempotent)
  const db = createAdminClient();
  const { federalId, stateIds } = await seedJurisdictions(db);
  const { senateId } = await seedGoverningBodies(db, federalId);

  // 1. Daily data pipelines
  if (apiKey) {
    try { await runRegulationsPipeline(apiKey, federalId); }
    catch (err) { console.error("[nightly] regulations failed:", err instanceof Error ? err.message : err); }
  }

  // Weekly pipelines (Sunday only)
  const dayOfWeek = new Date().getDay();
  if (dayOfWeek === 0) {
    const fecKey = process.env["FEC_API_KEY"];
    const clKey  = process.env["COURTLISTENER_API_KEY"];
    const osKey  = process.env["OPENSTATES_API_KEY"];

    if (fecKey) {
      try { await runFecPipeline(fecKey); }
      catch (err) { console.error("[nightly] fec failed:", err instanceof Error ? err.message : err); }
    }

    try { await runUsaSpendingPipeline(federalId); }
    catch (err) { console.error("[nightly] usaspending failed:", err instanceof Error ? err.message : err); }

    if (clKey) {
      try { await runCourtListenerPipeline(clKey, federalId, senateId); }
      catch (err) { console.error("[nightly] courtlistener failed:", err instanceof Error ? err.message : err); }
    }

    if (osKey) {
      try { await runOpenStatesPipeline(osKey, stateIds); }
      catch (err) { console.error("[nightly] openstates failed:", err instanceof Error ? err.message : err); }
    }
  }

  // 2. Derive connections (delta only)
  try { await runConnectionsDelta(); }
  catch (err) { console.error("[nightly] connections-delta failed:", err instanceof Error ? err.message : err); }

  // 3. Rule-based tags (all new/updated entities)
  try { await runRuleBasedTagger(); }
  catch (err) { console.error("[nightly] tag-rules failed:", err instanceof Error ? err.message : err); }

  // 4. AI tags (new entities only, $0.10 max per nightly run)
  try { await runAiTagger({ maxCostCents: 10, onlyNew: true }); }
  catch (err) { console.error("[nightly] tag-ai failed:", err instanceof Error ? err.message : err); }

  console.log(`\n  Nightly sync complete: ${new Date().toISOString()}`);
}

// ---------------------------------------------------------------------------
// Standalone entry points
// ---------------------------------------------------------------------------

if (require.main === module) {
  const command = process.argv[2];

  if (command === "status") {
    printStatus().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
  } else if (command === "nightly") {
    runNightlySync().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
  } else {
    runAllPipelines().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
  }
}
