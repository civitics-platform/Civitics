/**
 * Civic Initiatives — Stage 1B shadow backfill.
 *
 * Per L1 decision I-B: existing public.civic_initiatives rows are migrated into
 * the shadow schema as:
 *   shadow.proposals          (type='initiative', same UUID reused)
 *   shadow.initiative_details (1:1 with the proposal row)
 *   shadow.external_source_refs (source='civic_initiatives_public', external_id=id)
 *
 * Reusing the same UUID means existing FKs (comments, signatures, votes) survive
 * the Stage 2 cutover without translation.
 *
 * This script is safe to re-run: all three tables upsert on conflict.
 *
 * Run:
 *   pnpm --filter @civitics/data data:shadow-initiatives
 */

import { createAdminClient } from "@civitics/db";
import { shadowClient, sleep, type ShadowDb } from "../utils";
import {
  startSync,
  completeSync,
  failSync,
  type PipelineResult,
} from "../sync-log";

const FETCH_SIZE  = 500;
const UPSERT_SIZE = 200; // smaller batches — three tables per row

// ---------------------------------------------------------------------------
// Stage → proposal_status mapping
//
// civic_initiatives.stage maps onto proposal_status as follows:
//   draft       → 'introduced'
//   deliberate  → 'in_committee'   (closest analogue: open for review/argument)
//   mobilise    → 'floor_vote'     (close enough: active signature drive)
//   resolved    → computed below (depends on resolution_type)
// ---------------------------------------------------------------------------
const STAGE_TO_STATUS: Record<string, string> = {
  draft:      "introduced",
  deliberate: "in_committee",
  mobilise:   "floor_vote",
  resolved:   "enacted",   // overridden per resolution_type below
};

function toProposalStatus(
  stage: string,
  resolutionType: string | null,
): string {
  if (stage === "resolved") {
    if (resolutionType === "sponsored") return "enacted";
    if (resolutionType === "declined")  return "vetoed";
    if (resolutionType === "withdrawn") return "vetoed";
    if (resolutionType === "expired")   return "comment_closed";
    return "enacted";
  }
  return STAGE_TO_STATUS[stage] ?? "introduced";
}

// ---------------------------------------------------------------------------
// Resolve jurisdiction ID
//
// civic_initiatives.jurisdiction_id may be set; if not, fall back to the
// federal USA jurisdiction. Using federal as default is safe for Stage 1B
// because all existing initiatives predate local jurisdiction coverage.
// ---------------------------------------------------------------------------

async function resolveFederalJurisdictionId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
): Promise<string | null> {
  const { data, error } = await db
    .from("jurisdictions")
    .select("id")
    .eq("jurisdiction_type", "federal")
    .ilike("name", "%United States%")
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("    Error looking up federal jurisdiction:", error.message);
    return null;
  }
  return data?.id ?? null;
}

// ---------------------------------------------------------------------------
// Main backfill
// ---------------------------------------------------------------------------

