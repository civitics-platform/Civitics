/**
 * USASpending bulk archive pipeline — supersedes the paginated API approach.
 *
 * Downloads pre-built annual award archives from:
 *   https://files.usaspending.gov/award_data_archive/
 *
 * Advantages over the API pipeline (data:usaspending):
 *   - All agencies (not just the hardcoded top 20)
 *   - All award sizes (no $1M minimum)
 *   - All awards in the FY (not just top 100 per agency)
 *   - Static files — no rate limits, no async polling
 *
 * Strategy:
 *   - First run (no prior state): Full file  FY{year}_All_Contracts_Full_{YYYYMMDD}.zip
 *   - Subsequent runs: Delta files since last processed date
 *   - Filters rows to agencies present in public.agencies (by name match)
 *   - Reuses resolveRecipients + upsertSpendingRelationshipsBatch from usaspending/writer.ts
 *   - Dedup key: contract_award_unique_key (transaction-level)
 *
 * State: packages/data/.usaspending-bulk-state.json (gitignored, not committed)
 *
 * Run standalone:
 *   pnpm --filter @civitics/data data:usaspending-bulk
 *   pnpm --filter @civitics/data data:usaspending-bulk -- --force   # force Full re-run
 */

import * as https    from "https";
import * as http     from "http";
import * as fs       from "fs";
import * as path     from "path";
import * as os       from "os";
import * as unzipper from "unzipper";
import { parse }     from "csv-parse";
import { createAdminClient } from "@civitics/db";
import {
  startSync,
  completeSync,
  failSync,
  type PipelineResult,
} from "../sync-log";
import {
  resolveRecipients,
  upsertSpendingRelationshipsBatch,
  type SpendingRelationshipInput,
} from "../usaspending/writer";
import { canonicalizeEntityName } from "../fec-bulk/writer";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TMP_DIR           = path.join(os.tmpdir(), "usaspending-bulk");
const ARCHIVE_INDEX_URL = "https://files.usaspending.gov/award_data_archive/";
const STATE_FILE        = path.join(__dirname, "../../.usaspending-bulk-state.json");
const BATCH_SIZE        = 1_000;   // rows per DB write batch

// ---------------------------------------------------------------------------
// State management (delta tracking)
// ---------------------------------------------------------------------------

interface PipelineState {
  /** YYYYMMDD of the latest archive file processed on the last successful run. */
  lastArchiveDate: string;
  lastRunType: "full" | "delta";
  lastRunAt: string;
}

function loadState(): PipelineState | null {
  try {
    if (!fs.existsSync(STATE_FILE)) return null;
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as PipelineState;
  } catch {
    return null;
  }
}

function saveState(state: PipelineState): void {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
  } catch (err) {
    console.warn("  [state] Could not save state:", err instanceof Error ? err.message : err);
  }
}

// ---------------------------------------------------------------------------
// Fiscal year helper
// ---------------------------------------------------------------------------

function currentFy(): number {
  const now = new Date();
  // FY runs Oct 1 → Sep 30; month is 0-based, so month >= 9 means Oct+
  return now.getUTCMonth() >= 9 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
}

// ---------------------------------------------------------------------------
// Archive index
// ---------------------------------------------------------------------------

interface ArchiveFile {
  name: string;
  url:  string;
  date: string;            // YYYYMMDD
  type: "Full" | "Delta";
  part: number;            // 1-based (1 when no part suffix)
}

async function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const follow = (u: string): void => {
      const lib = u.startsWith("https") ? https : http;
      lib.get(u, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          res.resume();
          follow(res.headers.location ?? u);
          return;
        }
        let data = "";
        res.on("data", (c: Buffer) => { data += c.toString(); });
        res.on("end", () => resolve(data));
        res.on("error", reject);
      }).on("error", reject);
    };
    follow(url);
  });
}

