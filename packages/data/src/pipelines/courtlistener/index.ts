/**
 * CourtListener pipeline — Stage 1B dual-write.
 *
 * Part 1: Federal judges → public.officials
 *   Fix for Stage 0 finding #6: judges get court-specific governing_body_id
 *   (type='judicial') instead of senateId. seedJudicialGoverningBodies() seeds
 *   one governing_body row per federal court and caches the map for the run.
 *   Existing judge rows are also updated to the correct governing_body_id.
 *
 * Part 2: Court opinions → public.proposals (legacy) + shadow dual-write
 *   Shadow writes: shadow.proposals + shadow.case_details +
 *                  shadow.external_source_refs
 *   Dedup key: shadow.external_source_refs(source='courtlistener',
 *              external_id=cluster_id, entity_type='proposal')
 *
 * Run standalone:
 *   pnpm --filter @civitics/data data:courts
 */

import { createAdminClient } from "@civitics/db";
import type { Database } from "@civitics/db";
import { shadowClient, sleep, fetchJson } from "../utils";
import { startSync, completeSync, failSync, type PipelineResult } from "../sync-log";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OfficialInsert = Database["public"]["Tables"]["officials"]["Insert"];
type ProposalInsert = Database["public"]["Tables"]["proposals"]["Insert"];
type Db = ReturnType<typeof createAdminClient>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ShadowDb = any;

interface CLPosition {
  id:               number;
  court:            string;
  court_full_name:  string;
  position_type:    string;
  date_start:       string | null;
  date_termination: string | null;
  person: {
    id:         number;
    name_full:  string;
    name_first: string;
    name_last:  string;
    date_dob:   string | null;
  };
}

interface CLPositionList {
  count:   number;
  next:    string | null;
  results: CLPosition[];
}

interface CLCluster {
  id:           number;
  case_name:    string;
  date_filed:   string | null;
  court_id:     string;
  absolute_url: string;
  syllabus:     string | null;
  scdb_id:      string | null;
}

