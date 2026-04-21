/**
 * Shadow entity_connections derivation pipeline.
 *
 * Reads from shadow source tables (and public for votes/officials/agencies, which
 * share UUIDs with shadow during the Stage 1B dual-write window) and writes to
 * shadow.entity_connections.
 *
 * Per L5: entity_connections is derivation-only. No pipeline writes directly; this
 * job rebuilds graph edges deterministically from source tables each nightly run.
 *
 * Derives:
 *   donation        ← shadow.financial_relationships type='donation'
 *   gift_received   ← shadow.financial_relationships type IN (gift, honorarium)
 *   holds_position  ← shadow.financial_relationships type IN (owns_stock, owns_bond,
 *                     property) WHERE ended_at IS NULL
 *   contract_award  ← shadow.financial_relationships type IN (contract, grant)
 *   lobbying        ← shadow.financial_relationships type='lobbying_spend'
 *   vote_yes/no     ← public.votes WHERE proposal_id IN shadow.proposals
 *   oversight       ← public.agencies WHERE governing_body_id IS NOT NULL
 *   appointment     ← public.officials × public.agencies (role_title keywords)
 *
 * Run:
 *   pnpm --filter @civitics/data data:shadow-connections
 *   pnpm --filter @civitics/data data:shadow-connections --force   (skip recency guard)
 */

import { createAdminClient } from "@civitics/db";
import { shadowClient, sleep, type ShadowDb } from "../utils";
import {
  startSync,
  completeSync,
  failSync,
  type PipelineResult,
} from "../sync-log";
import { voteToConnectionType } from "./index";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FETCH_SIZE = 1000;
const UPSERT_SIZE = 500;

/** Max evidence_ids stored per edge — keeps UUID[] from growing unbounded. */
const MAX_EVIDENCE_IDS = 50;

/** Minimum hours between full rebuilds (override with --force). */
const MIN_RUN_INTERVAL_HOURS = 4;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ShadowConnectionCounts {
  donation:        number;
  gift_received:   number;
  holds_position:  number;
  contract_award:  number;
  lobbying:        number;
  vote_yes:        number;
  vote_no:         number;
  vote_abstain:    number;
  nom_vote_yes:    number;
  nom_vote_no:     number;
  oversight:       number;
  appointment:     number;
  failed:          number;
}

