// Section helpers shared by /api/claude/status, /core, /quality.
// Each helper does one logical section of the platform health response.
// Errors are wrapped with `section()` at the call site, never thrown out.

import { createAdminClient, getAnthropicUsage } from "@civitics/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = ReturnType<typeof createAdminClient> & Record<string, any>;

export const CONNECTION_TYPES = [
  "donation",
  "vote_yes",
  "vote_no",
  "vote_abstain",
  "nomination_vote_yes",
  "nomination_vote_no",
  "appointment",
  "revolving_door",
  "oversight",
  "lobbying",
  "co_sponsorship",
  "family",
  "business_partner",
  "legal_representation",
  "endorsement",
  "contract_award",
] as const;

export const VOTE_CATEGORIES = [
  "substantive",
  "procedural",
  "nomination",
  "treaty",
  "amendment",
] as const;

export async function section<T>(
  fn: () => Promise<T>,
): Promise<T | { error: string; partial: true }> {
  try {
    return await fn();
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
      partial: true as const,
    };
  }
}

// ── 1. Platform version ──────────────────────────────────────────────────────
export async function getVersion(db: Db) {
  const latestSync = await db
    .from("data_sync_log")
    .select("pipeline, completed_at, status")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return {
    commit_sha: process.env["VERCEL_GIT_COMMIT_SHA"] ?? "local",
    env: process.env["VERCEL_ENV"] ?? "development",
    latest_sync_at: latestSync.data?.completed_at ?? null,
    latest_pipeline: latestSync.data?.pipeline ?? null,
  };
}

// ── 2. Row counts ────────────────────────────────────────────────────────────
export async function getDatabase(db: Db, yesterday: string) {
  const [
    officials,
    proposals,
    votes,
    connections,
    finRel,
    finEnt,
    tags,
    cache,
    views,
  ] = await Promise.all([
    db.from("officials").select("*", { count: "exact", head: true }),
    db.from("proposals").select("*", { count: "exact", head: true }),
    db.from("votes").select("*", { count: "exact", head: true }),
    db.from("entity_connections").select("*", { count: "exact", head: true }),
    db.from("financial_relationships").select("*", { count: "exact", head: true }),
    db.from("financial_entities").select("*", { count: "exact", head: true }),
    db.from("entity_tags").select("*", { count: "exact", head: true }),
    db.from("ai_summary_cache").select("*", { count: "exact", head: true }),
    db
      .from("page_views")
      .select("*", { count: "exact", head: true })
      .gt("viewed_at", yesterday)
      .eq("is_bot", false),
  ]);
  return {
    officials: officials.count ?? 0,
    proposals: proposals.count ?? 0,
    votes: votes.count ?? 0,
    entity_connections: connections.count ?? 0,
    financial_relationships: finRel.count ?? 0,
    financial_entities: finEnt.count ?? 0,
    entity_tags: tags.count ?? 0,
    ai_summary_cache: cache.count ?? 0,
    page_views_24h: views.count ?? 0,
  };
}

// ── 3. Connection type breakdown ─────────────────────────────────────────────
export async function getConnectionTypes(db: Db) {
  const results = await Promise.all(
    CONNECTION_TYPES.map((ct) =>
      db
        .from("entity_connections")
        .select("*", { count: "exact", head: true })
        .eq("connection_type", ct)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .then((r: any) => ({ connection_type: ct, count: r.count ?? 0 })),
    ),
  );
  return results.sort(
    (a: { count: number }, b: { count: number }) => b.count - a.count,
  );
}

// ── 4. Pipeline status ───────────────────────────────────────────────────────
export async function getPipelines(db: Db) {
  const [recentRuns, cronState] = await Promise.all([
    db
      .from("data_sync_log")
      .select("pipeline, status, completed_at, rows_inserted")
      .order("completed_at", { ascending: false })
      .limit(10),
    db
      .from("pipeline_state")
      .select("value")
      .eq("key", "cron_last_run")
      .maybeSingle(),
  ]);
  return {
    recent_runs: recentRuns.data ?? [],
    cron_last_run: cronState.data?.value ?? null,
  };
}