function parseArchiveIndex(html: string, fy: number): ArchiveFile[] {
  // Matches e.g. FY2026_All_Contracts_Full_20260415.zip
  //          and FY2026_All_Contracts_Delta_20260416_1.zip
  const re = new RegExp(
    `(FY${fy}_All_Contracts_(Full|Delta)_(\\d{8})(?:_(\\d+))?\\.zip)`,
    "g",
  );

  const seen  = new Set<string>();
  const files: ArchiveFile[] = [];
  let m: RegExpExecArray | null;

  while ((m = re.exec(html)) !== null) {
    const name = m[1]!;
    if (seen.has(name)) continue;
    seen.add(name);
    files.push({
      name,
      url:  `${ARCHIVE_INDEX_URL}${name}`,
      date: m[3]!,
      type: m[2] as "Full" | "Delta",
      part: m[4] ? parseInt(m[4], 10) : 1,
    });
  }
  return files;
}

function latestFullSet(files: ArchiveFile[]): ArchiveFile[] {
  const fulls = files.filter((f) => f.type === "Full");
  if (fulls.length === 0) return [];
  const latest = fulls.reduce((max, f) => (f.date > max ? f.date : max), "");
  return fulls
    .filter((f) => f.date === latest)
    .sort((a, b) => a.part - b.part);
}

function deltasSince(files: ArchiveFile[], since: string): ArchiveFile[] {
  return files
    .filter((f) => f.type === "Delta" && f.date > since)
    .sort((a, b) => a.date.localeCompare(b.date) || a.part - b.part);
}

// ---------------------------------------------------------------------------
// Download helper (follows redirects, works for http + https)
// ---------------------------------------------------------------------------

function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const follow = (u: string): void => {
      const lib = u.startsWith("https") ? https : http;
      const file = fs.createWriteStream(destPath);
      lib.get(u, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          res.resume();
          file.destroy();
          follow(res.headers.location ?? u);
          return;
        }
        if (res.statusCode !== 200) {
          file.destroy();
          reject(new Error(`HTTP ${res.statusCode} — ${u}`));
          return;
        }
        res.pipe(file);
        file.on("finish", () => file.close(() => resolve()));
        file.on("error", (err) => {
          fs.unlink(destPath, () => undefined);
          reject(err);
        });
      }).on("error", (err) => {
        file.destroy();
        reject(err);
      });
    };
    follow(url);
  });
}

// ---------------------------------------------------------------------------
// ZIP → CSV extraction (streaming, no full-zip buffer)
// ---------------------------------------------------------------------------

/**
 * Extract the first .csv entry from a zip file to disk via pipe.
 * Never loads the full zip into memory — identical to the FEC bulk approach.
 */
