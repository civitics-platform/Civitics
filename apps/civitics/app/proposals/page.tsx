export const dynamic = "force-dynamic";

import { cookies } from "next/headers";
import { createServerClient } from "@civitics/db";
import { ProposalCard, type ProposalCardData } from "./components/ProposalCard";
import { FeaturedSection } from "./components/FeaturedSection";
import { AGENCY_FULL_NAMES } from "./components/agencyNames";
import type { EntityTag } from "../components/tags/EntityTags";
import { PageViewTracker } from "../components/PageViewTracker";
import { PageHeader } from "@civitics/ui";
import { NavBar } from "../components/NavBar";

const PAGE_SIZE = 20;

const PROPOSAL_TYPE_LABELS: Record<string, string> = {
  regulation:      "Federal Regulation",
  bill:            "Congressional Bill",
  executive_order: "Executive Order",
  treaty:          "Treaty",
  referendum:      "Referendum",
  resolution:      "Resolution",
};

// Top agencies by proposal volume — used for the filter dropdown.
const AGENCIES = [
  "EPA","FAA","USCG","FCC","FWS","NOAA","IRS","NCUA","OSHA","AMS",
  "CMS","OCC","NRC","ED","FERC","OPM","FDA","VA","CPSC","NHTSA",
];

// Topic filter pills — top 8 by proposal volume
const TOPIC_PILLS = [
  { tag: "climate",             label: "Climate",      icon: "🌊" },
  { tag: "healthcare",          label: "Healthcare",   icon: "🏥" },
  { tag: "finance",             label: "Finance",      icon: "📈" },
  { tag: "aviation",            label: "Aviation",     icon: "✈️" },
  { tag: "agriculture",         label: "Agriculture",  icon: "🌾" },
  { tag: "energy",              label: "Energy",       icon: "⚡" },
  { tag: "education",           label: "Education",    icon: "📚" },
  { tag: "consumer_protection", label: "Consumer",     icon: "🛡" },
];

type SearchParams = {
  status?: string;
  type?: string;
  agency?: string;
  topics?: string;
  q?: string;
  page?: string;
};

function buildUrl(base: SearchParams, updates: Partial<SearchParams>): string {
  // Merge — only reset page to "1" when the update is a filter change (no explicit page)
  const merged = { ...base, ...updates };
  if (!("page" in updates)) merged.page = "1";
  const params = new URLSearchParams();
  if (merged.status && merged.status !== "all") params.set("status", merged.status);
  if (merged.type)   params.set("type",   merged.type);
  if (merged.agency) params.set("agency", merged.agency);
  if (merged.topics) params.set("topics", merged.topics);
  if (merged.q)      params.set("q",      merged.q);
  if (merged.page && merged.page !== "1") params.set("page", merged.page);
  const qs = params.toString();
  return `/proposals${qs ? `?${qs}` : ""}`;
}

function toggleTopicInUrl(base: SearchParams, topic: string): string {
  const current = (base.topics ?? "").split(",").filter(Boolean);
  const next = current.includes(topic)
    ? current.filter((t) => t !== topic)
    : [...current, topic];
  return buildUrl(base, { topics: next.join(",") || undefined });
}

function buildCountLabel(
  totalCount: number,
  statusFilter: string,
  searchQ: string
): string {
  if (searchQ) return `${totalCount.toLocaleString()} proposals matching "${searchQ}"`;
  if (statusFilter === "open") return `${totalCount.toLocaleString()} open for comment`;
  if (statusFilter === "closed") return `${totalCount.toLocaleString()} closed proposals`;
  return `${totalCount.toLocaleString()} total proposals`;
}

