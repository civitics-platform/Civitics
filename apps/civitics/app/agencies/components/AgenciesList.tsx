"use client";

import { useState, useMemo } from "react";
import type { AgencyRow } from "../page";
import { AgencyCard, ALL_SECTORS, inferSectorLabels } from "./AgencyCard";
import { AgencySlideOver } from "./AgencySlideOver";
import { WhiteHouseFeaturedCard } from "./WhiteHouseFeaturedCard";

const TYPE_LABELS: Record<string, string> = {
  federal:       "Federal",
  state:         "State",
  local:         "Local",
  independent:   "Independent",
  international: "International",
  other:         "Other",
};

export function AgenciesList({
  agencies,
  featuredAgency,
}: {
  agencies: AgencyRow[];
  featuredAgency?: AgencyRow | null;
}) {
  const [search,       setSearch]       = useState("");
  const [typeFilter,   setTypeFilter]   = useState("all");
  const [sectorFilter, setSectorFilter] = useState("all");
  const [openOnly,     setOpenOnly]     = useState(false);
  const [selected,     setSelected]     = useState<AgencyRow | null>(null);

  const filtersActive =
    search.trim() !== "" || typeFilter !== "all" || sectorFilter !== "all" || openOnly;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return agencies.filter((a) => {
      if (q) {
        const nameMatch    = a.name.toLowerCase().includes(q);
        const acronymMatch = (a.acronym ?? "").toLowerCase().includes(q);
        if (!nameMatch && !acronymMatch) return false;
      }
      if (typeFilter !== "all" && a.agency_type !== typeFilter) return false;
      if (sectorFilter !== "all") {
        const sectors = inferSectorLabels(a.name, a.acronym);
        if (!sectors.includes(sectorFilter)) return false;
      }
      if (openOnly && a.openProposals === 0) return false;
      return true;
    });
  }, [agencies, search, typeFilter, sectorFilter, openOnly]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <header className="border-b border-gray-200 bg-white px-5 py-3">
        <div className="flex items-center gap-3">
          <a href="/" className="text-sm font-medium text-gray-400 hover:text-gray-700 transition-colors">
            ← Civitics
          </a>
          <span className="text-gray-200">/</span>
          <span className="text-sm font-semibold text-gray-900">Agencies</span>
          <span className="ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
            {agencies.length.toLocaleString()} total
          </span>
        </div>
      </header>

      {/* Filters */}
      <div className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="search"
              placeholder="Search by name or acronym…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-64 rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm placeholder-gray-400 focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />

            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            >
              <option value="all">All types</option>
              {Object.entries(TYPE_LABELS).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>

            <select
              value={sectorFilter}
              onChange={(e) => setSectorFilter(e.target.value)}
              className="rounded border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            >
              <option value="all">All sectors</option>
              {ALL_SECTORS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>

            <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={openOnly}
                onChange={(e) => setOpenOnly(e.target.checked)}
                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              Open comment periods only
            </label>

            {filtered.length !== agencies.length && (
              <span className="text-sm text-gray-400">
                {filtered.length.toLocaleString()} of {agencies.length.toLocaleString()} shown
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Grid */}
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Featured card — hidden when any filter is active */}
        {!filtersActive && featuredAgency && (
          <div className="mb-6">
            <WhiteHouseFeaturedCard agency={featuredAgency} />
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-white px-8 py-16 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-50">
              <svg className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-gray-900">No agencies found.</p>
            <p className="mt-1 text-sm text-gray-500">Agency data is updated regularly. Check back soon.</p>
            {filtersActive && (
              <button
                onClick={() => { setSearch(""); setTypeFilter("all"); setSectorFilter("all"); setOpenOnly(false); }}
                className="mt-4 inline-block text-sm font-medium text-indigo-600 hover:underline"
              >
                Clear all filters
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((agency) => (
              <AgencyCard
                key={agency.id}
                agency={agency}
                onClick={() => setSelected(agency)}
              />
            ))}
          </div>
        )}
      </main>

      <AgencySlideOver agency={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
