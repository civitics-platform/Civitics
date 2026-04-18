/**
 * seed-agency-websites.ts
 *
 * Populates website_url for all agencies from a hardcoded lookup table.
 * Federal agency URLs are deterministic — no API calls needed.
 *
 * Run:
 *   npx tsx scripts/seed-agency-websites.ts
 *
 * Requires:
 *   NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in your .env.local
 */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), "apps/civitics/.env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Acronym → website URL lookup
// Covers all 85 agencies currently in the DB.
// Add more as needed; update URLs if agencies rebrand.
const AGENCY_WEBSITES: Record<string, string> = {
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
  COLC:   "https://www.copyright.gov/licensing-division",
  CPSC:   "https://www.cpsc.gov",
  CRB:    "https://www.crb.gov",
  DARS:   "https://www.acq.osd.mil/dpap/dars",
  DEA:    "https://www.dea.gov",
  DNFSB:  "https://www.dnfsb.gov",
  DOC:    "https://www.commerce.gov",
  DOD:    "https://www.defense.gov",
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

async function run() {
  console.log("Fetching agencies with null website_url...");

  const { data: agencies, error } = await supabase
    .from("agencies")
    .select("id, name, acronym, website_url")
    .eq("is_active", true)
    .is("website_url", null);

  if (error) {
    console.error("Failed to fetch agencies:", error.message);
    process.exit(1);
  }

  console.log(`Found ${agencies.length} agencies with no website URL.`);

  let updated = 0;
  let skipped = 0;

  for (const agency of agencies) {
    const url = agency.acronym ? AGENCY_WEBSITES[agency.acronym] : undefined;

    if (!url) {
      console.log(`  ⬜ No URL for: ${agency.name} (${agency.acronym ?? "no acronym"})`);
      skipped++;
      continue;
    }

    const { error: updateError } = await supabase
      .from("agencies")
      .update({ website_url: url })
      .eq("id", agency.id);

    if (updateError) {
      console.error(`  ✗ Failed to update ${agency.name}:`, updateError.message);
    } else {
      console.log(`  ✓ ${agency.acronym} → ${url}`);
      updated++;
    }
  }

  console.log(`\nDone. Updated: ${updated}, Skipped (no URL known): ${skipped}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