export async function runInitiativesShadowBackfill(): Promise<PipelineResult> {
  console.log("\n=== Civic Initiatives — Stage 1B shadow backfill ===");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db  = createAdminClient() as any;
  const sdb: ShadowDb = shadowClient(db);

  const logId = await startSync("shadow-initiatives-backfill");

  let inserted = 0;
  let failed   = 0;

  try {
    // ── 1. Load federal jurisdiction fallback ────────────────────────────────
    const federalJurisdictionId = await resolveFederalJurisdictionId(db);
    if (!federalJurisdictionId) {
      console.error("  Fatal: federal jurisdiction not found — run data:jurisdictions first.");
      await failSync(logId, "federal jurisdiction not found");
      return { inserted: 0, updated: 0, failed: 1, estimatedMb: 0 };
    }
    console.log(`  Federal jurisdiction: ${federalJurisdictionId}`);

    // ── 2. Paginate public.civic_initiatives ─────────────────────────────────
    let lastId: string | null = null;
    let page = 0;
    let total = 0;

    while (true) {
      page++;
      let q = db
        .from("civic_initiatives")
        .select(
          "id, title, summary, body_md, stage, authorship_type, primary_author_id, " +
          "linked_proposal_id, scope, target_district, issue_area_tags, quality_gate_score, " +
          "mobilise_started_at, resolved_at, resolution_type, jurisdiction_id, " +
          "created_at, updated_at"
        )
        .order("id")
        .limit(FETCH_SIZE);
      if (lastId) q = q.gt("id", lastId);

      const { data: rows, error } = await q;
      if (error) {
        console.error(`    Error fetching civic_initiatives page ${page}:`, error.message);
        failed++;
        break;
      }
      if (!rows || rows.length === 0) break;

      lastId = String(rows[rows.length - 1].id);
      total += rows.length;
      console.log(`    Page ${page}: ${rows.length} rows (total so far: ${total})`);

      // ── 3. Build three sets of upsert rows per page ──────────────────────
      const shadowProposalRows = [];
      const initiativeDetailRows = [];
      const extRefRows = [];

      for (const ci of rows) {
        const jurisdictionId = ci.jurisdiction_id ?? federalJurisdictionId;
        const status = toProposalStatus(
          String(ci.stage ?? "draft"),
          ci.resolution_type ?? null,
        );

        // shadow.proposals
        shadowProposalRows.push({
          id:              ci.id,              // reuse same UUID
          type:            "initiative",
          status,
          jurisdiction_id: jurisdictionId,
          title:           ci.title,
          short_title:     ci.title.slice(0, 80),
          summary_plain:   ci.summary ?? null,
          introduced_at:   ci.created_at ? String(ci.created_at).slice(0, 10) : null,
          last_action_at:  ci.updated_at ? String(ci.updated_at).slice(0, 10) : null,
          resolved_at:     ci.resolved_at ? String(ci.resolved_at).slice(0, 10) : null,
          metadata:        {},
          created_at:      ci.created_at,
          updated_at:      ci.updated_at ?? new Date().toISOString(),
        });

        // shadow.initiative_details
        initiativeDetailRows.push({
          proposal_id:         ci.id,
          stage:               ci.stage ?? "draft",
          authorship_type:     ci.authorship_type ?? "individual",
          primary_author_id:   ci.primary_author_id ?? null,
          scope:               ci.scope ?? "federal",
          target_district:     ci.target_district ?? null,
          body_md:             ci.body_md ?? "",
          issue_area_tags:     ci.issue_area_tags ?? [],
          quality_gate_score:  ci.quality_gate_score ?? {},
          mobilise_started_at: ci.mobilise_started_at ?? null,
          signature_threshold: null,
          resolution_type:     ci.resolution_type ?? null,
          promoted_to_proposal_id: ci.linked_proposal_id ?? null,
        });

        // shadow.external_source_refs
        extRefRows.push({
          source:      "civic_initiatives_public",
          external_id: String(ci.id),
          entity_type: "proposal",
          entity_id:   ci.id,
          last_seen_at: new Date().toISOString(),
          metadata:    { stage: ci.stage, scope: ci.scope },
        });
      }

      // ── 4. Upsert in chunks ──────────────────────────────────────────────

      // shadow.proposals
      for (let i = 0; i < shadowProposalRows.length; i += UPSERT_SIZE) {
        const chunk = shadowProposalRows.slice(i, i + UPSERT_SIZE);
        const { error: e } = await sdb
          .from("proposals")
          .upsert(chunk, { onConflict: "id" });
        if (e) {
          console.error(`    shadow.proposals upsert error:`, e.message);
          failed += chunk.length;
        } else {
          inserted += chunk.length;
        }
      }

      // shadow.initiative_details (upsert after proposals — FK dep)
      for (let i = 0; i < initiativeDetailRows.length; i += UPSERT_SIZE) {
        const chunk = initiativeDetailRows.slice(i, i + UPSERT_SIZE);
        const { error: e } = await sdb
          .from("initiative_details")
          .upsert(chunk, { onConflict: "proposal_id" });
        if (e) {
          console.error(`    shadow.initiative_details upsert error:`, e.message);
          failed += chunk.length;
        }
      }

      // shadow.external_source_refs
      for (let i = 0; i < extRefRows.length; i += UPSERT_SIZE) {
        const chunk = extRefRows.slice(i, i + UPSERT_SIZE);
        const { error: e } = await sdb
          .from("external_source_refs")
          .upsert(chunk, { onConflict: "source,external_id" });
        if (e) {
          console.error(`    shadow.external_source_refs upsert error:`, e.message);
          // non-fatal: ref table
        }
      }

      if (rows.length < FETCH_SIZE) break;
      await sleep(100);
    }

    const result: PipelineResult = { inserted, updated: 0, failed, estimatedMb: 0 };

    console.log("\n  ──────────────────────────────────────────────────");
    console.log("  Civic initiatives shadow backfill report");
    console.log("  ──────────────────────────────────────────────────");
    console.log(`  ${"Total public rows processed:".padEnd(36)} ${total}`);
    console.log(`  ${"shadow.proposals upserted:".padEnd(36)} ${inserted}`);
    console.log(`  ${"failed:".padEnd(36)} ${failed}`);
    console.log(`  ${"Note:".padEnd(36)} re-run shadow-connections after this`);

    await completeSync(logId, result);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("  Backfill fatal error:", msg);
    await failSync(logId, msg);
    return { inserted, updated: 0, failed: failed + 1, estimatedMb: 0 };
  }
}

// ---------------------------------------------------------------------------
// Standalone entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  runInitiativesShadowBackfill()
    .then(() => { setTimeout(() => process.exit(0), 500); })
    .catch((err) => {
      console.error("Backfill failed:", err);
      setTimeout(() => process.exit(1), 500);
    });
}
