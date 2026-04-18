/**
 * /search?q=[query]&type=all|officials|proposals|agencies|financial
 *
 * Full search results page — grouped sections, tab filters, direct DB queries.
 * "All" tab shows an interleaved list ranked by relevance_score (max 30, max 15 per type).
 */

export const dynamic = "force-dynamic";

import { createAdminClient } from "@civitics/db";
import type {
  SearchOfficial,
  SearchProposal,
  SearchAgency,
  SearchFinancialEntity,
} from "../api/search/route";
import { PageViewTracker } from "../components/PageViewTracker";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PARTY_BADGE: Record<string, string> = {
  democrat:    "bg-blue-100 text-blue-800",
  republican:  "bg-red-100 text-red-800",
  independent: "bg-purple-100 text-purple-800",
};

const STATUS_LABEL: Record<string, string> = {
  open_comment:         "Open Comment",
  introduced:           "Introduced",
  in_committee:         "In Committee",
  passed_committee:     "Passed Committee",
  floor_vote:           "Floor Vote",
  passed_chamber:       "Passed Chamber",
  passed_both_chambers: "Passed Both Chambers",
  signed:               "Signed",
  enacted:              "Enacted",
  failed:               "Failed",
  withdrawn:            "Withdrawn",
  comment_closed:       "Comment Closed",
};

const STATUS_COLOR: Record<string, string> = {
  open_comment:  "bg-emerald-100 text-emerald-800",
  introduced:    "bg-amber-100 text-amber-800",
  in_committee:  "bg-amber-100 text-amber-800",
  enacted:       "bg-green-100 text-green-800",
  signed:        "bg-green-100 text-green-800",
  failed:        "bg-red-100 text-red-800",
};

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function formatDollars(cents: number | null): string {
  if (cents == null) return "";
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(0)}K`;
  return `$${dollars.toFixed(0)}`;
}

// ---------------------------------------------------------------------------
// Sub-components (server-renderable)
// ---------------------------------------------------------------------------

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
        {count}
      </span>
    </div>
  );
}

function OfficialCard({ o, badge }: { o: SearchOfficial; badge?: boolean }) {
  const partyBadge = PARTY_BADGE[o.party ?? ""] ?? "bg-gray-100 text-gray-700";
  return (
    <a
      href={`/officials/${o.id}`}
      className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 hover:border-indigo-300 hover:shadow-sm transition-all"
    >
      {badge && (
        <span className="shrink-0 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-500">
          Official
        </span>
      )}
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-600">
        {o.photo_url
          ? <img src={o.photo_url} alt={o.full_name} className="h-9 w-9 rounded-full object-cover" />
          : initials(o.full_name)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-gray-900">{o.full_name}</p>
        <p className="truncate text-xs text-gray-500">
          {o.role_title}{o.state ? ` · ${o.state}` : ""}
        </p>
      </div>
      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${partyBadge}`}>
        {o.party?.[0]?.toUpperCase() ?? "?"}
      </span>
    </a>
  );
}

