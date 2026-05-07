/**
 * OPM FedScope → agencies.personnel_fte — FIX-214.
 *
 * Downloads the OPM quarterly Employment cube (CPDF extract), aggregates
 * employment headcount by toptier agency code, and writes the total to
 * agencies.personnel_fte.
 *
 * URL discovery order:
 *   1. OPM_FEDSCOPE_URL env var — use exactly as given (for manual override
 *      or testing with a locally-cached file)
 *   2. Computed URL based on the most-recently-completed OPM quarter:
 *      https://www.fedscope.opm.gov/datadefn/EMPLOYMENT{YYYYMM}.zip
 *      OPM updates quarterly (March / June / September / December).
 *
 * Agency code mapping:
 *   OPM AGYSUB column = 6-char code; first 4 chars = toptier agency code.
 *   These differ from USASpending toptier codes (3-digit numbers) and our
 *   agencies.usaspending_agency_id. We join via two strategies:
 *   1. Static OPM_TO_USAS_CODE mapping table for the top ~20 agencies.
 *   2. Normalised-name fallback using the DTAGY lookup file inside the ZIP.
 *
 * Run:
 *   pnpm --filter @civitics/data data:opm-fte
 *   OPM_FEDSCOPE_URL=https://... pnpm --filter @civitics/data data:opm-fte
 */

import { createAdminClient } from "@civitics/db";
import { completeSync, failSync, startSync, type PipelineResult } from "../sync-log";
import unzipper from "unzipper";
import { Readable } from "stream";

// ---------------------------------------------------------------------------
// OPM toptier code → USASpending toptier code mapping
// (OPM 4-char alpha codes → our agencies.usaspending_agency_id values)
// ---------------------------------------------------------------------------

const OPM_TO_USAS_CODE: Record<string, string> = {
  // Dept of Agriculture
  "AG00": "12",
  // Dept of Commerce
  "CM00": "13",
  // Dept of Defense (aggregate — individual components listed separately in OPM)
  "DD00": "97",
  // Dept of Education
  "ED00": "91",
  // Dept of Energy
  "DN00": "89",
  // Dept of Health and Human Services
  "HE00": "75",
  // Dept of Homeland Security
  "HS00": "70",
  // Dept of Housing and Urban Development
  "HU00": "86",
  // Dept of the Interior
  "IN00": "14",
  // Dept of Justice
  "JU00": "15",
  // Dept of Labor
  "LB00": "16",
  // Dept of State
  "ST00": "19",
  // Dept of Transportation
  "TD00": "69",
  // Dept of the Treasury
  "TR00": "20",
  // Dept of Veterans Affairs
  "VA00": "36",
  // Environmental Protection Agency
  "EP00": "68",
  // NASA
  "NN00": "80",
  // National Science Foundation
  "NS00": "49",
  // Small Business Administration
  "SB00": "73",
  // Social Security Administration
  "SS00": "28",
  // Office of Personnel Management
  "PM00": "27",
  // General Services Administration
  "GS00": "47",
  // Federal Trade Commission
  "FT00": "29",
  // Federal Communications Commission
  "CC00": "422",
  // Securities and Exchange Commission
  "SE00": "438",
  // Nuclear Regulatory Commission
  "RC00": "443",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Returns the YYYYMM string for the most recently completed OPM quarter. */
function latestOpmQuarterYYYYMM(): string {
  const now = new Date();
  const month = now.getMonth() + 1; // 1–12
  const year = now.getFullYear();
  // OPM quarterly data: March=03, June=06, September=09, December=12.
  // Allow 6 weeks for OPM to publish after quarter end.
  const completedQuarters = [
    { m: 3,  lag: 6 },
    { m: 6,  lag: 6 },
    { m: 9,  lag: 6 },
    { m: 12, lag: 6 },
  ];
  for (const q of [...completedQuarters].reverse()) {
    const publishMonth = q.m + q.lag / 4;
    if (month > publishMonth || (month === q.m && now.getDate() > 14)) {
      return `${year}${String(q.m).padStart(2, "0")}`;
    }
  }
  // Fall back to December of prior year
  return `${year - 1}12`;
}

async function tryFetchZip(url: string): Promise<Buffer | null> {
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "Civitics/1.0 (civic data platform; contact@civitics.com)" },
      redirect: "follow",
    });
    if (!resp.ok) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    // Sanity check: ZIP magic bytes PK (0x50 0x4B)
    if (buf[0] !== 0x50 || buf[1] !== 0x4b) return null;
    return buf;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// ZIP parsing — returns { agencyName: fte } and OPM code tables