interface FinancialEdge {
  connection_type: string;
  from_type:       string;
  from_id:         string;
  to_type:         string;
  to_id:           string;
  amount_cents:    number;
  occurred_at:     string | null;
  ended_at:        string | null;
  evidence_ids:    string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Log-scaled donation strength: $10k→0.25 $100k→0.50 $1M→0.75 $10M+→1.0 */
function donationStrength(amountCents: number): number {
  if (amountCents <= 0) return 0;
  return Math.max(0, Math.min(1.0, Math.log10(amountCents / 100_000) / 4));
}

/** Log-scaled strength for any money edge (same formula as donation). */
const moneyStrength = donationStrength;

/** Map shadow.financial_relationship_type → public.connection_type. */
const FINANCIAL_CONN_MAP: Record<string, string> = {
  donation:       "donation",
  gift:           "gift_received",
  honorarium:     "gift_received",
  owns_stock:     "holds_position",
  owns_bond:      "holds_position",
  property:       "holds_position",
  contract:       "contract_award",
  grant:          "contract_award",
  lobbying_spend: "lobbying",
  // loan / other: no connection type → skip
};

/** Role title keywords that indicate agency head / cabinet-level appointment. */
const LEADERSHIP_KEYWORDS = [
  "secretary", "administrator", "director", "commissioner",
  "chair", "chairman", "attorney general", "surgeon general",
  "comptroller", "treasurer", "postmaster",
];

function isAgencyLeadershipRole(roleTitle: string): boolean {
  const lower = roleTitle.toLowerCase();
  return LEADERSHIP_KEYWORDS.some((kw) => lower.includes(kw));
}

// ---------------------------------------------------------------------------
// Batch upsert to shadow.entity_connections
// ---------------------------------------------------------------------------

interface ShadowConnectionRow {
  from_type:       string;
  from_id:         string;
  to_type:         string;
  to_id:           string;
  connection_type: string;
  strength:        number;
  amount_cents:    number | null;
  occurred_at:     string | null;
  ended_at:        string | null;
  evidence_count:  number;
  evidence_source: string;
  evidence_ids:    string[];
  derived_at:      string;
}

async function batchUpsertShadowConnections(
  sdb: ShadowDb,
  rows: ShadowConnectionRow[],
  counts: ShadowConnectionCounts,
  label: string,
  logEvery = 5,
): Promise<void> {
  const total   = rows.length;
  let batchNum  = 0;
  const now     = new Date().toISOString();
  const MAX_RETRIES = 3;

  for (let i = 0; i < total; i += UPSERT_SIZE) {
    batchNum++;
    const chunk = rows.slice(i, i + UPSERT_SIZE).map((r) => ({
      ...r,
      derived_at: now,
    }));

    let err = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const result = await sdb
        .from("entity_connections")
        .upsert(chunk, {
          onConflict: "from_type,from_id,to_type,to_id,connection_type",
        });
      err = result.error;
      if (!err) break;
      if (!err.message.includes("timeout")) break;
      if (attempt < MAX_RETRIES) {
        console.log(`    [${label}] batch ${batchNum} timeout, retrying (${attempt + 1})...`);
      }
    }

    if (err) {
      console.error(`    [${label}] batch ${batchNum} error:`, err.message);
      counts.failed += chunk.length;
    } else {
      for (const row of chunk) {
        const ct = row.connection_type;
        if      (ct === "donation")            counts.donation++;
        else if (ct === "gift_received")       counts.gift_received++;
        else if (ct === "holds_position")      counts.holds_position++;
        else if (ct === "contract_award")      counts.contract_award++;
        else if (ct === "lobbying")            counts.lobbying++;
        else if (ct === "vote_yes")            counts.vote_yes++;
        else if (ct === "vote_no")             counts.vote_no++;
        else if (ct === "vote_abstain")        counts.vote_abstain++;
        else if (ct === "nomination_vote_yes") counts.nom_vote_yes++;
        else if (ct === "nomination_vote_no")  counts.nom_vote_no++;
        else if (ct === "oversight")           counts.oversight++;
        else if (ct === "appointment")         counts.appointment++;
      }
      if (batchNum % logEvery === 0 || i + UPSERT_SIZE >= total) {
        const done = Math.min(i + UPSERT_SIZE, total);
        console.log(`    Batch ${batchNum}/${Math.ceil(total / UPSERT_SIZE)} ✓  (${done}/${total})`);
      }
    }

    await sleep(100); // throttle: avoid Supabase free-tier I/O spikes
  }
}

// ---------------------------------------------------------------------------
// 1. Financial connections (all types in one pass)
//
// Single pagination pass through shadow.financial_relationships, grouped by
// (connection_type, from_type, from_id, to_type, to_id). Aggregates amount_cents
// and collects evidence_ids. Skips unknown relationship types (loan, other).
//
// For holds_position: only processes rows WHERE ended_at IS NULL (active holdings).
// ---------------------------------------------------------------------------

