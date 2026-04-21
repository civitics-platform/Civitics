/**
 * Congress bills writer — dual-write pipeline.
 *
 * Stage 1B (dual-write window): every insert lands in BOTH public.proposals
 * (legacy, canonical through cutover) and shadow.proposals + shadow.bill_details
 * + shadow.external_source_refs (new, authoritative after cutover). The public
 * write is strict; shadow failures are logged but do not surface to the caller.
 * This keeps the live pipeline resilient to shadow-schema bugs during Stage 1B.
 *
 * Stage 1 schema notes:
 *   - shadow.proposals.id === public.proposals.id (same UUID is reused, so
 *     existing FKs — cosponsorships, committee_assignments, etc. — migrate
 *     without any id translation layer).
 *   - shadow.bill_details.jurisdiction_id is populated by a BEFORE INSERT
 *     trigger on the shadow side (reads from shadow.proposals). We don't
 *     send it; the trigger fills it.
 *   - shadow.external_source_refs is keyed (source, external_id); we upsert
 *     on conflict so re-runs are safe.
 *
 * Lookup precedence for dedup:
 *   1) shadow.external_source_refs(source='congress_gov', external_id=billKey)
 *   2) fallback: public.proposals source_ids->>congress_gov_bill
 *      (kept during dual-write window; dropped at cutover)
 */

import type { createAdminClient } from "@civitics/db";
import type { Database } from "@civitics/db";

type ProposalInsert = Database["public"]["Tables"]["proposals"]["Insert"];
type ProposalType = Database["public"]["Enums"]["proposal_type"];
type ProposalStatus = Database["public"]["Enums"]["proposal_status"];

type Db = ReturnType<typeof createAdminClient>;

// ---------------------------------------------------------------------------
// Shadow-schema client helper
//
// The generated Database type (packages/db/src/types/database.ts) currently
// only covers `public`. Until `supabase gen types --schema public,shadow` is
// wired up, we cast the shadow-schema client to `any` in one place so the
// rest of this module stays readable. Runtime behavior is unchanged:
// supabase-js supports cross-schema calls via .schema(name).
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ShadowDb = any;

function shadowDb(db: Db): ShadowDb {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (db as any).schema("shadow");
}

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
  /** Session identifier as stored on bill_details/proposals, usually String(congressNumber). */
  session: string;
}

// ---------------------------------------------------------------------------
// Lookup — find existing proposal by congress_gov bill key
// ---------------------------------------------------------------------------

/**
 * Looks up an existing proposal for a given Congress.gov bill key.
 *
 * Checks shadow.external_source_refs first (post-backfill, this is the
 * authoritative source). Falls back to the legacy public.proposals
 * source_ids JSONB path — needed during the dual-write window because we
 * cannot guarantee every legacy row had its shadow ref backfilled
 * (new bills created between schema migration and backfill run, for
 * example).
 */
async function findExistingProposalId(db: Db, billKey: string): Promise<string | null> {
  // Primary: shadow.external_source_refs
  {
    const { data, error } = await shadowDb(db)
      .from("external_source_refs")
      .select("entity_id")
      .eq("source", "congress_gov")
      .eq("external_id", billKey)
      .eq("entity_type", "proposal")
      .maybeSingle();

    if (error) {
      console.error(
        `    bills.ts: shadow.external_source_refs lookup error for ${billKey}: ${error.message}`
      );
    } else if (data?.entity_id) {
      return data.entity_id as string;
    }
  }

  // Fallback: legacy source_ids JSON path
  const { data, error } = await db
    .from("proposals")
    .select("id")
    .filter("source_ids->>congress_gov_bill", "eq", billKey)
    .maybeSingle();

  if (error) {
    console.error(
      `    bills.ts: legacy source_ids lookup error for ${billKey}: ${error.message}`
    );
    return null;
  }

  return (data?.id as string) ?? null;
}

// ---------------------------------------------------------------------------
// Dual-write: public.proposals is canonical; shadow is best-effort
// ---------------------------------------------------------------------------

/**
 * Writes a new bill proposal to public + shadow.
 *
 * - Public insert is strict: a failure returns null and no shadow writes happen.
 * - Shadow inserts are best-effort: errors are logged but the function still
 *   returns the public UUID so the caller can continue processing votes.
 *
 * Why best-effort on shadow: during Stage 1B we cannot let a shadow-side bug
 * (trigger failure, FK mismatch, enum drift) break the live pipeline. Public
 * is canonical until cutover.
 */
