/**
 * Elections pipeline — FIX-022.
 *
 * Populates the election-status columns on `officials`:
 *   current_term_start, current_term_end, next_election_date,
 *   next_election_type, is_up_for_election
 *
 * Sources (no external API fetches — all derived from data we already have):
 *   - Existing term_start / term_end columns (set by Congress + OpenStates pipelines).
 *   - Curated US federal + state election calendar in ./calendar.ts. The state
 *     calendar covers NJ/VA/KY/LA/MS odd-year cycles; other states fall back
 *     to the federal calendar.
 *
 * Ballotpedia was considered as a secondary source but its free API coverage is
 * narrower than the curated state calendar + OpenStates term_end data. Phase 2
 * may add a Ballotpedia pipeline for contested-primary metadata.
 *
 * Safe to re-run: UPDATEs are idempotent.
 *
 * Run standalone:
 *   pnpm --filter @civitics/data data:elections
 */

import { createAdminClient } from "@civitics/db";
import { completeSync, failSync, startSync, type PipelineResult } from "../sync-log";
import {
  FEDERAL_GENERAL_ELECTIONS,
  STATE_ELECTION_CALENDAR,
  nextLegislativeElection,
  nextGubernatorialElection,
} from "./calendar";

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

    // Build a "this governing_body is federal" lookup. Federal House/Senate
    // members can have jurisdiction_id set to their state (not 'country'),
    // so we need governing_body to disambiguate.
    const { data: gbRows, error: gbErr } = await db
      .from("governing_bodies")
      .select("id, name");
    if (gbErr) throw new Error(gbErr.message);
    const federalGoverningBody = new Set<string>();
    for (const gb of (gbRows ?? []) as Array<{ id: string; name: string | null }>) {
      const n = (gb.name ?? "").toLowerCase();
      if (n.includes("united states") || n.startsWith("u.s. ") || n.startsWith("us ")) {
        federalGoverningBody.add(gb.id);
      }
    }

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
        // Federal officials either live under the 'country' jurisdiction
        // OR are attached to a state jurisdiction (e.g. NJ Reps) but belong
        // to a federal governing body (US House / US Senate).
        const isFederal = jType === "country"
          || (r.governing_body_id !== null && federalGoverningBody.has(r.governing_body_id));

        // Current term copy-over (idempotent; same value if already set).
        const currentTermStart = r.term_start;
        const currentTermEnd   = r.term_end;

        const stateAbbr = (r.metadata && typeof r.metadata["state"] === "string")
          ? (r.metadata["state"] as string)
          : null;

        // Governor detection: role title contains "governor" but not
        // "lieutenant" (lt govs are typically on the same cycle anyway, but
        // if data ever reflects a distinct cycle we'd want to handle that).
        const role = (r.role_title ?? "").toLowerCase();
        const isGovernor = role.includes("governor") && !role.includes("lieutenant");

        let nextElectionDate: string | null = null;
        let nextElectionType: string | null = null;

        if (isFederal) {
          // Federal officials: next federal general election.
          nextElectionDate = nextFederalGeneral(now);
          nextElectionType = "general";
        } else if (isGovernor) {
          // State governor: separate cycle in KY/LA/MS/NJ/VA, federal cycle elsewhere.
          nextElectionDate = nextGubernatorialElection(stateAbbr, nowIso);
          nextElectionType = "general";
        } else {
          // State/local officials. Use the state-specific legislative calendar
          // when available. If we have a term_end, prefer the latest cycle
          // date that falls on or before term_end (i.e. the actual election
          // that ends THIS term); otherwise fall back to the next upcoming.
          const candidates =
            (stateAbbr && STATE_ELECTION_CALENDAR[stateAbbr]?.legislative)
            ?? FEDERAL_GENERAL_ELECTIONS;

          if (currentTermEnd) {
            for (let i = candidates.length - 1; i >= 0; i--) {
              const d = candidates[i]!;
              if (d <= currentTermEnd && d >= nowIso) {
                nextElectionDate = d;
                nextElectionType = "general";
                break;
              }
            }
          }
          if (!nextElectionDate) {
            nextElectionDate = nextLegislativeElection(stateAbbr, nowIso);
            if (nextElectionDate) nextElectionType = "general";
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
