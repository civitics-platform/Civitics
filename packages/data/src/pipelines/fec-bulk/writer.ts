/**
 * FEC bulk writer — post-cutover, batched writes against public.
 *
 * Tables written:
 *   public.financial_entities        (dedup via fec_committee_id UNIQUE)
 *   public.financial_relationships   (dedup via financial_relationships_donation_unique
 *                                     partial index, added in 20260423000000)
 *
 * All writes go through `upsert` with `onConflict` so a full run collapses to
 * O(chunks) round-trips instead of O(rows). Earlier revision did SELECT +
 * INSERT per row; on local Docker that was fine, but against Pro with ~100ms
 * RTT, 33k round-trips put one run at ~55 min. Batched it's under a minute.
 *
 * entity_connections is NOT written here. Per L5 it's derivation-only; the
 * rebuild_entity_connections() SQL function handles donation edges.
 */

import type { createAdminClient } from "@civitics/db";

type Db = ReturnType<typeof createAdminClient>;

const ENTITY_CHUNK = 500;
const RELATIONSHIP_CHUNK = 500;

// ---------------------------------------------------------------------------
// Name canonicalization
// ---------------------------------------------------------------------------

/**
 * Canonical (dedup-friendly) form of a committee / entity name.
 *   - uppercase, strip punctuation, collapse whitespace
 *   - strip trailing corporate suffix (INC/LLC/CORP/PAC/COMMITTEE)
 */
