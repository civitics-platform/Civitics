/**
 * OpenStates pipeline — Stage 1B dual-write.
 *
 * Phase A: State legislators → public.officials (existing)
 *   + shadow.external_source_refs (new — normalizes dedup off JSON path filter)
 *
 * Phase B: State bills → shadow.proposals + shadow.bill_details +
 *          shadow.external_source_refs (new — state legislation in shadow)
 *
 * Storage target: ~30 MB
 * Rate limit:     100ms between API calls
 *
 * Run standalone:
 *   pnpm --filter @civitics/data data:states
 */

import { createAdminClient } from "@civitics/db";
import type { Database } from "@civitics/db";
import { shadowClient, sleep, fetchJson, QuotaExhaustedError } from "../utils";
import { startSync, completeSync, failSync, type PipelineResult } from "../sync-log";
import { STATE_DATA } from "../../jurisdictions/us-states";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OfficialInsert = Database["public"]["Tables"]["officials"]["Insert"];
type GovBodyInsert  = Database["public"]["Tables"]["governing_bodies"]["Insert"];
type GovBodyType    = Database["public"]["Enums"]["governing_body_type"];
type ProposalType   = Database["public"]["Enums"]["proposal_type"];
type ProposalStatus = Database["public"]["Enums"]["proposal_status"];
type Db = ReturnType<typeof createAdminClient>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ShadowDb = any;

interface OSPerson {
  id:             string;
  name:           string;
  party:          string;
  openstates_url: string;
  current_role: {
    title:              string;
    org_classification: string;
    district:           string;
    division_id:        string;
    end_date:           string | null;
    start_date:         string | null;
  } | null;
}

interface OSPersonList {
  results:    OSPerson[];
  pagination: { max_page: number; page: number; per_page: number; total_items: number };
}

interface OSBillOrg {
  name:           string;
  classification: string;  // "upper" | "lower" | "legislature"
}

interface OSBill {
  id:                          string;   // "ocd-bill/..."
  identifier:                  string;   // "HB 1234"
  title:                       string;
  classification:              string[]; // ["bill"] | ["resolution"] | ...
  session:                     string;
  first_action_date:           string | null;
  latest_action_date:          string | null;
  latest_action_description:   string | null;
  from_organization:           OSBillOrg | null;
}