async function insertBillDualWrite(db: Db, args: BillProposalArgs): Promise<string | null> {
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

  // --- Public insert (canonical) -------------------------------------------
  const publicRecord: ProposalInsert = {
    title: truncatedTitle,
    bill_number: billNumber,
    type,
    jurisdiction_id: jurisdictionId,
    congress_number: congressNumber,
    session,
    status,
    governing_body_id: governingBodyId,
    source_ids: { congress_gov_bill: billKey },
    congress_gov_url: congressGovUrl,
    introduced_at: introducedAt,
    last_action_at: lastActionAt,
    metadata: latestActionText ? { latest_action: latestActionText } : {},
  };

  const { data: inserted, error: publicErr } = await db
    .from("proposals")
    .insert(publicRecord)
    .select("id")
    .single();

  if (publicErr || !inserted) {
    console.error(`    bills.ts: public insert failed for ${billKey}: ${publicErr?.message}`);
    return null;
  }

  const proposalId = inserted.id as string;

  // --- Shadow writes (best-effort) -----------------------------------------
  // Run sequentially because each depends on the previous (FK chain:
  // proposals → bill_details + external_source_refs).

  try {
    const { error: sProposalErr } = await shadowDb(db)
      .from("proposals")
      .insert({
        id: proposalId,
        type,
        status,
        jurisdiction_id: jurisdictionId,
        governing_body_id: governingBodyId,
        title: truncatedTitle,
        introduced_at: introducedAt,
        last_action_at: lastActionAt,
        external_url: congressGovUrl,
        metadata: {
          legacy_bill_number: billNumber,
          legacy_congress_num: congressNumber,
          legacy_session: session,
          ...(latestActionText ? { latest_action: latestActionText } : {}),
        },
      });

    if (sProposalErr && sProposalErr.code !== "23505") {
      // 23505 = already present (backfill race); fine.
      console.error(`    bills.ts: shadow.proposals insert failed for ${billKey}: ${sProposalErr.message}`);
      return proposalId; // bail on shadow; public is still good
    }

    const { error: sBillErr } = await shadowDb(db)
      .from("bill_details")
      .insert({
        proposal_id: proposalId,
        bill_number: billNumber,
        chamber,
        session,
        congress_number: congressNumber,
        congress_gov_url: congressGovUrl,
        // jurisdiction_id is filled by the shadow trigger
      });

    if (sBillErr && sBillErr.code !== "23505") {
      console.error(`    bills.ts: shadow.bill_details insert failed for ${billKey}: ${sBillErr.message}`);
    }

    const { error: sRefErr } = await shadowDb(db)
      .from("external_source_refs")
      .insert({
        source: "congress_gov",
        external_id: billKey,
        entity_type: "proposal",
        entity_id: proposalId,
        source_url: congressGovUrl,
        metadata: {},
      });

    if (sRefErr && sRefErr.code !== "23505") {
      console.error(`    bills.ts: shadow.external_source_refs insert failed for ${billKey}: ${sRefErr.message}`);
    }
  } catch (err) {
    console.error(`    bills.ts: unexpected shadow error for ${billKey}:`, err);
  }

  return proposalId;
}

// ---------------------------------------------------------------------------
// Exported entry points
// ---------------------------------------------------------------------------

/**
 * Reactive create: called from the vote-ingestion path. If the bill already
 * exists (by billKey), returns its ID. Otherwise inserts it via dual-write.
 */
export async function findOrCreateBillProposal(
  db: Db,
  args: BillProposalArgs
): Promise<string | null> {
  const existing = await findExistingProposalId(db, args.billKey);
  if (existing) return existing;
  return insertBillDualWrite(db, args);
}

/**
 * Proactive upsert: called from the recent-bills sync. If the bill exists,
 * updates its status + last_action_at on both public and shadow. Otherwise
 * inserts via dual-write.
 *
 * Returns the proposal UUID on success, null on public-side failure.
 */
export async function upsertBillProposal(
  db: Db,
  args: BillProposalArgs
): Promise<string | null> {
  const existing = await findExistingProposalId(db, args.billKey);

  if (existing) {
    const now = new Date().toISOString();

    // Public update
    const { error: pubErr } = await db
      .from("proposals")
      .update({
        title: args.title.slice(0, 500),
        status: args.status,
        last_action_at: args.lastActionAt,
        updated_at: now,
      })
      .eq("id", existing);

    if (pubErr) {
      console.error(`    bills.ts: public update failed for ${args.billKey}: ${pubErr.message}`);
      return null;
    }

    // Shadow update (best-effort)
    try {
      const { error: shdErr } = await db
        .schema("shadow")
        .from("proposals")
        .update({
          title: args.title.slice(0, 500),
          status: args.status,
          last_action_at: args.lastActionAt,
          updated_at: now,
        })
        .eq("id", existing);

      if (shdErr) {
        console.error(`    bills.ts: shadow.proposals update failed for ${args.billKey}: ${shdErr.message}`);
      }
    } catch (err) {
      console.error(`    bills.ts: unexpected shadow update error for ${args.billKey}:`, err);
    }

    return existing;
  }

  return insertBillDualWrite(db, args);
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
