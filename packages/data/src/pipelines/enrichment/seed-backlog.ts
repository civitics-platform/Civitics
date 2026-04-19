/**
 * Enrichment backlog seeder (FIX-064)
 *
 * One-shot script: stages every proposal + official that's missing an AI tag
 * or an AI summary into enrichment_queue. Unlike the pipeline's queue-mode
 * branch (narrow scope — open-comment proposals, active Sen/Rep with records),
 * the seeder widens to "everything missing" so a worker can drain the whole
 * backlog in one go.
 *
 *   pnpm --filter @civitics/data data:enrich-seed             # real inserts
 *   pnpm --filter @civitics/data data:enrich-seed -- --dry-run
 */

import { createAdminClient, agencyFullName } from "@civitics/db";
import {
  enqueue,
  zeroCounts,
  buildProposalTagContext,
  buildOfficialTagContext,
  buildProposalSummaryContext,
  buildOfficialSummaryContext,
  classifyProposalContext,
  aggregateOfficialStats,
  type EnqueueCounts,
  type EnqueueAction,
} from "./queue";

const DRY_RUN = process.argv.includes("--dry-run");
const PAGE = 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

// ---------------------------------------------------------------------------
// Pagination helpers
// ---------------------------------------------------------------------------

async function fetchAll<T>(
  label: string,
  loader: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const to = from + PAGE - 1;
    const { data, error } = await loader(from, to);
    if (error) {
      console.error(`   ✗ ${label} page ${from}-${to} failed:`, error.message);
      break;
    }
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Already-done sets (so we can "fetch all missing X" efficiently)
// ---------------------------------------------------------------------------

async function taggedEntityIds(
  db: Db,
  entityType: "proposal" | "official",
): Promise<Set<string>> {
  const rows = await fetchAll<{ entity_id: string }>(
    `entity_tags(${entityType})`,
    (from, to) =>
      db
        .from("entity_tags")
        .select("entity_id")
        .eq("entity_type", entityType)
        .eq("generated_by", "ai")
        .eq("tag_category", "topic")
        .range(from, to),
  );
  return new Set(rows.map((r) => r.entity_id));
}

async function summarizedEntityIds(
  db: Db,
  entityType: "proposal" | "official",
  summaryType: string,
): Promise<Set<string>> {
  const rows = await fetchAll<{ entity_id: string }>(
    `ai_summary_cache(${entityType},${summaryType})`,
    (from, to) =>
      db
        .from("ai_summary_cache")
        .select("entity_id")
        .eq("entity_type", entityType)
        .eq("summary_type", summaryType)
        .range(from, to),
  );
  return new Set(rows.map((r) => r.entity_id));
}

// ---------------------------------------------------------------------------
// Proposal sources
// ---------------------------------------------------------------------------

type ProposalRow = {
  id: string;
  title: string;
  summary_plain: string | null;
  type: string | null;
  metadata: Record<string, unknown> | null;
};

async function fetchAllProposals(db: Db): Promise<ProposalRow[]> {
  return fetchAll<ProposalRow>("proposals", (from, to) =>
    db.from("proposals").select("id, title, summary_plain, type, metadata").range(from, to),
  );
}

// ---------------------------------------------------------------------------
// Official sources
// ---------------------------------------------------------------------------

type OfficialRow = {
  id: string;
  full_name: string;
  role_title: string;
  party: string | null;
  metadata: Record<string, unknown> | null;
};

async function fetchAllActiveOfficials(db: Db): Promise<OfficialRow[]> {
  return fetchAll<OfficialRow>("officials", (from, to) =>
    db
      .from("officials")
      .select("id, full_name, role_title, party, metadata")
      .eq("is_active", true)
      .range(from, to),
  );
}

// ---------------------------------------------------------------------------
// Enqueue loops
// ---------------------------------------------------------------------------

async function enqueueAll(
  db: Db,
  rows: Array<{
    entity_id: string;
    entity_type: "proposal" | "official";
    task_type: "tag" | "summary";
    context: unknown;
  }>,
  label: string,
): Promise<EnqueueCounts> {
  const counts = zeroCounts();
  if (DRY_RUN) {
    counts.created = rows.length;
    console.log(`   [dry-run] would enqueue ${rows.length} ${label}`);
    return counts;
  }
  let errors = 0;
  for (const row of rows) {
    try {
      const action: EnqueueAction = await enqueue(db, row);
      counts[action]++;
    } catch (err) {
      errors++;
      if (errors <= 3) {
        console.error(`   ✗ enqueue ${label} ${row.entity_id}:`, err instanceof Error ? err.message : err);
      }
    }
  }
  if (errors > 0) console.error(`   ✗ ${errors} ${label} enqueues failed`);
  return counts;
}

function fmt(counts: EnqueueCounts): string {
  return `created=${counts.created} retried=${counts.retried} skipped_done=${counts.skipped_done} skipped_pending=${counts.skipped_pending}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`\n═══ Enrichment backlog seed ════════════════════════════════`);
  console.log(`    Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log(`    Time: ${new Date().toISOString()}\n`);

  const db = createAdminClient() as unknown as Db;

  // 1. Proposal tags
  const [proposals, taggedProposalIds] = await Promise.all([
    fetchAllProposals(db),
    taggedEntityIds(db, "proposal"),
  ]);
  const proposalTagRows = proposals
    .filter((p) => !taggedProposalIds.has(p.id))
    .map((p) => ({
      entity_id: p.id,
      entity_type: "proposal" as const,
      task_type: "tag" as const,
      context: buildProposalTagContext({
        id: p.id,
        title: p.title,
        summary_plain: p.summary_plain,
        metadata: p.metadata,
      }),
    }));
  console.log(`── Proposal tags (${proposalTagRows.length} missing) ──`);
  const proposalTagCounts = await enqueueAll(db, proposalTagRows, "proposal-tags");
  console.log(`   ${fmt(proposalTagCounts)}\n`);

  // 2. Proposal summaries — exclude truly_empty (worker can't produce output)
  const summarizedProposalIds = await summarizedEntityIds(db, "proposal", "plain_language");
  const proposalSummaryRows = proposals
    .filter((p) => !summarizedProposalIds.has(p.id))
    .filter((p) => classifyProposalContext(p.summary_plain, p.title) !== "truly_empty")
    .map((p) => {
      const acronym = (p.metadata?.["agency_id"] as string | undefined) ?? null;
      return {
        entity_id: p.id,
        entity_type: "proposal" as const,
        task_type: "summary" as const,
        context: buildProposalSummaryContext({
          id: p.id,
          title: p.title,
          summary_plain: p.summary_plain,
          type: p.type,
          agency_name: agencyFullName(acronym),
          agency_acronym: acronym,
        }),
      };
    });
  console.log(`── Proposal summaries (${proposalSummaryRows.length} missing, non-empty) ──`);
  const proposalSummaryCounts = await enqueueAll(db, proposalSummaryRows, "proposal-summaries");
  console.log(`   ${fmt(proposalSummaryCounts)}\n`);

  // 3. Official tags + 4. Official summaries — share the officials fetch and
  //    the stats aggregation (top_industries, vote_count, total_raised).
  const [officials, taggedOfficialIds, summarizedOfficialIds] = await Promise.all([
    fetchAllActiveOfficials(db),
    taggedEntityIds(db, "official"),
    summarizedEntityIds(db, "official", "profile"),
  ]);
  const officialIds = officials.map((o) => o.id);
  const stats = await aggregateOfficialStats(db, officialIds);

  const officialTagRows = officials
    .filter((o) => !taggedOfficialIds.has(o.id))
    .map((o) => {
      const agg = stats.get(o.id);
      return {
        entity_id: o.id,
        entity_type: "official" as const,
        task_type: "tag" as const,
        context: buildOfficialTagContext({
          id: o.id,
          full_name: o.full_name,
          role_title: o.role_title,
          party: o.party ?? null,
          state: (o.metadata?.["state"] as string | undefined) ?? null,
          vote_count: agg?.vote_count ?? 0,
          total_raised: agg?.total_raised ?? 0,
          top_industries: agg?.top_industries ?? "Unknown",
        }),
      };
    });
  console.log(`── Official tags (${officialTagRows.length} missing) ──`);
  const officialTagCounts = await enqueueAll(db, officialTagRows, "official-tags");
  console.log(`   ${fmt(officialTagCounts)}\n`);

  const officialSummaryRows = officials
    .filter((o) => !summarizedOfficialIds.has(o.id))
    .map((o) => {
      const agg = stats.get(o.id);
      return {
        entity_id: o.id,
        entity_type: "official" as const,
        task_type: "summary" as const,
        context: buildOfficialSummaryContext({
          id: o.id,
          full_name: o.full_name,
          role_title: o.role_title,
          state: (o.metadata?.["state"] as string | undefined) ?? null,
          party: o.party ?? null,
          vote_count: agg?.vote_count ?? 0,
          donor_count: agg?.donor_count ?? 0,
          total_raised: agg?.total_raised ?? 0,
        }),
      };
    });
  console.log(`── Official summaries (${officialSummaryRows.length} missing) ──`);
  const officialSummaryCounts = await enqueueAll(db, officialSummaryRows, "official-summaries");
  console.log(`   ${fmt(officialSummaryCounts)}\n`);

  // Summary report
  console.log(`══ Seed complete ════════════════════════════════════════════`);
  console.log(`   Proposal tags:      ${fmt(proposalTagCounts)}`);
  console.log(`   Proposal summaries: ${fmt(proposalSummaryCounts)}`);
  console.log(`   Official tags:      ${fmt(officialTagCounts)}`);
  console.log(`   Official summaries: ${fmt(officialSummaryCounts)}`);
  if (DRY_RUN) console.log(`   (DRY RUN — nothing inserted)`);
}

main()
  .then(() => setTimeout(() => process.exit(0), 500))
  .catch((err) => {
    console.error("Seed failed:", err);
    setTimeout(() => process.exit(1), 500);
  });