async function deriveFinancialConnections(
  sdb: ShadowDb,
  counts: ShadowConnectionCounts,
): Promise<void> {
  console.log("\n  [1/4] Financial connections (donation / gift / holds_position / contract / lobbying)...");

  // Aggregate: edgeKey → FinancialEdge
  const edgeMap = new Map<string, FinancialEdge>();

  let lastId: string | null = null;
  let page = 0;
  let totalRows = 0;

  while (true) {
    page++;
    let q = sdb
      .from("financial_relationships")
      .select("id, relationship_type, from_type, from_id, to_type, to_id, amount_cents, occurred_at, started_at, ended_at")
      .order("id")
      .limit(FETCH_SIZE);
    if (lastId) q = q.gt("id", lastId);

    const { data: batch, error } = await q;
    if (error) {
      console.error("    Error fetching financial_relationships:", error.message);
      return;
    }
    if (!batch || batch.length === 0) break;

    lastId = String(batch[batch.length - 1].id);
    totalRows += batch.length;

    for (const row of batch) {
      const relType = String(row.relationship_type);
      const connType = FINANCIAL_CONN_MAP[relType];
      if (!connType) continue; // loan, other — no connection type

      // holds_position: active (non-ended) only
      if (connType === "holds_position" && row.ended_at != null) continue;

      const edgeKey = `${connType}|${row.from_type}|${row.from_id}|${row.to_type}|${row.to_id}`;
      const amt = Number(row.amount_cents ?? 0);

      // occurred_at for one-off types; started_at for stateful types
      const dateField = row.occurred_at ?? row.started_at ?? null;

      const existing = edgeMap.get(edgeKey);
      if (existing) {
        existing.amount_cents += amt;
        // Keep the latest date for one-off, earliest start for stateful
        if (dateField && (!existing.occurred_at || dateField > existing.occurred_at)) {
          existing.occurred_at = String(dateField);
        }
        if (row.ended_at && (!existing.ended_at || String(row.ended_at) > existing.ended_at)) {
          existing.ended_at = String(row.ended_at);
        }
        if (existing.evidence_ids.length < MAX_EVIDENCE_IDS) {
          existing.evidence_ids.push(String(row.id));
        }
      } else {
        edgeMap.set(edgeKey, {
          connection_type: connType,
          from_type:       String(row.from_type),
          from_id:         String(row.from_id),
          to_type:         String(row.to_type),
          to_id:           String(row.to_id),
          amount_cents:    amt,
          occurred_at:     dateField != null ? String(dateField) : null,
          ended_at:        row.ended_at != null ? String(row.ended_at) : null,
          evidence_ids:    [String(row.id)],
        });
      }
    }

    if (page % 10 === 0) {
      console.log(`    Fetched ${totalRows} rows, ${edgeMap.size} edges so far...`);
    }
    if (batch.length < FETCH_SIZE) break;
    await sleep(50);
  }

  console.log(`    ${totalRows} rows → ${edgeMap.size} unique edges`);
  if (edgeMap.size === 0) return;

  // Convert to ShadowConnectionRow
  const rows: ShadowConnectionRow[] = [...edgeMap.values()].map((e) => ({
    from_type:       e.from_type,
    from_id:         e.from_id,
    to_type:         e.to_type,
    to_id:           e.to_id,
    connection_type: e.connection_type,
    strength:        moneyStrength(e.amount_cents),
    amount_cents:    e.amount_cents > 0 ? e.amount_cents : null,
    occurred_at:     e.occurred_at,
    ended_at:        e.ended_at,
    evidence_count:  e.evidence_ids.length,
    evidence_source: "financial_relationships",
    evidence_ids:    e.evidence_ids,
    derived_at:      new Date().toISOString(),
  }));

  console.log(`    Upserting ${rows.length} financial connections...`);
  await batchUpsertShadowConnections(sdb, rows, counts, "financial", 5);
}

// ---------------------------------------------------------------------------
// 2. Vote connections
//
// Reads shadow.votes — the clean, re-keyed table written by the Priority 1
// votes pipeline fix. UNIQUE(roll_call_id, official_id) means multiple roll
// calls per bill are separate rows; evidence_ids accumulates all of them.
//
// vote_question is a first-class column here (not buried in metadata JSON)
// so procedural and nomination detection is reliable without needing
// vote_category (which shadow.proposals doesn't have).
//
// No public.votes or shadow proposal pre-load needed: shadow.votes only
// contains rows linked to shadow.bill_details via FK, so every row is
// already scoped to the shadow schema.
// ---------------------------------------------------------------------------

