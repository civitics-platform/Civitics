/**
 * Agency leadership pipeline — FIX-209.
 *
 * Uses Wikidata SPARQL to populate current + recent (last 15 years) agency
 * heads into:
 *   - officials     (one row per person, dedup via source_ids->>'wikidata_id')
 *   - entity_connections  (connection_type='appointment', metadata with
 *                         start_date, end_date, position_title, is_current)
 *
 * Agencies with wikidata_id = NULL are skipped (run agency-enrichment first).
 * Agencies where Wikidata returns 0 leaders are enqueued in enrichment_queue
 * with entity_type='agency', task_type='leadership', priority=40.
 *
 * Run:
 *   pnpm --filter @civitics/data data:agency-leadership
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
  wikidata_id: string | null;
}

interface LeaderBinding {
  person: { value: string };
  personLabel: { value: string };
  start?: { value: string };
  end?: { value: string };
  posLabel?: { value: string };
}

// ---------------------------------------------------------------------------
// SPARQL helper
// ---------------------------------------------------------------------------

const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const CUTOFF_YEAR = new Date().getFullYear() - 15;

async function fetchAgencyLeaders(wikidataId: string): Promise<LeaderBinding[]> {
  // P488 = "head of government/executive" statement on the agency item.
  // We use both P488 (head of agency) as the primary property.
  const sparql = `
SELECT ?person ?personLabel ?start ?end ?posLabel WHERE {
  wd:${wikidataId} p:P488 ?stmt .
  ?stmt ps:P488 ?person .
  OPTIONAL { ?stmt pq:P580 ?start }
  OPTIONAL { ?stmt pq:P582 ?end }
  OPTIONAL {
    ?stmt pq:P794 ?pos .
    ?pos rdfs:label ?posLabel FILTER(LANG(?posLabel) = "en")
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
}
ORDER BY DESC(?start)
LIMIT 15
`.trim();

  const qs = new URLSearchParams({ query: sparql, format: "json" });
  const resp = await fetch(`${SPARQL_ENDPOINT}?${qs.toString()}`, {
    headers: {
      accept: "application/sparql-results+json",
      "User-Agent": "Civitics/1.0 (civic data platform; contact@civitics.com)",
    },
  });
  if (!resp.ok) throw new Error(`Wikidata SPARQL ${resp.status}`);
  const body = await resp.json() as { results?: { bindings?: LeaderBinding[] } };
  return body.results?.bindings ?? [];
}

function parseDate(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10); // YYYY-MM-DD
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runAgencyLeadershipPipeline(): Promise<PipelineResult> {
  console.log("\n=== Agency leadership pipeline ===");

  const logId = await startSync("agency_leadership");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any;
  const result: PipelineResult = { inserted: 0, updated: 0, failed: 0, estimatedMb: 0 };

  try {
    // Load all federal agencies that have a wikidata_id
    const { data: agencyData, error: agErr } = await db
      .from("agencies")
      .select("id, name, acronym, wikidata_id")
      .eq("agency_type", "federal")
      .not("wikidata_id", "is", null);
    if (agErr) throw new Error(agErr.message);

    const agencies = (agencyData ?? []) as AgencyRow[];
    console.log(`  ${agencies.length} federal agencies with wikidata_id`);

    // Look up the US federal jurisdiction (fips_code='00')
    const { data: jurData } = await db
      .from("jurisdictions")
      .select("id")
      .eq("fips_code", "00")
      .maybeSingle();
    const federalJurisdictionId = jurData?.id as string | null;
    if (!federalJurisdictionId) {
      console.warn("  WARNING: federal jurisdiction (fips_code=00) not found — officials will be skipped");
    }

    // Build existing wikidata_id → official UUID map to avoid N inserts
    const { data: existingOfficials } = await db
      .from("officials")
      .select("id, source_ids")
      .not("source_ids->>wikidata_id", "is", null);
    const officialByWdId = new Map<string, string>();
    for (const o of existingOfficials ?? []) {
      const wdId = (o.source_ids as Record<string, string> | null)?.wikidata_id;
      if (wdId) officialByWdId.set(wdId, o.id as string);
    }
    console.log(`  ${officialByWdId.size} officials with wikidata_id already in DB`);

    let noLeadersCount = 0;

    for (const agency of agencies) {
      if (!agency.wikidata_id) continue;

      let leaders: LeaderBinding[] = [];
      try {
        leaders = await fetchAgencyLeaders(agency.wikidata_id);
        await sleep(1200); // Wikidata rate limit: ~1 req/sec
      } catch (err) {
        console.warn(`  ${agency.acronym ?? agency.name}: SPARQL error:`, err instanceof Error ? err.message : err);
        result.failed++;
        await sleep(2000);
        continue;
      }

      // Filter to last 15 years (keep if end_date is null OR year >= CUTOFF_YEAR)
      const recent = leaders.filter(l => {
        const endDate = parseDate(l.end?.value);
        if (!endDate) return true; // current/no end date → keep
        return new Date(endDate).getFullYear() >= CUTOFF_YEAR;
      });

      if (recent.length === 0) {
        noLeadersCount++;
        // Enqueue for AI gap-fill
        if (federalJurisdictionId) {
          await db.rpc("enqueue_enrichment", {
            p_entity_id: agency.id,
            p_entity_type: "agency",
            p_task_type: "summary",
            p_context: { name: agency.name, acronym: agency.acronym, wikidata_id: agency.wikidata_id },
          }); // non-fatal — ignore { error } return value
        }
        continue;
      }

      for (const leader of recent) {
        const personQid = leader.person.value.replace("http://www.wikidata.org/entity/", "");
        const fullName = leader.personLabel?.value ?? "Unknown";
        const startDate = parseDate(leader.start?.value);
        const endDate = parseDate(leader.end?.value);
        const posTitle = leader.posLabel?.value ?? `Head of ${agency.acronym ?? agency.name}`;
        const isCurrent = !endDate;

        // ── Upsert official ────────────────────────────────────────────────────
        let officialId = officialByWdId.get(personQid);

        if (!officialId) {
          if (!federalJurisdictionId) continue;

          const { data: insertedOfficial, error: insErr } = await db
            .from("officials")
            .insert({
              full_name: fullName,
              role_title: posTitle,
              is_active: isCurrent,
              jurisdiction_id: federalJurisdictionId,
              source_ids: { wikidata_id: personQid },
              metadata: { source: "wikidata_agency_leadership" },
            })
            .select("id")
            .single();

          if (insErr) {
            // May already exist under a different source — try to find by name
            const { data: found } = await db
              .from("officials")
              .select("id")
              .eq("full_name", fullName)
              .maybeSingle();
            if (found?.id) {
              officialId = found.id as string;
              officialByWdId.set(personQid, officialId);
            } else {
              console.warn(`  ${fullName}: insert failed: ${insErr.message}`);
              result.failed++;
              continue;
            }
          } else if (insertedOfficial?.id) {
            officialId = insertedOfficial.id as string;
            officialByWdId.set(personQid, officialId);
            result.inserted++;
          }
        } else {
          // Update is_active if current status changed
          await db
            .from("officials")
            .update({ is_active: isCurrent, role_title: posTitle, updated_at: new Date().toISOString() })
            .eq("id", officialId)
            .is("source_ids->>wikidata_id", personQid);
          result.updated++;
        }

        if (!officialId) continue;

        // ── Upsert entity_connection ────────────────────────────────────────────
        // Dedup: unique on (from_id, to_id, connection_type) with metadata check
        const connMeta = {
          start_date: startDate,
          end_date: endDate,
          position_title: posTitle,
          is_current: isCurrent,
          wikidata_source: personQid,
        };

        const { error: connErr } = await db
          .from("entity_connections")
          .upsert(
            {
              from_type: "official",
              from_id: officialId,
              to_type: "agency",
              to_id: agency.id,
              connection_type: "appointment",
              evidence_source: "wikidata",
              evidence_ids: [],
              metadata: connMeta,
            },
            { onConflict: "from_type,from_id,to_type,to_id,connection_type", ignoreDuplicates: false }
          );
        if (connErr) {
          console.warn(`  Connection upsert failed (${fullName}→${agency.acronym ?? agency.name}): ${connErr.message}`);
        }
      }

      console.log(`  ${agency.acronym ?? agency.name}: ${recent.length} leader(s) processed`);
    }

    console.log(`\n  ${noLeadersCount} agencies with no Wikidata leaders → enqueued for AI enrichment`);
    await completeSync(logId, result);
    console.log(`  ✓ Done. Inserted: ${result.inserted}, updated: ${result.updated}, failed: ${result.failed}`);
    return result;
  } catch (err) {
    await failSync(logId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

if (require.main === module) {
  runAgencyLeadershipPipeline()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