export function canonicalizeEntityName(raw: string): string {
  const base = (raw ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return base
    .replace(/\s+(INC|LLC|LTD|CORP|CORPORATION|COMPANY|CO|PAC|COMMITTEE)$/i, "")
    .trim();
}

// ---------------------------------------------------------------------------
// FEC CMTE_TP → financial_entities.entity_type
// ---------------------------------------------------------------------------

export type FinancialEntityType =
  | "individual"
  | "pac"
  | "super_pac"
  | "corporation"
  | "union"
  | "party_committee"
  | "small_donor_aggregate"
  | "tribal"
  | "527"
  | "other";

export function cmteTypeToEntityType(cmteType: string): FinancialEntityType {
  const c = (cmteType ?? "").trim().toUpperCase();
  if (c === "O") return "super_pac";
  if (["X", "Y", "Z"].includes(c)) return "party_committee";
  if (["N", "Q", "V", "W"].includes(c)) return "pac";
  return "other";
}

// ---------------------------------------------------------------------------
// Batched entity upsert
// ---------------------------------------------------------------------------

export interface PacEntityInput {
  cmteId: string;
  name: string;
  cmteType: string;
  connectedOrg: string;
  totalDonatedCents: number;
}

export interface EntityBatchResult {
  /** Map from fec_committee_id → entity UUID for every successfully upserted row. */
  entityIdByCmte: Map<string, string>;
  upserted: number;
  failed: number;
}

/**
 * Upsert every committee in one batched call per chunk.
 *
 * Dedup via `financial_entities.fec_committee_id` UNIQUE. PostgREST returns
 * all columns we ask for from the upsert, including id, so we can build the
 * cmte→id map from a single round-trip per chunk.
 */
export async function upsertPacEntitiesBatch(
  db: Db,
  inputs: PacEntityInput[],
): Promise<EntityBatchResult> {
  const entityIdByCmte = new Map<string, string>();
  let upserted = 0;
  let failed = 0;

  if (inputs.length === 0) return { entityIdByCmte, upserted, failed };

  const records = inputs.map((input) => {
    const entityType = cmteTypeToEntityType(input.cmteType);
    const displayName = (input.name || input.cmteId).trim();
    return {
      canonical_name: canonicalizeEntityName(displayName),
      display_name: displayName,
      entity_type: entityType,
      fec_committee_id: input.cmteId,
      total_donated_cents: input.totalDonatedCents,
      total_received_cents: 0,
      metadata: {
        fec_cmte_type_raw: input.cmteType,
        fec_connected_org_nm: input.connectedOrg?.trim() || null,
      },
    };
  });

  for (let i = 0; i < records.length; i += ENTITY_CHUNK) {
    const chunk = records.slice(i, i + ENTITY_CHUNK);

    const { data, error } = await db
      .from("financial_entities")
      .upsert(chunk, { onConflict: "fec_committee_id" })
      .select("id, fec_committee_id");

    if (error) {
      console.error(
        `    financial_entities chunk ${i}-${i + chunk.length} failed: ${error.message}`,
      );
      failed += chunk.length;
      continue;
    }

    for (const row of (data ?? []) as Array<{ id: string; fec_committee_id: string | null }>) {
      if (row.fec_committee_id) entityIdByCmte.set(row.fec_committee_id, row.id);
    }
    upserted += chunk.length;
  }

  return { entityIdByCmte, upserted, failed };
}

// ---------------------------------------------------------------------------
// Batched relationship upsert
// ---------------------------------------------------------------------------

export interface DonationRelationshipInput {
  fromEntityId: string;
  toOfficialId: string;
  cycleYear: number;
  amountCents: number;
  occurredAt: string | null;
  cmteId: string;
  txCount: number;
}

export interface RelationshipBatchResult {
  upserted: number;
  failed: number;
}

/**
 * Upsert every donation aggregate in batched calls.
 *
 * Dedup via the partial unique index `financial_relationships_donation_unique`
 * on (relationship_type, from_id, to_id, cycle_year) WHERE relationship_type
 * = 'donation' AND cycle_year IS NOT NULL. Migration 20260423000000 adds it.
 */
export async function upsertDonationRelationshipsBatch(
  db: Db,
  inputs: DonationRelationshipInput[],
): Promise<RelationshipBatchResult> {
  let upserted = 0;
  let failed = 0;

  if (inputs.length === 0) return { upserted, failed };

  // Client-side dedupe by (from_id, to_id, cycle_year). Duplicates arise when
  // one official holds multiple FEC candidate IDs (a House fec_candidate_id
  // + a later Senate fec_id, say) and a PAC gave to both — pacAggs has two
  // entries pointing to the same official. Batched upsert rejects two rows
  // that would collide on the same conflict arbiter in one statement
  // ("ON CONFLICT DO UPDATE command cannot affect row a second time"), so we
  // merge here: sum amounts, sum tx_count, keep the latest occurred_at.
  const merged = new Map<string, DonationRelationshipInput>();
  for (const input of inputs) {
    const key = `${input.fromEntityId}|${input.toOfficialId}|${input.cycleYear}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...input });
      continue;
    }
    existing.amountCents += input.amountCents;
    existing.txCount += input.txCount;
    if (input.occurredAt && (!existing.occurredAt || input.occurredAt > existing.occurredAt)) {
      existing.occurredAt = input.occurredAt;
    }
  }

  const records = [...merged.values()].map((input) => {
    // occurred_at fallback — the CHECK constraint requires exactly one of
    // (occurred_at) / (started_at). When FEC txn date is blank we pin to
    // Jan 1 of the cycle so the row validates.
    const occurredAt = input.occurredAt ?? `${input.cycleYear}-01-01`;
    return {
      relationship_type: "donation" as const,
      from_type: "financial_entity",
      from_id: input.fromEntityId,
      to_type: "official",
      to_id: input.toOfficialId,
      amount_cents: input.amountCents,
      occurred_at: occurredAt,
      started_at: null,
      ended_at: null,
      cycle_year: input.cycleYear,
      source_url: `https://www.fec.gov/data/committee/${input.cmteId}/`,
      metadata: {
        fec_committee_id: input.cmteId,
        tx_count: input.txCount,
        source: "fec_bulk_pac",
        aggregated: true,
      },
    };
  });

  for (let i = 0; i < records.length; i += RELATIONSHIP_CHUNK) {
    const chunk = records.slice(i, i + RELATIONSHIP_CHUNK);

    const { error } = await db
      .from("financial_relationships")
      .upsert(chunk, {
        onConflict: "relationship_type,from_id,to_id,cycle_year",
      });

    if (error) {
      console.error(
        `    financial_relationships chunk ${i}-${i + chunk.length} failed: ${error.message}`,
      );
      failed += chunk.length;
      continue;
    }

    upserted += chunk.length;
  }

  return { upserted, failed };
}
