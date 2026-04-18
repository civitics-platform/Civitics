/**
 * seed-agency-officials.mjs
 *
 * Creates entity_connections rows linking officials to agencies for testing.
 * Uses known Senate committee oversight assignments + revolving-door relationships.
 *
 * Run from repo root:
 *   node scripts/seed-agency-officials.mjs
 *
 * Safe to re-run — upserts with ignoreDuplicates on the unique triple.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in apps/civitics/.env.local
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Load .env.local manually
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
    // .env.local may not exist in CI
  }
}

// Check root first, then apps/civitics as fallback
loadEnv(resolve(__dirname, "../.env.local"));
loadEnv(resolve(__dirname, "../apps/civitics/.env.local"));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌  Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY");
  console.error("    Make sure apps/civitics/.env.local exists with those keys.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Supabase REST helpers
// ---------------------------------------------------------------------------

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};

async function supabaseSelect(table, params = "") {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, { headers });
  if (!res.ok) throw new Error(`GET ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function supabaseUpsert(table, rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`POST ${table}: ${res.status} ${await res.text()}`);
}

// ---------------------------------------------------------------------------
// Seed data — known committee oversight / revolving door relationships
// Format: { official, agency_acronym, type, strength }
//   strength: 1.0 = appointed head  0.7 = committee chair  0.5 = member  0.4 = revolving door
// ---------------------------------------------------------------------------

const SEED_CONNECTIONS = [
  // Senate Commerce Committee → FAA, FCC, DOT
  { official: "Roger F. Wicker",    agency: "FAA",  type: "oversight",      strength: 0.7 },
  { official: "Roger F. Wicker",    agency: "FCC",  type: "oversight",      strength: 0.7 },
  { official: "Roger F. Wicker",    agency: "DOT",  type: "oversight",      strength: 0.7 },
  { official: "Brian Schatz",       agency: "FCC",  type: "oversight",      strength: 0.5 },
  { official: "Brian Schatz",       agency: "DOE",  type: "oversight",      strength: 0.5 },

  // Senate Environment & Public Works → EPA, NOAA
  { official: "Sheldon Whitehouse", agency: "EPA",  type: "oversight",      strength: 0.7 },
  { official: "Sheldon Whitehouse", agency: "NOAA", type: "oversight",      strength: 0.6 },
  { official: "Edward J. Markey",   agency: "EPA",  type: "oversight",      strength: 0.6 },
  { official: "Edward J. Markey",   agency: "NOAA", type: "oversight",      strength: 0.6 },

  // Senate Banking Committee → FDIC, SEC, FTC
  { official: "Mike Rounds",        agency: "FDIC", type: "oversight",      strength: 0.7 },
  { official: "Rick Scott",         agency: "FDIC", type: "oversight",      strength: 0.6 },
  { official: "Mark R. Warner",     agency: "SEC",  type: "oversight",      strength: 0.6 },

  // Senate HELP Committee → HHS, OPM, OSHA
  { official: "Markwayne Mullin",   agency: "OPM",  type: "oversight",      strength: 0.7 },
  { official: "Markwayne Mullin",   agency: "OPM",  type: "appointment",    strength: 0.5 },
  { official: "Chris Van Hollen",   agency: "HHS",  type: "oversight",      strength: 0.6 },

  // Senate Finance → IRS
  { official: "Mike Rounds",        agency: "IRS",  type: "oversight",      strength: 0.5 },
  { official: "Charles E. Schumer", agency: "IRS",  type: "oversight",      strength: 0.5 },

  // Senate Intelligence → DOJ
  { official: "Mark R. Warner",     agency: "DOJ",  type: "oversight",      strength: 0.6 },

  // Senate Agriculture → USDA
  { official: "John Thune",         agency: "USDA", type: "oversight",      strength: 0.6 },

  // Senate Energy → DOE
  { official: "Jeanne Shaheen",     agency: "DOE",  type: "oversight",      strength: 0.6 },

  // Revolving door
  { official: "David Schweikert",   agency: "FAA",  type: "revolving_door", strength: 0.4 },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run() {
  // 1. Resolve agency acronym → ID
  const acronyms = [...new Set(SEED_CONNECTIONS.map((r) => r.agency))];
  const agencyRows = await supabaseSelect(
    "agencies",
    `select=id,acronym&acronym=in.(${acronyms.join(",")})`
  );
  const agencyByAcronym = new Map(agencyRows.map((a) => [a.acronym, a.id]));
  console.log(`Resolved ${agencyRows.length} agencies.\n`);

  // 2. Resolve official name → ID (one lookup per unique name)
  const names = [...new Set(SEED_CONNECTIONS.map((r) => r.official))];
  const officialIdMap = new Map();

  for (const name of names) {
    // URL-encode the ILIKE filter
    const param = encodeURIComponent(`%${name}%`);
    const rows = await supabaseSelect(
      "officials",
      `select=id,full_name&full_name=ilike.${param}&limit=1`
    );
    if (rows.length > 0) {
      officialIdMap.set(name, rows[0].id);
      console.log(`  ✓  Found: ${rows[0].full_name}`);
    } else {
      console.log(`  ⬜  Not found: ${name}`);
    }
  }

  // 3. Build insert rows
  const toInsert = [];
  let skipped = 0;

  for (const row of SEED_CONNECTIONS) {
    const officialId = officialIdMap.get(row.official);
    const agencyId   = agencyByAcronym.get(row.agency);

    if (!officialId || !agencyId) {
      skipped++;
      continue;
    }

    toInsert.push({
      from_type:   "official",
      from_id:     officialId,
      to_type:     "agency",
      to_id:       agencyId,
      connection_type: row.type,
      strength:    row.strength,
      is_verified: false,
      metadata:    { source: "seed-script", seed_version: "v1" },
    });
  }

  if (toInsert.length === 0) {
    console.log("\nNo rows to insert (all officials/agencies missing from DB).");
    return;
  }

  console.log(`\nInserting ${toInsert.length} connections (skipped ${skipped})...`);
  await supabaseUpsert("entity_connections", toInsert);

  console.log(`\nDone ✓`);
  console.log("\nVerify by visiting any agency page that has connected officials, e.g.:");
  console.log("  http://localhost:3000/agencies/<EPA-id>");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
