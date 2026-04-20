/**
 * Shadow-schema writer for the FEC bulk pipeline.
 *
 * Decision #4 (rebuild FEC from scratch) and L7 (polymorphic
 * financial_relationships with relationship_type enum) mean the new shape
 * looks nothing like public.financial_*. Rather than dual-writing to a
 * legacy shape we're about to delete, this module writes ONLY to shadow.
 * Public.financial_* data freezes at whatever state the last legacy run
 * left it in, and Stage 1B read-cutover flips queries to shadow.
 *
 * Per-source layout:
 *   shadow.financial_entities
 *     - One row per FEC committee (PAC, party, super PAC, …)
 *     - Dedup via `fec_committee_id` (UNIQUE column) — the FEC CMTE_ID
 *     - canonical_name = normalized committee name (uppercase, stripped)
 *     - display_name   = source-cased committee name
 *     - entity_type    = 'pac' | 'super_pac' | 'party_committee'
 *                        (derived from FEC CMTE_TP code)
 *     - total_donated_cents refreshed on every pipeline run
 *
 *   shadow.financial_relationships
 *     - One row per (committee, candidate, cycle) aggregate
 *     - relationship_type = 'donation'
 *     - from_type='financial_entity', from_id=committee UUID
 *     - to_type='official',           to_id=official UUID
 *     - amount_cents  = summed across all 24K/24Z txns in the cycle
 *     - occurred_at   = latest transaction date in that aggregation
 *     - cycle_year    = 2024 (or whatever CYCLE was run)
 *   Dedup: (from_id, to_id, cycle_year, relationship_type='donation') —
 *     looked up with a SELECT before INSERT. The
 *     `financial_relationships_derivation` compound index makes this fast.
 *
 * Entity_connections is NOT written here. Per L5 it is derivation-only; a
 * nightly job rebuilds shadow.entity_connections from shadow.financial_*.
 */

import type { createAdminClient } from "@civitics/db";
import { shadowClient, type ShadowDb } from "../utils";

type Db = ReturnType<typeof createAdminClient>;

// ---------------------------------------------------------------------------
// Name canonicalization
// ---------------------------------------------------------------------------

/**
 * Produce a canonical (dedup-friendly) form of a committee / entity name.
 *
 * Rules:
 *   - uppercase
 *   - strip punctuation (., ', -, &, /)
 *   - collapse whitespace
 *   - strip trailing corporate suffixes (INC, LLC, CORP, PAC, COMMITTEE)
 *   - trim
 *
 * Intentionally simple for the initial slice; a dedicated dedup pass can
 * unify aliases later.
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
// FEC CMTE_TP → shadow.financial_entities.entity_type
//
//   N/Q/V/W  → 'pac'
//   O        → 'super_pac' (IE-only)
//   X/Y/Z    → 'party_committee'
//   other    → 'other'
// ---------------------------------------------------------------------------

export type ShadowEntityType =
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

export function cmteTypeToShadowEntityType(cmteType: string): ShadowEntityType {
  const c = (cmteType ?? "").trim().toUpperCase();
  if (c === "O") return "super_pac";
  if (["X", "Y", "Z"].includes(c)) return "party_committee";
  if (["N", "Q", "V", "W"].includes(c)) return "pac";
  return "other";
}

// ---------------------------------------------------------------------------
// upsertPacEntityShadow — one row per PAC committee
//
// Dedup on shadow.financial_entities.fec_committee_id (UNIQUE column).
// Returns the entity UUID — needed as from_id for the relationship insert.
// ---------------------------------------------------------------------------

export interface PacEntityInput {
  /** FEC CMTE_ID — the canonical external key. */
  cmteId: string;
  /** Raw committee name from cm24 CMTE_NM column. */
  name: string;
  /** Raw committee type code from cm24 (N/Q/V/W/X/Y/Z/O/…). */
  cmteType: string;
  /** cm24 CONNECTED_ORG_NM — parent corp, union, trade assoc, etc. */
  connectedOrg: string;
  /** Aggregated total given across all (cmte × cand) pairs in this cycle. */
  totalDonatedCents: number;
}

export interface UpsertEntityResult {
  outcome: "inserted" | "updated" | "failed";
  id: string | null;
}