// ---------------------------------------------------------------------------

interface ParsedEmployment {
  fteByOpmCode: Map<string, number>;    // toptier OPM code (4 chars) → total FTE
  opmCodeToName: Map<string, string>;   // OPM code → agency name from DTAGY
}

async function parseEmploymentZip(buf: Buffer): Promise<ParsedEmployment> {
  const fteByOpmCode = new Map<string, number>();
  const opmCodeToName = new Map<string, string>();

  const zip = await unzipper.Open.buffer(buf);

  // ── Parse DTAGY (agency name lookup) if present ──────────────────────────
  const agencyLookupFile = zip.files.find(
    (f) => /dtagy/i.test(f.path) || /agency/i.test(f.path) && f.path.endsWith(".txt")
  );
  if (agencyLookupFile) {
    const content = (await agencyLookupFile.buffer()).toString("utf8");
    for (const line of content.split(/\r?\n/)) {
      const parts = line.split("|");
      if (parts.length >= 2) {
        const code = (parts[0] ?? "").trim().toUpperCase();
        const name = (parts[1] ?? "").trim();
        if (code && name) opmCodeToName.set(code, name);
      }
    }
    console.log(`    Agency lookup: ${opmCodeToName.size} OPM agency codes`);
  }

  // ── Parse employment data file ────────────────────────────────────────────
  // File naming varies by OPM release; look for the largest .txt file in the
  // ZIP that isn't a lookup table.
  const dataFiles = zip.files
    .filter((f) => f.path.toLowerCase().endsWith(".txt") && !/dtagy|dtloc|dtagylvl/i.test(f.path))
    .sort((a, b) => b.uncompressedSize - a.uncompressedSize);

  if (dataFiles.length === 0) {
    console.warn("    No employment data file found in ZIP");
    return { fteByOpmCode, opmCodeToName };
  }

  const dataFile = dataFiles[0];
  console.log(`    Parsing employment file: ${dataFile.path} (${(dataFile.uncompressedSize / 1024 / 1024).toFixed(1)} MB)`);

  const stream = dataFile.stream() as unknown as Readable;
  let partial = "";
  let lineCount = 0;
  let errorCount = 0;

  await new Promise<void>((resolve, reject) => {
    stream.on("data", (chunk: Buffer | string) => {
      const text = partial + chunk.toString("utf8");
      const lines = text.split(/\r?\n/);
      partial = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        lineCount++;

        // CPDF employment cube: pipe-delimited fields.
        // Field order varies by OPM release but AGYSUB is always first and
        // EMPLOYMENT is always the last numeric field.
        const parts = line.split("|");
        if (parts.length < 2) { errorCount++; continue; }

        const agysub = (parts[0] ?? "").trim().toUpperCase();
        const empRaw = (parts[parts.length - 1] ?? "").trim();
        const emp = parseInt(empRaw, 10);

        if (!agysub || isNaN(emp) || emp <= 0) { errorCount++; continue; }

        // Toptier code = first 4 chars of AGYSUB
        const toptierCode = agysub.slice(0, 4);
        fteByOpmCode.set(toptierCode, (fteByOpmCode.get(toptierCode) ?? 0) + emp);
      }
    });
    stream.on("end", () => {
      // Process any remaining partial line
      if (partial.trim()) {
        const parts = partial.split("|");
        if (parts.length >= 2) {
          const agysub = (parts[0] ?? "").trim().toUpperCase().slice(0, 4);
          const emp = parseInt(parts[parts.length - 1] ?? "0", 10);
          if (agysub && !isNaN(emp) && emp > 0) {
            fteByOpmCode.set(agysub, (fteByOpmCode.get(agysub) ?? 0) + emp);
          }
        }
      }
      resolve();
    });
    stream.on("error", reject);
  });

  console.log(`    Employment lines: ${lineCount.toLocaleString()}, errors: ${errorCount}, unique toptier codes: ${fteByOpmCode.size}`);
  return { fteByOpmCode, opmCodeToName };
}

// ---------------------------------------------------------------------------
// Match OPM codes to DB agencies and write personnel_fte
// ---------------------------------------------------------------------------