async function deriveVoteConnections(
  sdb: ShadowDb,
  counts: ShadowConnectionCounts,
): Promise<void> {
  console.log("\n  [2/4] Vote connections (shadow.votes)...");

  let lastId: string | null = null;
  let votePage = 0;
  let totalFetched = 0;

  while (true) {
    votePage++;
    let q = sdb
      .from("votes")
      .select("id, official_id, bill_proposal_id, vote, voted_at, vote_question")
      .order("id")
      .limit(FETCH_SIZE);
    if (lastId) q = q.gt("id", lastId);

    const { data: votes, error } = await q;
    if (error) { console.error(`    Error fetching shadow.votes page ${votePage}:`, error.message); return; }
    if (!votes || votes.length === 0) break;

    lastId = String(votes[votes.length - 1].id);
    totalFetched += votes.length;

    // Deduplicate within page by (from_id, to_id, connType).
    // Multiple roll calls for the same (official, bill, direction) accumulate evidence_ids.
    const batchMap = new Map<string, ShadowConnectionRow>();
    for (const v of votes) {
      const connType = voteToConnectionType(
        String(v.vote ?? ""),
        null,                                          // shadow.proposals has no vote_category
        null,                                          // title not needed — vote_question handles both
        { vote_question: v.vote_question ?? "" },     // first-class column → reliable procedural/nom detection
      );
      if (!connType) continue;

      const fromId    = String(v.official_id);
      const toId      = String(v.bill_proposal_id);  // shared UUID with public/shadow proposals
      const dedupeKey = `${fromId}|${toId}|${connType}`;

      const existing = batchMap.get(dedupeKey);
      if (existing) {
        // Accumulate evidence_ids across multiple roll calls for the same edge.
        if (existing.evidence_ids.length < MAX_EVIDENCE_IDS) {
          existing.evidence_ids.push(String(v.id));
          existing.evidence_count++;
        }
      } else {
        batchMap.set(dedupeKey, {
          from_type:       "official",
          from_id:         fromId,
          to_type:         "proposal",
          to_id:           toId,
          connection_type: connType,
          strength:        1.0,
          amount_cents:    null,
          occurred_at:     v.voted_at ? String(v.voted_at).slice(0, 10) : null,
          ended_at:        null,
          evidence_count:  1,
          evidence_source: "votes",
          evidence_ids:    [String(v.id)],
          derived_at:      new Date().toISOString(),
        });
      }
    }

    const batch = [...batchMap.values()];
    if (batch.length > 0) {
      await batchUpsertShadowConnections(sdb, batch, counts, `vote p${votePage}`, 999);
    }

    if (votePage % 20 === 0) {
      console.log(
        `    Processed ${totalFetched} shadow votes... ` +
        `(yes: ${counts.vote_yes}, no: ${counts.vote_no}, abstain: ${counts.vote_abstain})`
      );
    }
    if (votes.length < FETCH_SIZE) break;
    await sleep(50);
  }

  console.log(
    `    Processed ${totalFetched} shadow votes → ` +
    `${counts.vote_yes} yes / ${counts.vote_no} no / ${counts.vote_abstain} abstain / ` +
    `${counts.nom_vote_yes} nom_yes / ${counts.nom_vote_no} nom_no`
  );
}

// ---------------------------------------------------------------------------
// 3. Oversight connections (governing_body → agency)
// ---------------------------------------------------------------------------