export async function upsertPacEntityShadow(
  db: Db,
  input: PacEntityInput,
): Promise<UpsertEntityResult> {
  const shd: ShadowDb = shadowClient(db);
  const entityType = cmteTypeToShadowEntityType(input.cmteType);
  const displayName = (input.name || input.cmteId).trim();
  const canonicalName = canonicalizeEntityName(displayName);
  const industry = input.connectedOrg?.trim() || null;

  // Primary dedup key: fec_committee_id
  const { data: existing, error: selErr } = await shd
    .from("financial_entities")
    .select("id")
    .eq("fec_committee_id", input.cmteId)
    .maybeSingle();

  if (selErr) {
    console.error(`    shadow.financial_entities select error for ${input.cmteId}: ${selErr.message}`);
    return { outcome: "failed", id: null };
  }

  if (existing?.id) {
    const { error: updErr } = await shd
      .from("financial_entities")
      .update({
        canonical_name: canonicalName,
        display_name: displayName,
        entity_type: entityType,
        industry,
        total_donated_cents: input.totalDonatedCents,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);

    if (updErr) {
      console.error(`    shadow.financial_entities update failed for ${input.cmteId}: ${updErr.message}`);
      return { outcome: "failed", id: existing.id as string };
    }
    return { outcome: "updated", id: existing.id as string };
  }

  const { data: inserted, error: insErr } = await shd
    .from("financial_entities")
    .insert({
      canonical_name: canonicalName,
      display_name: displayName,
      entity_type: entityType,
      fec_committee_id: input.cmteId,
      industry,
      total_donated_cents: input.totalDonatedCents,
      total_received_cents: 0,
      metadata: {
        fec_cmte_type_raw: input.cmteType,
      },
    })
    .select("id")
    .single();

  if (insErr || !inserted) {
    // 23505 = unique-violation race; look up and treat as existing
    if (insErr?.code === "23505") {
      const { data: raced } = await shd
        .from("financial_entities")
        .select("id")
        .eq("fec_committee_id", input.cmteId)
        .maybeSingle();
      if (raced?.id) return { outcome: "updated", id: raced.id as string };
    }
    console.error(`    shadow.financial_entities insert failed for ${input.cmteId}: ${insErr?.message}`);
    return { outcome: "failed", id: null };
  }

  return { outcome: "inserted", id: inserted.id as string };
}

// ---------------------------------------------------------------------------
// upsertDonationRelationshipShadow — one row per (PAC, official, cycle)
//
// Dedup on (from_id, to_id, cycle_year, relationship_type='donation').
// Uses a SELECT before INSERT (no partial unique constraint exists for this
// predicate); the `financial_relationships_derivation` compound index makes
// the lookup cheap.
// ---------------------------------------------------------------------------

export interface DonationRelationshipInput {
  /** UUID of the PAC committee in shadow.financial_entities. */
  fromEntityId: string;
  /** UUID of the receiving candidate in public.officials. */
  toOfficialId: string;
  /** Election cycle (2024, 2022, …). */
  cycleYear: number;
  /** Aggregated total contribution amount in cents. */
  amountCents: number;
  /** Latest transaction date in this aggregation (ISO date, nullable). */
  occurredAt: string | null;
  /** FEC CMTE_ID — breadcrumb, not a dedup key. */
  cmteId: string;
  /** Raw transaction count (metadata, not a dedup key). */
  txCount: number;
}

export async function upsertDonationRelationshipShadow(
  db: Db,
  input: DonationRelationshipInput,
): Promise<"inserted" | "updated" | "failed"> {
  const shd: ShadowDb = shadowClient(db);

  // Dedup lookup
  const { data: existing, error: selErr } = await shd
    .from("financial_relationships")
    .select("id")
    .eq("relationship_type", "donation")
    .eq("from_type", "financial_entity")
    .eq("from_id", input.fromEntityId)
    .eq("to_type", "official")
    .eq("to_id", input.toOfficialId)
    .eq("cycle_year", input.cycleYear)
    .maybeSingle();

  if (selErr) {
    console.error(`    shadow.financial_relationships select error for ${input.cmteId}→${input.toOfficialId}: ${selErr.message}`);
    return "failed";
  }

  // occurred_at is the temporal key for one-off donations. If we only have
  // raw txns without any date we fall back to Jan 1 of the cycle so the
  // CHECK constraint (exactly one of occurred_at / started_at) is satisfied.
  const occurredAt = input.occurredAt ?? `${input.cycleYear}-01-01`;

  if (existing?.id) {
    const { error: updErr } = await shd
      .from("financial_relationships")
      .update({
        amount_cents: input.amountCents,
        occurred_at: occurredAt,
        metadata: {
          fec_committee_id: input.cmteId,
          tx_count: input.txCount,
          source: "fec_bulk_pac",
          aggregated: true,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);

    return updErr ? "failed" : "updated";
  }

  const { error: insErr } = await shd
    .from("financial_relationships")
    .insert({
      relationship_type: "donation",
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
    });

  return insErr ? "failed" : "inserted";
}
