/**
 * FEC individual contributions (indiv{yy}.zip) — FIX-181.
 *
 * Each cycle's indiv file is ~2 GB compressed (~10 GB uncompressed) and
 * contains every itemized individual contribution to FEC-registered
 * committees for the cycle. Roughly 30M rows for a presidential cycle.
 *
 * Unlike pas2, indiv rows reference the recipient committee (CMTE_ID)
 * rather than the candidate (CAND_ID), so we need ccl{yy}.zip — the
 * candidate-committee linkage file — to map CMTE_ID → CAND_ID. We only
 * keep principal ('P') and authorized ('A') committees, which covers
 * virtually all individual contribution flow.
 *
 * Donor identity: indiv has no donor ID. We dedupe on
 *   fingerprint = upper(NAME) collapsed + "|" + ZIP5
 * which is FEC's own near-duplicate convention. canonical_name embeds the
 * fingerprint so the existing UNIQUE(canonical_name, entity_type='individual')
 * dedup contract is honored.
 *
 * Memory: streams the file line-by-line, but holds the per-cycle
 * aggregation map in RAM. Empirical peak ~500 MB for a presidential
 * cycle. If you hit OOM, bump heap with NODE_OPTIONS=--max-old-space-size=4096.
 */

import * as fs       from "fs";
import * as path     from "path";
import * as readline from "readline";
import { extractZipEntryToDisk } from "./util";

// ---------------------------------------------------------------------------
// Column maps
// ---------------------------------------------------------------------------

// indiv pipe-delimited column indices (0-based). Ref:
// https://www.fec.gov/campaign-finance-data/contributions-individuals-file-description/
const INDIV_COL = {
  CMTE_ID:         0,
  TRANSACTION_TP:  5,
  ENTITY_TP:       6,
  NAME:            7,
  CITY:            8,
  STATE:           9,
  ZIP_CODE:        10,
  EMPLOYER:        11,
  OCCUPATION:      12,
  TRANSACTION_DT:  13,
  TRANSACTION_AMT: 14,
} as const;

// ccl pipe-delimited column indices. Ref:
// https://www.fec.gov/campaign-finance-data/candidate-committee-linkage-file-description/
const CCL_COL = {
  CAND_ID:   0,
  CMTE_ID:   3,
  CMTE_TP:   4,
  CMTE_DSGN: 5,
} as const;

// Transaction types we keep:
//   '15'  direct individual contribution
//   '15E' earmarked through a conduit (ActBlue, WinRed, etc.) — still attributed to individual
// Excluded: '15J' memo, '15T' passthrough (would double-count), refunds, transfers.
const KEEP_TX_TYPES = new Set(["15", "15E"]);

// FEC's itemization floor. Same threshold the pas2 pipeline uses post-FIX-182.
const MIN_AMT_DOLLARS = 200;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface IndivAggregation {
  donorFingerprint: string;
  candId:           string;
  totalCents:       number;
  txCount:          number;
  latestDate:       string | null; // raw MMDDYYYY
}

export interface IndivDonorMeta {
  fingerprint: string;
  displayName: string;
  city:        string;
  state:       string;
  zip5:        string;
  employer:    string;
  occupation:  string;
}

export interface IndivStreamResult {
  aggregations: Map<string, IndivAggregation>; // key = `${fingerprint}|${candId}`
  donorMetas:   Map<string, IndivDonorMeta>;   // key = fingerprint
  stats: {
    linesRead:    number;
    passedTxType: number;
    passedCmte:   number;
    passedCand:   number;
    passedAmt:    number;
  };
}

// ---------------------------------------------------------------------------
// ccl parser
// ---------------------------------------------------------------------------

/**
 * Build the CMTE_ID → CAND_ID lookup. Multi-committee candidates (a
 * principal + several authorized) all collapse to the same CAND_ID, so an
 * indiv contribution to any of those committees attributes correctly.
 *
 * Excludes joint-fundraising and leadership committees (CMTE_DSGN ∈ {J, D, B})
 * because their donations are split downstream and would double-count if we
 * also pulled them in here.
 */
export function parseCcl(buffer: Buffer): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const line of buffer.toString("latin1").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols     = line.split("|");
    const candId   = (cols[CCL_COL.CAND_ID]   ?? "").trim();
    const cmteId   = (cols[CCL_COL.CMTE_ID]   ?? "").trim();
    const cmteDsgn = (cols[CCL_COL.CMTE_DSGN] ?? "").trim().toUpperCase();
    if (!candId || !cmteId) continue;
    if (cmteDsgn !== "P" && cmteDsgn !== "A") continue;
    if (!lookup.has(cmteId)) lookup.set(cmteId, candId);
  }
  return lookup;
}

// ---------------------------------------------------------------------------
// Donor fingerprinting
// ---------------------------------------------------------------------------

