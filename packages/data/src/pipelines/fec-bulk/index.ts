/**
 * FEC bulk data pipeline.
 *
 * Downloads bulk zip files directly from FEC (no API key, no rate limits),
 * parses the all-candidates summary (weball24), matches records to officials
 * in our database, and inserts aggregated financial_relationships rows.
 *
 * Files downloaded to /tmp and deleted after processing:
 *   weball24.zip / weball24.txt — all-candidates summary (2024 cycle)
 *   cm24.zip / cm24.txt         — committee master (downloaded, reserved for future use)
 *
 * Data strategy: download → process → delete. No API key needed.
 * FEC updates bulk files weekly — run this pipeline on the weekly cron.
 *
 * Run standalone:
 *   pnpm --filter @civitics/data data:fec-bulk
 */

import * as https from "https";
import * as fs   from "fs";
import * as path from "path";
import * as os   from "os";
import * as unzipper from "unzipper";
import { parse }    from "csv-parse/sync";
import { createAdminClient } from "@civitics/db";
import type { Database }     from "@civitics/db";
import {
  startSync,
  completeSync,
  failSync,
  type PipelineResult,
} from "../sync-log";
import { runConnectionsPipeline } from "../connections";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FinancialInsert = Database["public"]["Tables"]["financial_relationships"]["Insert"];
type DonorType       = Database["public"]["Enums"]["donor_type"];

interface WeBallRow {
  candId:           string;  // CAND_ID
  candName:         string;  // CAND_NAME  (format: "LAST, FIRST MI")
  ttlReceipts:      number;  // TTL_RECEIPTS
  ttlDisb:          number;  // TTL_DISB
  cohCop:           number;  // COH_COP (cash on hand, close of period)
  candContrib:      number;  // CAND_CONTRIB (self-funded)
  candLoans:        number;  // CAND_LOANS
  otherLoans:       number;  // OTHER_LOANS
  indivContrib:     number;  // TTL_INDIV_CONTRIB
  polPtyContrib:    number;  // POL_PTY_CONTRIB
  cvrdHarReceipts:  number;  // OTHER_POL_CMTE_CONTRIB (PAC contributions)
  candOfficeSt:     string;  // CAND_OFFICE_ST (state abbr)
}

interface OfficialRecord {
  id:         string;
  full_name:  string;
  last_name:  string | null;
  source_ids: Record<string, string>;
  state:      string | null;
}

// weball pipe-delimited column indices (0-based)
// Ref: https://www.fec.gov/campaign-finance-data/all-candidates-file-description/
const COL = {
  CAND_ID:                0,
  CAND_NAME:              1,
  TTL_RECEIPTS:           5,
  TRANS_FROM_AUTH:        6,
  TTL_DISB:               7,
  COH_COP:                10,
  CAND_CONTRIB:           11,
  CAND_LOANS:             12,
  OTHER_LOANS:            13,
  TTL_INDIV_CONTRIB:      17,
  CAND_OFFICE_ST:         18,
  OTHER_POL_CMTE_CONTRIB: 25,
  POL_PTY_CONTRIB:        26,
} as const;

// ---------------------------------------------------------------------------
// Download + extract helpers
// ---------------------------------------------------------------------------

const TMP_DIR = path.join(os.tmpdir(), "fec-bulk");

function ensureTmpDir(): void {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
}

function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const follow = (targetUrl: string): void => {
      const file = fs.createWriteStream(destPath);
      https
        .get(targetUrl, (res) => {
          const { statusCode, headers } = res;
          if (statusCode === 301 || statusCode === 302) {
            res.resume();
            file.destroy();
            follow(headers.location ?? targetUrl);
            return;
          }
          if (statusCode !== 200) {
            file.destroy();
            reject(new Error(`HTTP ${statusCode} — ${targetUrl}`));
            return;
          }
          res.pipe(file);
          file.on("finish", () => file.close(() => resolve()));
          file.on("error", (err) => {
            fs.unlink(destPath, () => undefined);
            reject(err);
          });
        })
        .on("error", (err) => {
          file.destroy();
          reject(err);
        });
    };
    follow(url);
  });
}