interface CLClusterList {
  count:   number;
  next:    string | null;
  results: CLCluster[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CL_BASE = "https://www.courtlistener.com/api/rest/v4";

const FEDERAL_COURTS = [
  "scotus", "ca1", "ca2", "ca3", "ca4", "ca5",
  "ca6", "ca7", "ca8", "ca9", "ca10", "ca11", "cadc", "cafc",
];

const COURT_FULL_NAMES: Record<string, string> = {
  scotus: "Supreme Court of the United States",
  ca1:    "U.S. Court of Appeals for the First Circuit",
  ca2:    "U.S. Court of Appeals for the Second Circuit",
  ca3:    "U.S. Court of Appeals for the Third Circuit",
  ca4:    "U.S. Court of Appeals for the Fourth Circuit",
  ca5:    "U.S. Court of Appeals for the Fifth Circuit",
  ca6:    "U.S. Court of Appeals for the Sixth Circuit",
  ca7:    "U.S. Court of Appeals for the Seventh Circuit",
  ca8:    "U.S. Court of Appeals for the Eighth Circuit",
  ca9:    "U.S. Court of Appeals for the Ninth Circuit",
  ca10:   "U.S. Court of Appeals for the Tenth Circuit",
  ca11:   "U.S. Court of Appeals for the Eleventh Circuit",
  cadc:   "U.S. Court of Appeals for the D.C. Circuit",
  cafc:   "U.S. Court of Appeals for the Federal Circuit",
};

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function clGet<T>(path: string, apiKey: string, params: Record<string, string> = {}): Promise<T> {
  await sleep(250);
  const url = new URL(`${CL_BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return fetchJson<T>(url.toString(), {
    headers: { Authorization: `Token ${apiKey}` },
  });
}

// ---------------------------------------------------------------------------
// Seed judicial governing bodies — one per federal court
//
// Returns a map of CL court slug → governing_body UUID.
// Uses find-or-create so re-runs are safe.
// ---------------------------------------------------------------------------

async function seedJudicialGoverningBodies(
  db: Db,
  federalId: string,
): Promise<Map<string, string>> {
  const courtMap = new Map<string, string>();

  for (const courtId of FEDERAL_COURTS) {
    const name = COURT_FULL_NAMES[courtId] ?? `Federal Court (${courtId})`;

    const { data: existing } = await db
      .from("governing_bodies")
      .select("id")
      .eq("name", name)
      .eq("jurisdiction_id", federalId)
      .maybeSingle();

    if (existing?.id) {
      courtMap.set(courtId, existing.id as string);
      continue;
    }

    const { data: inserted, error } = await db
      .from("governing_bodies")
      .insert({
        name,
        short_name: courtId.toUpperCase(),
        type: "judicial",
        jurisdiction_id: federalId,
        is_active: true,
        metadata: { courtlistener_court_id: courtId },
      })
      .select("id")
      .single();

    if (error || !inserted) {
      // 23505 = name collision on concurrent run; retry select
      if (error?.code === "23505") {
        const { data: retry } = await db
          .from("governing_bodies")
          .select("id")
          .eq("name", name)
          .eq("jurisdiction_id", federalId)
          .maybeSingle();
        if (retry?.id) { courtMap.set(courtId, retry.id as string); continue; }
      }
      console.error(`    seedJudicialGoverningBodies: failed for ${courtId}: ${error?.message}`);
      continue;
    }

    courtMap.set(courtId, inserted.id as string);
  }

  console.log(`  Seeded ${courtMap.size} judicial governing bodies`);
  return courtMap;
}

// ---------------------------------------------------------------------------
// Shadow opinion writer
// ---------------------------------------------------------------------------

async function writeShadowOpinion(
  sdb: ShadowDb,
  proposalId: string,
  cluster: CLCluster,
  courtId: string,         // reliable loop variable — cluster.court_id may be undefined in v4 API
  federalId: string,
  opinionUrl: string,
): Promise<void> {
  const clId = String(cluster.id);

  // Check if already in shadow via external_source_refs
  const { data: existing } = await sdb
    .from("external_source_refs")
    .select("entity_id")
    .eq("source", "courtlistener")
    .eq("external_id", clId)
    .eq("entity_type", "proposal")
    .maybeSingle();

  if (existing?.entity_id) return; // already written

  // shadow.proposals
  const { error: sProposalErr } = await sdb
    .from("proposals")
    .insert({
      id: proposalId,
      type: "other",
      status: "enacted",
      jurisdiction_id: federalId,
      title: (cluster.case_name || `Opinion ${clId}`).slice(0, 500),
      introduced_at: cluster.date_filed ?? null,
      last_action_at: cluster.date_filed ?? null,
      external_url: opinionUrl,
      metadata: {
        court: courtId,
        source: "courtlistener",
        syllabus: (cluster.syllabus ?? "").slice(0, 300),
        ...(cluster.scdb_id ? { scdb_id: cluster.scdb_id } : {}),
      },
    });

  if (sProposalErr && sProposalErr.code !== "23505") {
    console.error(`    shadow.proposals insert failed for cluster ${clId}: ${sProposalErr.message}`);
    return;
  }

  // shadow.case_details
  const { error: sCaseErr } = await sdb
    .from("case_details")
    .insert({
      proposal_id: proposalId,
      docket_number: `CL-${clId}`,  // placeholder; enriched when full docket API is integrated
      court_name: COURT_FULL_NAMES[courtId] ?? courtId,
      case_name: (cluster.case_name || null),
      filed_at: cluster.date_filed ?? null,
      courtlistener_id: clId,
    });

  if (sCaseErr && sCaseErr.code !== "23505") {
    console.error(`    shadow.case_details insert failed for cluster ${clId}: ${sCaseErr.message}`);
  }

  // shadow.external_source_refs
  const { error: sRefErr } = await sdb
    .from("external_source_refs")
    .insert({
      source: "courtlistener",
      external_id: clId,
      entity_type: "proposal",
      entity_id: proposalId,
      source_url: opinionUrl,
      metadata: { court_id: courtId },
    });

  if (sRefErr && sRefErr.code !== "23505") {
    console.error(`    shadow.external_source_refs insert failed for cluster ${clId}: ${sRefErr.message}`);
  }
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

export async function runCourtListenerPipeline(
  apiKey: string,
  federalId: string,
): Promise<PipelineResult> {
  console.log("\n=== CourtListener pipeline ===");
  const logId = await startSync("courtlistener");
  const db = createAdminClient();
  const sdb: ShadowDb = shadowClient(db);
  let inserted = 0, updated = 0, failed = 0;

  try {
    // Seed / fetch judicial governing bodies (fixes Stage 0 finding #6)
    const courtGovBodyMap = await seedJudicialGoverningBodies(db, federalId);

    // -----------------------------------------------------------------------
    // Part 1: Federal judges → public.officials
    // -----------------------------------------------------------------------

    console.log("  Fetching active federal judges...");
    let nextUrl: string | null = null;
    let page = 1;
    const judgesProcessed = new Set<number>();

    do {
      let positions: CLPositionList;
      try {
        if (nextUrl) {
          await sleep(250);
          positions = await fetchJson<CLPositionList>(nextUrl, {
            headers: { Authorization: `Token ${apiKey}` },
          });
        } else {
          positions = await clGet<CLPositionList>("positions/", apiKey, {
            court__jurisdiction: "F",
            position_type:       "jud",
            page_size:           "100",
            page:                String(page),
          });
        }
      } catch (err) {
        console.error(`  Judges page ${page}: fetch error —`, err instanceof Error ? err.message : err);
        break;
      }

      for (const pos of positions.results ?? []) {
        const personId = pos.person?.id;
        if (!personId || judgesProcessed.has(personId)) continue;
        judgesProcessed.add(personId);

        const person = pos.person;
        const clId = String(personId);

        // In CL API v4, pos.court may be a URL string or nested object — extract slug
        const courtStr = String(typeof pos.court === "object" && pos.court !== null
          ? (pos.court as Record<string, unknown>)["id"] ?? ""
          : pos.court ?? "");
        const courtSlug = courtStr.split("/").filter(Boolean).pop() ?? courtStr;
        const governingBodyId = courtGovBodyMap.get(courtSlug)
          ?? [...courtGovBodyMap.values()][0]!;

        const record: OfficialInsert = {
          full_name:         person.name_full || `${person.name_first} ${person.name_last}`.trim(),
          first_name:        person.name_first || null,
          last_name:         person.name_last || null,
          role_title:        "Federal Judge",
          governing_body_id: governingBodyId,
          jurisdiction_id:   federalId,
          is_active:         !pos.date_termination,
          is_verified:       false,
          term_start:        pos.date_start ?? null,
          term_end:          pos.date_termination ?? null,
          source_ids:        { courtlistener_person_id: clId },
          metadata:          {
            court:            pos.court,
            court_full_name:  pos.court_full_name,
            position_type:    pos.position_type,
          },
        };

        try {
          const { data: existing } = await db
            .from("officials")
            .select("id")
            .filter("source_ids->>courtlistener_person_id", "eq", clId)
            .maybeSingle();

          if (existing) {
            const { error } = await db.from("officials")
              .update({ ...record, updated_at: new Date().toISOString() })
              .eq("id", existing.id);
            if (error) { failed++; } else { updated++; }
          } else {
            const { error } = await db.from("officials").insert(record);
            if (error) { failed++; } else { inserted++; }
          }
        } catch (err) {
          console.error(`    Judge ${person.name_full}: error —`, err);
          failed++;
        }
      }

      nextUrl = positions.next ?? null;
      page++;
      if (page > 20) break;
    } while (nextUrl);

    console.log(`  Judges — inserted: ${inserted}, updated: ${updated}`);
    const judgesInserted = inserted, judgesUpdated = updated;
    inserted = 0; updated = 0;

    // -----------------------------------------------------------------------
    // Part 2: Recent opinions → public.proposals + shadow dual-write
    // -----------------------------------------------------------------------

    console.log("  Fetching recent court opinions...");

    for (const courtId of FEDERAL_COURTS) {
      console.log(`    Court: ${courtId}`);
      let nextClusters: string | null = null;

      for (let p = 1; p <= 2; p++) {
        let clusters: CLClusterList;
        try {
          if (nextClusters) {
            await sleep(250);
            clusters = await fetchJson<CLClusterList>(nextClusters, {
              headers: { Authorization: `Token ${apiKey}` },
            });
          } else {
            clusters = await clGet<CLClusterList>("clusters/", apiKey, {
              docket__court: courtId,
              page_size:     "100",
            });
          }
        } catch (err) {
          console.error(`    ${courtId} page ${p}: error —`, err instanceof Error ? err.message : err);
          break;
        }
        nextClusters = clusters.next ?? null;

        for (const cluster of clusters.results ?? []) {
          const clId = String(cluster.id);
          const opinionUrl = `https://www.courtlistener.com${cluster.absolute_url}`;

          const record: ProposalInsert = {
            title:           (cluster.case_name || `Opinion ${clId}`).slice(0, 500),
            type:            "other",
            status:          "enacted",
            jurisdiction_id: federalId,
            introduced_at:   cluster.date_filed ?? null,
            last_action_at:  cluster.date_filed ?? null,
            full_text_url:   opinionUrl,
            source_ids:      {
              courtlistener_cluster_id: clId,
              court_id:  courtId,
              scdb_id:   cluster.scdb_id ?? "",
            },
            metadata:        {
              court:    courtId,
              source:   "courtlistener",
              syllabus: (cluster.syllabus ?? "").slice(0, 300),
            },
          };

          try {
            const { data: existing } = await db
              .from("proposals")
              .select("id")
              .filter("source_ids->>courtlistener_cluster_id", "eq", clId)
              .maybeSingle();

            if (existing) {
              await db.from("proposals")
                .update({ updated_at: new Date().toISOString() })
                .eq("id", existing.id);
              updated++;

              // Shadow write for already-inserted public row
              await writeShadowOpinion(sdb, existing.id as string, cluster, courtId, federalId, opinionUrl);
            } else {
              const { data: newRow, error } = await db
                .from("proposals")
                .insert(record)
                .select("id")
                .single();

              if (error || !newRow) {
                failed++;
              } else {
                inserted++;
                await writeShadowOpinion(sdb, newRow.id as string, cluster, courtId, federalId, opinionUrl);
              }
            }
          } catch (err) {
            console.error(`    Cluster ${clId}: error —`, err);
            failed++;
          }
        }

        if ((clusters.results ?? []).length < 100 || !nextClusters) break;
      }
    }

