/**
 * Enrichment queue helpers — shared by the pipeline queue-mode branches and
 * the backlog seeder. Wraps the `enqueue_enrichment` RPC and assembles the
 * context blob a worker will replay in-session to produce tags / summaries
 * without having to re-query the database.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

import { VALID_TOPICS, TOPIC_ICONS, ISSUE_AREAS } from "../tags/topics";

export type EntityType = "proposal" | "official";
export type TaskType = "tag" | "summary";
export type EnqueueAction =
  | "created"
  | "retried"
  | "skipped_done"
  | "skipped_pending";

export type EnqueueCounts = Record<EnqueueAction, number>;

export function zeroCounts(): EnqueueCounts {
  return { created: 0, retried: 0, skipped_done: 0, skipped_pending: 0 };
}

export async function enqueue(
  db: Db,
  row: {
    entity_id: string;
    entity_type: EntityType;
    task_type: TaskType;
    context: unknown;
    priority?: number;
    entity_updated_at?: string;
  },
): Promise<EnqueueAction> {
  const { data, error } = await db.rpc("enqueue_enrichment", {
    p_entity_id: row.entity_id,
    p_entity_type: row.entity_type,
    p_task_type: row.task_type,
    p_context: row.context,
    ...(row.priority !== undefined && { p_priority: row.priority }),
    ...(row.entity_updated_at !== undefined && { p_entity_updated_at: row.entity_updated_at }),
  });
  if (error) throw error;
  return data as EnqueueAction;
}

// ---------------------------------------------------------------------------
// Jurisdiction-based priority helpers
// ---------------------------------------------------------------------------

export function jurisdictionToPriority(type: string): number {
  switch (type) {
    case "global":
    case "supranational":
    case "country": return 40;
    case "state":   return 30;
    case "county":  return 20;
    case "city":
    case "district": return 10;
    default:         return 5;
  }
}

export async function loadJurisdictionPriorities(
  db: Db,
  jurisdictionIds: string[],
): Promise<Map<string, number>> {
  if (jurisdictionIds.length === 0) return new Map();
  const unique = [...new Set(jurisdictionIds)];
  const { data } = await db
    .from("jurisdictions")
    .select("id, type")
    .in("id", unique);
  const out = new Map<string, number>();
  for (const j of (data ?? []) as { id: string; type: string }[]) {
    out.set(j.id, jurisdictionToPriority(j.type));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Context builders — shapes the worker needs to reproduce the inline prompt.
// ---------------------------------------------------------------------------

export type ProposalTagInput = {
  id: string;
  title: string;
  summary_plain: string | null;
  metadata: Record<string, unknown> | null;
};

export function buildProposalTagContext(p: ProposalTagInput) {
  const agencyId =
    typeof p.metadata?.["agency_id"] === "string"
      ? (p.metadata["agency_id"] as string)
      : null;
  return {
    title: p.title,
    summary_plain: (p.summary_plain ?? "").slice(0, 300),
    agency_id: agencyId,
    valid_topics: VALID_TOPICS,
    topic_icons: TOPIC_ICONS,
  };
}

export type OfficialTagInput = {
  id: string;
  full_name: string;
  role_title: string;
  party: string | null;
  state: string | null;
  vote_count: number;
  total_raised: number;
  top_industries: string;
};

export function buildOfficialTagContext(o: OfficialTagInput) {
  return {
    full_name: o.full_name,
    role_title: o.role_title,
    party: o.party,
    state: o.state,
    vote_count: o.vote_count,
    total_raised: o.total_raised,
    top_industries: o.top_industries,
    issue_areas: ISSUE_AREAS,
  };
}

export type ProposalSummaryInput = {
  id: string;
  title: string;
  summary_plain: string | null;
  type: string | null;
  agency_name: string | null;
  agency_acronym: string | null;
};

export type ProposalContextLevel = "full_summary" | "title_only" | "truly_empty";

export function classifyProposalContext(
  summaryPlain: string | null,
  title: string,
): ProposalContextLevel {
  if ((summaryPlain?.length ?? 0) > 100) return "full_summary";
  if (title.trim().length >= 10) return "title_only";
  return "truly_empty";
}

export function buildProposalSummaryContext(p: ProposalSummaryInput) {
  const context_level = classifyProposalContext(p.summary_plain, p.title);
  return {
    title: p.title,
    summary_plain: p.summary_plain,
    agency_name: p.agency_name,
    agency_acronym: p.agency_acronym,
    type: p.type,
    context_level,
    prompt_template: context_level, // worker resolves template by name
    max_tokens: context_level === "full_summary" ? 300 : 200,
  };
}

export type OfficialSummaryInput = {
  id: string;
  full_name: string;
  role_title: string;
  state: string | null;
  party: string | null;
  vote_count: number;
  donor_count: number;
  total_raised: number;
};

export function buildOfficialSummaryContext(o: OfficialSummaryInput) {
  return {
    full_name: o.full_name,
    role_title: o.role_title,
    state: o.state,
    party: o.party,
    vote_count: o.vote_count,
    donor_count: o.donor_count,
    total_raised: o.total_raised,
    max_tokens: 200,
  };
}

// ---------------------------------------------------------------------------
// Batch enrichment for officials — top_industries / vote_count / total_raised
// aren't on the officials row itself; they come from aggregating votes and
// financial_relationships. Both the tag-context builder and summary-context
// builder need this, so compute once per batch.
// ---------------------------------------------------------------------------

export type OfficialAggregate = {
  vote_count: number;
  donor_count: number;
  total_raised: number;
  top_industries: string;
};

export async function aggregateOfficialStats(
  db: Db,
  officialIds: string[],
): Promise<Map<string, OfficialAggregate>> {
  const out = new Map<string, OfficialAggregate>();
  if (officialIds.length === 0) return out;

  const [voteRes, donorRes] = await Promise.all([
    db.from("votes").select("official_id").in("official_id", officialIds),
    db
      .from("financial_relationships")
      .select("official_id, donor_type, amount_cents")
      .in("official_id", officialIds),
  ]);

  const voteCounts = new Map<string, number>();
  for (const v of (voteRes.data ?? []) as { official_id: string }[]) {
    voteCounts.set(v.official_id, (voteCounts.get(v.official_id) ?? 0) + 1);
  }

  const donorCounts = new Map<string, number>();
  const donorTotals = new Map<string, number>();
  const typeByOfficial = new Map<string, Map<string, number>>();
  for (const d of (donorRes.data ?? []) as {
    official_id: string;
    donor_type: string | null;
    amount_cents: number | null;
  }[]) {
    donorCounts.set(d.official_id, (donorCounts.get(d.official_id) ?? 0) + 1);
    donorTotals.set(
      d.official_id,
      (donorTotals.get(d.official_id) ?? 0) + (d.amount_cents ?? 0),
    );
    const typeKey = d.donor_type ?? "unknown";
    const typeMap = typeByOfficial.get(d.official_id) ?? new Map<string, number>();
    typeMap.set(typeKey, (typeMap.get(typeKey) ?? 0) + (d.amount_cents ?? 0));
    typeByOfficial.set(d.official_id, typeMap);
  }

  for (const id of officialIds) {
    const typeMap = typeByOfficial.get(id) ?? new Map<string, number>();
    const topIndustries = Array.from(typeMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([t]) => t)
      .join(", ");
    out.set(id, {
      vote_count: voteCounts.get(id) ?? 0,
      donor_count: donorCounts.get(id) ?? 0,
      total_raised: donorTotals.get(id) ?? 0,
      top_industries: topIndustries || "Unknown",
    });
  }
  return out;
}