async function extractCsvFromZip(zipPath: string, destPath: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let found = false;

    fs.createReadStream(zipPath)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .pipe((unzipper as any).Parse())
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on("entry", (entry: any) => {
        const name = (entry.path as string).toLowerCase();
        if (!found && name.endsWith(".csv")) {
          found = true;
          const out = fs.createWriteStream(destPath);
          entry.pipe(out);
          out.on("finish", () => resolve(true));
          out.on("error", reject);
        } else {
          entry.autodrain();
        }
      })
      .on("finish", () => { if (!found) resolve(false); })
      .on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Agency map
// ---------------------------------------------------------------------------

async function loadAgencyMap(
  db: ReturnType<typeof createAdminClient>,
): Promise<Map<string, string>> {
  const { data, error } = await db
    .from("agencies")
    .select("id, name, acronym");

  if (error || !data) {
    console.error("  Failed to load agencies:", error?.message);
    return new Map();
  }

  const map = new Map<string, string>();
  for (const row of data as Array<{ id: string; name: string | null; acronym: string | null }>) {
    if (row.name)    map.set(row.name.toUpperCase().trim(), row.id);
    if (row.acronym) map.set(row.acronym.toUpperCase().trim(), row.id);
  }

  console.log(`  Loaded ${data.length} agencies (${map.size} name/acronym keys)`);
  return map;
}

// ---------------------------------------------------------------------------
// CSV processing — streamed line by line through csv-parse
// ---------------------------------------------------------------------------

interface CsvRow {
  contract_award_unique_key?: string;
  award_id_piid?:             string;
  recipient_name?:            string;
  recipient_uei?:             string;
  federal_action_obligation?: string;
  action_date?:               string;
  awarding_agency_name?:      string;
  naics_code?:                string;
  award_description?:         string;
}

interface PendingRow {
  uniqueKey:     string;
  recipientName: string;
  agencyId:      string;
  amountCents:   number;
  actionDate:    string;
  naicsCode:     string | null;
  description:   string | null;
}

interface FileResult {
  upserted: number;
  failed:   number;
  skipped:  number;
}

async function processCsvFile(
  csvPath:   string,
  agencyMap: Map<string, string>,
  db:        ReturnType<typeof createAdminClient>,
): Promise<FileResult> {
  const result: FileResult = { upserted: 0, failed: 0, skipped: 0 };

  const fileMb = (fs.statSync(csvPath).size / 1024 / 1024).toFixed(0);
  console.log(`    Processing CSV (${fileMb} MB uncompressed)...`);

  const parser = fs.createReadStream(csvPath).pipe(
    parse({
      columns:          true,
      skip_empty_lines: true,
      relax_quotes:     true,
      trim:             true,
    }),
  );

  let batch: PendingRow[] = [];
  let rowsRead = 0;
  let rowsMatched = 0;

  const flushBatch = async (): Promise<void> => {
    if (batch.length === 0) return;

    const recipientInputs = batch.map((r) => ({ displayName: r.recipientName }));
    const { byCanonical } = await resolveRecipients(db, recipientInputs);

    const relInputs: SpendingRelationshipInput[] = [];
    for (const row of batch) {
      const canonical = canonicalizeEntityName(row.recipientName);
      const recipientEntityId = byCanonical.get(canonical);
      if (!recipientEntityId) { result.failed++; continue; }

      relInputs.push({
        agencyId:           row.agencyId,
        recipientEntityId,
        relationshipType:   "contract",
        amountCents:        row.amountCents,
        occurredAt:         row.actionDate,
        usaspendingAwardId: row.uniqueKey,
        naicsCode:          row.naicsCode,
        cfdaNumber:         null,
        description:        row.description,
        sourceUrl:          `https://www.usaspending.gov/award/${encodeURIComponent(row.uniqueKey)}/`,
      });
    }

    const batchResult = await upsertSpendingRelationshipsBatch(db, relInputs);
    result.upserted += batchResult.upserted;
    result.failed   += batchResult.failed;
    batch = [];
  };

  for await (const row of parser as AsyncIterable<CsvRow>) {
    rowsRead++;

    const agencyName = (row.awarding_agency_name ?? "").toUpperCase().trim();
    const agencyId   = agencyMap.get(agencyName);
    if (!agencyId) { result.skipped++; continue; }

    // Use contract_award_unique_key (transaction-level) as the dedup key;
    // fall back to award_id_piid for files that omit it.
    const uniqueKey = (row.contract_award_unique_key ?? row.award_id_piid ?? "").trim();
    if (!uniqueKey) { result.skipped++; continue; }

    const recipientName = (row.recipient_name ?? "").trim();
    if (!recipientName) { result.skipped++; continue; }

    const amount = parseFloat((row.federal_action_obligation ?? "").trim());
    // Skip zero and negative obligations (de-obligations / cancellations)
    if (isNaN(amount) || amount <= 0) { result.skipped++; continue; }

    // Archive uses ISO YYYY-MM-DD dates
    const actionDate = (row.action_date ?? "").trim().slice(0, 10);
    if (!actionDate || actionDate.length < 10) { result.skipped++; continue; }

    batch.push({
      uniqueKey,
      recipientName,
      agencyId,
      amountCents: Math.round(amount * 100),
      actionDate,
      naicsCode:   (row.naics_code ?? "").trim() || null,
      description: (row.award_description ?? "").trim().slice(0, 500) || null,
    });
    rowsMatched++;

    if (batch.length >= BATCH_SIZE) {
      await flushBatch();
    }

    if (rowsRead % 100_000 === 0) {
      console.log(
        `    ... ${rowsRead.toLocaleString()} rows read,` +
        ` ${rowsMatched.toLocaleString()} matched,` +
        ` ${result.upserted.toLocaleString()} upserted`,
      );
    }
  }

  await flushBatch();

  console.log(`    Rows read:          ${rowsRead.toLocaleString()}`);
  console.log(`    Matched agencies:   ${rowsMatched.toLocaleString()}`);
  console.log(`    Skipped:            ${result.skipped.toLocaleString()}`);
  console.log(`    Upserted:           ${result.upserted.toLocaleString()}`);
  console.log(`    Failed:             ${result.failed.toLocaleString()}`);

  return result;
}

// ---------------------------------------------------------------------------
// Temp dir helpers
// ---------------------------------------------------------------------------

function ensureTmpDir(): void {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
}

function cleanTmpDir(): void {
  try {
    if (!fs.existsSync(TMP_DIR)) return;
    for (const f of fs.readdirSync(TMP_DIR)) {
      fs.unlinkSync(path.join(TMP_DIR, f));
    }
    fs.rmdirSync(TMP_DIR);
  } catch {
    // best effort
  }
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

export async function runUsaSpendingBulkPipeline(
  opts: { force?: boolean } = {},
): Promise<PipelineResult> {
  console.log("\n=== USASpending bulk archive pipeline ===");
  const logId = await startSync("usaspending_bulk");
  const db    = createAdminClient();

  let totalUpserted = 0;
  let totalFailed   = 0;

  try {
    // ── [1/5] Fetch archive index ──────────────────────────────────────────
    console.log("\n  [1/5] Fetching archive index...");
    const html = await fetchText(ARCHIVE_INDEX_URL);
    const fy   = currentFy();
    const all  = parseArchiveIndex(html, fy);
    console.log(`  Found ${all.length} archive entries for FY${fy}`);

    if (all.length === 0) {
      console.warn("  No archive files found — aborting");
      await failSync(logId, "No archive files found in index");
      return { inserted: 0, updated: 0, failed: 1, estimatedMb: 0 };
    }

    // ── [2/5] Decide Full vs Delta ─────────────────────────────────────────
    console.log("\n  [2/5] Determining run mode...");
    const state = opts.force ? null : loadState();

    let filesToProcess: ArchiveFile[];
    let runMode: "full" | "delta";

    if (!state) {
      filesToProcess = latestFullSet(all);
      runMode = "full";
      if (filesToProcess.length === 0) {
        console.warn("  No Full archive found for FY" + fy);
        await failSync(logId, `No Full archive found for FY${fy}`);
        return { inserted: 0, updated: 0, failed: 1, estimatedMb: 0 };
      }
      console.log(
        `  ${opts.force ? "Forced full re-run" : "No prior state — first run"}:` +
        ` ${filesToProcess.length} Full file(s) dated ${filesToProcess[0]!.date}`,
      );
    } else {
      filesToProcess = deltasSince(all, state.lastArchiveDate);
      runMode = "delta";
      if (filesToProcess.length === 0) {
        console.log(`  No new Delta files since ${state.lastArchiveDate} — nothing to do`);
        await completeSync(logId, { inserted: 0, updated: 0, failed: 0, estimatedMb: 0 });
        return { inserted: 0, updated: 0, failed: 0, estimatedMb: 0 };
      }
      console.log(
        `  Delta mode: ${filesToProcess.length} file(s) since ${state.lastArchiveDate}`,
      );
    }

    // ── [3/5] Load agency map ──────────────────────────────────────────────
    console.log("\n  [3/5] Loading agency map...");
    const agencyMap = await loadAgencyMap(db);
    if (agencyMap.size === 0) {
      await failSync(logId, "No agencies loaded — cannot filter archive rows");
      return { inserted: 0, updated: 0, failed: 1, estimatedMb: 0 };
    }

    // ── [4/5] Download and process each archive file ───────────────────────
    console.log("\n  [4/5] Processing archive files...");
    ensureTmpDir();

    let lastProcessedDate = state?.lastArchiveDate ?? "";

    for (const archiveFile of filesToProcess) {
      console.log(`\n  Processing ${archiveFile.name}...`);

      const zipPath = path.join(TMP_DIR, archiveFile.name);
      const csvPath = path.join(TMP_DIR, path.basename(archiveFile.name, ".zip") + ".csv");

      try {
        // Download ZIP (can be 300 MB – 1 GB)
        console.log("    Downloading (large file — please wait)...");
        await downloadFile(archiveFile.url, zipPath);
        const zipMb = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(0);
        console.log(`    Downloaded ${zipMb} MB`);

        // Extract inner CSV to disk (streaming — never buffers full zip)
        console.log("    Extracting CSV from ZIP...");
        const found = await extractCsvFromZip(zipPath, csvPath);

        // ZIP no longer needed — delete immediately to free disk space
        try { fs.unlinkSync(zipPath); } catch { /* best effort */ }

        if (!found) {
          console.warn(`    No .csv found inside ${archiveFile.name} — skipping`);
          continue;
        }

        // Process the CSV stream
        const fileResult = await processCsvFile(csvPath, agencyMap, db);
        totalUpserted += fileResult.upserted;
        totalFailed   += fileResult.failed;

        if (archiveFile.date > lastProcessedDate) {
          lastProcessedDate = archiveFile.date;
        }

      } finally {
        // Best-effort cleanup — don't let stray temp files accumulate
        try { if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath); } catch { /* ok */ }
        try { if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath); } catch { /* ok */ }
      }
    }

    // ── [5/5] Finalize ─────────────────────────────────────────────────────
    console.log("\n  [5/5] Finalising...");
    cleanTmpDir();

    const result: PipelineResult = {
      inserted:    totalUpserted,
      updated:     0,
      failed:      totalFailed,
      estimatedMb: 0,  // agent of change — let dashboard derive from DB size
    };

    console.log("\n  ──────────────────────────────────────────────────");
    console.log("  USASpending bulk pipeline report");
    console.log("  ──────────────────────────────────────────────────");
    console.log(`  ${"Run mode:".padEnd(30)} ${runMode}`);
    console.log(`  ${"FY:".padEnd(30)} ${fy}`);
    console.log(`  ${"Files processed:".padEnd(30)} ${filesToProcess.length}`);
    console.log(`  ${"Relationships upserted:".padEnd(30)} ${totalUpserted}`);
    console.log(`  ${"Failed:".padEnd(30)} ${totalFailed}`);

    await completeSync(logId, result);

    // Persist state for next run's delta logic
    if (lastProcessedDate) {
      saveState({
        lastArchiveDate: lastProcessedDate,
        lastRunType:     runMode,
        lastRunAt:       new Date().toISOString(),
      });
    }

    return result;

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("  USASpending bulk pipeline fatal error:", msg);
    cleanTmpDir();
    await failSync(logId, msg);
    return { inserted: totalUpserted, updated: 0, failed: totalFailed, estimatedMb: 0 };
  }
}

// ---------------------------------------------------------------------------
// Standalone entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  const force = process.argv.includes("--force");
  runUsaSpendingBulkPipeline({ force })
    .then(() => { setTimeout(() => process.exit(0), 500); })
    .catch((err) => {
      console.error("Pipeline failed:", err);
      setTimeout(() => process.exit(1), 500);
    });
}
