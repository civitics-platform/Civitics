export const dynamic = "force-dynamic";

import Link from "next/link";
import { cookies } from "next/headers";
import { createServerClient } from "@civitics/db";
import { AuthButton } from "../components/AuthButton";
import { GlobalSearch } from "../components/GlobalSearch";
import { PageViewTracker } from "../components/PageViewTracker";

// ─── Types ────────────────────────────────────────────────────────────────────

type InitiativeRow = {
  id: string;
  title: string;
  summary: string | null;
  stage: "draft" | "deliberate" | "mobilise" | "resolved";
  scope: "federal" | "state" | "local";
  authorship_type: "individual" | "community";
  issue_area_tags: string[];
  target_district: string | null;
  mobilise_started_at: string | null;
  created_at: string;
  resolved_at: string | null;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const STAGE_STYLES: Record<string, { label: string; color: string }> = {
  draft:       { label: "Draft",           color: "bg-gray-100 text-gray-600 border-gray-200" },
  deliberate:  { label: "Deliberating",    color: "bg-amber-100 text-amber-700 border-amber-200" },
  mobilise:    { label: "Mobilising",      color: "bg-indigo-100 text-indigo-700 border-indigo-200" },
  resolved:    { label: "Resolved",        color: "bg-green-100 text-green-700 border-green-200" },
};

const SCOPE_STYLES: Record<string, string> = {
  federal: "bg-blue-50 text-blue-700",
  state:   "bg-violet-50 text-violet-700",
  local:   "bg-teal-50 text-teal-700",
};

const STAGE_TABS = [
  { value: "",           label: "All" },
  { value: "deliberate", label: "Deliberating" },
  { value: "mobilise",   label: "Mobilising" },
  { value: "resolved",   label: "Resolved" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function InitiativesPage({
  searchParams,
}: {
  searchParams: { stage?: string; scope?: string; tag?: string; page?: string };
}) {
  const params = searchParams;
  const stage = params.stage ?? "";
  const scope = params.scope ?? "";
  const tag = params.tag ?? "";
  const page = Math.max(1, parseInt(params.page ?? "1") || 1);
  const PAGE_SIZE = 20;

  const cookieStore = await cookies();
  const supabase = createServerClient(cookieStore);

  // Build query
  let query = supabase
    .from("civic_initiatives")
    .select(
      "id,title,summary,stage,scope,authorship_type,issue_area_tags,target_district,mobilise_started_at,created_at,resolved_at",
      { count: "exact" }
    );

  if (stage) query = query.eq("stage", stage);
  if (scope) query = query.eq("scope", scope);
  if (tag)   query = query.contains("issue_area_tags", [tag]);

  const { data, count } = await query
    .order("mobilise_started_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const initiatives = (data ?? []) as InitiativeRow[];
  const total = count ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  function buildUrl(updates: Record<string, string>) {
    const p = new URLSearchParams();
    const merged = { stage, scope, tag, ...updates };
    if (merged.stage) p.set("stage", merged.stage);
    if (merged.scope) p.set("scope", merged.scope);
    if (merged.tag)   p.set("tag", merged.tag);
    if (merged.page && merged.page !== "1") p.set("page", merged.page);
    const qs = p.toString();
    return `/initiatives${qs ? `?${qs}` : ""}`;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <PageViewTracker />

      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600">
                <span className="text-xs font-bold text-white">CV</span>
              </div>
              <span className="hidden text-sm font-semibold text-gray-900 sm:block">Civitics</span>
            </Link>
            <nav className="hidden md:flex items-center gap-4">
              {[
                { label: "Officials",   href: "/officials" },
                { label: "Proposals",   href: "/proposals" },
                { label: "Agencies",    href: "/agencies" },
                { label: "Graph",       href: "/graph" },
                { label: "Initiatives", href: "/initiatives" },
              ].map(({ label, href }) => (
                <Link
                  key={href}
                  href={href}
                  className={`text-sm font-medium transition-colors ${
                    href === "/initiatives"
                      ? "text-indigo-600"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  {label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <GlobalSearch variant="nav" />
            <AuthButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {/* ── Page header ──────────────────────────────────────────────── */}
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Civic Initiatives</h1>
            <p className="mt-1 text-sm text-gray-500">
              Citizen-led proposals — from deliberation to official accountability.
            </p>
          </div>
          <Link
            href="/initiatives/new"
            className="flex-shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            + New initiative
          </Link>
        </div>

        {/* ── Stage tabs ───────────────────────────────────────────────── */}
        <div className="mb-6 flex gap-1 overflow-x-auto rounded-lg border border-gray-200 bg-white p-1">
          {STAGE_TABS.map((tab) => (
            <Link
              key={tab.value}
              href={buildUrl({ stage: tab.value, page: "1" })}
              className={`flex-shrink-0 rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                stage === tab.value
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </div>

        {/* ── Scope filter ─────────────────────────────────────────────── */}
        <div className="mb-6 flex flex-wrap gap-2">
          {[
            { value: "", label: "All scopes" },
            { value: "federal", label: "Federal" },
            { value: "state",   label: "State" },
            { value: "local",   label: "Local" },
          ].map((opt) => (
            <Link
              key={opt.value}
              href={buildUrl({ scope: opt.value, page: "1" })}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                scope === opt.value
                  ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                  : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-900"
              }`}
            >
              {opt.label}
            </Link>
          ))}
        </div>

        {/* ── Results header ───────────────────────────────────────────── */}
        <div className="mb-4 flex items-center justify-between text-sm text-gray-500">
          <span>
            {total === 0
              ? "No initiatives found"
              : `${total.toLocaleString()} initiative${total === 1 ? "" : "s"}`}
          </span>
        </div>

        {/* ── Initiative cards ─────────────────────────────────────────── */}
        {initiatives.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white px-8 py-16 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50">
              <svg className="h-6 w-6 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-900">No initiatives yet</p>
            <p className="mt-1 text-sm text-gray-500">Be the first — start a civic initiative.</p>
            <Link
              href="/initiatives/new"
              className="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              Start an initiative
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {initiatives.map((initiative) => {
              const stage_style = STAGE_STYLES[initiative.stage] ?? STAGE_STYLES.draft;
              return (
                <Link
                  key={initiative.id}
                  href={`/initiatives/${initiative.id}`}
                  className="block rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      {/* Tags row */}
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${stage_style.color}`}>
                          {stage_style.label}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${SCOPE_STYLES[initiative.scope] ?? "bg-gray-50 text-gray-600"}`}>
                          {initiative.scope}
                        </span>
                        {initiative.authorship_type === "community" && (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                            Community
                          </span>
                        )}
                        {initiative.issue_area_tags.slice(0, 3).map((t) => (
                          <span key={t} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 capitalize">
                            {t.replace(/_/g, " ")}
                          </span>
                        ))}
                      </div>
                      {/* Title */}
                      <h2 className="text-base font-semibold text-gray-900 leading-snug line-clamp-2">
                        {initiative.title}
                      </h2>
                      {/* Summary */}
                      {initiative.summary && (
                        <p className="mt-1 text-sm text-gray-500 line-clamp-2">{initiative.summary}</p>
                      )}
                    </div>
                  </div>
                  {/* Footer */}
                  <div className="mt-3 flex items-center gap-4 text-xs text-gray-400">
                    <span>Started {formatDate(initiative.created_at)}</span>
                    {initiative.mobilise_started_at && (
                      <span>Mobilising since {formatDate(initiative.mobilise_started_at)}</span>
                    )}
                    {initiative.target_district && (
                      <span>{initiative.target_district}</span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {/* ── Pagination ───────────────────────────────────────────────── */}
        {totalPages > 1 && (
          <div className="mt-8 flex items-center justify-center gap-2">
            {page > 1 && (
              <Link
                href={buildUrl({ page: String(page - 1) })}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                ← Previous
              </Link>
            )}
            <span className="text-sm text-gray-500">Page {page} of {totalPages}</span>
            {page < totalPages && (
              <Link
                href={buildUrl({ page: String(page + 1) })}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Next →
              </Link>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