export default async function ProposalsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const cookieStore = await cookies();
  const supabase = createServerClient(cookieStore);

  const statusFilter = searchParams.status ?? "open";
  const typeFilter   = searchParams.type   ?? "";
  const agencyFilter = searchParams.agency ?? "";
  const topicsFilter = searchParams.topics ?? "";
  const searchQ      = searchParams.q      ?? "";
  const page         = Math.max(1, parseInt(searchParams.page ?? "1", 10));
  const offset       = (page - 1) * PAGE_SIZE;
  const activeTopics = topicsFilter ? topicsFilter.split(",").filter(Boolean) : [];

  const now = new Date().toISOString();

  // ─── Featured section queries (all three tabs) ────────────────────────────
  const openFeaturedQuery = supabase
    .from("proposals")
    .select("id,title,type,status,regulations_gov_id,congress_gov_url,comment_period_end,summary_plain,summary_model,introduced_at,metadata")
    .eq("status", "open_comment")
    .gt("comment_period_end", now)
    .order("comment_period_end", { ascending: true })
    .limit(6);

  // Congressional Bills tab — newest bills regardless of status
  const billsQuery = supabase
    .from("proposals")
    .select("id,title,type,status,regulations_gov_id,congress_gov_url,comment_period_end,summary_plain,summary_model,introduced_at,metadata")
    .eq("type", "bill")
    .order("introduced_at", { ascending: false, nullsFirst: false })
    .limit(6);

  // Most Viewed tab — look up top proposal IDs from page_views then fetch them
  const sbAny2 = supabase as any;
  const topViewedIdsRes = await sbAny2
    .from("page_views")
    .select("entity_id")
    .eq("entity_type", "proposal")
    .limit(200);

  // Count views per proposal and take top 6
  const viewCounts: Record<string, number> = {};
  for (const row of topViewedIdsRes.data ?? []) {
    const id = row.entity_id as string;
    viewCounts[id] = (viewCounts[id] ?? 0) + 1;
  }
  const topProposalIds = Object.entries(viewCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([id]) => id);

  const mostViewedQuery =
    topProposalIds.length > 0
      ? supabase
          .from("proposals")
          .select("id,title,type,status,regulations_gov_id,congress_gov_url,comment_period_end,summary_plain,summary_model,introduced_at,metadata")
          .in("id", topProposalIds)
      : Promise.resolve({ data: [] as any[], error: null });

  // ─── Filtered main list ───────────────────────────────────────────────────
  let mainQuery = supabase
    .from("proposals")
    .select("id,title,type,status,regulations_gov_id,congress_gov_url,comment_period_end,summary_plain,summary_model,introduced_at,metadata", {
      count: "exact",
    });

  // Status filter
  if (statusFilter === "open") {
    mainQuery = mainQuery.eq("status", "open_comment").gt("comment_period_end", now);
  } else if (statusFilter === "closed") {
    mainQuery = mainQuery.or(`status.eq.comment_closed,and(status.eq.open_comment,comment_period_end.lt.${now})`);
  }
  // "all" — no status filter

  // Type filter
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeFilter) mainQuery = mainQuery.eq("type", typeFilter as any);

  // Agency filter (via metadata JSONB)
  if (agencyFilter) mainQuery = mainQuery.filter("metadata->>agency_id", "eq", agencyFilter);

  // Text search
  if (searchQ) mainQuery = mainQuery.ilike("title", `%${searchQ}%`);

  // Topic filter — if active topics, get matching proposal IDs first
  if (activeTopics.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sbAny = supabase as any;
    const { data: tagRows } = await sbAny
      .from("entity_tags")
      .select("entity_id")
      .eq("entity_type", "proposal")
      .in("tag", activeTopics);
    const topicFilteredIds = (tagRows ?? []).map((r: { entity_id: string }) => r.entity_id) as string[];
    if (topicFilteredIds.length > 0) {
      mainQuery = mainQuery.in("id", topicFilteredIds);
    }
  }

  // Sort and paginate
  mainQuery = mainQuery
    .order("comment_period_end", { ascending: true, nullsFirst: false })
    .range(offset, offset + PAGE_SIZE - 1);

  const [openFeaturedRes, billsRes, mostViewedRes, mainRes] = await Promise.all([
    openFeaturedQuery,
    billsQuery,
    mostViewedQuery,
    mainQuery,
  ]);

  const rawOpenFeatured   = (openFeaturedRes.data  ?? []) as ProposalCardData[];
  const rawBills          = (billsRes.data          ?? []) as ProposalCardData[];
  const rawMostViewed     = (mostViewedRes.data     ?? []) as ProposalCardData[];
  const rawMainProposals  = (mainRes.data           ?? []) as ProposalCardData[];
  const totalCount = mainRes.count ?? 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  // ─── AI summary cache lookup ──────────────────────────────────────────────
  // Fetch cached summaries for all proposals on this page in one query
  const allProposalIds = [
    ...rawOpenFeatured.map((p) => p.id),
    ...rawBills.map((p) => p.id),
    ...rawMostViewed.map((p) => p.id),
    ...rawMainProposals.map((p) => p.id),
  ].filter((id, i, arr) => arr.indexOf(id) === i); // dedupe

  // ai_summary_cache may not be in generated types — cast to bypass
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const [summaryRes, tagsRes] = await Promise.all([
    allProposalIds.length > 0
      ? sb
          .from("ai_summary_cache")
          .select("entity_id,summary_text")
          .eq("entity_type", "proposal")
          .in("entity_id", allProposalIds)
      : Promise.resolve({ data: [] }),
    allProposalIds.length > 0
      ? sb
          .from("entity_tags")
          .select("entity_id,tag,tag_category,display_label,display_icon,visibility,confidence,generated_by,ai_model,metadata")
          .eq("entity_type", "proposal")
          .in("entity_id", allProposalIds)
      : Promise.resolve({ data: [] }),
  ]);

  const summaryMap: Record<string, string> = {};
  for (const s of summaryRes.data ?? []) {
    if (!summaryMap[s.entity_id]) summaryMap[s.entity_id] = s.summary_text;
  }

  const tagsMap: Record<string, EntityTag[]> = {};
  for (const t of tagsRes.data ?? []) {
    const eid = t.entity_id as string;
    if (!tagsMap[eid]) tagsMap[eid] = [];
    tagsMap[eid]!.push(t as EntityTag);
  }

  // Enrich proposals with agency names, AI summaries, and tags
  function enrich(p: ProposalCardData): ProposalCardData {
    const acronym = p.metadata?.agency_id ?? null;
    return {
      ...p,
      agency_name: acronym ? (AGENCY_FULL_NAMES[acronym] ?? null) : null,
      ai_summary: summaryMap[p.id] ?? null,
      tags: tagsMap[p.id] ?? [],
    };
  }

  const openFeatured  = rawOpenFeatured.map(enrich);
  const featuredBills = rawBills.map(enrich);
  // Restore view-count rank order (DB .in() doesn't guarantee order)
  const featuredMostViewed = rawMostViewed
    .map(enrich)
    .sort((a, b) => (viewCounts[b.id] ?? 0) - (viewCounts[a.id] ?? 0));
  const mainProposals = rawMainProposals.map(enrich);

  const showFeaturedSection =
    statusFilter !== "closed" && !typeFilter && !agencyFilter && !topicsFilter && !searchQ && page === 1;

  const currentParams: SearchParams = {
    status: statusFilter,
    type: typeFilter || undefined,
    agency: agencyFilter || undefined,
    topics: topicsFilter || undefined,
    q: searchQ || undefined,
  };

  const countLabel = buildCountLabel(totalCount, statusFilter, searchQ);

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main id="main-content">
      <PageViewTracker entityType="proposal_list" />
      {/* ─── Header ────────────────────────────────────────────────────────── */}
      <div className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <PageHeader
            title="Proposals"
            description="Bills, regulations, and rules open for public comment."
            breadcrumb={[
              { label: "Civitics", href: "/" },
              { label: "Proposals" },
            ]}
            badge={`${totalCount.toLocaleString()} total`}
          />
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">

        {/* ─── Featured — tabbed: Closing Soon / Bills / Most Viewed ──────── */}
        {showFeaturedSection && (openFeatured.length > 0 || featuredBills.length > 0 || featuredMostViewed.length > 0) && (
          <FeaturedSection
            closingSoon={openFeatured}
            bills={featuredBills}
            mostViewed={featuredMostViewed}
          />
        )}

        {/* ─── Topic filter pills ──────────────────────────────────────── */}
        <nav aria-label="Filter by topic" className="mb-4 flex flex-wrap items-center gap-2">
          <a
            href={buildUrl(currentParams, { topics: undefined })}
            aria-current={activeTopics.length === 0 ? "true" : undefined}
            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 ${
              activeTopics.length === 0
                ? "bg-indigo-600 text-white"
                : "bg-white border border-gray-200 text-gray-600 hover:border-indigo-300 hover:text-indigo-700"
            }`}
          >
            All
          </a>
          {TOPIC_PILLS.map((pill) => {
            const isActive = activeTopics.includes(pill.tag);
            return (
              <a
                key={pill.tag}
                href={toggleTopicInUrl(currentParams, pill.tag)}
                aria-current={isActive ? "true" : undefined}
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 ${
                  isActive
                    ? "bg-indigo-600 text-white"
                    : "bg-white border border-gray-200 text-gray-600 hover:border-indigo-300 hover:text-indigo-700"
                }`}
              >
                <span aria-hidden="true">{pill.icon}</span>
                {pill.label}
              </a>
            );
          })}
        </nav>

        {/* ─── Filters ───────────────────────────────────────────────────── */}
        <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
          <form method="GET" action="/proposals" className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            {/* Status */}
            <div className="flex flex-col gap-1 w-full sm:w-auto">
              <label htmlFor="filter-status" className="text-xs font-medium text-gray-500">Status</label>
              <select
                id="filter-status"
                name="status"
                defaultValue={statusFilter}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="open">Open for Comment</option>
                <option value="all">All Proposals</option>
                <option value="closed">Comment Closed</option>
              </select>
            </div>

            {/* Type */}
            <div className="flex flex-col gap-1 w-full sm:w-auto">
              <label htmlFor="filter-type" className="text-xs font-medium text-gray-500">Type</label>
              <select
                id="filter-type"
                name="type"
                defaultValue={typeFilter}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">All Types</option>
                {Object.entries(PROPOSAL_TYPE_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            {/* Agency */}
            <div className="flex flex-col gap-1 w-full sm:w-auto">
              <label htmlFor="filter-agency" className="text-xs font-medium text-gray-500">Agency</label>
              <select
                id="filter-agency"
                name="agency"
                defaultValue={agencyFilter}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">All Agencies</option>
                {AGENCIES.map((a) => {
                  const fullName = AGENCY_FULL_NAMES[a];
                  return (
                    <option key={a} value={a}>
                      {a}{fullName ? ` · ${fullName.length > 35 ? fullName.slice(0, 35) + "…" : fullName}` : ""}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Search */}
            <div className="flex flex-col gap-1 w-full sm:flex-1 sm:min-w-[180px]">
              <label htmlFor="filter-search" className="text-xs font-medium text-gray-500">Search</label>
              <input
                id="filter-search"
                type="text"
                name="q"
                defaultValue={searchQ}
                placeholder="Search proposals…"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <button
              type="submit"
              className="w-full sm:w-auto rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
            >
              Filter
            </button>

            {(statusFilter !== "open" || typeFilter || agencyFilter || topicsFilter || searchQ) && (
              <a
                href="/proposals"
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Clear
              </a>
            )}
          </form>
        </div>

        {/* ─── Results header ─────────────────────────────────────────────── */}
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-gray-500">
            {totalCount === 0 ? "No proposals found" : countLabel}
          </p>
          {totalPages > 1 && (
            <p className="text-sm text-gray-400">
              Page {page} of {totalPages}
            </p>
          )}
        </div>

        {/* ─── Proposals grid ─────────────────────────────────────────────── */}
        {mainProposals.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-white px-8 py-16 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-50">
              <svg aria-hidden="true" className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-gray-900">No proposals match your filters.</p>
            <p className="mt-1 text-sm text-gray-500">Try adjusting the status, type, or topic filters, or clear your search.</p>
            <a href="/proposals" className="mt-4 inline-block text-sm font-medium text-indigo-600 hover:underline">
              Clear filters →
            </a>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {mainProposals.map((p) => (
              <ProposalCard key={p.id} proposal={p} />
            ))}
          </div>
        )}

        {/* ─── Pagination ──────────────────────────────────────────────────── */}
        {totalPages > 1 && (
          <nav aria-label="Pagination" className="mt-8 flex items-center justify-center gap-2">
            {page > 1 && (
              <a
                href={buildUrl(currentParams, { page: String(page - 1) })}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                ← Previous
              </a>
            )}

            {/* Page numbers — show current ±2 */}
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
              .reduce<(number | "…")[]>((acc, p, i, arr) => {
                if (i > 0 && (arr[i - 1] as number) < p - 1) acc.push("…");
                acc.push(p);
                return acc;
              }, [])
              .map((p, i) =>
                p === "…" ? (
                  <span key={`ellipsis-${i}`} aria-hidden="true" className="px-1 text-gray-400">…</span>
                ) : (
                  <a
                    key={p}
                    href={buildUrl(currentParams, { page: String(p) })}
                    aria-current={p === page ? "page" : undefined}
                    aria-label={p === page ? `Page ${p}, current page` : `Page ${p}`}
                    className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                      p === page
                        ? "border-indigo-600 bg-indigo-600 text-white"
                        : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {p}
                  </a>
                )
              )}

            {page < totalPages && (
              <a
                href={buildUrl(currentParams, { page: String(page + 1) })}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                Next →
              </a>
            )}
          </nav>
        )}
      </div>
      </main>
    </div>
  );
}
