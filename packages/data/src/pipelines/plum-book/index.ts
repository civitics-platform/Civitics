/**
 * OPM PLUM Book pipeline — FIX-215.
 *
 * Source: OpenSanctions us_plum_book dataset (daily mirror of OPM PLUM data).
 * Covers ~9,000 Senate-confirmed, presidential, Schedule C, and senior SES
 * positions across all federal agencies — more complete than Congress.gov
 * nominations (which only covers Senate-confirmed) or Wikidata (sparse).
 *
 * FTM entity schema (NDJSON, one entity per line):
 *   Person     — the appointee (name, plum entity id)
 *   Position   — the position title, agency embedded as last comma-segment
 *   Occupancy  — links Person ↔ Position with status/startDate/endDate
 *
 * Version check: HEAD request on the daily file; if Last-Modified / ETag
 * is unchanged since last run (stored in pipeline_state), the pipeline is
 * a no-op. Pass --force to bypass.
 *
 * Run:
 *   pnpm --filter @civitics/data data:plum-book
 *   pnpm --filter @civitics/data data:plum-book -- --force
 */

import { createAdminClient } from "@civitics/db";
import { completeSync, failSync, startSync, getLastSync, type PipelineResult } from "../sync-log";

// ---------------------------------------------------------------------------
// FTM types
// ---------------------------------------------------------------------------

interface FtmEntity {
  id: string;
  schema: string;
  properties: Record<string, string[]>;
}

