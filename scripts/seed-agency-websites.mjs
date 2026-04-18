/**
 * seed-agency-websites.mjs
 *
 * Populates website_url for all agencies from a hardcoded lookup table.
 * Federal agency URLs are deterministic — no API calls needed.
 *
 * Run from repo root:
 *   node scripts/seed-agency-websites.mjs
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in apps/civitics/.env.local
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Load .env.local manually (no dotenv dependency needed)
// ---------------------------------------------------------------------------

function loadEnv(filePath) {
  try {
    const content = readFileSync(filePath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // .env.local may not exist in CI — that's fine if vars are set externally
  }
}

loadEnv(resolve(__dirname, "../apps/civitics/.env.local"));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌  Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY");
  console.error("    Make sure apps/civitics/.env.local exists with those keys.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Supabase REST helpers (Node 18+ fetch — no SDK needed)
// ---------------------------------------------------------------------------

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=minimal",
};

async function supabaseSelect(table, params = "") {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, { headers });
  if (!res.ok) throw new Error(`GET ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function supabasePatch(table, filter, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${table}: ${res.status} ${await res.text()}`);
}

// ---------------------------------------------------------------------------
// Acronym → website URL lookup
// ---------------------------------------------------------------------------

const AGENCY_WEBSITES = {
  ACF:    "https://www.acf.hhs.gov",
  AMS:    "https://www.ams.usda.gov",
  APHIS:  "https://www.aphis.usda.gov",
  ATBCB:  "https://www.access-board.gov",
  BLM:    "https://www.blm.gov",
  BOEM:   "https://www.boem.gov",
  BSEE:   "https://www.bsee.gov",
  CFTC:   "https://www.cftc.gov",
  CFPB:   "https://www.consumerfinance.gov",
  CISA:   "https://www.cisa.gov",
  CMS:    "https://www.cms.gov",
  CPSC:   "https://www.cpsc.gov",
  CRB:    "https://www.crb.gov",
  DARS:   "https://www.acq.osd.mil/dpap/dars",
  DEA:    "https://www.dea.gov",
  DNFSB:  "https://www.dnfsb.gov",
  DOC:    "https://www.commerce.gov",
  DOE:    "https://www.energy.gov",
  DOI:    "https://www.doi.gov",
  DOJ:    "https://www.justice.gov",
  DOS:    "https://www.state.gov",
  DOT:    "https://www.transportation.gov",
  ED:     "https://www.ed.gov",
  EOP:    "https://www.whitehouse.gov",
  EPA:    "https://www.epa.gov",
  FAA:    "https://www.faa.gov",
  FCC:    "https://www.fcc.gov",
  FDIC:   "https://www.fdic.gov",
  FERC:   "https://www.ferc.gov",
  FISCAL: "https://www.fiscal.treasury.gov",
  FRA:    "https://www.fra.dot.gov",
  FTA:    "https://www.transit.dot.gov",
  FTC:    "https://www.ftc.gov",
  FWS:    "https://www.fws.gov",
  GSA:    "https://www.gsa.gov",
  HHS:    "https://www.hhs.gov",
  HUD:    "https://www.hud.gov",
  IRS:    "https://www.irs.gov",
  MSHA:   "https://www.msha.gov",
  NASA:   "https://www.nasa.gov",
  NCUA:   "https://www.ncua.gov",
  NIH:    "https://www.nih.gov",
  NLRB:   "https://www.nlrb.gov",
  NOAA:   "https://www.noaa.gov",
  NRC:    "https://www.nrc.gov",
  NSF:    "https://www.nsf.gov",
  OCC:    "https://www.occ.gov",
  OPM:    "https://www.opm.gov",
  OSHA:   "https://www.osha.gov",
  SEC:    "https://www.sec.gov",
  SBA:    "https://www.sba.gov",
  SSA:    "https://www.ssa.gov",
  TREAS:  "https://home.treasury.gov",
  TTB:    "https://www.ttb.gov",
  USDA:   "https://www.usda.gov",
  USCG:   "https://www.uscg.mil",
  USPS:   "https://www.usps.com",
  VA:     "https://www.va.gov",
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run() {
  console.log("Fetching agencies with null website_url...");

  const agencies = await supabaseSelect(
    "agencies",
    "select=id,name,acronym,website_url&is_active=eq.true&website_url=is.null"
  );

  console.log(`Found ${agencies.length} agencies with no website URL.\n`);

  let updated = 0;
  let skipped = 0;

  for (const agency of agencies) {
    const url = agency.acronym ? AGENCY_WEBSITES[agency.acronym] : undefined;

    if (!url) {
      console.log(`  ⬜  No URL known for: ${agency.name} (${agency.acronym ?? "no acronym"})`);
      skipped++;
      continue;
    }

    await supabasePatch("agencies", `id=eq.${agency.id}`, { website_url: url });
    console.log(`  ✓  ${agency.acronym} → ${url}`);
    updated++;
  }

  console.log(`\nDone. Updated: ${updated}  |  Skipped (no URL known): ${skipped}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
