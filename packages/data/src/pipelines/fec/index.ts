/**
 * FEC campaign finance pipeline.
 *
 * For each official in our database, searches the FEC API to find their
 * candidate committees, then fetches their top 50 donors per election cycle
 * from Schedule A. Aggregates by donor name — stores totals, not raw rows.
 *
 * Storage target: ~50 MB
 * Rate limit:     1,000 req/hour — 100ms delay between calls
 * Cycles:         2024 first, then 2022 if space allows
 *
 * Run standalone:
 *   pnpm --filter @civitics/data data:fec
 */

import { createAdminClient } from "@civitics/db";
import type { Database } from "@civitics/db";
import { sleep, fetchJson } from "../utils";
import { startSync, completeSync, failSync, getDbSizeMb, type PipelineResult } from "../sync-log";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FinancialInsert = Database["public"]["Tables"]["financial_relationships"]["Insert"];
type DonorType = Database["public"]["Enums"]["donor_type"];

interface FecCandidate {
  candidate_id:   string;
  name:           string;
  state:          string;
  party:          string;
  office:         string;
  election_years: number[];
}

interface FecCommittee {
  committee_id: string;
  name:         string;
  committee_type: string;
  designation:  string;
}

interface FecContribution {
  contributor_name:            string;
  contribution_receipt_amount: number;
  entity_type:                 string | null;
  contributor_employer:        string | null;
  contributor_occupation:      string | null;
  contributor_state:           string | null;
  receipt_date:                string | null;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const FEC_BASE = "https://api.open.fec.gov/v1";

async function fecGet<T>(path: string, apiKey: string, extraParams: Record<string, string> = {}): Promise<T> {
  await sleep(100);
  const url = new URL(`${FEC_BASE}/${path}`);
  url.searchParams.set("api_key", apiKey);
  for (const [k, v] of Object.entries(extraParams)) url.searchParams.set(k, v);
  return fetchJson<T>(url.toString(), {}, 0);  // no retry — rate limit hits should fail fast
}

async function searchCandidate(
  apiKey: string,
  lastName: string,
  state: string
): Promise<FecCandidate[]> {
  try {
    const data = await fecGet<{ results: FecCandidate[] }>(
      "candidates/search/",
      apiKey,
      { q: lastName, state, office: "H,S", per_page: "10" }
    );
    return data.results ?? [];
  } catch {
    return [];
  }
}

async function getCandidateCommittees(
  apiKey: string,
  candidateId: string,
  cycle: number
): Promise<FecCommittee[]> {
  try {
    const data = await fecGet<{ results: FecCommittee[] }>(
      `candidate/${candidateId}/committees/`,
      apiKey,
      { cycle: String(cycle), designation: "P,A" }  // P=principal, A=authorized
    );
    return data.results ?? [];
  } catch {
    return [];
  }
}

async function getTopContributors(
  apiKey: string,
  committeeId: string,
  cycle: number
): Promise<FecContribution[]> {
  try {
    const data = await fecGet<{ results: FecContribution[] }>(
      "schedules/schedule_a/",
      apiKey,
      {
        committee_id:                 committeeId,
        two_year_transaction_period:  String(cycle),
        per_page:                     "100",
        sort:                         "-contribution_receipt_amount",
        sort_hide_null:               "true",
        is_individual:                "true",
      }
    );
    return data.results ?? [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapEntityType(entityType: string | null): DonorType {
  switch ((entityType ?? "").toUpperCase()) {
    case "IND": return "individual";
    case "PAC": return "pac";
    case "ORG": return "corporate";
    case "PTY": return "party_committee";
    case "CCM": return "party_committee";
    default:    return "other";
  }
}

/** Aggregate contributions by donor name; return top N. */
function aggregateContributions(
  rows: FecContribution[],
  topN = 50
): Map<string, { totalCents: number; entityType: string | null; latestDate: string | null }> {
  const map = new Map<string, { totalCents: number; entityType: string | null; latestDate: string | null }>();
  for (const r of rows) {
    const name = (r.contributor_name ?? "UNKNOWN").trim().toUpperCase();
    const cents = Math.round((r.contribution_receipt_amount ?? 0) * 100);
    const existing = map.get(name);
    if (existing) {
      existing.totalCents += cents;
      if (r.receipt_date && (!existing.latestDate || r.receipt_date > existing.latestDate)) {
        existing.latestDate = r.receipt_date;
      }
    } else {
      map.set(name, { totalCents: cents, entityType: r.entity_type, latestDate: r.receipt_date ?? null });
    }
  }
  // Return top N by total
  return new Map(
    [...map.entries()]
      .sort((a, b) => b[1].totalCents - a[1].totalCents)
      .slice(0, topN)
  );
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

export async function runFecPipeline(apiKey: string): Promise<PipelineResult> {
  console.log("\n=== FEC campaign finance pipeline ===");
  const logId = await startSync("fec");
  const db = createAdminClient();
  let inserted = 0, updated = 0, failed = 0;

  const STORAGE_BUDGET_MB = 50;
  const CYCLES = [2024, 2022];

  try {
    // 1. Fetch all officials with their last names and state abbreviations
    const { data: officials, error: offErr } = await db
      .from("officials")
      .select("id, last_name, source_ids, jurisdictions!jurisdiction_id(short_name)")
      .eq("is_active", true)
      .not("last_name", "is", null);

    if (offErr) throw new Error(`Could not fetch officials: ${offErr.message}`);
    console.log(`  Processing ${(officials ?? []).length} officials...`);

    for (const official of officials ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const o = official as any;
      const lastName   = (o.last_name as string) ?? "";
      const stateAbbr  = (o.jurisdictions?.short_name as string) ?? "";
      const officialId = o.id as string;
      const sourceIds  = (o.source_ids as Record<string, string>) ?? {};

      if (!lastName || !stateAbbr) continue;

      // Check storage budget before continuing
      const dbMb = await getDbSizeMb();
      if (dbMb > 160) {
        console.log(`  Storage budget reached (${dbMb} MB used). Stopping FEC pipeline.`);
        break;
      }

      // Find FEC candidate ID (from stored source_ids or by searching)
      let candidateId = sourceIds["fec_candidate_id"] ?? null;

      if (!candidateId) {
        const candidates = await searchCandidate(apiKey, lastName, stateAbbr);
        // Best match: same state, most recent election year
        const match = candidates.find(
          (c) => c.state === stateAbbr && (c.office === "H" || c.office === "S")
        ) ?? candidates[0];
        if (!match) continue;
        candidateId = match.candidate_id;
        // Persist the FEC ID so future runs skip the search
        await db.from("officials")
          .update({ source_ids: { ...sourceIds, fec_candidate_id: candidateId } })
          .eq("id", officialId);
      }

      // Process each election cycle
      for (const cycle of CYCLES) {
        try {
          const committees = await getCandidateCommittees(apiKey, candidateId, cycle);
          const principalCommittee = committees.find(
            (c) => c.designation === "P" || c.designation === "A"
          ) ?? committees[0];
          if (!principalCommittee) continue;

          const contributions = await getTopContributors(apiKey, principalCommittee.committee_id, cycle);
          const aggregated    = aggregateContributions(contributions, 50);

          for (const [donorName, agg] of aggregated) {
            if (agg.totalCents <= 0) continue;

            const record: FinancialInsert = {
              official_id:       officialId,
              donor_name:        donorName,
              donor_type:        mapEntityType(agg.entityType),
              amount_cents:      agg.totalCents,
              cycle_year:        cycle,
              contribution_date: agg.latestDate ?? null,
              fec_committee_id:  principalCommittee.committee_id,
              source_url:        `https://www.fec.gov/data/candidate/${candidateId}/`,
              source_ids:        { fec_candidate_id: candidateId, fec_committee_id: principalCommittee.committee_id },
            };

            // Upsert by official + donor + cycle
            const { data: existing } = await db
              .from("financial_relationships")
              .select("id")
              .eq("official_id", officialId)
              .eq("donor_name", donorName)
              .eq("cycle_year", cycle)
              .maybeSingle();

            if (existing) {
              const { error } = await db
                .from("financial_relationships")
                .update({ amount_cents: agg.totalCents, updated_at: new Date().toISOString() })
                .eq("id", existing.id);
              if (error) { failed++; } else { updated++; }
            } else {
              const { error } = await db.from("financial_relationships").insert(record);
              if (error) { failed++; } else { inserted++; }
            }
          }
        } catch (err) {
          console.error(`    ${lastName} (${stateAbbr}) cycle ${cycle}: error —`, err instanceof Error ? err.message : err);
          failed++;
        }
      }
    }

    const estimatedMb = +((inserted + updated) * 517 / 1024 / 1024).toFixed(2);
    const result: PipelineResult = { inserted, updated, failed, estimatedMb };

    console.log(`  Done — inserted: ${inserted}, updated: ${updated}, failed: ${failed}`);
    console.log(`  Estimated storage: ~${estimatedMb} MB`);

    await completeSync(logId, result);
    return result;

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("  FEC pipeline fatal error:", msg);
    await failSync(logId, msg);
    return { inserted, updated, failed, estimatedMb: 0 };
  }
}

// ---------------------------------------------------------------------------
// Standalone entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  const apiKey = process.env["FEC_API_KEY"];
  if (!apiKey) { console.error("FEC_API_KEY not set"); process.exit(1); }

  (async () => {
    try {
      await runFecPipeline(apiKey);
      process.exit(0);
    } catch (err) {
      console.error("Fatal:", err);
      process.exit(1);
    }
  })();
}