interface ParsedEntities {
  persons:     Map<string, FtmEntity>;
  positions:   Map<string, FtmEntity>;
  occupancies: FtmEntity[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FTM_URL =
  "https://data.opensanctions.org/datasets/latest/us_plum_book/entities.ftm.json";

// Only ingest occupancies that ended on or after this date (plus all current).
// Covers the full Biden + Trump-47 administrations.
const HISTORICAL_CUTOFF = "2021-01-20";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function firstProp(entity: FtmEntity, prop: string): string | null {
  return entity.properties[prop]?.[0] ?? null;
}

// ---------------------------------------------------------------------------
// Version check
// ---------------------------------------------------------------------------

async function getCurrentDatasetVersion(): Promise<string | null> {
  try {
    const resp = await fetch(FTM_URL, {
      method: "HEAD",
      headers: { "User-Agent": "Civitics/1.0 (civic data platform; contact@civitics.com)" },
    });
    // Prefer ETag (stable content hash) over Last-Modified (clock-sensitive)
    return resp.headers.get("ETag") ?? resp.headers.get("Last-Modified") ?? null;
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getStoredVersion(db: any): Promise<string | null> {
  try {
    const { data } = await db
      .from("pipeline_state")
      .select("value")
      .eq("key", "plum_book_state")
      .maybeSingle();
    return (data?.value as Record<string, string> | null)?.version ?? null;
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function storeVersion(db: any, version: string): Promise<void> {
  try {
    await db
      .from("pipeline_state")
      .upsert({ key: "plum_book_state", value: { version }, updated_at: new Date().toISOString() }, { onConflict: "key" });
  } catch {
    // non-fatal
  }
}

// ---------------------------------------------------------------------------
// Download + parse NDJSON
// ---------------------------------------------------------------------------

async function downloadAndParse(): Promise<ParsedEntities & { bytes: number }> {
  const resp = await fetch(FTM_URL, {
    headers: { "User-Agent": "Civitics/1.0 (civic data platform; contact@civitics.com)" },
  });
  if (!resp.ok) throw new Error(`OpenSanctions HTTP ${resp.status}`);

  const text = await resp.text();
  const bytes = Buffer.byteLength(text, "utf8");

  const persons     = new Map<string, FtmEntity>();
  const positions   = new Map<string, FtmEntity>();
  const occupancies: FtmEntity[] = [];

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entity = JSON.parse(trimmed) as FtmEntity;
      if (entity.schema === "Person")     { persons.set(entity.id, entity);   continue; }
      if (entity.schema === "Position")   { positions.set(entity.id, entity); continue; }
      if (entity.schema === "Occupancy")  { occupancies.push(entity);         continue; }
    } catch {
      // skip malformed lines
    }
  }

  return { persons, positions, occupancies, bytes };
}

// ---------------------------------------------------------------------------
// Agency matching
// ---------------------------------------------------------------------------

interface AgencyRecord {
  id: string;
  name: string;
  acronym: string | null;
  short_name: string | null;
}

function buildAgencyLookup(agencies: AgencyRecord[]): Map<string, AgencyRecord> {
  const m = new Map<string, AgencyRecord>();
  for (const a of agencies) {
    m.set(normalizeName(a.name), a);
    if (a.short_name) m.set(normalizeName(a.short_name), a);
    if (a.acronym)    m.set(normalizeName(a.acronym), a);
  }
  return m;
}

/**
 * Agency name is always the last comma-delimited segment of the position name:
 *   "CHAIR, FEDERAL COMMUNICATIONS COMMISSION"
 *   → "FEDERAL COMMUNICATIONS COMMISSION"
 *
 * Falls back to combining 2 then 3 trailing segments for edge cases like
 * multi-part sub-components that span a comma.
 *
 * Also returns the position title with the agency suffix stripped.
 */
function matchPosition(
  positionName: string,
  agencyLookup: Map<string, AgencyRecord>
): { agency: AgencyRecord; posTitle: string } | null {
  const parts = positionName.split(", ");
  for (let take = 1; take <= Math.min(3, parts.length - 1); take++) {
    const suffix   = parts.slice(parts.length - take).join(", ");
    const match    = agencyLookup.get(normalizeName(suffix));
    if (match) {
      const posTitle = parts.slice(0, parts.length - take).join(", ") || positionName;
      return { agency: match, posTitle };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Stale is_current cleanup (plum_book source only)
// ---------------------------------------------------------------------------

async function closeStaleConnections(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  agencyId: string,
  currentOfficialIds: Set<string>,
  today: string
): Promise<number> {
  if (currentOfficialIds.size === 0) return 0;

  const inList = [...currentOfficialIds].join(",");
  const { data: staleConns } = await db
    .from("entity_connections")
    .select("id, metadata")
    .eq("to_type", "agency")
    .eq("to_id", agencyId)
    .eq("from_type", "official")
    .eq("connection_type", "appointment")
    .eq("evidence_source", "plum_book")
    .filter("metadata->>is_current", "eq", "true")
    .not("from_id", "in", `(${inList})`);

  if (!staleConns?.length) return 0;

  let closed = 0;
  for (const conn of staleConns) {
    const { error } = await db
      .from("entity_connections")
      .update({
        metadata:   { ...(conn.metadata ?? {}), is_current: false },
        ended_at:   today,
        derived_at: new Date().toISOString(),
      })
      .eq("id", conn.id);
    if (!error) closed++;
  }
  return closed;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runPlumBookPipeline(opts: { force?: boolean } = {}): Promise<PipelineResult> {
  console.log("\n=== OPM PLUM Book pipeline ===");

  const logId  = await startSync("plum_book");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db     = createAdminClient() as any;
  const result: PipelineResult = { inserted: 0, updated: 0, failed: 0, estimatedMb: 0 };
  const today  = new Date().toISOString().slice(0, 10);
  const force  = opts.force ?? process.argv.includes("--force");

  try {
    // ── Version check ──────────────────────────────────────────────────────
    const currentVersion = await getCurrentDatasetVersion();
    if (currentVersion && !force) {
      const storedVersion = await getStoredVersion(db);
      if (storedVersion === currentVersion) {
        console.log(`  No new release (${currentVersion}) — skipping`);
        await completeSync(logId, result);
        return result;
      }
      console.log(`  New release detected: ${currentVersion} (was ${storedVersion ?? "never run"})`);
    } else if (force) {
      console.log("  --force: skipping version check");
    }

    // ── Download + parse ───────────────────────────────────────────────────
    console.log("  Downloading entities.ftm.json...");
    const { persons, positions, occupancies, bytes } = await downloadAndParse();
    result.estimatedMb = +(bytes / 1024 / 1024).toFixed(2);
    console.log(
      `  Parsed: ${persons.size.toLocaleString()} persons, ` +
      `${positions.size.toLocaleString()} positions, ` +
      `${occupancies.length.toLocaleString()} occupancies ` +
      `(${result.estimatedMb} MB)`
    );

    // ── Load agencies ──────────────────────────────────────────────────────
    const { data: agencyData, error: agErr } = await db
      .from("agencies")
      .select("id, name, acronym, short_name")
      .eq("agency_type", "federal");
    if (agErr) throw new Error(agErr.message);

    const agencies     = (agencyData ?? []) as AgencyRecord[];
    const agencyLookup = buildAgencyLookup(agencies);
    console.log(`  ${agencies.length} federal agencies in lookup`);

    // ── Federal jurisdiction ───────────────────────────────────────────────
    const { data: jurData } = await db
      .from("jurisdictions")
      .select("id")
      .eq("fips_code", "00")
      .maybeSingle();
    const federalJurisdictionId = jurData?.id as string | null;
    if (!federalJurisdictionId) {
      console.warn("  WARNING: federal jurisdiction (fips_code=00) not found — inserts will be skipped");
    }

    // ── Build official lookup by plum_id ───────────────────────────────────
    const { data: existingOfficials } = await db
      .from("officials")
      .select("id, source_ids")
      .not("source_ids->>plum_id", "is", null);
    const officialByPlumId = new Map<string, string>();
    for (const o of existingOfficials ?? []) {
      const plumId = (o.source_ids as Record<string, string> | null)?.plum_id;
      if (plumId) officialByPlumId.set(plumId, o.id as string);
    }
    console.log(`  ${officialByPlumId.size} officials with plum_id already in DB`);

    // ── Filter occupancies ─────────────────────────────────────────────────
    const relevant = occupancies.filter((occ) => {
      if (firstProp(occ, "status") === "current") return true;
      const end = firstProp(occ, "endDate");
      return !!end && end >= HISTORICAL_CUTOFF;
    });
    console.log(`  ${relevant.length.toLocaleString()} relevant occupancies (current + ended ≥ ${HISTORICAL_CUTOFF})`);

    // ── Process occupancies ────────────────────────────────────────────────
    const currentsByAgency = new Map<string, Set<string>>();
    let matched   = 0;
    let unmatched = 0;

    for (const occ of relevant) {
      const personId   = firstProp(occ, "holder");
      const positionId = firstProp(occ, "post");
      if (!personId || !positionId) continue;

      const person   = persons.get(personId);
      const position = positions.get(positionId);
      if (!person || !position) continue;

      const positionName = firstProp(position, "name");
      if (!positionName) continue;

      const hit = matchPosition(positionName, agencyLookup);
      if (!hit) { unmatched++; continue; }
      matched++;

      const { agency, posTitle } = hit;
      const isCurrent       = firstProp(occ, "status") === "current";
      const startDate       = firstProp(occ, "startDate");
      const endDate         = firstProp(occ, "endDate");
      const appointmentType = firstProp(occ, "description"); // pay/appointment code
      const personName      = firstProp(person, "name") ?? "Unknown";

      // ── Upsert official ──────────────────────────────────────────────────
      let officialId = officialByPlumId.get(personId);

      if (!officialId) {
        if (!federalJurisdictionId) continue;

        // Name-match fallback before creating a new row
        const { data: byName } = await db
          .from("officials")
          .select("id, source_ids")
          .eq("full_name", personName)
          .maybeSingle();

        if (byName?.id) {
          officialId = byName.id as string;
          await db
            .from("officials")
            .update({
              source_ids:  { ...(byName.source_ids ?? {}), plum_id: personId },
              is_active:   isCurrent,
              updated_at:  new Date().toISOString(),
            })
            .eq("id", officialId);
          officialByPlumId.set(personId, officialId);
          result.updated++;
        } else {
          const { data: ins, error: insErr } = await db
            .from("officials")
            .insert({
              full_name:       personName,
              role_title:      posTitle.slice(0, 200),
              is_active:       isCurrent,
              jurisdiction_id: federalJurisdictionId,
              source_ids:      { plum_id: personId },
              metadata:        { source: "plum_book", appointment_type: appointmentType },
            })
            .select("id")
            .single();

          if (insErr || !ins?.id) { result.failed++; continue; }
          officialId = ins.id as string;
          officialByPlumId.set(personId, officialId);
          result.inserted++;
        }
      } else {
        await db
          .from("officials")
          .update({
            is_active:  isCurrent,
            role_title: posTitle.slice(0, 200),
            updated_at: new Date().toISOString(),
          })
          .eq("id", officialId);
        result.updated++;
      }

      if (!officialId) continue;

      if (isCurrent) {
        const s = currentsByAgency.get(agency.id) ?? new Set<string>();
        s.add(officialId);
        currentsByAgency.set(agency.id, s);
      }

      // ── Upsert entity_connection ─────────────────────────────────────────
      await db.from("entity_connections").upsert(
        {
          from_type:       "official",
          from_id:         officialId,
          to_type:         "agency",
          to_id:           agency.id,
          connection_type: "appointment",
          strength:        isCurrent ? 1.0 : 0.5,
          occurred_at:     startDate ?? null,
          ended_at:        endDate   ?? null,
          evidence_source: "plum_book",
          metadata: {
            start_date:       startDate,
            end_date:         endDate,
            position_title:   posTitle.slice(0, 300),
            position_property: "plum_book",
            appointment_type: appointmentType,
            is_current:       isCurrent,
            plum_person_id:   personId,
            plum_position_id: positionId,
          },
        },
        { onConflict: "from_type,from_id,to_type,to_id,connection_type", ignoreDuplicates: false }
      );
    }

    console.log(`  Agency matches: ${matched.toLocaleString()}, unmatched: ${unmatched.toLocaleString()}`);

    // ── Close stale is_current connections ────────────────────────────────
    let totalStaleClosed = 0;
    for (const [agencyId, currentIds] of currentsByAgency) {
      totalStaleClosed += await closeStaleConnections(db, agencyId, currentIds, today);
    }
    if (totalStaleClosed > 0) {
      console.log(`  Stale connections closed: ${totalStaleClosed}`);
    }

    // ── Persist version so next weekly run can skip if unchanged ──────────
    if (currentVersion) await storeVersion(db, currentVersion);

    await completeSync(logId, result);
    console.log(`\n  ✓ Done. Inserted: ${result.inserted}, updated: ${result.updated}, failed: ${result.failed}`);
    return result;
  } catch (err) {
    await failSync(logId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

if (require.main === module) {
  runPlumBookPipeline()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
