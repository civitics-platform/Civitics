/**
 * Pipeline scheduler.
 *
 * Runs pipelines on a cron schedule:
 *   - Daily 2am:   Regulations.gov (open comment periods change daily)
 *   - Weekly Sun:  FEC, USASpending, CourtListener, OpenStates
 *
 * Run standalone (keeps process alive):
 *   pnpm --filter @civitics/data data:scheduler
 */

import cron from "node-cron";
import { createAdminClient } from "@civitics/db";
import { getDbSizeMb } from "./pipelines/sync-log";
import { runRegulationsPipeline } from "./pipelines/regulations";
import { runFecPipeline } from "./pipelines/fec";
import { runUsaSpendingPipeline } from "./pipelines/usaspending";
import { runCourtListenerPipeline } from "./pipelines/courtlistener";
import { runOpenStatesPipeline } from "./pipelines/openstates";
import { seedJurisdictions, seedGoverningBodies } from "./jurisdictions/us-states";

const STORAGE_BUDGET_MB = 270;

async function withBudgetCheck(name: string, fn: () => Promise<unknown>): Promise<void> {
  const mb = await getDbSizeMb();
  if (mb >= STORAGE_BUDGET_MB) {
    console.log(`[scheduler] ${name} skipped — DB at ${mb} MB (budget: ${STORAGE_BUDGET_MB} MB)`);
    return;
  }
  console.log(`[scheduler] Starting ${name} (DB: ${mb} MB)`);
  try {
    await fn();
    console.log(`[scheduler] ${name} complete`);
  } catch (err) {
    console.error(`[scheduler] ${name} failed:`, err instanceof Error ? err.message : err);
  }
}

async function bootstrap(): Promise<{ federalId: string; senateId: string; stateIds: Map<string, string> }> {
  const db = createAdminClient();
  const { federalId, stateIds } = await seedJurisdictions(db);
  const { senateId } = await seedGoverningBodies(db, federalId);
  return { federalId, senateId, stateIds };
}

// ---------------------------------------------------------------------------
// Daily 2am — regulations (comment periods can open/close daily)
// ---------------------------------------------------------------------------
cron.schedule("0 2 * * *", async () => {
  const apiKey = process.env["REGULATIONS_API_KEY"];
  if (!apiKey) { console.warn("[scheduler] REGULATIONS_API_KEY not set"); return; }
  const { federalId } = await bootstrap();
  await withBudgetCheck("regulations", () => runRegulationsPipeline(apiKey, federalId));
}, { timezone: "America/New_York" });

// ---------------------------------------------------------------------------
// Weekly Sunday 3am — FEC, USASpending, CourtListener, OpenStates
// ---------------------------------------------------------------------------
cron.schedule("0 3 * * 0", async () => {
  const { federalId, senateId, stateIds } = await bootstrap();

  const fecKey    = process.env["FEC_API_KEY"];
  const clKey     = process.env["COURTLISTENER_API_KEY"];
  const osKey     = process.env["OPENSTATES_API_KEY"];

  if (fecKey) {
    await withBudgetCheck("fec", () => runFecPipeline(fecKey));
  }

  await withBudgetCheck("usaspending", () => runUsaSpendingPipeline(federalId));

  if (clKey) {
    await withBudgetCheck("courtlistener", () => runCourtListenerPipeline(clKey, federalId, senateId));
  }

  if (osKey) {
    await withBudgetCheck("openstates", () => runOpenStatesPipeline(osKey, stateIds));
  }
}, { timezone: "America/New_York" });

console.log("[scheduler] Running. Schedules:");
console.log("  Regulations.gov — daily 2am ET");
console.log("  FEC, USASpending, CourtListener, OpenStates — weekly Sun 3am ET");
console.log("  Press Ctrl+C to stop.");
