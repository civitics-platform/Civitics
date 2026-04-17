"use client";

import { useState, useMemo } from "react";
import type { AgencyRow } from "../page";

const TYPE_LABELS: Record<string, string> = {
  federal:       "Federal",
  state:         "State",
  local:         "Local",
  independent:   "Independent",
  international: "International",
  other:         "Other",
};

const TYPE_COLORS: Record<string, string> = {
  federal:       "bg-blue-50 text-blue-700 border-blue-200",
  state:         "bg-purple-50 text-purple-700 border-purple-200",
  local:         "bg-green-50 text-green-700 border-green-200",
  independent:   "bg-amber-50 text-amber-700 border-amber-200",
  international: "bg-indigo-50 text-indigo-700 border-indigo-200",
  other:         "bg-gray-50 text-gray-600 border-gray-200",
};

// ---------------------------------------------------------------------------
// Sector tag inference — derived from agency name/acronym, no pipeline needed
// ---------------------------------------------------------------------------

const SECTOR_RULES: [RegExp, string, string][] = [
  [/environment|forest|land|wildlife|ocean|fish|park|nature|conservation|reclamation|mines|geology|weather|atmospheric|noaa/i, "Environment", "bg-emerald-50 text-emerald-700"],
  [/defense|army|navy|air force|marine|coast guard|military|pentagon|veteran|national guard/i, "Defense", "bg-slate-100 text-slate-700"],
  [/health|disease|cancer|drug|food|fda|cdc|nih|medicare|medicaid|substance|mental|elder|disability/i, "Health", "bg-rose-50 text-rose-700"],
  [/financial|banking|securities|exchange|treasury|budget|fiscal|currency|fed|reserve|cftc|fdic|consumer financial/i, "Finance", "bg-amber-50 text-amber-700"],
  [/transport|highway|aviation|rail|transit|maritime|pipeline|fhwa|faa|fra|fta|fmcsa/i, "Transportation", "bg-sky-50 text-sky-700"],
  [/energy|nuclear|power|petroleum|oil|gas|electric|ferc|doe|nrc/i, "Energy", "bg-orange-50 text-orange-700"],
  [/education|school|student|college|university|learning|title/i, "Education", "bg-violet-50 text-violet-700"],
  [/labor|worker|wage|safety|osha|mine safety|employment|pension|benefit/i, "Labor", "bg-cyan-50 text-cyan-700"],
  [/agriculture|farm|crop|food safety|rural|animal|plant health|commodity/i, "Agriculture", "bg-lime-50 text-lime-700"],
  [/justice|law|court|civil rights|atf|dea|fbi|prison|correctional|alcohol|tobacco|firearms/i, "Justice", "bg-purple-50 text-purple-700"],
  [/housing|urban|community|hud|mortgage|rural development/i, "Housing", "bg-teal-50 text-teal-700"],
  [/immigration|customs|border|citizenship|visa|ice\b/i, "Immigration", "bg-indigo-50 text-indigo-700"],
  [/space|nasa|aeronaut/i, "Space", "bg-blue-50 text-blue-700"],
  [/trade|commerce|export|import|international trade|census|patent|copyright/i, "Commerce", "bg-yellow-50 text-yellow-700"],
  [/communication|broadcast|fcc|telecom|internet|spectrum/i, "Communications", "bg-pink-50 text-pink-700"],
];

function inferSectorTags(name: string, acronym: string | null): { label: string; color: string }[] {
  const text = `${name} ${acronym ?? ""}`;
  const tags: { label: string; color: string }[] = [];
  for (const [pattern, label, color] of SECTOR_RULES) {
    if (pattern.test(text)) {
      tags.push({ label, color });
      if (tags.length >= 2) break; // cap at 2 tags per card
    }
  }
  return tags;
}

