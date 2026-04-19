/**
 * Elections pipeline — FIX-022.
 *
 * Populates the election-status columns on `officials`:
 *   current_term_start, current_term_end, next_election_date,
 *   next_election_type, is_up_for_election
 *
 * Sources (no external API fetches — all derived from data we already have):
 *   - Existing term_start / term_end columns (set by Congress + OpenStates pipelines).
 *   - Static US federal election calendar (general elections are Nov of even years;
 *     Senate class cycle is deterministic).
 *
 * Ballotpedia was considered as a secondary source but its free API coverage is
 * narrower than the static federal calendar + OpenStates term_end data. Phase 2
 * may add a Ballotpedia pipeline for contested-primary metadata.
 *
 * Safe to re-run: UPDATEs are idempotent.
 *
 * Run standalone:
 *   pnpm --filter @civitics/data data:elections
 */

import { createAdminClient } from "@civitics/db";
import { completeSync, failSync, startSync, type PipelineResult } from "../sync-log";

// ---------------------------------------------------------------------------
// US federal election calendar
// ---------------------------------------------------------------------------

// General elections: first Tuesday after first Monday of November, even years.
// Hard-coded through 2032 — covers Phase 1 horizon; Phase 2 may extend.
const FEDERAL_GENERAL_ELECTIONS: string[] = [
  "2024-11-05",
  "2026-11-03",
  "2028-11-07",
  "2030-11-05",
  "2032-11-02",
];

function nextFederalGeneral(asOf: Date): string | null {
  const now = asOf.toISOString().slice(0, 10);
  for (const d of FEDERAL_GENERAL_ELECTIONS) {
    if (d > now) return d;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OfficialRow {
  id: string;
  role_title: string | null;
  term_start: string | null;
  term_end: string | null;
  jurisdiction_id: string;
  governing_body_id: string | null;
  metadata: Record<string, unknown> | null;
}

interface JurisdictionRow {
  id: string;
  type: string;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runElectionsPipeline(): Promise<PipelineResult> {
  console.log("\n=== Elections pipeline ===");
  const logId = await startSync("elections");
  const db = createAdminClient();
  const result: PipelineResult = { inserted: 0, updated: 0, failed: 0, estimatedMb: 0 };

  try {
    const { data: jRows, error: jErr } = await db
      .from("jurisdictions")
      .select("id, type");
    if (jErr) throw new Error(jErr.message);
    const jurisdictionType = new Map<string, string>();
    for (const j of (jRows ?? []) as JurisdictionRow[]) jurisdictionType.set(j.id, j.type);

    // Paginate officials in 1000-row chunks to avoid memory spikes on full table.
    const now = new Date();
    const nowIso = now.toISOString().slice(0, 10);
    const pageSize = 1000;
    let offset = 0;
    let processed = 0;

    for (;;) {
      const { data, error } = await db
        .from("officials")
        .select("id, role_title, term_start, term_end, jurisdiction_id, governing_body_id, metadata")
        .eq("is_active", true)
        .order("id", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw new Error(error.message);

      const rows = (data ?? []) as OfficialRow[];
      if (rows.length === 0) break;

      for (const r of rows) {
        const jType = jurisdictionType.get(r.jurisdiction_id);
        // Federal officials live under the 'country' jurisdiction (United States).
        const isFederal = jType === "country";

        // Current term copy-over (idempotent; same value if already set).
        const currentTermStart = r.term_start;
        const currentTermEnd   = r.term_end;

        let nextElectionDate: string | null = null;
        let nextElectionType: string | null = null;

        if (isFederal) {
          // Federal officials: next federal general election.
          nextElectionDate = nextFederalGeneral(now);
          nextElectionType = "general";
        } else if (currentTermEnd) {
          // State/local officials: derive from term_end. Election is typically
          // the November before the term ends — so approximate to the nearest
          // federal-general date before or equal to term_end.
          const termEndIso = currentTermEnd;
          // Find the latest election date that's <= term_end.
          for (let i = FEDERAL_GENERAL_ELECTIONS.length - 1; i >= 0; i--) {
            const d = FEDERAL_GENERAL_ELECTIONS[i]!;
            if (d <= termEndIso && d >= nowIso) {
              nextElectionDate = d;
              nextElectionType = "general";
              break;
            }
          }
        }

        const isUp = nextElectionDate !== null
          && nextElectionDate >= nowIso
          && // "up for election" if within the next 13 months
             (Date.parse(nextElectionDate) - now.getTime()) / 86400000 <= 400;

        const patch = {
          current_term_start: currentTermStart,
          current_term_end:   currentTermEnd,
          next_election_date: nextElectionDate,
          next_election_type: nextElectionType,
          is_up_for_election: isUp,
        };

        const { error: upErr } = await db
          .from("officials")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .update(patch as any)
          .eq("id", r.id);
        if (upErr) {
          result.failed++;
        } else {
          result.updated++;
        }
        processed++;
      }

      offset += rows.length;
      if (rows.length < pageSize) break;
    }

    console.log(`  Processed ${processed} officials. Updated: ${result.updated}, failed: ${result.failed}`);

    await completeSync(logId, result);
    return result;
  } catch (err) {
    await failSync(logId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

if (require.main === module) {
  runElectionsPipeline()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