// ── 5. AI costs ──────────────────────────────────────────────────────────────
export async function getAiCosts(db: Db, monthStart: string) {
  const adminResult = await getAnthropicUsage();

  if (adminResult.source === "api") {
    const { this_month, budget } = adminResult;
    return {
      monthly_spent_usd: Math.round(budget.spent_usd * 10000) / 10000,
      monthly_budget_usd: budget.limit_usd,
      budget_used_pct: Math.round(budget.pct_used * 10) / 10,
      month_start: monthStart,
      last_hour_tokens: adminResult.last_hour.total_tokens,
      last_24h_tokens: adminResult.last_24h.total_tokens,
      last_24h_cost_usd: adminResult.last_24h.cost_usd,
      source: "api" as const,
      this_month_total_tokens: this_month.total_tokens,
    };
  }

  const { data: rows } = await db
    .from("api_usage_logs")
    .select("input_tokens, output_tokens, cost_cents")
    .eq("service", "anthropic")
    .gte("created_at", monthStart);

  type UsageRow = {
    input_tokens: number | null;
    output_tokens: number | null;
    cost_cents: number | null;
  };
  const monthly_spent = ((rows ?? []) as UsageRow[]).reduce((sum, r) => {
    if (r.input_tokens != null && r.output_tokens != null) {
      return sum + (r.input_tokens * 0.25 + r.output_tokens * 1.25) / 1_000_000;
    }
    return sum + (r.cost_cents ?? 0) / 100;
  }, 0);
  const budget_usd = parseFloat(process.env.ANTHROPIC_MONTHLY_BUDGET ?? "") || 3.5;

  return {
    monthly_spent_usd: Math.round(monthly_spent * 10000) / 10000,
    monthly_budget_usd: budget_usd,
    budget_used_pct: Math.round((monthly_spent / budget_usd) * 1000) / 10,
    month_start: monthStart,
    source: "api_usage_logs" as const,
  };
}

// ── 6. Data quality checks ───────────────────────────────────────────────────
export async function getQuality(db: Db) {
  const [congressMembers, voteCategoryCounts, totalPacsRes, voteConnTotal] =
    await Promise.all([
      db
        .from("officials")
        .select("source_ids, metadata")
        .in("role_title", ["Senator", "Representative"]),

      Promise.all(
        VOTE_CATEGORIES.map((cat) =>
          db
            .from("proposals")
            .select("*", { count: "exact", head: true })
            .eq("vote_category", cat)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .then((r: any) => ({ vote_category: cat, count: r.count ?? 0 })),
        ),
      ),

      db
        .from("financial_entities")
        .select("*", { count: "exact", head: true })
        .eq("entity_type", "pac"),

      db
        .from("entity_connections")
        .select("*", { count: "exact", head: true })
        .in("connection_type", [
          "vote_yes",
          "vote_no",
          "vote_abstain",
          "nomination_vote_yes",
          "nomination_vote_no",
        ]),
    ]);

  const pacIdRows = await db
    .from("financial_entities")
    .select("id")
    .eq("entity_type", "pac")
    .limit(2000);
  const pacIds: string[] = (pacIdRows.data ?? []).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (r: any) => r.id as string,
  );
  const { count: taggedPacs } = await db
    .from("entity_tags")
    .select("entity_id", { count: "exact", head: true })
    .in("entity_id", pacIds)
    .eq("tag_category", "industry");

  type CongressRow = {
    source_ids: Record<string, string> | null;
    metadata: Record<string, string> | null;
  };
  const allCongress = ((congressMembers.data ?? []) as CongressRow[]).filter(
    (r) => r.source_ids?.["congress_gov"],
  );
  const total = allCongress.length;
  const has_fec = allCongress.filter((r) => r.source_ids?.["fec_id"]).length;
  const missing_state = allCongress.filter(
    (r) => !r.metadata?.["state"] && !r.metadata?.["state_abbr"],
  ).length;
  const totalPacs = totalPacsRes.count ?? 0;

  return {
    fec_coverage: {
      total,
      has_fec,
      pct: total ? Math.round((has_fec / total) * 1000) / 10 : 0,
    },
    missing_state,
    vote_categories: (
      voteCategoryCounts as { vote_category: string; count: number }[]
    ).filter((r) => r.count > 0),
    industry_tags: {
      total: totalPacs,
      tagged: taggedPacs ?? 0,
      pct: totalPacs
        ? Math.round(((taggedPacs ?? 0) / totalPacs) * 1000) / 10
        : 0,
      note:
        pacIds.length >= 2000 ? "tagged count capped at first 2000 PACs" : undefined,
    },
    vote_connections: voteConnTotal.count ?? 0,
  };
}

