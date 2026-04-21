/**
 * spending-shadow pipeline.
 *
 * Migrates public.spending_records → shadow.financial_relationships (Decision C,
 * Decision E.4). Government contracts and grants are first-class financial
 * relationships in the shadow schema, so shadow.rebuild_entity_connections()
 * can derive `contract_award` edges automatically.
 *
 * Design:
 *   - FROM side: agency (looked up via source_ids->>'agency_acronym')
 *   - TO side:   financial_entity (corporation — find-or-create by canonical name)
 *   - relationship_type: 'contract' when cfda_number is null, 'grant' when present
 *   - Temporal model: occurred_at = award_date (one-off event)
 *   - Dedup key: usaspending_award_id (UNIQUE partial index on shadow table)
 *
 * Run:
 *   pnpm --filter @civitics/data data:spending-shadow
 */

import { createAdminClient } from "@civitics/db";
import { shadowClient, sleep } from "../utils";
import { startSync, completeSync, failSync, type PipelineResult } from "../sync-log";
import { canonicalizeEntityName } from "../fec-bulk/shadow-writer";

type Db = ReturnType<typeof createAdminClient>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ShadowDb = any;

const BATCH_SIZE = 200;

// ---------------------------------------------------------------------------
// Agency map: acronym → UUID
// ---------------------------------------------------------------------------

async function loadAgencyMap(db: Db): Promise<Map<string, string>> {
  const { data, error } = await db
    .from("agencies")
    .select("id, acronym")
    .not("acronym", "is", null);

  if (error) {
    console.error("  Failed to load agencies:", error.message);
    return new Map();
  }

  const map = new Map<string, string>();
  for (const row of data ?? []) {
    if (row.acronym) map.set(row.acronym.toUpperCase(), row.id as string);
  }
  console.log(`  Loaded ${map.size} agencies`);
  return map;
}

// ---------------------------------------------------------------------------
// Recipient entity: find or create in shadow.financial_entities
// ---------------------------------------------------------------------------

async function findOrCreateRecipientEntity(
  sdb: ShadowDb,
  recipientName: string,
): Promise<string | null> {
  const displayName = recipientName.trim().slice(0, 500);
  const canonicalName = canonicalizeEntityName(displayName);
  if (!canonicalName) return null;

  // Primary lookup: UNIQUE(canonical_name, entity_type)
  const { data: existing, error: selErr } = await sdb
    .from("financial_entities")
    .select("id")
    .eq("canonical_name", canonicalName)
    .eq("entity_type", "corporation")
    .maybeSingle();

  if (selErr) {
    console.error(`    financial_entities lookup error for "${displayName}": ${selErr.message}`);
    return null;
  }

  if (existing?.id) return existing.id as string;

  // Insert new entity
  const { data: inserted, error: insErr } = await sdb
    .from("financial_entities")
    .insert({
      canonical_name: canonicalName,
      display_name: displayName,
      entity_type: "corporation",
      total_donated_cents: 0,
      total_received_cents: 0,
      metadata: { source: "usaspending" },
    })
    .select("id")
    .single();

  if (insErr) {
    if (insErr.code === "23505") {
      // Race — another insert won; retry select
      const { data: retry } = await sdb
        .from("financial_entities")
        .select("id")
        .eq("canonical_name", canonicalName)
        .eq("entity_type", "corporation")
        .maybeSingle();
      return (retry?.id as string) ?? null;
    }
    console.error(`    financial_entities insert failed for "${displayName}": ${insErr.message}`);
    return null;
  }

  return (inserted?.id as string) ?? null;
}

// ---------------------------------------------------------------------------
// Relationship upsert
// ---------------------------------------------------------------------------

type OutcomeStr = "inserted" | "updated" | "skipped" | "failed";

interface SpendingRelationshipInput {
  agencyId: string;
  recipientEntityId: string;
  relationshipType: "contract" | "grant";
  amountCents: number;
  occurredAt: string;              // ISO date
  usaspendingAwardId: string | null;
  naicsCode: string | null;
  cfdaNumber: string | null;
  description: string | null;
  sourceUrl: string | null;
}

