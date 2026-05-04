"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { FocusEntity, FocusGroup } from "@civitics/graph";
import type { SearchResults } from "../../api/search/route";
import { SearchResultCard, resultId, resultEntityId, resultEntityType } from "./SearchResultCard";
import type { AnySearchResult } from "./SearchResultCard";
import { SearchFiltersPanel } from "./SearchFiltersPanel";
import type { SearchFilters } from "./SearchFiltersPanel";
import { SearchDetailPanel } from "./SearchDetailPanel";
import { SearchActionBar } from "./SearchActionBar";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AdvancedSearchPageProps {
  initialData?: SearchResults;
  initialParams?: Record<string, string>;
  mode?: "page" | "sidebar";
  onAddEntity?: (entity: FocusEntity) => void;
  onAddGroup?: (group: FocusGroup) => void;
  activeEntityIds?: string[];
  activeGroupIds?: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TYPE_TABS = [
  { key: "all",       label: "All" },
  { key: "officials", label: "Officials" },
  { key: "proposals", label: "Proposals" },
  { key: "agencies",  label: "Agencies" },
  { key: "financial", label: "Donors & PACs" },
] as const;

function filtersToParams(q: string, filters: SearchFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (q)                       p.set("q",             q);
  if (filters.type && filters.type !== "all") p.set("type", filters.type);
  if (filters.party)           p.set("party",         filters.party);
  if (filters.state)           p.set("state",         filters.state);
  if (filters.chamber)         p.set("chamber",       filters.chamber);
  if (filters.status)          p.set("status",        filters.status);
  if (filters.proposal_type)   p.set("proposal_type", filters.proposal_type);
  if (filters.date_from)       p.set("date_from",     filters.date_from);
  if (filters.date_to)         p.set("date_to",       filters.date_to);
  if (filters.agency_type)     p.set("agency_type",   filters.agency_type);
  if (filters.entity_type)     p.set("entity_type",   filters.entity_type);
  if (filters.industry)        p.set("industry",      filters.industry);
  if (filters.min_amount)      p.set("min_amount",    filters.min_amount);
  if (filters.max_amount)      p.set("max_amount",    filters.max_amount);
  return p;
}

function flattenResults(pages: SearchResults[]): AnySearchResult[] {
  const out: AnySearchResult[] = [];
  for (const page of pages) {
    for (const o of page.officials)         out.push({ kind: "official",  data: o });
    for (const p of page.proposals)         out.push({ kind: "proposal",  data: p });
    for (const a of page.agencies)          out.push({ kind: "agency",    data: a });
    for (const f of page.financial_entities) out.push({ kind: "financial", data: f });
  }
  return out;
}

/** For the "all" type, interleave by relevance_score. For single type, keep order. */
function sortResults(results: AnySearchResult[], type: string): AnySearchResult[] {
  if (type !== "all") return results;
  return [...results].sort((a, b) => b.data.relevance_score - a.data.relevance_score);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdvancedSearchPage({
  initialData,
  initialParams,
  mode = "page",
  onAddEntity,
  activeEntityIds = [],
  activeGroupIds = [],
}: AdvancedSearchPageProps) {
  const [query, setQuery] = useState(initialParams?.q ?? "");
  const [debouncedQuery, setDebouncedQuery] = useState(initialParams?.q ?? "");
  const [filters, setFilters] = useState<SearchFilters>({
    type: initialParams?.type ?? "all",
    party:         initialParams?.party,
    state:         initialParams?.state,
    chamber:       initialParams?.chamber,
    status:        initialParams?.status,
    proposal_type: initialParams?.proposal_type,
    date_from:     initialParams?.date_from,
    date_to:       initialParams?.date_to,
    agency_type:   initialParams?.agency_type,
    entity_type:   initialParams?.entity_type,
    industry:      initialParams?.industry,
    min_amount:    initialParams?.min_amount,
    max_amount:    initialParams?.max_amount,
  });

  const [pages, setPages] = useState<SearchResults[]>(initialData ? [initialData] : []);
  const [cursor, setCursor] = useState<string | null>(initialData?.next_cursor ?? null);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailResult, setDetailResult] = useState<AnySearchResult | null>(null);

  const sentinelRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchingRef = useRef(false);

  // ── Debounce text query ────────────────────────────────────────────────────
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(query), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  // ── Fetch on filter/query change ───────────────────────────────────────────
  const fetchPage = useCallback(async (
    q: string,
    f: SearchFilters,
    cursorParam: string | null,
    append: boolean,
  ) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setLoading(true);

    try {
      const params = filtersToParams(q, f);
      if (cursorParam) params.set("cursor", cursorParam);

      const res = await fetch(`/api/search?${params.toString()}`);
      if (!res.ok) return;
      const data: SearchResults = await res.json();

      setPages((prev) => append ? [...prev, data] : [data]);
      setCursor(data.next_cursor);
    } finally {
      fetchingRef.current = false;
      setLoading(false);
    }
  }, []);

  // Reset and re-fetch when query or filters change
  useEffect(() => {
    setPages([]);
    setSelectedIds(new Set());
    setDetailResult(null);
    setCursor(null);
    fetchPage(debouncedQuery, filters, null, false);

    // Sync URL (page mode only)
    if (mode === "page") {
      const params = filtersToParams(debouncedQuery, filters);
      const url = `/search${params.toString() ? `?${params.toString()}` : ""}`;
      window.history.pushState(null, "", url);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, filters, mode]);

  // ── Infinite scroll sentinel ───────────────────────────────────────────────
  useEffect(() => {
    if (!sentinelRef.current || !cursor || loading) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && cursor && !fetchingRef.current) {
          fetchPage(debouncedQuery, filters, cursor, true);
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [cursor, loading, fetchPage, debouncedQuery, filters]);

  // ── Selection helpers ──────────────────────────────────────────────────────
  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allResults = sortResults(flattenResults(pages), filters.type);
  const selectedResults = allResults.filter((r) => selectedIds.has(resultId(r)));
  const total = pages[0]?.total ?? 0;

  // ── Graph seed (single entity from detail panel) ───────────────────────────
  function handleSeedToGraph(result: AnySearchResult) {
    if (mode === "sidebar" && onAddEntity) {
      onAddEntity({
        id:   resultEntityId(result),
        name: result.data.id, // name resolved by graph from DB
        type: resultEntityType(result) as FocusEntity["type"],
      });
      return;
    }
    const params = new URLSearchParams({
      addEntityIds:   result.data.id,
      addEntityTypes: result.kind,
    });
    window.location.href = `/graph?${params.toString()}`;
  }

  // ── Filter change helper ───────────────────────────────────────────────────
  function applyFilters(partial: Partial<SearchFilters>) {
    setFilters((prev) => ({ ...prev, ...partial }));
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const isPage = mode === "page";

  return (
    <div className={`flex flex-col ${isPage ? "h-screen" : "h-full"} bg-gray-50 overflow-hidden`}>

      {/* ── Top bar ── */}
      <div className={`shrink-0 bg-white border-b border-gray-200 ${isPage ? "px-4" : "px-3"}`}>

        {/* Page header with logo (page mode only) */}
        {isPage && (
          <div className="flex items-center gap-4 h-14 border-b border-gray-100">
            <a href="/" className="flex items-center gap-2 shrink-0">
              <div className="flex h-8 w-8 items-center justify-center rounded bg-indigo-600">
                <span className="text-xs font-bold text-white">CV</span>
              </div>
              <span className="text-lg font-semibold tracking-tight text-gray-900">Civitics</span>
            </a>
          </div>
        )}

        {/* Search bar */}
        <div className={`flex items-center gap-3 ${isPage ? "py-3" : "py-2"}`}>
          <div className="relative flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">
              <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </span>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search officials, proposals, agencies, donors…"
              className="w-full rounded-md border border-gray-200 bg-gray-50 pl-9 pr-4 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
              autoFocus={!query}
            />
          </div>
        </div>

        {/* Type tabs */}
        <div className="flex gap-0.5 overflow-x-auto scrollbar-hide">
          {TYPE_TABS.map((tab) => {
            const active = filters.type === tab.key;
            const count = tab.key === "all" ? total
              : tab.key === "officials" ? (pages[0]?.officials.length ?? 0)
              : tab.key === "proposals" ? (pages[0]?.proposals.length ?? 0)
              : tab.key === "agencies"  ? (pages[0]?.agencies.length ?? 0)
              : (pages[0]?.financial_entities.length ?? 0);
            return (
              <button
                key={tab.key}
                onClick={() => applyFilters({ type: tab.key })}
                className={`flex items-center gap-1 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap
                  ${active
                    ? "border-indigo-600 text-indigo-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"}`}
              >
                {tab.label}
                {count > 0 && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold
                    ${active ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-500"}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Three-panel body ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* LEFT — taxonomy + filter pills (page mode only) */}
        {isPage && (
          <div className="w-[260px] shrink-0 overflow-hidden">
            <SearchFiltersPanel filters={filters} onFiltersChange={applyFilters} />
          </div>
        )}

        {/* MIDDLE — infinite scroll results */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2 pb-20">

            {/* Summary line */}
            {pages.length > 0 && (
              <p className="text-xs text-gray-500 mb-3">
                {total > 0
                  ? <><span className="font-semibold text-gray-700">{allResults.length}</span> of <span className="font-semibold text-gray-700">{total}</span> results{debouncedQuery ? ` for "${debouncedQuery}"` : ""}</>
                  : debouncedQuery ? `No results for "${debouncedQuery}"` : "No results for these filters"}
              </p>
            )}

            {/* Results */}
            {allResults.map((result) => (
              <SearchResultCard
                key={resultId(result)}
                result={result}
                isSelected={selectedIds.has(resultId(result))}
                onToggleSelect={toggleSelect}
                onClickDetail={setDetailResult}
                showCheckbox={isPage}
                badge={filters.type === "all"}
              />
            ))}

            {/* Empty state */}
            {!loading && pages.length > 0 && allResults.length === 0 && (
              <div className="py-16 text-center">
                <p className="text-sm text-gray-400">
                  {debouncedQuery.length < 2 && Object.values(filters).every((v) => !v || v === "all")
                    ? "Enter a search term or select a category to explore"
                    : "No results match these filters"}
                </p>
              </div>
            )}

            {/* Loading skeleton */}
            {loading && pages.length === 0 && (
              <div className="space-y-2">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="h-14 rounded-lg bg-gray-100 animate-pulse" />
                ))}
              </div>
            )}

            {/* Infinite scroll sentinel */}
            <div ref={sentinelRef} className="h-4" />

            {/* Bottom loader */}
            {loading && pages.length > 0 && (
              <div className="py-4 text-center">
                <span className="text-xs text-gray-400">Loading more…</span>
              </div>
            )}
          </div>

          {/* Multi-select action bar */}
          {isPage && (
            <SearchActionBar
              selected={selectedResults}
              onClear={() => setSelectedIds(new Set())}
            />
          )}
        </div>

        {/* RIGHT — detail panel (page mode only) */}
        {isPage && (
          <div className="w-[280px] shrink-0 overflow-hidden">
            <SearchDetailPanel
              result={detailResult}
              onSeedToGraph={handleSeedToGraph}
            />
          </div>
        )}
      </div>
    </div>
  );
}