// ── 7. Self-tests ────────────────────────────────────────────────────────────
export async function getSelfTests(db: Db) {
  // Step 1: resolve Warren (needed for two checks)
  const warrenSearch = await db.rpc("search_graph_entities", {
    q: "warren",
    lim: 5,
  });
  type SearchRow = { id: string; label: string; entity_type: string };
  const warrenRows = (warrenSearch.data ?? []) as SearchRow[];
  const warrenEntity = warrenRows.find(
    (r) =>
      r.label.toLowerCase().includes("elizabeth warren") ||
      (r.label.toLowerCase().endsWith("warren") && r.entity_type === "official"),
  );
  const warrenId = warrenEntity?.id ?? null;

  const [
    chordData,
    warrenVotesRes,
    anthropicUsageResult,
    cronState,
    connPipelineRes,
    voteYesTotal,
  ] = await Promise.all([
    db.rpc("chord_industry_flows"),

    warrenId
      ? db
          .from("entity_connections")
          .select("*", { count: "exact", head: true })
          .eq("from_id", warrenId)
          .eq("connection_type", "vote_yes")
      : Promise.resolve({ count: null }),

    getAnthropicUsage(),

    db
      .from("pipeline_state")
      .select("value")
      .eq("key", "cron_last_run")
      .maybeSingle(),

    db
      .from("data_sync_log")
      .select("status, rows_inserted, completed_at")
      .eq("pipeline", "connections")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    db
      .from("entity_connections")
      .select("*", { count: "exact", head: true })
      .eq("connection_type", "vote_yes"),
  ]);

  const monthlySpent =
    anthropicUsageResult.source === "api"
      ? anthropicUsageResult.this_month.cost_usd
      : 0;

  type ChordRow = { industry: string };
  const chordGroups = chordData.error
    ? 0
    : ((chordData.data ?? []) as ChordRow[]).filter(
        (r) => r.industry !== "untagged",
      ).length;

  const cronVal = (cronState.data?.value ?? null) as
    | { completed_at?: string; started_at?: string }
    | null;
  const cronLastRun = cronVal?.completed_at ?? cronVal?.started_at ?? null;

  return [
    {
      name: "entity_search_finds_warren",
      passed: warrenEntity != null,
      detail: warrenEntity
        ? `Found ${warrenEntity.label} (${warrenEntity.id})`
        : "Elizabeth Warren not found in search results",
    },
    {
      name: "chord_has_industry_data",
      passed: !chordData.error && chordGroups >= 5,
      detail: chordData.error
        ? `RPC error: ${chordData.error.message}`
        : `${chordGroups} industry groups returned`,
    },
    {
      name: "warren_has_vote_connections",
      passed: (warrenVotesRes.count ?? 0) > 10,
      detail: warrenId
        ? `${warrenVotesRes.count ?? 0} vote_yes connections (expected ~23 per-proposal deduplicated)`
        : "Warren not found — skipped",
    },
    {
      name: "ai_budget_ok",
      passed:
        anthropicUsageResult.source === "api"
          ? monthlySpent < anthropicUsageResult.budget.limit_usd * 0.9
          : monthlySpent < 3.5 * 0.9,
      detail:
        anthropicUsageResult.source === "api"
          ? `$${monthlySpent.toFixed(4)} of $${anthropicUsageResult.budget.limit_usd.toFixed(2)} budget (${Math.round((monthlySpent / anthropicUsageResult.budget.limit_usd) * 100)}% used) [admin api]`
          : `$${monthlySpent.toFixed(4)} — admin key unavailable`,
    },
    {
      name: "nightly_ran_today",
      passed:
        cronLastRun != null &&
        Date.now() - new Date(cronLastRun).getTime() < 26 * 60 * 60 * 1000,
      detail: cronLastRun
        ? `Last run: ${cronLastRun}`
        : "No cron_last_run in pipeline_state",
    },
    {
      name: "connections_pipeline_healthy",
      passed:
        connPipelineRes.data?.status === "complete" &&
        (voteYesTotal.count ?? 0) > 50000,
      detail: connPipelineRes.data
        ? `Status: ${connPipelineRes.data.status}, vote_yes total: ${voteYesTotal.count ?? 0}`
        : "No connections pipeline run found in data_sync_log",
    },
  ];
}

