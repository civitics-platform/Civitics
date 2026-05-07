/**
 * Agency enrichment pipeline — FIX-208.
 *
 * Three passes:
 *   1. USASpending /api/v2/agency/{toptier_code}/employees/ → personnel_fte
 *   2. USA.gov Social Media Registry → metadata.{twitter_handle, youtube_handle,
 *      facebook_url, instagram_handle}
 *   3. Federal Register /api/v1/agencies.json → fill empty description/website_url
 *      + Wikidata SPARQL → founded_year, wikidata_id
 *
 * Safe to re-run: all writes are upserts or conditional updates.
 *
 * Run:
 *   pnpm --filter @civitics/data data:agency-enrichment
 *   pnpm --filter @civitics/data data:agency-enrichment -- --pass=1  (single pass)
 */

import { createAdminClient } from "@civitics/db";
import { completeSync, failSync, startSync, type PipelineResult } from "../sync-log";
import { sleep } from "../utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgencyRow {
  id: string;
  name: string;
  acronym: string | null;
  short_name: string | null;
  agency_type: string;
  description: string | null;
  website_url: string | null;
  usaspending_agency_id: string | null;
  metadata: Record<string, unknown> | null;
  wikidata_id: string | null;
  personnel_fte: number | null;
  founded_year: number | null;
}

// ---------------------------------------------------------------------------
// Pass 1: USASpending FTE
// ---------------------------------------------------------------------------

async function enrichFTE(db: ReturnType<typeof createAdminClient>, agencies: AgencyRow[], result: PipelineResult): Promise<void> {
  console.log("\n  Pass 1: USASpending FTE headcounts");
  const eligible = agencies.filter(a => a.usaspending_agency_id && !a.personnel_fte);
  console.log(`    ${eligible.length} agencies with toptier code and no FTE yet`);

  for (const agency of eligible) {
    try {
      const url = `https://api.usaspending.gov/api/v2/agency/${agency.usaspending_agency_id}/employees/`;
      const resp = await fetch(url, { headers: { accept: "application/json" } });
      if (!resp.ok) {
        console.warn(`    ${agency.acronym ?? agency.name}: FTE ${resp.status}`);
        continue;
      }
      const body = await resp.json() as { results?: Array<{ employment_type: string; count: number }> };
      const total = body.results?.find(r => r.employment_type === "Total")?.count
        ?? body.results?.reduce((s, r) => s + (r.count ?? 0), 0)
        ?? null;
      if (total == null) continue;

      const { error } = await db
        .from("agencies")
        .update({ personnel_fte: total, updated_at: new Date().toISOString() })
        .eq("id", agency.id);
      if (error) {
        console.warn(`    ${agency.acronym ?? agency.name}: FTE write failed: ${error.message}`);
        result.failed++;
      } else {
        result.updated++;
      }
    } catch (err) {
      console.warn(`    ${agency.acronym ?? agency.name}: FTE fetch error:`, err instanceof Error ? err.message : err);
    }
    await sleep(500);
  }
  console.log(`    FTE pass: ${result.updated} updated`);
}