async function extractZip(zipPath: string, destDir: string): Promise<string[]> {
  const extracted: string[] = [];
  const directory = await unzipper.Open.file(zipPath);
  for (const entry of directory.files) {
    if (entry.type === "File") {
      const outPath = path.join(destDir, path.basename(entry.path));
      const content = await entry.buffer();
      fs.writeFileSync(outPath, content);
      extracted.push(outPath);
    }
  }
  return extracted;
}

function deleteTmpDir(): void {
  try {
    if (fs.existsSync(TMP_DIR)) {
      for (const f of fs.readdirSync(TMP_DIR)) {
        fs.unlinkSync(path.join(TMP_DIR, f));
      }
      fs.rmdirSync(TMP_DIR);
    }
  } catch {
    // non-fatal — best effort
  }
}

// ---------------------------------------------------------------------------
// Parse weball flat file
// ---------------------------------------------------------------------------

function parseMoney(raw: string | undefined): number {
  const n = parseFloat(raw ?? "0");
  return isNaN(n) ? 0 : n;
}

function parseWeBall(buffer: Buffer): WeBallRow[] {
  const records = parse(buffer.toString("latin1"), {
    delimiter:          "|",
    relax_column_count: true,
    skip_empty_lines:   true,
    quote:              false,  // FEC names contain literal quote chars — disable quoting
  }) as string[][];

  const rows: WeBallRow[] = [];
  for (const cols of records) {
    const candId = (cols[COL.CAND_ID] ?? "").trim();
    if (!candId) continue;
    rows.push({
      candId,
      candName:        (cols[COL.CAND_NAME] ?? "").trim(),
      ttlReceipts:     parseMoney(cols[COL.TTL_RECEIPTS]),
      ttlDisb:         parseMoney(cols[COL.TTL_DISB]),
      cohCop:          parseMoney(cols[COL.COH_COP]),
      candContrib:     parseMoney(cols[COL.CAND_CONTRIB]),
      candLoans:       parseMoney(cols[COL.CAND_LOANS]),
      otherLoans:      parseMoney(cols[COL.OTHER_LOANS]),
      indivContrib:    parseMoney(cols[COL.TTL_INDIV_CONTRIB]),
      polPtyContrib:   parseMoney(cols[COL.POL_PTY_CONTRIB]),
      cvrdHarReceipts: parseMoney(cols[COL.OTHER_POL_CMTE_CONTRIB]),
      candOfficeSt:    (cols[COL.CAND_OFFICE_ST] ?? "").trim().toUpperCase(),
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Name normalization for fuzzy matching
// ---------------------------------------------------------------------------

/** "SMITH, JOHN A" → { last: "SMITH", first: "JOHN" } */
function parseFecName(candName: string): { last: string; first: string } {
  const commaIdx = candName.indexOf(",");
  if (commaIdx < 0) return { last: candName.toUpperCase().trim(), first: "" };
  const last  = candName.slice(0, commaIdx).toUpperCase().trim();
  const parts = candName.slice(commaIdx + 1).trim().split(/\s+/);
  return { last, first: (parts[0] ?? "").toUpperCase() };
}

function normalizeLastName(name: string | null): string {
  return (name ?? "").toUpperCase().replace(/[^A-Z]/g, "");
}

// ---------------------------------------------------------------------------
// Match FEC rows to our officials
// ---------------------------------------------------------------------------

async function loadOfficials(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any
): Promise<OfficialRecord[]> {
  const { data, error } = await db
    .from("officials")
    .select("id, full_name, last_name, source_ids, jurisdictions!jurisdiction_id(short_name)")
    .eq("is_active", true);

  if (error) throw new Error(`Could not load officials: ${error.message}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((o: any) => ({
    id:         o.id as string,
    full_name:  o.full_name as string,
    last_name:  (o.last_name as string | null) ?? null,
    source_ids: (o.source_ids ?? {}) as Record<string, string>,
    state:      (o.jurisdictions?.short_name as string | null) ?? null,
  }));
}

interface MatchIndex {
  byFecId:    Map<string, string>;      // fecId → officialId
  byLastName: Map<string, OfficialRecord[]>; // normalizedLast → officials
}

function buildMatchIndex(officials: OfficialRecord[]): MatchIndex {
  const byFecId    = new Map<string, string>();
  const byLastName = new Map<string, OfficialRecord[]>();

  for (const o of officials) {
    // Support both key names (new = fec_id, legacy = fec_candidate_id)
    const fecId = o.source_ids["fec_id"] ?? o.source_ids["fec_candidate_id"];
    if (fecId) byFecId.set(fecId, o.id);

    const key  = normalizeLastName(o.last_name ?? o.full_name);
    const list = byLastName.get(key) ?? [];
    list.push(o);
    byLastName.set(key, list);
  }

  return { byFecId, byLastName };
}

interface MatchResult {
  officialId: string;
  fecId:      string;
  byFecId:    boolean;
}

function matchRow(row: WeBallRow, index: MatchIndex): MatchResult | null {
  // 1. Direct stored fec_id match
  const directId = index.byFecId.get(row.candId);
  if (directId) return { officialId: directId, fecId: row.candId, byFecId: true };

  // 2. Name fuzzy match
  const { last, first } = parseFecName(row.candName);
  const key       = last.replace(/[^A-Z]/g, "");
  const candidates = index.byLastName.get(key) ?? [];
  if (candidates.length === 0) return null;

  // Narrow by state if available
  const statePool =
    row.candOfficeSt
      ? candidates.filter((c) => (c.state ?? "").toUpperCase() === row.candOfficeSt)
      : candidates;
  const pool = statePool.length > 0 ? statePool : candidates;

  if (pool.length === 1) return { officialId: pool[0].id, fecId: row.candId, byFecId: false };

  // Further narrow by first-name prefix
  if (first.length >= 3) {
    const firstPool = pool.filter((c) =>
      c.full_name.toUpperCase().split(/\s+/).some((p) => p.startsWith(first.slice(0, 3)))
    );
    if (firstPool.length === 1) return { officialId: firstPool[0].id, fecId: row.candId, byFecId: false };
  }

  return null; // ambiguous — skip
}

// ---------------------------------------------------------------------------
// Upsert financial_relationships (manual select → insert/update for safety)
// ---------------------------------------------------------------------------

async function upsertFinancial(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  record: FinancialInsert
): Promise<"inserted" | "updated" | "failed"> {
  try {
    const { data: existing, error: selErr } = await db
      .from("financial_relationships")
      .select("id")
      .eq("official_id", record.official_id)
      .eq("donor_name",  record.donor_name)
      .eq("cycle_year",  record.cycle_year)
      .maybeSingle();

    if (selErr) {
      console.error("    upsert select error:", selErr.message);
      return "failed";
    }

    if (existing) {
      const { error } = await db
        .from("financial_relationships")
        .update({
          amount_cents: record.amount_cents,
          source_ids:   record.source_ids,
          updated_at:   new Date().toISOString(),
        })
        .eq("id", existing.id);
      return error ? "failed" : "updated";
    } else {
      const { error } = await db.from("financial_relationships").insert(record);
      return error ? "failed" : "inserted";
    }
  } catch {
    return "failed";
  }
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

export async function runFecBulkPipeline(): Promise<PipelineResult> {
  console.log("\n=== FEC bulk data pipeline ===");
  const logId = await startSync("fec_bulk");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any;

  let inserted = 0, updated = 0, failed = 0;
  let matchedByFecId = 0, matchedByName = 0, notMatched = 0;
  let connectionsCreated = 0;
  let totalFileMb = "0";
  let tempFreedMb = "0";

  try {
    // ── Step 1: Download bulk files ──────────────────────────────────────────
    console.log("\n  [1/6] Downloading FEC bulk files...");
    ensureTmpDir();

    const CYCLE = "2024";
    const bulkFiles = [
      {
        url:  `https://www.fec.gov/files/bulk-downloads/${CYCLE}/weball${CYCLE.slice(2)}.zip`,
        name: `weball${CYCLE.slice(2)}.zip`,
      },
      {
        url:  `https://www.fec.gov/files/bulk-downloads/${CYCLE}/cm${CYCLE.slice(2)}.zip`,
        name: `cm${CYCLE.slice(2)}.zip`,
      },
    ];

    for (const f of bulkFiles) {
      const destPath = path.join(TMP_DIR, f.name);
      console.log(`    Downloading ${f.name}...`);
      await downloadFile(f.url, destPath);
      const sizeMb = (fs.statSync(destPath).size / 1024 / 1024).toFixed(1);
      console.log(`    ✓ ${f.name} (${sizeMb} MB)`);
    }

    // ── Step 2: Extract and parse weball ────────────────────────────────────
    console.log("\n  [2/6] Extracting and parsing candidate summary...");
    const weballZip  = path.join(TMP_DIR, `weball${CYCLE.slice(2)}.zip`);
    const extracted  = await extractZip(weballZip, TMP_DIR);
    const weballFile = extracted.find(
      (f) => path.basename(f).toLowerCase().startsWith("weball") && f.endsWith(".txt")
    );
    if (!weballFile) throw new Error("weball .txt not found inside zip");

    const weballBuf  = fs.readFileSync(weballFile);
    const weballRows = parseWeBall(weballBuf);
    totalFileMb = (weballBuf.byteLength / 1024 / 1024).toFixed(1);
    console.log(`    Parsed ${weballRows.length} candidate rows (${totalFileMb} MB)`);

    // ── Step 3: Load officials + build match index ───────────────────────────
    console.log("\n  [3/6] Loading officials and matching to FEC candidates...");
    const officials = await loadOfficials(db);
    const index     = buildMatchIndex(officials);
    const officialMap = new Map(officials.map((o) => [o.id, o]));
    console.log(`    Loaded ${officials.length} active officials`);

    const matches: Array<{ row: WeBallRow; match: MatchResult }> = [];
    const newFecIds: Array<{ officialId: string; fecId: string }> = [];

    for (const row of weballRows) {
      const match = matchRow(row, index);
      if (!match) { notMatched++; continue; }

      matches.push({ row, match });

      if (match.byFecId) {
        matchedByFecId++;
      } else {
        matchedByName++;
        // Persist newly discovered fec_id into the index so later rows don't double-match
        index.byFecId.set(match.fecId, match.officialId);
        newFecIds.push({ officialId: match.officialId, fecId: match.fecId });
      }
    }

    console.log(`    Matched by fec_id: ${matchedByFecId}`);
    console.log(`    Matched by name:   ${matchedByName}`);
    console.log(`    Not matched:       ${notMatched}`);

    // Persist newly discovered fec_ids back into officials.source_ids
    if (newFecIds.length > 0) {
      console.log(`    Storing ${newFecIds.length} new fec_id associations...`);
      for (const { officialId, fecId } of newFecIds) {
        const o = officialMap.get(officialId);
        if (!o) continue;
        await db
          .from("officials")
          .update({ source_ids: { ...o.source_ids, fec_id: fecId } })
          .eq("id", officialId);
      }
    }

    // ── Step 4: Insert financial_relationships ──────────────────────────────
    console.log("\n  [4/6] Inserting financial_relationships...");

    for (const { row, match } of matches) {
      const base = {
        official_id: match.officialId,
        cycle_year:  parseInt(CYCLE, 10),
        source_url:  `https://www.fec.gov/data/candidate/${match.fecId}/`,
        source_ids:  { fec_id: match.fecId, source_system: "fec_bulk" },
      };

      const contributions: Array<{ donorName: string; donorType: DonorType; amountDollars: number }> = [
        {
          donorName:     "Individual Contributors",
          donorType:     "individual",
          amountDollars: row.indivContrib,
        },
        {
          donorName:     "PAC/Committee Contributions",
          donorType:     "pac",
          amountDollars: row.cvrdHarReceipts,
        },
        {
          donorName:     "Party Contributions",
          donorType:     "party_committee",
          amountDollars: row.polPtyContrib,
        },
        {
          donorName:     "Self-Funded (Candidate)",
          donorType:     "individual",
          amountDollars: row.candContrib,
        },
      ];

      for (const contrib of contributions) {
        if (contrib.amountDollars <= 0) continue;

        const record: FinancialInsert = {
          ...base,
          donor_name:   contrib.donorName,
          donor_type:   contrib.donorType,
          amount_cents: Math.round(contrib.amountDollars * 100),
        };

        const outcome = await upsertFinancial(db, record);
        if (outcome === "inserted") inserted++;
        else if (outcome === "updated") updated++;
        else failed++;
      }
    }

    console.log(`    Inserted: ${inserted}  Updated: ${updated}  Failed: ${failed}`);

    // ── Step 5: Cleanup ──────────────────────────────────────────────────────
    console.log("\n  [5/6] Cleaning up temp files...");
    const tmpBytes = fs.readdirSync(TMP_DIR).reduce(
      (acc, f) => acc + fs.statSync(path.join(TMP_DIR, f)).size,
      0
    );
    tempFreedMb = (tmpBytes / 1024 / 1024).toFixed(1);
    deleteTmpDir();
    console.log(`    Freed ~${tempFreedMb} MB ✓`);

    // ── Step 6: Re-run connections pipeline ─────────────────────────────────
    console.log("\n  [6/6] Re-running entity connections pipeline...");
    const connResult   = await runConnectionsPipeline();
    connectionsCreated = connResult.inserted;

    // ── Report ───────────────────────────────────────────────────────────────
    console.log("\n  ──────────────────────────────────────────────────");
    console.log("  FEC Bulk Pipeline Report");
    console.log("  ──────────────────────────────────────────────────");
    console.log(`  ${"Officials matched by fec_id:".padEnd(36)} ${matchedByFecId}`);
    console.log(`  ${"Officials matched by name:".padEnd(36)} ${matchedByName}`);
    console.log(`  ${"Officials not matched:".padEnd(36)} ${notMatched}`);
    console.log(`  ${"Financial rows inserted:".padEnd(36)} ${inserted}`);
    console.log(`  ${"Financial rows updated:".padEnd(36)} ${updated}`);
    console.log(`  ${"Financial rows failed:".padEnd(36)} ${failed}`);
    console.log(`  ${"Donation connections created:".padEnd(36)} ${connectionsCreated}`);
    console.log(`  ${"Total financial data:".padEnd(36)} ~${totalFileMb} MB`);
    console.log(`  ${"Temp files deleted:".padEnd(36)} ✓`);

    // Sanity check — top 5 officials by individual contributions
    const { data: top5 } = await db
      .from("financial_relationships")
      .select("official_id, amount_cents, officials!official_id(full_name)")
      .eq("cycle_year",  parseInt(CYCLE, 10))
      .eq("donor_name",  "Individual Contributors")
      .order("amount_cents", { ascending: false })
      .limit(5);

    if (top5 && top5.length > 0) {
      console.log("\n  Top 5 officials by individual contributions (sanity check):");
      for (const row of top5) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const name = (row as any).officials?.full_name ?? "Unknown";
        const amt  = `$${(Number(row.amount_cents) / 100).toLocaleString()}`;
        console.log(`    ${String(name).padEnd(40)} ${amt}`);
      }
    }

    const result: PipelineResult = {
      inserted,
      updated,
      failed,
      estimatedMb: parseFloat(totalFileMb),
    };
    await completeSync(logId, result);
    return result;

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("  FEC bulk pipeline fatal error:", msg);
    deleteTmpDir(); // best-effort cleanup even on error
    await failSync(logId, msg);
    return { inserted, updated, failed, estimatedMb: 0 };
  }
}

// ---------------------------------------------------------------------------
// Standalone entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  (async () => {
    try {
      await runFecBulkPipeline();
      process.exit(0);
    } catch (err) {
      console.error("Fatal:", err);
      process.exit(1);
    }
  })();
}