// ── 8. Chord top flows ───────────────────────────────────────────────────────
export async function getChord(db: Db) {
  const { data, error } = await db.rpc("chord_industry_flows");
  if (error) throw new Error(error.message ?? "chord RPC error");

  type FlowRow = {
    industry: string;
    party_chamber: string;
    total_cents: number;
  };
  const rows = (data ?? []) as FlowRow[];
  const lbl = (s: string) =>
    s.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());

  const flowMatrix = new Map<string, Map<string, number>>();
  let totalFlow = 0;
  for (const row of rows) {
    const usd = Number(row.total_cents) / 100;
    totalFlow += usd;
    if (row.industry === "untagged") continue;
    if (!flowMatrix.has(row.industry)) flowMatrix.set(row.industry, new Map());
    const pm = flowMatrix.get(row.industry)!;
    pm.set(row.party_chamber, (pm.get(row.party_chamber) ?? 0) + usd);
  }

  const topFlows: Array<{ from: string; to: string; amount_usd: number }> = [];
  for (const [ind, pm] of flowMatrix)
    for (const [party, usd] of pm)
      topFlows.push({ from: lbl(ind), to: party, amount_usd: Math.round(usd) });
  topFlows.sort((a, b) => b.amount_usd - a.amount_usd);

  return {
    top_flows: topFlows.slice(0, 10),
    total_flow_usd: Math.round(totalFlow),
  };
}

// ── 9. Activity: top pages last 24 h ─────────────────────────────────────────
export async function getActivity(db: Db, yesterday: string) {
  const [countRes, pathRes] = await Promise.all([
    db
      .from("page_views")
      .select("*", { count: "exact", head: true })
      .gt("viewed_at", yesterday)
      .eq("is_bot", false),
    db
      .from("page_views")
      .select("path")
      .gt("viewed_at", yesterday)
      .eq("is_bot", false)
      .not("path", "in", `("/","/dashboard")`)
      .limit(500),
  ]);

  const counts: Record<string, number> = {};
  for (const r of (pathRes.data ?? []) as unknown as { path: string }[]) {
    counts[r.path] = (counts[r.path] ?? 0) + 1;
  }
  const topPages = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([path, views]) => ({ path, views }));

  return {
    page_views_24h: countRes.count ?? 0,
    top_pages: topPages,
  };
}

// ── 10. Resource warnings ────────────────────────────────────────────────────
export async function getResourceWarnings(db: Db) {
  const { data: egressRow } = await db
    .from("pipeline_state")
    .select("value")
    .eq("key", "monthly_egress_estimate")
    .maybeSingle();
  const egressMb =
    ((egressRow?.value as Record<string, unknown> | null)?.egress_mb as number) ??
    0;
  const EGRESS_LIMIT_MB = 5000;
  return {
    egress_estimate_mb: egressMb,
    egress_limit_mb: EGRESS_LIMIT_MB,
    egress_pct: Math.round((egressMb / EGRESS_LIMIT_MB) * 100),
    egress_warning: egressMb > 4000,
    egress_critical: egressMb > 4750,
  };
}

// ── 11. Officials breakdown ──────────────────────────────────────────────────
export async function getOfficialsBreakdown(db: Db) {
  const { data, error } = await db.rpc("get_officials_breakdown");
  if (error || !data) return null;
  type Row = { category: string; count: number };
  const rows = data as Row[];
  const get = (cat: string) => rows.find((r) => r.category === cat)?.count ?? 0;
  return { federal: get("federal"), state: get("state"), judges: get("judges") };
}