function normalizeName(raw: string): string {
  return (raw ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function zip5Of(raw: string): string {
  const s = (raw ?? "").trim();
  return s.length >= 5 ? s.slice(0, 5) : s;
}

export function donorFingerprint(name: string, zip5: string): string {
  const n = normalizeName(name);
  const z = zip5Of(zip5);
  return z ? `${n}|${z}` : n;
}

// ---------------------------------------------------------------------------
// Stream indiv{yy}.zip → in-memory aggregations
// ---------------------------------------------------------------------------

export async function streamIndiv(
  zipPath:      string,
  cmteToCandId: Map<string, string>,
  candidateSet: Set<string>,
  tempDir:      string,
): Promise<IndivStreamResult> {
  const txtPath = path.join(tempDir, "indiv-extracted.txt");
  const found = await extractZipEntryToDisk(
    zipPath,
    (name) => name.startsWith("itcont") || (name.startsWith("indiv") && name.endsWith(".txt")),
    txtPath,
  );
  if (!found) {
    throw new Error(`indiv .txt entry not found inside ${zipPath} (looked for itcont*.txt or indiv*.txt)`);
  }

  const txtMb = (fs.statSync(txtPath).size / 1024 / 1024).toFixed(0);
  console.log(`    Extracted indiv text (${txtMb} MB) — streaming line by line...`);

  const aggregations = new Map<string, IndivAggregation>();
  const donorMetas   = new Map<string, IndivDonorMeta>();

  let linesRead = 0, passedTxType = 0, passedCmte = 0, passedCand = 0, passedAmt = 0;

  const rl = readline.createInterface({
    input:     fs.createReadStream(txtPath, { encoding: "latin1" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    linesRead++;
    if (linesRead % 1_000_000 === 0) {
      console.log(
        `    ... ${linesRead.toLocaleString()} lines | ` +
        `${aggregations.size.toLocaleString()} pairs | ` +
        `${donorMetas.size.toLocaleString()} donors`,
      );
    }

    const cols   = line.split("|");
    const txType = (cols[INDIV_COL.TRANSACTION_TP] ?? "").trim();
    if (!KEEP_TX_TYPES.has(txType)) continue;
    passedTxType++;

    const cmteId = (cols[INDIV_COL.CMTE_ID] ?? "").trim();
    const candId = cmteToCandId.get(cmteId);
    if (!candId) continue;
    passedCmte++;

    if (!candidateSet.has(candId)) continue;
    passedCand++;

    const amtStr = (cols[INDIV_COL.TRANSACTION_AMT] ?? "").trim();
    const amt    = parseFloat(amtStr);
    if (isNaN(amt) || amt < MIN_AMT_DOLLARS) continue;
    passedAmt++;

    const name = (cols[INDIV_COL.NAME] ?? "").trim();
    if (!name) continue;

    const zip5 = zip5Of(cols[INDIV_COL.ZIP_CODE] ?? "");
    const fp   = donorFingerprint(name, zip5);
    const dt   = (cols[INDIV_COL.TRANSACTION_DT] ?? "").trim();
    const amtCents = Math.round(amt * 100);

    if (!donorMetas.has(fp)) {
      donorMetas.set(fp, {
        fingerprint: fp,
        displayName: name,
        city:        (cols[INDIV_COL.CITY]       ?? "").trim(),
        state:       (cols[INDIV_COL.STATE]      ?? "").trim().toUpperCase(),
        zip5,
        employer:    (cols[INDIV_COL.EMPLOYER]   ?? "").trim(),
        occupation:  (cols[INDIV_COL.OCCUPATION] ?? "").trim(),
      });
    }

    const aggKey  = `${fp}|${candId}`;
    const existing = aggregations.get(aggKey);
    if (existing) {
      existing.totalCents += amtCents;
      existing.txCount++;
      if (dt && dt > (existing.latestDate ?? "")) existing.latestDate = dt;
    } else {
      aggregations.set(aggKey, {
        donorFingerprint: fp,
        candId,
        totalCents:       amtCents,
        txCount:          1,
        latestDate:       dt || null,
      });
    }
  }

  console.log(`    Lines read:                ${linesRead.toLocaleString()}`);
  console.log(`    Passed 15/15E filter:      ${passedTxType.toLocaleString()}`);
  console.log(`    Passed cmte→cand lookup:   ${passedCmte.toLocaleString()}`);
  console.log(`    Passed candidateSet:       ${passedCand.toLocaleString()}`);
  console.log(`    Passed $200+ filter:       ${passedAmt.toLocaleString()}`);
  console.log(`    Unique donors:             ${donorMetas.size.toLocaleString()}`);
  console.log(`    Donor × candidate pairs:   ${aggregations.size.toLocaleString()}`);

  try { fs.unlinkSync(txtPath); } catch { /* best effort */ }

  return { aggregations, donorMetas, stats: { linesRead, passedTxType, passedCmte, passedCand, passedAmt } };
}