    inserted += judgesInserted;
    updated  += judgesUpdated;

    const estimatedMb = +((inserted + updated) * 517 / 1024 / 1024).toFixed(2);
    const result: PipelineResult = { inserted, updated, failed, estimatedMb };

    console.log(`  Done — inserted: ${inserted}, updated: ${updated}, failed: ${failed}`);
    console.log(`  Estimated storage: ~${estimatedMb} MB`);

    await completeSync(logId, result);
    return result;

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("  CourtListener pipeline fatal error:", msg);
    await failSync(logId, msg);
    return { inserted, updated, failed, estimatedMb: 0 };
  }
}

// ---------------------------------------------------------------------------
// Standalone entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  const apiKey = process.env["COURTLISTENER_API_KEY"];
  if (!apiKey) { console.error("COURTLISTENER_API_KEY not set"); process.exit(1); }

  const { seedJurisdictions } = require("../../jurisdictions/us-states");
  const db = createAdminClient();

  (async () => {
    const { federalId } = await seedJurisdictions(db);
    await runCourtListenerPipeline(apiKey, federalId);
  })()
    .then(() => { setTimeout(() => process.exit(0), 500); })
    .catch((err) => {
      console.error("Pipeline failed:", err);
      setTimeout(() => process.exit(1), 500);
    });
}