function ProposalCard({ p, badge }: { p: SearchProposal; badge?: boolean }) {
  const color = STATUS_COLOR[p.status] ?? "bg-gray-100 text-gray-700";
  const label = STATUS_LABEL[p.status] ?? p.status.replace(/_/g, " ");
  const isOpen = p.status === "open_comment" && p.comment_period_end && new Date(p.comment_period_end) > new Date();
  return (
    <a
      href={`/proposals/${p.id}`}
      className="block rounded-lg border border-gray-200 bg-white px-4 py-3 hover:border-indigo-300 hover:shadow-sm transition-all"
    >
      <div className="flex items-center gap-2">
        {badge && (
          <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600">
            Proposal
          </span>
        )}
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${color}`}>{label}</span>
        {isOpen && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
            Comment open
          </span>
        )}
        {p.agency_acronym && (
          <a
            href={`/proposals?agency=${encodeURIComponent(p.agency_acronym)}`}
            className="font-mono text-[11px] text-gray-400 hover:text-indigo-600 transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            {p.agency_acronym}
          </a>
        )}
      </div>
      <p className="mt-1.5 text-sm font-semibold text-gray-900 line-clamp-2 leading-snug">
        {p.title}
      </p>
      {p.ai_summary && (
        <p className="mt-1 text-xs text-gray-500 line-clamp-2 leading-relaxed">{p.ai_summary}</p>
      )}
    </a>
  );
}

function AgencyCard({ a, badge }: { a: SearchAgency; badge?: boolean }) {
  return (
    <a
      href={`/agencies/${a.id}`}
      className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 hover:border-indigo-300 hover:shadow-sm transition-all"
    >
      {badge && (
        <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
          Agency
        </span>
      )}
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-gray-200 bg-gray-50 font-mono text-[10px] font-bold text-gray-600">
        {(a.acronym ?? a.name).slice(0, 4)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-gray-900">{a.name}</p>
        {a.acronym && <p className="text-xs text-gray-400">{a.acronym}</p>}
      </div>
      <span className="shrink-0 rounded bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500 capitalize">
        {a.agency_type.replace(/_/g, " ")}
      </span>
    </a>
  );
}

function FinancialEntityCard({ f, badge }: { f: SearchFinancialEntity; badge?: boolean }) {
  return (
    <a
      href={`/donors/${f.id}`}
      className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 hover:border-indigo-300 hover:shadow-sm transition-all"
    >
      {badge && (
        <span className="shrink-0 rounded bg-green-50 px-1.5 py-0.5 text-[10px] font-semibold text-green-600">
          Donor
        </span>
      )}
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-gray-200 bg-gray-50 text-[10px] font-bold text-gray-600">
        <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-gray-900">{f.name}</p>
        <p className="truncate text-xs text-gray-500">
          {f.entity_type.replace(/_/g, " ")}
          {f.industry ? ` · ${f.industry}` : ""}
        </p>
      </div>
      {f.total_amount_cents != null && (
        <span className="shrink-0 rounded bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
          {formatDollars(f.total_amount_cents)}
        </span>
      )}
    </a>
  );
}

function EmptyState({ query }: { query: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white py-16 text-center">
      <p className="text-base font-medium text-gray-500">No results for &ldquo;{query}&rdquo;</p>
      <p className="mt-1 text-sm text-gray-400">
        Try an official&apos;s name, agency acronym (e.g. &ldquo;EPA&rdquo;), or policy topic
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Interleaved "All" tab item
// ---------------------------------------------------------------------------

type InterleavedItem =
  | { kind: "official"; data: SearchOfficial; score: number }
  | { kind: "proposal"; data: SearchProposal; score: number }
  | { kind: "agency";   data: SearchAgency;   score: number }
  | { kind: "financial"; data: SearchFinancialEntity; score: number };

function buildInterleavedList(
  officials: SearchOfficial[],
  proposals: SearchProposal[],
  agencies: SearchAgency[],
  financial: SearchFinancialEntity[],
): InterleavedItem[] {
  const items: InterleavedItem[] = [
    ...officials.slice(0, 15).map((o) => ({ kind: "official" as const, data: o, score: o.relevance_score })),
    ...proposals.slice(0, 15).map((p) => ({ kind: "proposal" as const, data: p, score: p.relevance_score })),
    ...agencies.slice(0, 15).map((a) => ({ kind: "agency" as const, data: a, score: a.relevance_score })),
    ...financial.slice(0, 15).map((f) => ({ kind: "financial" as const, data: f, score: f.relevance_score })),
  ];
  items.sort((a, b) => b.score - a.score);
  return items.slice(0, 30);
}

// ---------------------------------------------------------------------------
// Inline search logic (mirrors /api/search, avoids HTTP round-trip on SSR)
// ---------------------------------------------------------------------------

function baseRelevance(name: string, q: string): number {
  const nameLower = name.toLowerCase();
  const qLower = q.toLowerCase();
  if (nameLower === qLower) return 100;
  if (nameLower.startsWith(qLower)) return 80;
  const wordBoundary = new RegExp(`\\b${qLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  if (wordBoundary.test(name)) return 60;
  if (nameLower.includes(qLower)) return 40;
  return 0;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string }>;
}) {
  const { q: rawQ, type: rawType } = await searchParams;
  const q = (rawQ ?? "").trim();
  const typeFilter = rawType ?? "all";

  let officials: SearchOfficial[] = [];
  let proposals: SearchProposal[] = [];
  let agencies: SearchAgency[] = [];
  let financial: SearchFinancialEntity[] = [];

  if (q.length >= 2) {
    const db = createAdminClient();
    const qLower = q.toLowerCase();

    const US_STATES: Record<string, string> = {
      AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
      CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
      HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
      KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
      MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
      MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
      NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina",
      ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
      RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee",
      TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
      WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia",
    };
    const PARTY_KEYWORDS: Record<string, string> = {
      democrat: "democrat", democratic: "democrat", dem: "democrat",
      republican: "republican", rep: "republican", gop: "republican",
      independent: "independent", ind: "independent",
    };
    const ROLE_KEYWORDS: Record<string, string> = {
      senator: "Senator", senators: "Senator",
      representative: "Representative", representatives: "Representative",
      congressman: "Representative", congresswoman: "Representative",
    };

    const stateAbbr = q.length === 2 ? q.toUpperCase() : null;
    const stateName = stateAbbr ? US_STATES[stateAbbr] : null;
    const partyFilter = PARTY_KEYWORDS[qLower];
    const roleFilter = ROLE_KEYWORDS[qLower];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db2 = db as any;

    const [officialsRes, proposalsRes, agenciesRes, financialRes] = await Promise.all([

      // Officials
      (async (): Promise<SearchOfficial[]> => {
        if (typeFilter !== "all" && typeFilter !== "officials") return [];
        let query = db2
          .from("officials")
          .select("id, full_name, role_title, party, photo_url, is_active, metadata, source_ids")
          .eq("is_active", true)
          .limit(60); // fetch 3x to allow ranking

        if (partyFilter) {
          query = query.eq("party", partyFilter);
        } else if (roleFilter) {
          query = query.eq("role_title", roleFilter);
        } else if (stateName) {
          query = query.filter("metadata->>state", "eq", stateAbbr);
        } else {
          query = query.or(`full_name.ilike.%${q}%,role_title.ilike.%${q}%`);
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await query;
        const rows: Array<{
          id: string; full_name: string; role_title: string; party: string | null;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          photo_url: string | null; is_active: boolean; metadata: any;
          source_ids: Record<string, string> | null;
        }> = data ?? [];
        if (rows.length === 0) return [];

        const ids = rows.map((o) => o.id);
        const [fromRes, toRes] = await Promise.all([
          db2.from("entity_connections").select("from_id").in("from_id", ids),
          db2.from("entity_connections").select("to_id").in("to_id", ids),
        ]);
        const countMap = new Map<string, number>();
        for (const r of fromRes.data ?? []) countMap.set(r.from_id, (countMap.get(r.from_id) ?? 0) + 1);
        for (const r of toRes.data ?? []) countMap.set(r.to_id, (countMap.get(r.to_id) ?? 0) + 1);

        const rankPriority = (o: typeof rows[0]): number => {
          const name = o.full_name.toLowerCase();
          if (name === qLower) return 0;
          const lastName = (o.full_name.split(" ").pop() ?? "").toLowerCase();
          if (lastName === qLower) return 1;
          if (name.startsWith(qLower)) return 2;
          const isFederal = !!o.source_ids?.["congress_gov"];
          const connCount = countMap.get(o.id) ?? 0;
          if (isFederal && connCount > 0) return 3;
          if (isFederal) return 4;
          if (connCount > 0) return 5;
          return 6;
        };

        return rows
          .sort((a, b) => {
            const pa = rankPriority(a);
            const pb = rankPriority(b);
            if (pa !== pb) return pa - pb;
            const ca = countMap.get(a.id) ?? 0;
            const cb = countMap.get(b.id) ?? 0;
            if (cb !== ca) return cb - ca;
            return a.full_name.localeCompare(b.full_name);
          })
          .slice(0, 20)
          .map((o) => {
            const connCount = countMap.get(o.id) ?? 0;
            const isFederal = !!o.source_ids?.["congress_gov"];
            let score = baseRelevance(o.full_name, q);
            if (score === 0) score = 20;
            if (isFederal) score += 15;
            if (o.is_active) score += 10;
            if (connCount > 100) score += 5;
            return {
              id: o.id,
              full_name: o.full_name,
              role_title: o.role_title,
              party: o.party ?? null,
              state: o.metadata?.state ?? null,
              photo_url: o.photo_url ?? null,
              is_active: o.is_active,
              relevance_score: Math.min(score, 100),
            };
          });
      })(),

      // Proposals
      (async (): Promise<SearchProposal[]> => {
        if (typeFilter !== "all" && typeFilter !== "proposals") return [];
        const { data: proposalData } = await db2
          .from("proposals")
          .select("id, title, status, type, comment_period_end, metadata, summary_plain")
          .or(`title.ilike.%${q}%,summary_plain.ilike.%${q}%`)
          .limit(20);

        const ids = (proposalData ?? []).map((p: { id: string }) => p.id);
        const summaryRes = ids.length > 0
          ? await db2.from("ai_summary_cache").select("entity_id, summary_text")
              .eq("entity_type", "proposal").in("entity_id", ids)
          : { data: [] };

        const summaryMap: Record<string, string> = {};
        for (const s of summaryRes.data ?? []) summaryMap[s.entity_id] = s.summary_text;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (proposalData ?? []).map((p: any) => {
          let score = baseRelevance(p.title, q);
          if (score === 0) score = 20;
          if (p.status === "open_comment") score += 10;
          return {
            id: p.id,
            title: p.title,
            status: p.status,
            type: p.type,
            comment_period_end: p.comment_period_end ?? null,
            agency_acronym: p.metadata?.agency_id ?? null,
            ai_summary: summaryMap[p.id] ?? null,
            relevance_score: Math.min(score, 100),
          };
        });
      })(),

      // Agencies
      (async (): Promise<SearchAgency[]> => {
        if (typeFilter !== "all" && typeFilter !== "agencies") return [];
        const { data: agencyData } = await db2
          .from("agencies")
          .select("id, name, acronym, agency_type, description")
          .eq("is_active", true)
          .or(`name.ilike.%${q}%,acronym.ilike.%${q}%,description.ilike.%${q}%`)
          .limit(10);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (agencyData ?? []).map((a: any) => {
          const exactAcronym = a.acronym?.toUpperCase() === q.toUpperCase();
          let score = baseRelevance(a.name, q);
          if (score === 0) score = 20;
          if (exactAcronym) score += 20;
          return {
            id: a.id,
            name: a.name,
            acronym: a.acronym ?? null,
            agency_type: a.agency_type,
            description: a.description ?? null,
            relevance_score: Math.min(score, 100),
          };
        }).sort((a: SearchAgency, b: SearchAgency) => b.relevance_score - a.relevance_score);
      })(),

      // Financial entities
      (async (): Promise<SearchFinancialEntity[]> => {
        if (typeFilter !== "all" && typeFilter !== "financial") return [];
        const { data } = await db2
          .from("financial_entities")
          .select("id, name, entity_type, industry, total_amount_cents")
          .ilike("name", `%${q}%`)
          .order("total_amount_cents", { ascending: false, nullsFirst: false })
          .limit(20);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (data ?? []).map((f: any) => {
          let score = baseRelevance(f.name, q);
          if (f.total_amount_cents != null && f.total_amount_cents > 100_000_00) score += 5;
          return {
            id: f.id,
            name: f.name,
            entity_type: f.entity_type,
            industry: f.industry ?? null,
            total_amount_cents: f.total_amount_cents ?? null,
            relevance_score: Math.min(score, 100),
          };
        });
      })(),
    ]);

    officials = officialsRes;
    proposals = proposalsRes;
    agencies = agenciesRes;
    financial = financialRes;
  }

  const total = officials.length + proposals.length + agencies.length + financial.length;
  const showAll = typeFilter === "all";

  function tabHref(type: string) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (type !== "all") params.set("type", type);
    return `/search?${params.toString()}`;
  }

  const tabs = [
    { key: "all",       label: "All",          count: total },
    { key: "officials", label: "Officials",     count: officials.length },
    { key: "proposals", label: "Proposals",     count: proposals.length },
    { key: "agencies",  label: "Agencies",      count: agencies.length },
    { key: "financial", label: "Donors & PACs", count: financial.length },
  ];

  const interleaved = showAll ? buildInterleavedList(officials, proposals, agencies, financial) : [];

  return (
    <div className="min-h-screen bg-gray-50">
      <PageViewTracker entityType="search" />
      {/* Header */}
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center gap-4">
            <a href="/" className="flex items-center gap-2 shrink-0">
              <div className="flex h-8 w-8 items-center justify-center rounded bg-indigo-600">
                <span className="text-xs font-bold text-white">CV</span>
              </div>
              <span className="text-lg font-semibold tracking-tight text-gray-900">Civitics</span>
            </a>
            {/* Search form */}
            <form method="get" action="/search" className="flex-1 max-w-2xl">
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">
                  <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </span>
                <input
                  name="q"
                  type="text"
                  defaultValue={q}
                  placeholder="Search officials, proposals, agencies, donors…"
                  autoFocus={!q}
                  className="w-full rounded-md border border-gray-200 bg-gray-50 pl-9 pr-4 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
              </div>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {!q ? (
          <div className="py-24 text-center">
            <p className="text-base text-gray-500">Enter a query to search officials, proposals, agencies, and donors.</p>
          </div>
        ) : (
          <>
            {/* Query summary */}
            <p className="mb-6 text-sm text-gray-500">
              {total > 0
                ? <><span className="font-semibold text-gray-900">{total} result{total !== 1 ? "s" : ""}</span> for &ldquo;{q}&rdquo;</>
                : <>No results for &ldquo;{q}&rdquo;</>}
            </p>

            {/* Tabs */}
            <div className="mb-8 flex gap-1 border-b border-gray-200">
              {tabs.map((tab) => {
                const active = typeFilter === tab.key;
                return (
                  <a
                    key={tab.key}
                    href={tabHref(tab.key)}
                    className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px
                      ${active
                        ? "border-indigo-600 text-indigo-600"
                        : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"}`}
                  >
                    {tab.label}
                    {tab.count > 0 && (
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold
                        ${active ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-500"}`}>
                        {tab.count}
                      </span>
                    )}
                  </a>
                );
              })}
            </div>

            {/* Results */}
            {total === 0 ? (
              <EmptyState query={q} />
            ) : (
              <div className="flex flex-col gap-10">

                {/* All tab — interleaved by relevance_score */}
                {showAll && interleaved.length > 0 && (
                  <section>
                    <div className="flex flex-col gap-2">
                      {interleaved.map((item) => {
                        if (item.kind === "official") return <OfficialCard key={`o-${item.data.id}`} o={item.data} badge />;
                        if (item.kind === "proposal") return <ProposalCard key={`p-${item.data.id}`} p={item.data} badge />;
                        if (item.kind === "agency")   return <AgencyCard   key={`a-${item.data.id}`} a={item.data} badge />;
                        return <FinancialEntityCard key={`f-${item.data.id}`} f={item.data} badge />;
                      })}
                    </div>
                  </section>
                )}

                {/* Officials tab */}
                {officials.length > 0 && typeFilter === "officials" && (
                  <section>
                    <SectionHeader title="Officials" count={officials.length} />
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {officials.map((o) => <OfficialCard key={o.id} o={o} />)}
                    </div>
                  </section>
                )}

                {/* Proposals tab */}
                {proposals.length > 0 && typeFilter === "proposals" && (
                  <section>
                    <SectionHeader title="Proposals" count={proposals.length} />
                    <div className="flex flex-col gap-2">
                      {proposals.map((p) => <ProposalCard key={p.id} p={p} />)}
                    </div>
                  </section>
                )}

                {/* Agencies tab */}
                {agencies.length > 0 && typeFilter === "agencies" && (
                  <section>
                    <SectionHeader title="Agencies" count={agencies.length} />
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {agencies.map((a) => <AgencyCard key={a.id} a={a} />)}
                    </div>
                  </section>
                )}

                {/* Donors & PACs tab */}
                {financial.length > 0 && typeFilter === "financial" && (
                  <section>
                    <SectionHeader title="Donors & PACs" count={financial.length} />
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {financial.map((f) => <FinancialEntityCard key={f.id} f={f} />)}
                    </div>
                  </section>
                )}

              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