async function upsertSpendingRelationship(
  sdb: ShadowDb,
  input: SpendingRelationshipInput,
): Promise<OutcomeStr> {
  // Dedup via usaspending_award_id unique partial index
  if (input.usaspendingAwardId) {
    const { data: existing } = await sdb
      .from("financial_relationships")
      .select("id")
      .eq("usaspending_award_id", input.usaspendingAwardId)
      .maybeSingle();

    if (existing?.id) {
      const { error: updErr } = await sdb
        .from("financial_relationships")
        .update({
          amount_cents: input.amountCents,
          occurred_at: input.occurredAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      return updErr ? "failed" : "updated";
    }
  }

  const { error: insErr } = await sdb
    .from("financial_relationships")
    .insert({
      relationship_type: input.relationshipType,
      from_type: "agency",
      from_id: input.agencyId,
      to_type: "financial_entity",
      to_id: input.recipientEntityId,
      amount_cents: input.amountCents,
      occurred_at: input.occurredAt,
      started_at: null,
      ended_at: null,
      usaspending_award_id: input.usaspendingAwardId ?? null,
      source_url: input.sourceUrl,
      metadata: {
        source: "usaspending",
        ...(input.naicsCode ? { naics_code: input.naicsCode } : {}),
        ...(input.cfdaNumber ? { cfda_number: input.cfdaNumber } : {}),
        ...(input.description ? { description: input.description } : {}),
      },
    });

  if (insErr) {
    if (insErr.code === "23505") return "skipped"; // already inserted concurrently
    console.error(`    financial_relationships insert failed: ${insErr.message}`);
    return "failed";
  }

  return "inserted";
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

export async function runSpendingShadowPipeline(): Promise<PipelineResult> {
  console.log("\n=== spending-shadow pipeline ===");
  const logId = await startSync("spending_shadow");
  const db = createAdminClient();
  const sdb: ShadowDb = shadowClient(db);

  let inserted = 0, updated = 0, skipped = 0, failed = 0;

  try {
    const agencyMap = await loadAgencyMap(db);
    if (agencyMap.size === 0) {
      console.warn("  No agencies found — cannot resolve FROM side. Aborting.");
      await failSync(logId, "No agencies loaded");
      return { inserted: 0, updated: 0, failed: 1, estimatedMb: 0 };
    }

    let lastId: string | null = null;
    let page = 0;
    let totalFetched = 0;

    while (true) {
      page++;
      let q = db
        .from("spending_records")
        .select("id, recipient_name, source_ids, amount_cents, award_date, period_of_performance_start, usaspending_award_id, naics_code, cfda_number, description")
        .order("id")
        .limit(BATCH_SIZE);
      if (lastId) q = q.gt("id", lastId);

      const { data: records, error } = await q;

      if (error) {
        console.error(`  spending_records fetch error (page ${page}):`, error.message);
        break;
      }
      if (!records || records.length === 0) break;

      lastId = records[records.length - 1].id as string;
      totalFetched += records.length;

      for (const rec of records) {
        const sourceIds = (rec.source_ids ?? {}) as Record<string, string | undefined>;
        const acronym = (sourceIds["agency_acronym"] ?? "").toUpperCase();
        const agencyId = agencyMap.get(acronym) ?? null;

        if (!agencyId) {
          skipped++;
          continue;
        }

        const recipientName = (rec.recipient_name ?? "").trim();
        if (!recipientName) { skipped++; continue; }

        const recipientEntityId = await findOrCreateRecipientEntity(sdb, recipientName);
        if (!recipientEntityId) { failed++; continue; }

        // Temporal: occurred_at must be non-null (CHECK constraint)
        const occurredAt =
          (rec.award_date as string | null) ??
          (rec.period_of_performance_start as string | null) ??
          new Date().toISOString().slice(0, 10);

        const relationshipType = rec.cfda_number ? "grant" : "contract";

        const awardUrl = rec.usaspending_award_id
          ? `https://www.usaspending.gov/award/${rec.usaspending_award_id}/`
          : null;

        const outcome = await upsertSpendingRelationship(sdb, {
          agencyId,
          recipientEntityId,
          relationshipType,
          amountCents: rec.amount_cents as number,
          occurredAt,
          usaspendingAwardId: rec.usaspending_award_id as string | null,
          naicsCode: rec.naics_code as string | null,
          cfdaNumber: rec.cfda_number as string | null,
          description: rec.description as string | null,
          sourceUrl: awardUrl,
        });

        if (outcome === "inserted") inserted++;
        else if (outcome === "updated") updated++;
        else if (outcome === "skipped") skipped++;
        else failed++;
      }

      if (page % 5 === 0) {
        console.log(`  Page ${page} — fetched ${totalFetched} records · inserted ${inserted} · updated ${updated} · skipped ${skipped} · failed ${failed}`);
      }

      if (records.length < BATCH_SIZE) break;
      await sleep(50);
    }

    const estimatedMb = +((inserted + updated) * 400 / 1024 / 1024).toFixed(2);
    const result: PipelineResult = { inserted, updated, failed, estimatedMb };

    console.log(`\n  Done — inserted: ${inserted}, updated: ${updated}, skipped: ${skipped}, failed: ${failed}`);
    console.log(`  Estimated storage: ~${estimatedMb} MB`);

    await completeSync(logId, result);
    return result;

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("  spending-shadow pipeline fatal error:", msg);
    await failSync(logId, msg);
    return { inserted, updated, failed, estimatedMb: 0 };
  }
}

// ---------------------------------------------------------------------------
// Standalone entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  runSpendingShadowPipeline()
    .then(() => { setTimeout(() => process.exit(0), 500); })
    .catch((err) => {
      console.error("Pipeline failed:", err);
      setTimeout(() => process.exit(1), 500);
    });
}