export function AgenciesList({ agencies }: { agencies: AgencyRow[] }) {
  const [search,     setSearch]     = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [openOnly,   setOpenOnly]   = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return agencies.filter((a) => {
      if (q) {
        const nameMatch    = a.name.toLowerCase().includes(q);
        const acronymMatch = (a.acronym ?? "").toLowerCase().includes(q);
        if (!nameMatch && !acronymMatch) return false;
      }
      if (typeFilter !== "all" && a.agency_type !== typeFilter) return false;
      if (openOnly && a.openProposals === 0) return false;
      return true;
    });
  }, [agencies, search, typeFilter, openOnly]);

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
              <option value="federal">Federal</option>
              <option value="state">State</option>
              <option value="local">Local</option>
              <option value="independent">Independent</option>
              <option value="international">International</option>
              <option value="other">Other</option>
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
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-white px-8 py-16 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-50">
              <svg className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-gray-900">No agencies found.</p>
            <p className="mt-1 text-sm text-gray-500">Agency data is updated regularly. Check back soon.</p>
            {search || typeFilter !== "all" || openOnly ? (
              <button
                onClick={() => { setSearch(""); setTypeFilter("all"); setOpenOnly(false); }}
                className="mt-4 inline-block text-sm font-medium text-indigo-600 hover:underline"
              >
                Clear all filters
              </button>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((agency) => {
              const typeColor = TYPE_COLORS[agency.agency_type] ?? TYPE_COLORS["other"]!;
              const typeLabel = TYPE_LABELS[agency.agency_type] ?? agency.agency_type;
              const displayAcronym = agency.acronym ?? agency.short_name ?? agency.name.slice(0, 5).toUpperCase();
              const sectorTags = inferSectorTags(agency.name, agency.acronym);

              return (
                <a
                  key={agency.id}
                  href={`/agencies/${agency.id}`}
                  className="group flex flex-col rounded-lg border border-gray-200 bg-white hover:border-indigo-300 hover:shadow-sm transition-all overflow-hidden"
                >
                  {/* Card body */}
                  <div className="flex flex-col flex-1 p-4">
                    {/* Header row */}
                    <div className="flex items-start gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded border border-gray-200 bg-gray-50 font-mono text-xs font-bold text-gray-700">
                        {displayAcronym.slice(0, 5)}
                      </div>
                      <div className="min-w-0 flex-1">
                        {/* Type + sector tags */}
                        <div className="flex flex-wrap items-center gap-1 mb-0.5">
                          <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold ${typeColor}`}>
                            {typeLabel}
                          </span>
                          {sectorTags.map((tag) => (
                            <span
                              key={tag.label}
                              className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${tag.color}`}
                            >
                              {tag.label}
                            </span>
                          ))}
                        </div>
                        <p className="text-sm font-semibold leading-tight text-gray-900 group-hover:text-indigo-700 line-clamp-2">
                          {agency.name}
                        </p>
                      </div>
                    </div>

                    {/* Description */}
                    {agency.description && (
                      <p className="mt-2.5 line-clamp-2 text-xs leading-relaxed text-gray-500">
                        {agency.description}
                      </p>
                    )}

                    <div className="flex-1" />

                    {/* Stats */}
                    <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded border border-gray-100 bg-gray-100">
                      <div className="bg-white px-3 py-2 text-center">
                        <p className="text-sm font-bold text-gray-900">
                          {agency.totalProposals > 0 ? agency.totalProposals.toLocaleString() : "—"}
                        </p>
                        <p className="text-[10px] text-gray-400">Total rules</p>
                      </div>
                      <div className="bg-white px-3 py-2 text-center">
                        <p className={`text-sm font-bold ${agency.openProposals > 0 ? "text-emerald-600" : "text-gray-400"}`}>
                          {agency.openProposals > 0 ? agency.openProposals.toLocaleString() : "—"}
                        </p>
                        <p className="text-[10px] text-gray-400">Open now</p>
                      </div>
                    </div>
                  </div>

                  {/* Footer action strip */}
                  <div className="flex items-center gap-1 border-t border-gray-100 bg-gray-50 px-3 py-2">
                    <a
                      href={`/graph?entity=${agency.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-gray-500 hover:bg-white hover:text-indigo-600 transition-colors"
                      title="Explore in connection graph"
                    >
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <circle cx="5"  cy="12" r="2" />
                        <circle cx="19" cy="5"  r="2" />
                        <circle cx="19" cy="19" r="2" />
                        <line x1="7"  y1="11" x2="17" y2="6"  strokeLinecap="round" />
                        <line x1="7"  y1="13" x2="17" y2="18" strokeLinecap="round" />
                      </svg>
                      Graph
                    </a>

                    {agency.website_url && (
                      <a
                        href={agency.website_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-gray-500 hover:bg-white hover:text-indigo-600 transition-colors"
                        title="Official website"
                      >
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                        Website
                      </a>
                    )}
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