async function deriveOversightConnections(
  sdb: ShadowDb,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  counts: ShadowConnectionCounts,
): Promise<void> {
  console.log("\n  [3/4] Oversight connections...");

  const { data: agencies, error } = await db
    .from("agencies")
    .select("id, governing_body_id")
    .not("governing_body_id", "is", null);

  if (error) { console.error("    Error fetching agencies:", error.message); return; }
  if (!agencies || agencies.length === 0) {
    console.log("    No agencies with governing_body_id — skipping.");
    return;
  }
  console.log(`    ${agencies.length} agency→governing_body pairs`);

  const rows: ShadowConnectionRow[] = (agencies as { id: string; governing_body_id: string }[]).map((a) => ({
    from_type:       "governing_body",
    from_id:         String(a.governing_body_id),
    to_type:         "agency",
    to_id:           String(a.id),
    connection_type: "oversight",
    strength:        1.0,
    amount_cents:    null,
    occurred_at:     null,
    ended_at:        null,
    evidence_count:  1,
    evidence_source: "agency_oversight",
    evidence_ids:    [],
    derived_at:      new Date().toISOString(),
  }));

  await batchUpsertShadowConnections(sdb, rows, counts, "oversight", 1);
  console.log(`    Created/updated: ${counts.oversight} oversight connections`);
}

// ---------------------------------------------------------------------------
// 4. Appointment connections (official → agency via role_title keywords)
// ---------------------------------------------------------------------------