// ---------------------------------------------------------------------------
// Pass 2: USA.gov Social Media Registry
// ---------------------------------------------------------------------------

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function enrichSocialMedia(db: ReturnType<typeof createAdminClient>, agencies: AgencyRow[], result: PipelineResult): Promise<void> {
  console.log("\n  Pass 2: USA.gov Social Media Registry");

  let registryData: Array<{
    service: string;
    account: string;
    organization_name: string;
    agencies?: Array<{ name: string }>;
  }>;

  try {
    const url = "https://registry.usa.gov/accounts.json?services[]=twitter&services[]=youtube&services[]=facebook&services[]=instagram";
    const resp = await fetch(url, { headers: { accept: "application/json" } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const body = await resp.json() as { accounts?: typeof registryData };
    registryData = body.accounts ?? [];
  } catch (err) {
    console.warn("    Social Media Registry unavailable:", err instanceof Error ? err.message : err);
    return;
  }

  console.log(`    ${registryData.length} social accounts fetched`);

  // Build name → social handles map
  const socialByName = new Map<string, Record<string, string>>();
  for (const acct of registryData) {
    const orgName = normalizeName(acct.organization_name ?? "");
    if (!orgName) continue;
    const existing = socialByName.get(orgName) ?? {};
    const serviceKey = acct.service === "twitter" ? "twitter_handle"
      : acct.service === "youtube" ? "youtube_handle"
      : acct.service === "facebook" ? "facebook_url"
      : acct.service === "instagram" ? "instagram_handle"
      : null;
    if (serviceKey) {
      // Prefer shorter / first account if duplicates
      if (!existing[serviceKey]) {
        existing[serviceKey] = acct.account;
      }
    }
    // Also index by agency sub-names if provided
    for (const sub of acct.agencies ?? []) {
      const subName = normalizeName(sub.name ?? "");
      if (subName) {
        const subExisting = socialByName.get(subName) ?? {};
        if (serviceKey && !subExisting[serviceKey]) subExisting[serviceKey] = acct.account;
        socialByName.set(subName, subExisting);
      }
    }
    socialByName.set(orgName, existing);
  }

  let matched = 0;
  for (const agency of agencies) {
    const key = normalizeName(agency.name);
    const handles = socialByName.get(key)
      ?? socialByName.get(normalizeName(agency.acronym ?? ""))
      ?? socialByName.get(normalizeName(agency.short_name ?? ""))
      ?? null;
    if (!handles) continue;

    const existing = (agency.metadata ?? {}) as Record<string, unknown>;
    const merged = { ...existing, ...handles };

    const { error } = await db
      .from("agencies")
      .update({ metadata: merged, updated_at: new Date().toISOString() })
      .eq("id", agency.id);
    if (error) {
      result.failed++;
    } else {
      result.updated++;
      matched++;
    }
  }
  console.log(`    Social media: ${matched} agencies matched`);
}

// ---------------------------------------------------------------------------
// Pass 3: Federal Register descriptions + Wikidata
// ---------------------------------------------------------------------------

interface FedRegAgency {
  name: string;
  short_name: string | null;
  display_name: string | null;
  description: string | null;
  url: string | null;
}

interface WikidataBinding {
  agency: { value: string };
  agencyLabel: { value: string };
  founded?: { value: string };
}

async function enrichFedRegAndWikidata(db: ReturnType<typeof createAdminClient>, agencies: AgencyRow[], result: PipelineResult): Promise<void> {
  console.log("\n  Pass 3: Federal Register + Wikidata");

  // ── Federal Register ────────────────────────────────────────────────────────
  let fedRegAgencies: FedRegAgency[] = [];
  try {
    const resp = await fetch("https://www.federalregister.gov/api/v1/agencies.json", {
      headers: { accept: "application/json" },
    });
    if (resp.ok) {
      fedRegAgencies = (await resp.json()) as FedRegAgency[];
      console.log(`    Federal Register: ${fedRegAgencies.length} agency records`);
    }
  } catch (err) {
    console.warn("    Federal Register unavailable:", err instanceof Error ? err.message : err);
  }

  const fedRegByName = new Map<string, FedRegAgency>();
  for (const fr of fedRegAgencies) {
    fedRegByName.set(normalizeName(fr.name), fr);
    if (fr.short_name) fedRegByName.set(normalizeName(fr.short_name), fr);
    if (fr.display_name) fedRegByName.set(normalizeName(fr.display_name), fr);
  }

  // ── Wikidata: bulk query for US federal agencies ─────────────────────────────
  // One big request — Wikidata's SPARQL endpoint supports queries up to ~1 MB.
  // P31/P279* wd:Q327333 = "is a (subclass of) government agency"
  // P17 wd:Q30 = "country = United States"
  // P571 = inception date
  const sparql = `
SELECT DISTINCT ?agency ?agencyLabel ?founded WHERE {
  {
    ?agency wdt:P31 wd:Q327333 .
    ?agency wdt:P17 wd:Q30 .
  } UNION {
    ?agency wdt:P31 wd:Q3204374 .
    ?agency wdt:P17 wd:Q30 .
  } UNION {
    ?agency wdt:P31 wd:Q2101564 .
    ?agency wdt:P17 wd:Q30 .
  }
  OPTIONAL { ?agency wdt:P571 ?founded }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
}
ORDER BY ?agencyLabel
LIMIT 3000
`.trim();

  let wikidataRows: WikidataBinding[] = [];
  try {
    await sleep(1000);
    const qs = new URLSearchParams({ query: sparql, format: "json" });
    const resp = await fetch(`https://query.wikidata.org/sparql?${qs.toString()}`, {
      headers: {
        accept: "application/sparql-results+json",
        "User-Agent": "Civitics/1.0 (civic data platform; contact@civitics.com)",
      },
    });
    if (resp.ok) {
      const body = await resp.json() as { results?: { bindings?: WikidataBinding[] } };
      wikidataRows = body.results?.bindings ?? [];
      console.log(`    Wikidata: ${wikidataRows.length} US agency bindings`);
    } else {
      console.warn(`    Wikidata SPARQL returned ${resp.status}`);
    }
  } catch (err) {
    console.warn("    Wikidata unavailable:", err instanceof Error ? err.message : err);
  }

  // Index by label
  const wikidataByLabel = new Map<string, { qid: string; founded: number | null }>();
  for (const row of wikidataRows) {
    const label = normalizeName(row.agencyLabel?.value ?? "");
    if (!label) continue;
    const qid = row.agency?.value?.replace("http://www.wikidata.org/entity/", "") ?? null;
    const foundedRaw = row.founded?.value;
    const founded = foundedRaw ? new Date(foundedRaw).getFullYear() : null;
    if (!wikidataByLabel.has(label) && qid) {
      wikidataByLabel.set(label, { qid, founded: isNaN(founded as number) ? null : founded });
    }
  }

  // ── Apply to each agency ─────────────────────────────────────────────────────
  for (const agency of agencies) {
    const update: Record<string, unknown> = {};

    // Federal Register: fill empty description / website
    const frMatch = fedRegByName.get(normalizeName(agency.name))
      ?? fedRegByName.get(normalizeName(agency.acronym ?? ""));
    if (frMatch) {
      if (!agency.description && frMatch.description?.trim()) {
        update["description"] = frMatch.description.trim();
      }
      if (!agency.website_url && frMatch.url?.trim()) {
        update["website_url"] = frMatch.url.trim();
      }
    }

    // Wikidata: founded_year, wikidata_id
    const wdMatch = wikidataByLabel.get(normalizeName(agency.name))
      ?? wikidataByLabel.get(normalizeName(agency.acronym ?? ""))
      ?? wikidataByLabel.get(normalizeName(agency.short_name ?? ""));
    if (wdMatch) {
      if (!agency.wikidata_id && wdMatch.qid) update["wikidata_id"] = wdMatch.qid;
      if (!agency.founded_year && wdMatch.founded) update["founded_year"] = wdMatch.founded;
    }

    if (Object.keys(update).length === 0) continue;
    update["updated_at"] = new Date().toISOString();

    const { error } = await db.from("agencies").update(update).eq("id", agency.id);
    if (error) {
      result.failed++;
    } else {
      result.updated++;
    }
  }
  console.log(`    Federal Register + Wikidata pass complete`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runAgencyEnrichmentPipeline(): Promise<PipelineResult> {
  const pass = process.argv.find(a => a.startsWith("--pass="))?.split("=")[1] ?? null;
  console.log("\n=== Agency enrichment pipeline ===");

  const logId = await startSync("agency_enrichment");
  const db = createAdminClient();
  const result: PipelineResult = { inserted: 0, updated: 0, failed: 0, estimatedMb: 0 };

  try {
    const { data: agencies, error } = await db
      .from("agencies")
      .select("id, name, acronym, short_name, agency_type, description, website_url, usaspending_agency_id, metadata, wikidata_id, personnel_fte, founded_year")
      .eq("agency_type", "federal");
    if (error) throw new Error(error.message);

    const rows = (agencies ?? []) as AgencyRow[];
    console.log(`  Loaded ${rows.length} federal agencies`);

    if (!pass || pass === "1") await enrichFTE(db, rows, result);
    if (!pass || pass === "2") await enrichSocialMedia(db, rows, result);
    if (!pass || pass === "3") await enrichFedRegAndWikidata(db, rows, result);

    await completeSync(logId, result);
    console.log(`\n  ✓ Done. Updated: ${result.updated}, failed: ${result.failed}`);
    return result;
  } catch (err) {
    await failSync(logId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

if (require.main === module) {
  runAgencyEnrichmentPipeline()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