interface OSBillList {
  results:    OSBill[];
  pagination: { max_page: number; page: number; per_page: number; total_items: number };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OS_BASE = "https://v3.openstates.org";

// Bills endpoint: max per_page=20, rate limit 10 req/min → 7s between calls
const BILLS_PER_PAGE = 20;
const BILLS_SLEEP_MS = 7000;
// Max bill pages per state (20 per page → up to 60 bills per state)
const MAX_BILL_PAGES = 3;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchLegislators(
  apiKey: string,
  jurisdictionId: string,
  orgClass: "upper" | "lower",
  page: number,
): Promise<OSPersonList> {
  await sleep(100);
  const url = new URL(`${OS_BASE}/people`);
  url.searchParams.set("jurisdiction",       jurisdictionId);
  url.searchParams.set("org_classification", orgClass);
  url.searchParams.set("per_page",           "50");
  url.searchParams.set("page",               String(page));
  return fetchJson<OSPersonList>(url.toString(), {
    headers: { "X-API-KEY": apiKey },
  });
}

async function fetchBills(
  apiKey: string,
  jurisdictionId: string,
  page: number,
): Promise<OSBillList> {
  await sleep(BILLS_SLEEP_MS);
  const url = new URL(`${OS_BASE}/bills`);
  url.searchParams.set("jurisdiction", jurisdictionId);
  url.searchParams.set("per_page",     String(BILLS_PER_PAGE));
  url.searchParams.set("page",         String(page));
  url.searchParams.set("sort",         "updated_desc");
  return fetchJson<OSBillList>(url.toString(), {
    headers: { "X-API-KEY": apiKey },
  });
}

function mapParty(party: string): OfficialInsert["party"] {
  const p = party.toLowerCase();
  if (p.includes("democrat"))    return "democrat";
  if (p.includes("republican"))  return "republican";
  if (p.includes("independent")) return "independent";
  if (p.includes("libertarian")) return "libertarian";
  if (p.includes("green"))       return "green";
  return "other";
}

function mapChamberType(orgClass: string): GovBodyType {
  if (orgClass === "upper") return "legislature_upper";
  if (orgClass === "lower") return "legislature_lower";
  return "legislature_unicameral";
}

function mapBillType(classification: string[]): ProposalType {
  const c = classification.map((s) => s.toLowerCase());
  if (c.some((s) => s === "bill"))                           return "bill";
  if (c.some((s) => s.includes("resolution")))              return "resolution";
  if (c.some((s) => s.includes("amendment")))               return "amendment";
  if (c.some((s) => s.includes("budget") || s.includes("appropriat"))) return "budget";
  if (c.some((s) => s.includes("ordinance")))               return "ordinance";
  return "other";
}

function mapBillStatus(latestAction: string | null): ProposalStatus {
  const a = (latestAction ?? "").toLowerCase();
  if (a.includes("signed") || a.includes("enacted") || a.includes("chaptered")) return "enacted";
  if (a.includes("vetoed"))                                 return "vetoed";
  if (a.includes("failed") || a.includes("defeated") || a.includes("died")) return "failed";
  if (a.includes("passed") && a.includes("house"))         return "passed_chamber";
  if (a.includes("passed") && a.includes("senate"))        return "passed_chamber";
  if (a.includes("passed both"))                           return "passed_both_chambers";
  if (a.includes("committee"))                             return "in_committee";
  return "introduced";
}

function mapBillChamber(orgClass: string): "house" | "senate" | null {
  if (orgClass === "upper") return "senate";
  if (orgClass === "lower") return "house";
  return null;
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

export async function runOpenStatesPipeline(
  apiKey: string,
  stateIds: Map<string, string>,   // state name → jurisdiction UUID
): Promise<PipelineResult> {
  console.log("\n=== OpenStates pipeline ===");
  const logId = await startSync("openstates");
  const db = createAdminClient();
  const sdb: ShadowDb = shadowClient(db);
  let inserted = 0, updated = 0, failed = 0;

  // Cache: "stateAbbr:chamberType" → governing_body UUID
  const govBodyCache = new Map<string, string>();

  async function findOrCreateGovBody(
    stateAbbr: string,
    stateName: string,
    jurisdictionId: string,
    orgClass: string,
  ): Promise<string | null> {
    const cacheKey = `${stateAbbr}:${orgClass}`;
    if (govBodyCache.has(cacheKey)) return govBodyCache.get(cacheKey)!;

    const bodyType     = mapChamberType(orgClass);
    const chamberLabel = orgClass === "upper" ? "Senate" : orgClass === "lower" ? "House" : "Legislature";
    const bodyName     = `${stateName} State ${chamberLabel}`;

    try {
      const { data: existing } = await db
        .from("governing_bodies")
        .select("id")
        .eq("jurisdiction_id", jurisdictionId)
        .eq("type", bodyType)
        .maybeSingle();

      if (existing) {
        govBodyCache.set(cacheKey, existing.id as string);
        return existing.id as string;
      }

      const row: GovBodyInsert = {
        jurisdiction_id: jurisdictionId,
        type:            bodyType,
        name:            bodyName,
        short_name:      `${stateAbbr} ${chamberLabel}`,
        is_active:       true,
      };
      const { data: created, error } = await db
        .from("governing_bodies").insert(row).select("id").single();
      if (error) {
        console.error(`    GovBody ${bodyName}: insert error — ${error.message}`);
        return null;
      }
      govBodyCache.set(cacheKey, created.id as string);
      return created.id as string;
    } catch (err) {
      console.error(`    GovBody ${bodyName}: unexpected error —`, err);
      return null;
    }
  }

  // ── Phase A: Legislators ───────────────────────────────────────────────────

  let billsInserted = 0, billsUpdated = 0, billsFailed = 0;
  let quotaHit = false;

  try {
    for (const state of STATE_DATA) {
      if (quotaHit) break;
      const jurisdictionId = stateIds.get(state.name);
      if (!jurisdictionId) {
        console.warn(`    No jurisdiction ID for ${state.name}, skipping`);
        continue;
      }

      const ocdId = `ocd-jurisdiction/country:us/state:${state.abbr.toLowerCase()}/government`;
      console.log(`  ${state.abbr} — legislators...`);

      let totalFetched = 0;

      for (const chamberClass of ["upper", "lower"] as const) {
        let page = 1;

        while (true) {
          if (quotaHit) break;
          let list: OSPersonList;
          try {
            list = await fetchLegislators(apiKey, ocdId, chamberClass, page);
          } catch (err) {
            if (err instanceof QuotaExhaustedError) {
              console.warn(`    OpenStates daily quota exhausted — stopping pipeline. Re-run tomorrow; upserts are idempotent.`);
              quotaHit = true;
              break;
            }
            console.error(`    ${state.abbr} ${chamberClass} page ${page}: fetch error —`, err instanceof Error ? err.message : err);
            break;
          }

          for (const person of list.results ?? []) {
            const role = person.current_role;
            if (!role) continue;

            const govBodyId = await findOrCreateGovBody(state.abbr, state.name, jurisdictionId, chamberClass);
            const osId      = person.id;

            if (!govBodyId) { failed++; continue; }

            const record: OfficialInsert = {
              full_name:         person.name,
              role_title:        role.title || (chamberClass === "upper" ? "State Senator" : "State Representative"),
              governing_body_id: govBodyId,
              jurisdiction_id:   jurisdictionId,
              party:             mapParty(person.party),
              district_name:     role.district || null,
              term_start:        role.start_date ?? null,
              term_end:          role.end_date   ?? null,
              is_active:         true,
              is_verified:       false,
              website_url:       person.openstates_url || null,
              source_ids:        { openstates_id: osId },
              metadata:          { org_classification: chamberClass },
            };

            try {
              const { data: existing } = await db
                .from("officials")
                .select("id")
                .filter("source_ids->>openstates_id", "eq", osId)
                .maybeSingle();

              let officialId: string | null = null;

              if (existing) {
                const { error } = await db.from("officials")
                  .update({ ...record, updated_at: new Date().toISOString() })
                  .eq("id", existing.id);
                if (error) { failed++; continue; }
                updated++;
                officialId = existing.id as string;
              } else {
                const { data: newRow, error } = await db
                  .from("officials").insert(record).select("id").single();
                if (error || !newRow) { failed++; continue; }
                inserted++;
                officialId = newRow.id as string;
              }

              // Shadow: normalize dedup off JSON filter → external_source_refs
              if (officialId) {
                await sdb.from("external_source_refs").upsert({
                  source:      "openstates",
                  external_id: osId,
                  entity_type: "official",
                  entity_id:   officialId,
                  metadata:    { state: state.abbr, chamber: chamberClass },
                }, { onConflict: "source,external_id,entity_type" });
              }
            } catch (err) {
              console.error(`    ${person.name}: error —`, err);
              failed++;
            }
          }

          totalFetched += (list.results ?? []).length;
          if (page >= list.pagination.max_page) break;
          page++;
        }
      }

      console.log(`    ${state.abbr}: ${totalFetched} legislators`);

      if (quotaHit) break;

      // ── Phase B: Bills for this state ──────────────────────────────────────

      console.log(`  ${state.abbr} — bills...`);
      let billPage = 1;
      let stateBillsFetched = 0;

      while (billPage <= MAX_BILL_PAGES) {
        let list: OSBillList;
        try {
          list = await fetchBills(apiKey, ocdId, billPage);
        } catch (err) {
          if (err instanceof QuotaExhaustedError) {
            console.warn(`    OpenStates daily quota exhausted — stopping pipeline. Re-run tomorrow; upserts are idempotent.`);
            quotaHit = true;
            break;
          }
          console.error(`    ${state.abbr} bills page ${billPage}: fetch error —`, err instanceof Error ? err.message : err);
          break;
        }

        for (const bill of list.results ?? []) {
          const osId       = bill.id;
          const billNumber = bill.identifier.slice(0, 100);
          const title      = (bill.title || billNumber).slice(0, 500);
          const session    = bill.session || "current";
          const orgClass   = bill.from_organization?.classification ?? "";
          const chamber    = mapBillChamber(orgClass);
          const billType   = mapBillType(bill.classification ?? []);
          const status     = mapBillStatus(bill.latest_action_description);

          // Dedup via external_source_refs
          const { data: existingRef } = await sdb
            .from("external_source_refs")
            .select("entity_id")
            .eq("source", "openstates")
            .eq("external_id", osId)
            .eq("entity_type", "proposal")
            .maybeSingle();

          if (existingRef?.entity_id) {
            // Update status on shadow.proposals if changed
            await sdb.from("proposals")
              .update({ status, last_action_at: bill.latest_action_date ?? null, updated_at: new Date().toISOString() })
              .eq("id", existingRef.entity_id);
            billsUpdated++;
            continue;
          }

          // Insert shadow.proposals
          const { data: newProposal, error: pErr } = await sdb
            .from("proposals")
            .insert({
              type:            billType,
              status,
              jurisdiction_id: jurisdictionId,
              title,
              introduced_at:   bill.first_action_date ?? null,
              last_action_at:  bill.latest_action_date ?? null,
              external_url:    `https://openstates.org/bills/${osId.replace("ocd-bill/", "")}/`,
              metadata: {
                source:               "openstates",
                openstates_id:        osId,
                latest_action:        (bill.latest_action_description ?? "").slice(0, 200),
              },
            })
            .select("id")
            .single();

          if (pErr || !newProposal) {
            if (pErr?.code !== "23505") {
              console.error(`    ${state.abbr} bill ${billNumber}: shadow.proposals error — ${pErr?.message}`);
            }
            billsFailed++;
            continue;
          }

          const proposalId = newProposal.id as string;

          // shadow.bill_details
          const { error: bdErr } = await sdb
            .from("bill_details")
            .insert({
              proposal_id: proposalId,
              bill_number:  billNumber,
              chamber:      chamber ?? undefined,
              session,
              // jurisdiction_id filled by trigger
            });

          if (bdErr && bdErr.code !== "23505") {
            console.error(`    ${state.abbr} bill ${billNumber}: shadow.bill_details error — ${bdErr.message}`);
          }

          // shadow.external_source_refs
          await sdb.from("external_source_refs").insert({
            source:      "openstates",
            external_id: osId,
            entity_type: "proposal",
            entity_id:   proposalId,
            metadata:    { state: state.abbr, session },
          });

          billsInserted++;
        }

        stateBillsFetched += (list.results ?? []).length;
        if (billPage >= list.pagination.max_page || list.results.length < BILLS_PER_PAGE) break;
        billPage++;
      }

      console.log(`    ${state.abbr}: ${stateBillsFetched} bills fetched (${billsInserted} inserted so far)`);
    }

    const totalInserted = inserted + billsInserted;
    const totalUpdated  = updated  + billsUpdated;
    const totalFailed   = failed   + billsFailed;

    const estimatedMb = +((totalInserted + totalUpdated) * 1000 / 1024 / 1024).toFixed(2);
    const result: PipelineResult = { inserted: totalInserted, updated: totalUpdated, failed: totalFailed, estimatedMb };

    console.log(`\n  Done`);
    console.log(`  Legislators — inserted: ${inserted}, updated: ${updated}, failed: ${failed}`);
    console.log(`  Bills       — inserted: ${billsInserted}, updated: ${billsUpdated}, failed: ${billsFailed}`);
    console.log(`  Estimated storage: ~${estimatedMb} MB`);

    await completeSync(logId, result);
    return result;

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("  OpenStates pipeline fatal error:", msg);
    await failSync(logId, msg);
    return { inserted, updated, failed, estimatedMb: 0 };
  }
}

// ---------------------------------------------------------------------------
// Standalone entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  const apiKey = process.env["OPENSTATES_API_KEY"];
  if (!apiKey) { console.error("OPENSTATES_API_KEY not set"); process.exit(1); }

  const { seedJurisdictions } = require("../../jurisdictions/us-states");
  const db = createAdminClient();

  (async () => {
    const { stateIds } = await seedJurisdictions(db);
    await runOpenStatesPipeline(apiKey, stateIds);
  })()
    .then(() => { setTimeout(() => process.exit(0), 500); })
    .catch((err) => {
      console.error("Pipeline failed:", err);
      setTimeout(() => process.exit(1), 500);
    });
}