async function applyFteToAgencies(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  fteByOpmCode: Map<string, number>,
  opmCodeToName: Map<string, string>,
  result: PipelineResult
): Promise<void> {
  // Load all federal agencies
  const { data: agencies, error } = await db
    .from("agencies")
    .select("id, name, acronym, short_name, usaspending_agency_id")
    .eq("agency_type", "federal");
  if (error) throw new Error(error.message);

  // Build USASpending code → agency map
  const agencyByUsasCode = new Map<string, { id: string; name: string }>();
  const agencyByNormName = new Map<string, { id: string; name: string }>();
  for (const a of agencies ?? []) {
    if (a.usaspending_agency_id) agencyByUsasCode.set(String(a.usaspending_agency_id), a);
    agencyByNormName.set(normalizeName(a.name), a);
    if (a.acronym) agencyByNormName.set(normalizeName(a.acronym), a);
    if (a.short_name) agencyByNormName.set(normalizeName(a.short_name), a);
  }

  // Also build OPM name → agency map from DTAGY lookup
  const agencyByOpmName = new Map<string, { id: string; name: string }>();
  for (const [opmCode, opmName] of opmCodeToName) {
    const normOpmName = normalizeName(opmName);
    const match = agencyByNormName.get(normOpmName);
    if (match) agencyByOpmName.set(opmCode, match);
  }

  let matched = 0;
  let unmatched = 0;

  for (const [opmCode, fte] of fteByOpmCode) {
    // Aggregated code (like "AF00" for all AF components) maps to one toptier agency
    let agency: { id: string; name: string } | undefined;

    // 1. Static code mapping
    const usasCode = OPM_TO_USAS_CODE[opmCode];
    if (usasCode) agency = agencyByUsasCode.get(usasCode);

    // 2. OPM name lookup (from DTAGY file in ZIP)
    if (!agency) agency = agencyByOpmName.get(opmCode);

    // 3. Direct OPM code as name fragment (last-ditch normalised match)
    if (!agency) {
      const opmName = opmCodeToName.get(opmCode) ?? "";
      if (opmName) agency = agencyByNormName.get(normalizeName(opmName));
    }

    if (!agency) { unmatched++; continue; }

    const { error: updErr } = await db
      .from("agencies")
      .update({ personnel_fte: fte, updated_at: new Date().toISOString() })
      .eq("id", agency.id);
    if (updErr) {
      result.failed++;
    } else {
      result.updated++;
      matched++;
    }
  }

  console.log(`    Matched: ${matched} agencies updated, ${unmatched} OPM codes unmatched`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runOpmFtePipeline(): Promise<PipelineResult> {
  console.log("\n=== OPM FedScope FTE pipeline (FIX-214) ===");

  const logId = await startSync("opm_fte");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any;
  const result: PipelineResult = { inserted: 0, updated: 0, failed: 0, estimatedMb: 0 };

  try {
    // Determine source URL
    const envUrl = process.env["OPM_FEDSCOPE_URL"];
    const computedYYYYMM = latestOpmQuarterYYYYMM();
    const candidateUrls = envUrl
      ? [envUrl]
      : [
          `https://www.fedscope.opm.gov/datadefn/EMPLOYMENT${computedYYYYMM}.zip`,
          `https://www.fedscope.opm.gov/datadefn/EMPDATA${computedYYYYMM}.zip`,
          // Try previous quarter as fallback
          `https://www.fedscope.opm.gov/datadefn/EMPLOYMENT${computedYYYYMM.slice(0, 4)}${String(Number(computedYYYYMM.slice(4)) - 3).padStart(2, "0")}.zip`,
        ];

    let zipBuf: Buffer | null = null;
    let usedUrl = "";
    for (const url of candidateUrls) {
      console.log(`  Trying: ${url}`);
      zipBuf = await tryFetchZip(url);
      if (zipBuf) { usedUrl = url; break; }
    }

    if (!zipBuf) {
      console.warn(
        "  Could not fetch OPM employment cube. Set OPM_FEDSCOPE_URL to the ZIP file URL\n" +
        "  (download from https://www.fedscope.opm.gov/ or https://fwd.opm.gov/)."
      );
      await failSync(logId, "OPM FedScope ZIP not accessible — set OPM_FEDSCOPE_URL");
      return result;
    }

    console.log(`  Fetched ${(zipBuf.length / 1024 / 1024).toFixed(1)} MB from ${usedUrl}`);
    result.estimatedMb = zipBuf.length / 1024 / 1024;

    const { fteByOpmCode, opmCodeToName } = await parseEmploymentZip(zipBuf);
    await applyFteToAgencies(db, fteByOpmCode, opmCodeToName, result);

    await completeSync(logId, result);
    console.log(`\n  ✓ Done. Updated: ${result.updated}, failed: ${result.failed}`);
    return result;
  } catch (err) {
    await failSync(logId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

if (require.main === module) {
  runOpmFtePipeline()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
