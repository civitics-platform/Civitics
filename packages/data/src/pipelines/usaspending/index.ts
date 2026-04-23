/**
 * USASpending.gov pipeline — post-cutover, writes directly to public
 * financial_entities + financial_relationships (contracts/grants).
 *
 * Pre-cutover this pipeline wrote to the legacy `spending_records` table and
 * a separate spending-shadow migration pass then moved those rows into
 * shadow.financial_relationships. spending_records was dropped at promotion;
 * this rewrite collapses both passes into one direct writer, batched.
 *
 * Data flow:
 *   1. Fetch top 100 awards >= $1M per top-20 federal agency (FY2024)
 *   2. Resolve recipient corporations via external_source_refs
 *      (source='usaspending_recipient'). Batch insert any new ones into
 *      public.financial_entities with entity_type='corporation'.
 *   3. Batch upsert public.financial_relationships with
 *      relationship_type='contract' (procurement) or 'grant' (CFDA present).
 *      Dedup via the partial unique index on usaspending_award_id.
 *
 * No API key required. Rate-limited to one request every 500ms.
 *
 * Run standalone:
 *   pnpm --filter @civitics/data data:usaspending
 */

import { createAdminClient } from "@civitics/db";
import { sleep, postJson } from "../utils";
import { startSync, completeSync, failSync, type PipelineResult } from "../sync-log";
import {
  resolveRecipients,
  upsertSpendingRelationshipsBatch,
  type SpendingRelationshipInput,
} from "./writer";
import { canonicalizeEntityName } from "../fec-bulk/writer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AwardResult {
  "Award ID":                          string | null;
  "Recipient Name":                    string | null;
  "Award Amount":                      number | null;
  "Award Type":                        string | null;
  "Action Date":                       string | null;
  "Awarding Agency":                   string | null;
  "Description":                       string | null;
  "Place of Performance State Code":   string | null;
  "Period of Performance Start Date":  string | null;
  "Period of Performance Current End Date": string | null;
  "NAICS Code":                        string | null;
  "CFDA Number":                       string | null;
}

interface AwardSearchResponse {
  results: AwardResult[];
  page_metadata: { total: number; page: number; limit: number; next?: string };
}

// ---------------------------------------------------------------------------
// Top 20 agencies
// ---------------------------------------------------------------------------

const TOP_AGENCIES: Array<{ name: string; acronym: string }> = [
  { name: "Department of Defense",                         acronym: "DOD"   },
  { name: "Department of Health and Human Services",       acronym: "HHS"   },
  { name: "Department of Energy",                          acronym: "DOE"   },
  { name: "National Aeronautics and Space Administration", acronym: "NASA"  },
  { name: "Department of Transportation",                  acronym: "DOT"   },
  { name: "Department of Agriculture",                     acronym: "USDA"  },
  { name: "Department of Justice",                         acronym: "DOJ"   },
  { name: "Department of Homeland Security",               acronym: "DHS"   },
  { name: "Department of Veterans Affairs",                acronym: "VA"    },
  { name: "Department of Commerce",                        acronym: "DOC"   },
  { name: "Department of the Treasury",                    acronym: "TREAS" },
  { name: "Department of State",                           acronym: "DOS"   },
  { name: "Environmental Protection Agency",               acronym: "EPA"   },
  { name: "Department of the Interior",                    acronym: "DOI"   },
  { name: "Department of Labor",                           acronym: "DOL"   },
  { name: "Department of Education",                       acronym: "ED"    },
  { name: "Department of Housing and Urban Development",   acronym: "HUD"  },
  { name: "Small Business Administration",                 acronym: "SBA"   },
  { name: "General Services Administration",               acronym: "GSA"   },
  { name: "Social Security Administration",                acronym: "SSA"   },
];

// FY2024: Oct 1 2023 → Sep 30 2024
const FY_START = "2023-10-01";
const FY_END   = "2024-09-30";

const USA_BASE = "https://api.usaspending.gov/api/v2";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function searchAwards(agencyName: string): Promise<AwardResult[]> {
  await sleep(500);
  const body = {
    subawards: false,
    filters: {
      time_period:      [{ start_date: FY_START, end_date: FY_END }],
      award_type_codes: ["A", "B", "C", "D"],   // procurement contracts only
      agencies:         [{ type: "awarding", tier: "toptier", name: agencyName }],
      award_amounts:    [{ lower_bound: 1_000_000 }],
    },
    fields: [
      "Award ID", "Recipient Name", "Award Amount", "Award Type",
      "Action Date", "Awarding Agency", "Description",
      "Place of Performance State Code",
      "Period of Performance Start Date",
      "Period of Performance Current End Date",
      "NAICS Code", "CFDA Number",
    ],
    sort:  "Award Amount",
    order: "desc",
    limit: 100,
    page:  1,
  };

  const data = await postJson<AwardSearchResponse>(
    `${USA_BASE}/search/spending_by_award/`,
    body,
    {},
    1
  );
  return data.results ?? [];
}

function toDate(s: string | null): string | null {
  if (!s) return null;
  try { return new Date(s).toISOString().split("T")[0]!; } catch { return null; }
}

function dollarsToCents(amount: number | null): number {
  return Math.round((amount ?? 0) * 100);
}

// ---------------------------------------------------------------------------
// Agency lookup — acronym → UUID
// ---------------------------------------------------------------------------

