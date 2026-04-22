/**
 * Congress bills writer — post-cutover, single-write against public.
 *
 * After the shadow→public promotion (migration 20260422000000), the shadow
 * schema is gone and its tables were renamed into public. This module now
 * writes exclusively to:
 *   - public.proposals          (core row)
 *   - public.bill_details       (proposal_id + bill-specific columns)
 *   - public.external_source_refs (source='congress_gov', entity_type='proposal')
 *
 * Lookup for dedup uses external_source_refs (unique on source+external_id).
 * The legacy public.proposals.source_ids JSONB path is gone — the source_ids
 * column was dropped as part of the promotion.
 */

import type { createAdminClient } from "@civitics/db";
import type { Database } from "@civitics/db";

type ProposalInsert = Database["public"]["Tables"]["proposals"]["Insert"];
type ProposalType = Database["public"]["Enums"]["proposal_type"];
type ProposalStatus = Database["public"]["Enums"]["proposal_status"];

type Db = ReturnType<typeof createAdminClient>;

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface BillProposalArgs {
  /** Canonical external ID for the bill, e.g. "119-HR-1234". */
  billKey: string;
  /** Display title (trimmed to 500 chars downstream). */
  title: string;
  /** Bill number as it appears on legislation, e.g. "HR 1234". */
  billNumber: string;
  /** Bill type (hr, s, hjres, sjres, hconres, sconres, ...). */
  billType: string;
  /** Chamber this bill originated in. 'house' | 'senate'. */
  chamber: "house" | "senate";
  /** proposal_type enum (mapLegislationType output). */
  type: ProposalType;
  /** proposal_status enum. */
  status: ProposalStatus;
  /** Federal jurisdiction UUID. */
  jurisdictionId: string;
  /** Governing body (House or Senate) UUID. */
  governingBodyId: string;
  /** https://www.congress.gov/... URL. */
  congressGovUrl: string;
  /** Introduction date (ISO date string or null). */
  introducedAt: string | null;
  /** Last action date (ISO date string or null). */
  lastActionAt: string | null;
  /** Optional free-text description of latest action. */
  latestActionText?: string;
  /** Congress number (e.g. 119). */
  congressNumber: number;
  /** Session identifier as stored on bill_details, usually String(congressNumber). */
  session: string;
}

// ---------------------------------------------------------------------------
// Lookup — find existing proposal by congress_gov bill key
// ---------------------------------------------------------------------------

async function findExistingProposalId(db: Db, billKey: string): Promise<string | null> {
  const { data, error } = await db
    .from("external_source_refs")
    .select("entity_id")
    .eq("source", "congress_gov")
    .eq("external_id", billKey)
    .eq("entity_type", "proposal")
    .maybeSingle();

  if (error) {
    console.error(
      `    bills.ts: external_source_refs lookup error for ${billKey}: ${error.message}`
    );
    return null;
  }

  return (data?.entity_id as string | undefined) ?? null;
}

// ---------------------------------------------------------------------------
// Insert — single write to public (proposals + bill_details + source_refs)
// ---------------------------------------------------------------------------

async function insertBill(db: Db, args: BillProposalArgs): Promise<string | null> {
  const {
    billKey,
    title,
    billNumber,
    chamber,
    type,
    status,
    jurisdictionId,
    governingBodyId,
    congressGovUrl,
    introducedAt,
    lastActionAt,
    latestActionText,
    congressNumber,
    session,
  } = args;

  const truncatedTitle = title.slice(0, 500);

  const proposalRecord: ProposalInsert = {
    title: truncatedTitle,
    type,
    status,
    jurisdiction_id: jurisdictionId,
    governing_body_id: governingBodyId,
    external_url: congressGovUrl,
    introduced_at: introducedAt,
    last_action_at: lastActionAt,
    metadata: {
      legacy_bill_number: billNumber,
      legacy_congress_num: congressNumber,
      legacy_session: session,
      ...(latestActionText ? { latest_action: latestActionText } : {}),
    },
  };

  const { data: inserted, error: propErr } = await db
    .from("proposals")
    .insert(proposalRecord)
    .select("id")
    .single();

  if (propErr || !inserted) {
    console.error(`    bills.ts: proposals insert failed for ${billKey}: ${propErr?.message}`);
    return null;
  }

  const proposalId = inserted.id as string;

  // bill_details — trigger bill_details_sync_denorm fills jurisdiction_id
  // from the parent proposals row, but supabase-js requires the column be
  // present in the INSERT; pass the value explicitly so PostgREST accepts it.
  const { error: bdErr } = await db.from("bill_details").insert({
    proposal_id: proposalId,
    bill_number: billNumber,
    chamber,
    session,
    congress_number: congressNumber,
    congress_gov_url: congressGovUrl,
    jurisdiction_id: jurisdictionId,
  });

  if (bdErr && bdErr.code !== "23505") {
    console.error(`    bills.ts: bill_details insert failed for ${billKey}: ${bdErr.message}`);
  }

  const { error: refErr } = await db.from("external_source_refs").insert({
    source: "congress_gov",
    external_id: billKey,
    entity_type: "proposal",
    entity_id: proposalId,
    source_url: congressGovUrl,
    metadata: {},
  });

  if (refErr && refErr.code !== "23505") {
    console.error(
      `    bills.ts: external_source_refs insert failed for ${billKey}: ${refErr.message}`
    );
  }

  return proposalId;
}

// ---------------------------------------------------------------------------
// Exported entry points
// ---------------------------------------------------------------------------

/**
 * Reactive create: called from the vote-ingestion path. If the bill already
 * exists (by billKey), returns its ID. Otherwise inserts it.
 */
export async function findOrCreateBillProposal(
  db: Db,
  args: BillProposalArgs
): Promise<string | null> {
  const existing = await findExistingProposalId(db, args.billKey);
  if (existing) return existing;
  return insertBill(db, args);
}

/**
 * Proactive upsert: called from the recent-bills sync. If the bill exists,
 * updates its status + last_action_at. Otherwise inserts.
 */
export async function upsertBillProposal(
  db: Db,
  args: BillProposalArgs
): Promise<string | null> {
  const existing = await findExistingProposalId(db, args.billKey);

  if (existing) {
    const { error } = await db
      .from("proposals")
      .update({
        title: args.title.slice(0, 500),
        status: args.status,
        last_action_at: args.lastActionAt,
      })
      .eq("id", existing);

    if (error) {
      console.error(`    bills.ts: proposals update failed for ${args.billKey}: ${error.message}`);
      return null;
    }

    return existing;
  }

  return insertBill(db, args);
}

/**
 * Resolves the chamber string from a Congress.gov bill type. Kept here so
 * votes.ts doesn't need a parallel lookup.
 */
export function chamberForBillType(billType: string): "house" | "senate" {
  const lt = billType.toLowerCase();
  if (lt.startsWith("h")) return "house";
  return "senate";
}
