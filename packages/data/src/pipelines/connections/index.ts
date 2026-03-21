/**
 * Entity connections derivation pipeline.
 *
 * Derives entity_connections from existing structured data — no external API calls.
 * Run after all data ingestion pipelines have populated the DB.
 *
 * Derives 4 connection types:
 *   donation       — financial_relationships → financial_entity (diamond node) → official
 *   vote_yes/no/abstain — votes table → official → proposal
 *   oversight      — agencies.governing_body_id → governing_body → agency
 *   appointment    — officials with agency-leadership role titles → agency
 *
 * Deduplication: upserts on (from_id, to_id, connection_type) unique constraint
 * added in migration 0004. Strength and evidence updated on conflict.
 *
 * Run standalone:
 *   pnpm --filter @civitics/data data:connections
 */

import { createAdminClient } from "@civitics/db";
import {
  startSync,
  completeSync,
  failSync,
  type PipelineResult,
} from "../sync-log";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConnectionCounts {
  donation:            number;
  vote_yes:            number;
  vote_no:             number;
  vote_abstain:        number;
  nomination_vote_yes: number;
  nomination_vote_no:  number;
  oversight:           number;
  appointment:         number;
  failed:              number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Donation strength formula.
 *   $10k  → 0.25   $100k → 0.50   $1M → 0.75   $10M+ → 1.0
 */
function donationStrength(amountCents: number): number {
  if (amountCents <= 0) return 0;
  return Math.max(0, Math.min(1.0, Math.log10(amountCents / 100000) / 4));
}

/**
 * Map votes.vote value to connection_type.
 * Returns null for non-definitive votes.
 *
 * @param vote        The vote value (yes/no/abstain/etc.)
 * @param voteCategory The proposal's vote_category (nomination → distinct edge types)
 */
function voteToConnectionType(vote: string, voteCategory?: string | null): string | null {
  const isNomination = voteCategory === "nomination";
  switch (vote) {
    case "yes":        return isNomination ? "nomination_vote_yes" : "vote_yes";
    case "no":         return isNomination ? "nomination_vote_no"  : "vote_no";
    case "abstain":
    case "present":
    case "not_voting": return "vote_abstain";
    default:           return null; // paired_yes / paired_no — skip
  }
}

/** Role titles that suggest agency head / cabinet-level appointment. */
const LEADERSHIP_KEYWORDS = [
  "secretary",
  "administrator",
  "director",
  "commissioner",
  "chair",
  "chairman",
  "attorney general",
  "surgeon general",
  "comptroller",
  "treasurer",
  "postmaster",
];

function isAgencyLeadershipRole(roleTitle: string): boolean {
  const lower = roleTitle.toLowerCase();
  return LEADERSHIP_KEYWORDS.some((kw) => lower.includes(kw));
}

// ---------------------------------------------------------------------------
// Upsert entity_connection
// Manual SELECT → INSERT/UPDATE — works regardless of whether migration 0004
// has been applied. Once the unique constraint exists the pipeline will still
// work correctly; it just does the dedup in application code.
// ---------------------------------------------------------------------------

async function upsertConnection(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  params: {
    fromType:       string;
    fromId:         string;
    toType:         string;
    toId:           string;
    connectionType: string;
    strength:       number;
    amountCents?:   number;
    evidence:       Record<string, unknown>[];
  }
): Promise<"upserted" | "failed"> {
  try {
    const { data: existing, error: selErr } = await db
      .from("entity_connections")
      .select("id")
      .eq("from_id", params.fromId)
      .eq("to_id", params.toId)
      .eq("connection_type", params.connectionType)
      .maybeSingle();

    if (selErr) {
      console.error(`    upsertConnection select error [${params.connectionType}]:`, selErr.message);
      return "failed";
    }

    if (existing) {
      const { error: updErr } = await db
        .from("entity_connections")
        .update({
          strength:     params.strength,
          amount_cents: params.amountCents ?? null,
          evidence:     params.evidence,
          updated_at:   new Date().toISOString(),
        })
        .eq("id", existing.id);

      if (updErr) {
        console.error(`    upsertConnection update error [${params.connectionType}]:`, updErr.message);
        return "failed";
      }
    } else {
      const { error: insErr } = await db
        .from("entity_connections")
        .insert({
          from_type:       params.fromType,
          from_id:         params.fromId,
          to_type:         params.toType,
          to_id:           params.toId,
          connection_type: params.connectionType,
          strength:        params.strength,
          amount_cents:    params.amountCents ?? null,
          evidence:        params.evidence,
        });

      if (insErr) {
        console.error(`    upsertConnection insert error [${params.connectionType}]:`, insErr.message);
        return "failed";
      }
    }

    return "upserted";
  } catch (err) {
    console.error("    upsertConnection threw:", err instanceof Error ? err.message : err);
    return "failed";
  }
}

// ---------------------------------------------------------------------------
// 1. Donation connections
// ---------------------------------------------------------------------------

async function deriveDonationConnections(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  counts: ConnectionCounts
): Promise<void> {
  console.log("\n  [1/4] Donation connections...");

  const PAGE_SIZE = 1000;
  let page = 0;
  const rows: {
    official_id: string; donor_name: string; donor_type: string;
    amount_cents: number; cycle_year: number | null;
    source_url: string | null; fec_committee_id: string | null;
  }[] = [];

  while (true) {
    const from = page * PAGE_SIZE;
    const to   = from + PAGE_SIZE - 1;
    const { data: batch, error } = await db
      .from("financial_relationships")
      .select(
        "official_id, donor_name, donor_type, amount_cents, cycle_year, source_url, fec_committee_id"
      )
      .not("official_id", "is", null)
      .range(from, to);

    if (error) {
      console.error("    Error fetching financial_relationships:", error.message);
      return;
    }
    if (!batch || batch.length === 0) break;
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    page++;
  }

  if (rows.length === 0) {
    console.log("    No financial_relationships found. Skipping.");
    return;
  }
  console.log(`    Loaded ${rows.length} financial_relationship records`);

  // Aggregate by donor key (name+type) across all officials → financial_entity totals
  const donorTotals = new Map<
    string,
    { name: string; type: string; totalCents: number; sourceUrl: string | null }
  >();

  // Aggregate by (donorKey, officialId) → connection totals
  const donorOfficialPairs = new Map<
    string,
    {
      donorKey:   string;
      officialId: string;
      totalCents: number;
      cycles:     number[];
      sourceUrl:  string | null;
    }
  >();

  for (const row of rows) {
    const donorName  = String(row.donor_name ?? "").trim().toUpperCase();
    const donorType  = String(row.donor_type ?? "other");
    const officialId = String(row.official_id);
    const amtCents   = Number(row.amount_cents ?? 0);
    const cycle      = row.cycle_year ? Number(row.cycle_year) : null;
    const sourceUrl  = (row.source_url as string | null) ?? null;

    const donorKey = `${donorName}|${donorType}`;
    const pairKey  = `${donorKey}|${officialId}`;

    // Per-donor aggregate (for financial_entity.total_donated_cents)
    const dt = donorTotals.get(donorKey);
    if (dt) {
      dt.totalCents += amtCents;
    } else {
      donorTotals.set(donorKey, { name: donorName, type: donorType, totalCents: amtCents, sourceUrl });
    }

    // Per-(donor, official) pair aggregate (for entity_connection)
    const pair = donorOfficialPairs.get(pairKey);
    if (pair) {
      pair.totalCents += amtCents;
      if (cycle !== null && !pair.cycles.includes(cycle)) pair.cycles.push(cycle);
    } else {
      donorOfficialPairs.set(pairKey, {
        donorKey,
        officialId,
        totalCents: amtCents,
        cycles: cycle !== null ? [cycle] : [],
        sourceUrl,
      });
    }
  }

  console.log(
    `    ${donorTotals.size} unique donors, ${donorOfficialPairs.size} donor→official pairs`
  );

  // Upsert financial_entities and collect their UUIDs
  const donorEntityIds = new Map<string, string>();

  for (const [donorKey, donor] of donorTotals) {
    try {
      const { data: existing } = await db
        .from("financial_entities")
        .select("id")
        .eq("name", donor.name)
        .eq("entity_type", donor.type)
        .maybeSingle();

      if (existing) {
        donorEntityIds.set(donorKey, existing.id as string);
        await db
          .from("financial_entities")
          .update({ total_donated_cents: donor.totalCents, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
      } else {
        const { data: inserted, error: insertErr } = await db
          .from("financial_entities")
          .insert({
            name:                 donor.name,
            entity_type:          donor.type,
            total_donated_cents:  donor.totalCents,
            source_ids:           {},
          })
          .select("id")
          .single();

        if (insertErr) {
          console.error(`    Could not insert financial_entity "${donor.name}":`, insertErr.message);
          counts.failed++;
          continue;
        }
        donorEntityIds.set(donorKey, inserted.id as string);
      }
    } catch (err) {
      console.error("    Error upserting financial_entity:", err instanceof Error ? err.message : err);
      counts.failed++;
    }
  }

  // Upsert entity_connections (financial_entity → official)
  for (const [, pair] of donorOfficialPairs) {
    const financialEntityId = donorEntityIds.get(pair.donorKey);
    if (!financialEntityId) continue;

    const strength = donationStrength(pair.totalCents);
    const evidence: Record<string, unknown>[] = [
      {
        source:          "fec",
        amount_cents:    pair.totalCents,
        election_cycles: pair.cycles,
        url:             pair.sourceUrl ?? "https://www.fec.gov/data/",
      },
    ];

    const result = await upsertConnection(db, {
      fromType:       "financial",
      fromId:         financialEntityId,
      toType:         "official",
      toId:           pair.officialId,
      connectionType: "donation",
      strength,
      amountCents:    pair.totalCents,
      evidence,
    });

    if (result === "failed") {
      counts.failed++;
    } else {
      counts.donation++;
    }
  }

  console.log(`    Created/updated: ${counts.donation} donation connections`);
}

// ---------------------------------------------------------------------------
// 2. Vote connections
// ---------------------------------------------------------------------------

async function deriveVoteConnections(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  counts: ConnectionCounts
): Promise<void> {
  console.log("\n  [2/4] Vote connections...");

  // Load all proposal vote_categories upfront so we can emit
  // nomination_vote_yes/no for confirmation votes.
  console.log("    Fetching proposal vote_categories...");
  const proposalCategoryMap = new Map<string, string | null>();
  {
    const PROP_PAGE = 1000;
    let propPage = 0;
    while (true) {
      const from = propPage * PROP_PAGE;
      const to   = from + PROP_PAGE - 1;
      const { data: props, error: propErr } = await db
        .from("proposals")
        .select("id, vote_category")
        .range(from, to);
      if (propErr) {
        console.error("    Warning: could not fetch proposal vote_categories:", propErr.message);
        break;
      }
      if (!props || props.length === 0) break;
      for (const p of props) proposalCategoryMap.set(String(p.id), p.vote_category ?? null);
      if (props.length < PROP_PAGE) break;
      propPage++;
    }
    console.log(`    Loaded ${proposalCategoryMap.size} proposal categories`);
  }

  // Supabase PostgREST caps responses at 1000 rows. Page through all votes,
  // then batch-upsert using the unique constraint (from_id, to_id, connection_type).
  const FETCH_SIZE  = 1000;
  const UPSERT_SIZE = 500;
  let page = 0;
  let totalFetched = 0;

  while (true) {
    const from = page * FETCH_SIZE;
    const to   = from + FETCH_SIZE - 1;

    const { data: votes, error } = await db
      .from("votes")
      .select("official_id, proposal_id, vote, voted_at, roll_call_number, chamber, session, source_ids")
      .range(from, to);

    if (error) {
      console.error("    Error fetching votes:", error.message);
      return;
    }
    if (!votes || votes.length === 0) {
      if (page === 0) console.log("    No votes found. Skipping.");
      break;
    }

    totalFetched += votes.length;

    // Build batch rows for this page
    const batch: Record<string, unknown>[] = [];
    for (const v of votes) {
      const voteCategory = proposalCategoryMap.get(String(v.proposal_id)) ?? null;
      const connType = voteToConnectionType(String(v.vote ?? ""), voteCategory);
      if (!connType) continue;

      const sourceIds    = (v.source_ids as Record<string, string>) ?? {};
      const rollCallKey  =
        sourceIds["roll_call"] ??
        sourceIds["house_clerk_url"] ??
        sourceIds["senate_lis_url"] ??
        null;

      batch.push({
        from_type:       "official",
        from_id:         String(v.official_id),
        to_type:         "proposal",
        to_id:           String(v.proposal_id),
        connection_type: connType,
        strength:        1.0,
        evidence: [
          {
            source:        "congress_gov",
            vote_date:     v.voted_at ?? null,
            roll_call:     v.roll_call_number ?? null,
            chamber:       v.chamber ?? null,
            session:       v.session ?? null,
            roll_call_key: rollCallKey,
          },
        ],
      });
    }

    // Upsert in sub-batches to avoid payload limits
    for (let i = 0; i < batch.length; i += UPSERT_SIZE) {
      const chunk = batch.slice(i, i + UPSERT_SIZE);
      const { error: upsertErr } = await db
        .from("entity_connections")
        .upsert(chunk, { onConflict: "from_id,to_id,connection_type" });

      if (upsertErr) {
        console.error(`    Upsert error (page ${page + 1}, chunk ${i / UPSERT_SIZE + 1}):`, upsertErr.message);
        counts.failed += chunk.length;
      } else {
        for (const row of chunk) {
          const ct = row.connection_type as string;
          if (ct === "vote_yes")              counts.vote_yes++;
          else if (ct === "vote_no")          counts.vote_no++;
          else if (ct === "nomination_vote_yes") counts.nomination_vote_yes++;
          else if (ct === "nomination_vote_no")  counts.nomination_vote_no++;
          else                                counts.vote_abstain++;
        }
      }
    }

    if (page % 10 === 0) {
      console.log(
        `    Fetched ${totalFetched} votes so far... (vote_yes: ${counts.vote_yes}, vote_no: ${counts.vote_no}, nom_yes: ${counts.nomination_vote_yes}, nom_no: ${counts.nomination_vote_no}, abstain: ${counts.vote_abstain})`
      );
    }

    if (votes.length < FETCH_SIZE) break;
    page++;
  }

  console.log(
    `    Created/updated: ${counts.vote_yes} vote_yes, ${counts.vote_no} vote_no, ` +
    `${counts.nomination_vote_yes} nomination_vote_yes, ${counts.nomination_vote_no} nomination_vote_no, ` +
    `${counts.vote_abstain} vote_abstain`
  );
}

// ---------------------------------------------------------------------------
// 3. Oversight connections
// ---------------------------------------------------------------------------

async function deriveOversightConnections(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  counts: ConnectionCounts
): Promise<void> {
  console.log("\n  [3/4] Oversight connections...");

  const { data: agencies, error } = await db
    .from("agencies")
    .select("id, name, governing_body_id")
    .not("governing_body_id", "is", null);

  if (error) {
    console.error("    Error fetching agencies:", error.message);
    return;
  }
  if (!agencies || agencies.length === 0) {
    console.log("    No agencies with governing_body_id. Skipping.");
    return;
  }
  console.log(`    Processing ${agencies.length} agency→governing_body relationships`);

  for (const agency of agencies) {
    const result = await upsertConnection(db, {
      fromType:       "governing_body",
      fromId:         String(agency.governing_body_id),
      toType:         "agency",
      toId:           String(agency.id),
      connectionType: "oversight",
      strength:       1.0,
      evidence:       [{ source: "inferred", relationship: "oversight_body" }],
    });

    if (result === "failed") {
      counts.failed++;
    } else {
      counts.oversight++;
    }
  }

  console.log(`    Created/updated: ${counts.oversight} oversight connections`);
}

// ---------------------------------------------------------------------------
// 4. Appointment connections (official → agency)
// Matches officials with agency-leadership role titles to the agencies whose
// governing_body they belong to. Produces 0 results until cabinet officials /
// agency heads are ingested — the code is correct and ready for that data.
// ---------------------------------------------------------------------------

async function deriveAppointmentConnections(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  counts: ConnectionCounts
): Promise<void> {
  console.log("\n  [4/4] Appointment connections...");

  const { data: officials, error: offErr } = await db
    .from("officials")
    .select("id, role_title, governing_body_id")
    .eq("is_active", true)
    .not("governing_body_id", "is", null);

  if (offErr) {
    console.error("    Error fetching officials:", offErr.message);
    return;
  }

  const leaders = (officials ?? []).filter(
    (o: { role_title: string | null }) => o.role_title && isAgencyLeadershipRole(o.role_title)
  );

  if (leaders.length === 0) {
    console.log(
      "    No agency-leadership officials found (cabinet/agency-head data not yet ingested). Skipping."
    );
    return;
  }
  console.log(`    Found ${leaders.length} officials with agency-leadership role titles`);

  // Build map: governing_body_id → agencies overseen by that body
  const { data: agencies, error: agErr } = await db
    .from("agencies")
    .select("id, name, governing_body_id")
    .not("governing_body_id", "is", null);

  if (agErr) {
    console.error("    Error fetching agencies:", agErr.message);
    return;
  }

  const agenciesByGovBody = new Map<string, Array<{ id: string; name: string }>>();
  for (const ag of agencies ?? []) {
    const list = agenciesByGovBody.get(String(ag.governing_body_id)) ?? [];
    list.push({ id: String(ag.id), name: String(ag.name) });
    agenciesByGovBody.set(String(ag.governing_body_id), list);
  }

  for (const official of leaders) {
    const linkedAgencies = agenciesByGovBody.get(String(official.governing_body_id)) ?? [];
    for (const agency of linkedAgencies) {
      const result = await upsertConnection(db, {
        fromType:       "official",
        fromId:         String(official.id),
        toType:         "agency",
        toId:           agency.id,
        connectionType: "appointment",
        strength:       1.0,
        evidence: [
          {
            source:      "inferred",
            role_title:  official.role_title,
            agency_name: agency.name,
          },
        ],
      });

      if (result === "failed") {
        counts.failed++;
      } else {
        counts.appointment++;
      }
    }
  }

  console.log(`    Created/updated: ${counts.appointment} appointment connections`);
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

export async function runConnectionsPipeline(): Promise<PipelineResult> {
  console.log("\n=== Entity connections pipeline ===");
  const logId = await startSync("connections");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any;

  const counts: ConnectionCounts = {
    donation:            0,
    vote_yes:            0,
    vote_no:             0,
    vote_abstain:        0,
    nomination_vote_yes: 0,
    nomination_vote_no:  0,
    oversight:           0,
    appointment:         0,
    failed:              0,
  };

  try {
    await deriveDonationConnections(db, counts);
    await deriveVoteConnections(db, counts);
    await deriveOversightConnections(db, counts);
    await deriveAppointmentConnections(db, counts);

    const total =
      counts.donation +
      counts.vote_yes +
      counts.vote_no +
      counts.vote_abstain +
      counts.nomination_vote_yes +
      counts.nomination_vote_no +
      counts.oversight +
      counts.appointment;

    const result: PipelineResult = {
      inserted:    total,
      updated:     0,
      failed:      counts.failed,
      estimatedMb: 0,
    };

    console.log("\n  ──────────────────────────────────────────────────");
    console.log("  Entity connections report");
    console.log("  ──────────────────────────────────────────────────");
    console.log(`  ${"Total connections created/updated:".padEnd(36)} ${total}`);
    console.log(`  ${"donation:".padEnd(36)} ${counts.donation}`);
    console.log(`  ${"vote_yes (legislation):".padEnd(36)} ${counts.vote_yes}`);
    console.log(`  ${"vote_no (legislation):".padEnd(36)} ${counts.vote_no}`);
    console.log(`  ${"vote_abstain:".padEnd(36)} ${counts.vote_abstain}`);
    console.log(`  ${"nomination_vote_yes:".padEnd(36)} ${counts.nomination_vote_yes}`);
    console.log(`  ${"nomination_vote_no:".padEnd(36)} ${counts.nomination_vote_no}`);
    console.log(`  ${"oversight:".padEnd(36)} ${counts.oversight}`);
    console.log(`  ${"appointment:".padEnd(36)} ${counts.appointment}`);
    console.log(`  ${"failed:".padEnd(36)} ${counts.failed}`);

    // Sample connection for verification
    const { data: sample } = await db
      .from("entity_connections")
      .select("from_type, from_id, to_type, to_id, connection_type, strength")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (sample) {
      console.log("\n  Sample connection (most recent):");
      console.log(
        `    ${sample.from_type}(${String(sample.from_id).slice(0, 8)}…) → ${sample.connection_type} → ${sample.to_type}(${String(sample.to_id).slice(0, 8)}…)  [strength: ${sample.strength}]`
      );
    } else {
      console.log("\n  No connections in DB yet (run data ingestion pipelines first).");
    }

    await completeSync(logId, result);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("  Connections pipeline fatal error:", msg);
    await failSync(logId, msg);
    return { inserted: 0, updated: 0, failed: counts.failed + 1, estimatedMb: 0 };
  }
}

// ---------------------------------------------------------------------------
// Standalone entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  (async () => {
    try {
      await runConnectionsPipeline();
      process.exit(0);
    } catch (err) {
      console.error("Fatal:", err);
      process.exit(1);
    }
  })();
}