async function loadAgencyMap(
  db: ReturnType<typeof createAdminClient>,
): Promise<Map<string, string>> {
  const { data, error } = await db
    .from("agencies")
    .select("id, acronym")
    .not("acronym", "is", null);

  if (error) {
    console.error("  Failed to load agencies:", error.message);
    return new Map();
  }

  const map = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ id: string; acronym: string | null }>) {
    if (row.acronym) map.set(row.acronym.toUpperCase(), row.id);
  }
  console.log(`  Loaded ${map.size} agencies`);
  return map;
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

export async function runUsaSpendingPipeline(): Promise<PipelineResult> {
  console.log("\n=== USASpending.gov pipeline (public) ===");
  const logId = await startSync("usaspending");
  const db = createAdminClient();

  let inserted = 0, updated = 0, failed = 0;

  try {
    const agencyMap = await loadAgencyMap(db);
    if (agencyMap.size === 0) {
      console.warn("  No agencies found — cannot resolve FROM side. Aborting.");
      await failSync(logId, "No agencies loaded");
      return { inserted: 0, updated: 0, failed: 1, estimatedMb: 0 };
    }

    // ── Fetch phase: collect all awards across the top-20 agencies ───────────
    type CollectedAward = {
      agencyAcronym: string;
      agencyId: string;
      award: AwardResult;
    };
    const collected: CollectedAward[] = [];

    for (const agency of TOP_AGENCIES) {
      const agencyId = agencyMap.get(agency.acronym);
      if (!agencyId) {
        console.warn(`  ${agency.acronym}: no matching agency in public.agencies — skipping`);
        continue;
      }

      console.log(`  Fetching awards for ${agency.acronym}...`);
      try {
        const awards = await searchAwards(agency.name);
        console.log(`    Got ${awards.length} awards`);
        for (const award of awards) {
          collected.push({ agencyAcronym: agency.acronym, agencyId, award });
        }
      } catch (err) {
        console.error(`    ${agency.acronym}: fetch error —`, err instanceof Error ? err.message : err);
        failed++;
      }
    }

    console.log(`\n  Collected ${collected.length} awards — resolving recipients...`);

    // ── Resolve recipients in one batched pass ──────────────────────────────
    const recipientInputs = collected
      .map((c) => ({ displayName: (c.award["Recipient Name"] ?? "").trim() }))
      .filter((r) => r.displayName.length > 0);

    const { byCanonical, inserted: newRecipients } = await resolveRecipients(db, recipientInputs);
    console.log(`  Recipients: ${byCanonical.size} total (${newRecipients} new)`);

    // ── Build relationship inputs ───────────────────────────────────────────
    const relInputs: SpendingRelationshipInput[] = [];
    let skippedMissingId = 0, skippedMissingRecipient = 0, skippedMissingAmount = 0;

    for (const { agencyId, award } of collected) {
      const awardId = award["Award ID"];
      if (!awardId) { skippedMissingId++; continue; }

      const recipientName = (award["Recipient Name"] ?? "").trim();
      if (!recipientName) { skippedMissingRecipient++; continue; }

      const amount = award["Award Amount"];
      if (amount === null) { skippedMissingAmount++; continue; }

      const canonical = canonicalizeEntityName(recipientName);
      const recipientEntityId = byCanonical.get(canonical);
      if (!recipientEntityId) { failed++; continue; }

      const occurredAt =
        toDate(award["Action Date"]) ??
        toDate(award["Period of Performance Start Date"]) ??
        new Date().toISOString().slice(0, 10);

      const relationshipType: "contract" | "grant" = award["CFDA Number"] ? "grant" : "contract";

      relInputs.push({
        agencyId,
        recipientEntityId,
        relationshipType,
        amountCents: dollarsToCents(amount),
        occurredAt,
        usaspendingAwardId: awardId,
        naicsCode: award["NAICS Code"] ?? null,
        cfdaNumber: award["CFDA Number"] ?? null,
        description: (award["Description"] ?? "").slice(0, 500) || null,
        sourceUrl: `https://www.usaspending.gov/award/${awardId}/`,
      });
    }

    console.log(`\n  Upserting ${relInputs.length} relationships...`);
    console.log(`    (skipped: missing award ID ${skippedMissingId}, missing recipient ${skippedMissingRecipient}, missing amount ${skippedMissingAmount})`);

    const relResult = await upsertSpendingRelationshipsBatch(db, relInputs);
    inserted = relResult.upserted;
    failed += relResult.failed;

    const estimatedMb = +(((inserted + updated) * 400) / 1024 / 1024).toFixed(2);
    const result: PipelineResult = { inserted, updated, failed, estimatedMb };

    console.log("\n  ──────────────────────────────────────────────────");
    console.log("  USASpending pipeline report");
    console.log("  ──────────────────────────────────────────────────");
    console.log(`  ${"Agencies processed:".padEnd(32)} ${agencyMap.size}`);
    console.log(`  ${"Awards collected:".padEnd(32)} ${collected.length}`);
    console.log(`  ${"Recipient entities upserted:".padEnd(32)} ${newRecipients} new / ${byCanonical.size} total`);
    console.log(`  ${"Relationships upserted:".padEnd(32)} ${inserted}`);
    console.log(`  ${"Failed:".padEnd(32)} ${failed}`);

    await completeSync(logId, result);
    return result;

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("  USASpending pipeline fatal error:", msg);
    await failSync(logId, msg);
    return { inserted, updated, failed, estimatedMb: 0 };
  }
}

// ---------------------------------------------------------------------------
// Standalone entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  runUsaSpendingPipeline()
    .then(() => { setTimeout(() => process.exit(0), 500); })
    .catch((err) => {
      console.error("Pipeline failed:", err);
      setTimeout(() => process.exit(1), 500);
    });
}