async function deriveAppointmentConnections(
  sdb: ShadowDb,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  counts: ShadowConnectionCounts,
): Promise<void> {
  console.log("\n  [4/4] Appointment connections...");

  const { data: officials, error: offErr } = await db
    .from("officials")
    .select("id, role_title, governing_body_id")
    .eq("is_active", true)
    .not("governing_body_id", "is", null);
  if (offErr) { console.error("    Error fetching officials:", offErr.message); return; }

  const leaders = (officials ?? []).filter(
    (o: { role_title: string | null }) => o.role_title && isAgencyLeadershipRole(o.role_title)
  );
  if (leaders.length === 0) {
    console.log("    No agency-leadership officials found (cabinet data not yet ingested).");
    return;
  }
  console.log(`    ${leaders.length} leadership officials`);

  const { data: agenciesRaw, error: agErr } = await db
    .from("agencies")
    .select("id, name, governing_body_id")
    .not("governing_body_id", "is", null);
  if (agErr) { console.error("    Error fetching agencies:", agErr.message); return; }

  const agByGovBody = new Map<string, Array<{ id: string; name: string }>>();
  for (const ag of agenciesRaw ?? []) {
    const list = agByGovBody.get(String(ag.governing_body_id)) ?? [];
    list.push({ id: String(ag.id), name: String(ag.name) });
    agByGovBody.set(String(ag.governing_body_id), list);
  }

  const rows: ShadowConnectionRow[] = [];
  for (const official of leaders) {
    for (const agency of agByGovBody.get(String(official.governing_body_id)) ?? []) {
      rows.push({
        from_type:       "official",
        from_id:         String(official.id),
        to_type:         "agency",
        to_id:           agency.id,
        connection_type: "appointment",
        strength:        1.0,
        amount_cents:    null,
        occurred_at:     null,
        ended_at:        null,
        evidence_count:  1,
        evidence_source: "career_history",
        evidence_ids:    [],
        derived_at:      new Date().toISOString(),
      });
    }
  }

  await batchUpsertShadowConnections(sdb, rows, counts, "appointment", 1);
  console.log(`    Created/updated: ${counts.appointment} appointment connections`);
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

export async function runShadowConnectionsPipeline(): Promise<PipelineResult> {
  console.log("\n=== Shadow entity_connections derivation ===");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db  = createAdminClient() as any;
  const sdb = shadowClient(db);
  const force = process.argv.includes("--force");

  // ── Recency guard ────────────────────────────────────────────────────────
  const { data: stateRow } = await db
    .from("pipeline_state")
    .select("value")
    .eq("key", "shadow_connections_last_run")
    .maybeSingle();
  const lastRun = (stateRow?.value as Record<string, unknown> | null)?.last_run as string | undefined;
  if (lastRun && !force) {
    const hoursSince = (Date.now() - new Date(lastRun).getTime()) / 3_600_000;
    if (hoursSince < MIN_RUN_INTERVAL_HOURS) {
      console.log(
        `⏭  Shadow connections skipping — ran ${hoursSince.toFixed(1)}h ago. Use --force to override.`
      );
      return { inserted: 0, updated: 0, failed: 0, estimatedMb: 0 };
    }
  }
  if (force) console.log("⚠  --force flag: skipping recency guard");

  const logId = await startSync("shadow-connections");
  const counts: ShadowConnectionCounts = {
    donation: 0, gift_received: 0, holds_position: 0, contract_award: 0,
    lobbying: 0, vote_yes: 0, vote_no: 0, vote_abstain: 0,
    nom_vote_yes: 0, nom_vote_no: 0, oversight: 0, appointment: 0, failed: 0,
  };

  try {
    await deriveFinancialConnections(sdb, counts);
    await deriveVoteConnections(sdb, counts);
    await deriveOversightConnections(sdb, db, counts);
    await deriveAppointmentConnections(sdb, db, counts);

    const total =
      counts.donation + counts.gift_received + counts.holds_position +
      counts.contract_award + counts.lobbying + counts.vote_yes + counts.vote_no +
      counts.vote_abstain + counts.nom_vote_yes + counts.nom_vote_no +
      counts.oversight + counts.appointment;

    // Persist state for recency guard
    await db.from("pipeline_state").upsert(
      {
        key:   "shadow_connections_last_run",
        value: { last_run: new Date().toISOString(), connections_upserted: total },
      },
      { onConflict: "key" },
    );

    console.log("\n  ──────────────────────────────────────────────────");
    console.log("  Shadow entity_connections report");
    console.log("  ──────────────────────────────────────────────────");
    console.log(`  ${"Total:".padEnd(36)} ${total}`);
    console.log(`  ${"  donation:".padEnd(36)} ${counts.donation}`);
    console.log(`  ${"  gift_received:".padEnd(36)} ${counts.gift_received}`);
    console.log(`  ${"  holds_position:".padEnd(36)} ${counts.holds_position}`);
    console.log(`  ${"  contract_award:".padEnd(36)} ${counts.contract_award}`);
    console.log(`  ${"  lobbying:".padEnd(36)} ${counts.lobbying}`);
    console.log(`  ${"  vote_yes:".padEnd(36)} ${counts.vote_yes}`);
    console.log(`  ${"  vote_no:".padEnd(36)} ${counts.vote_no}`);
    console.log(`  ${"  vote_abstain:".padEnd(36)} ${counts.vote_abstain}`);
    console.log(`  ${"  nomination_vote_yes:".padEnd(36)} ${counts.nom_vote_yes}`);
    console.log(`  ${"  nomination_vote_no:".padEnd(36)} ${counts.nom_vote_no}`);
    console.log(`  ${"  oversight:".padEnd(36)} ${counts.oversight}`);
    console.log(`  ${"  appointment:".padEnd(36)} ${counts.appointment}`);
    console.log(`  ${"  failed:".padEnd(36)} ${counts.failed}`);

    const result: PipelineResult = { inserted: total, updated: 0, failed: counts.failed, estimatedMb: 0 };
    await completeSync(logId, result);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("  Shadow connections pipeline fatal error:", msg);
    await failSync(logId, msg);
    return { inserted: 0, updated: 0, failed: counts.failed + 1, estimatedMb: 0 };
  }
}

// ---------------------------------------------------------------------------
// Standalone entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  runShadowConnectionsPipeline()
    .then(() => { setTimeout(() => process.exit(0), 500); })
    .catch((err) => {
      console.error("Pipeline failed:", err);
      setTimeout(() => process.exit(1), 500);
    });
}
