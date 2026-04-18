import Link from "next/link";

// ─── Shared types ────────────────────────────────────────────────────────────

export type InitiativeCardData = {
  id: string;
  title: string;
  summary: string | null;
  stage: string; // "problem" | "draft" | "deliberate" | "mobilise" | "resolved"
  scope: string; // "federal" | "state" | "local"
  authorship_type: string; // "individual" | "community"
  issue_area_tags: string[];
  target_district: string | null;
  mobilise_started_at: string | null;
  created_at: string;
  resolved_at: string | null;
  /** Optional — surfaced on the homepage "trending" grid */
  upvoteCount?: number;
};

// ─── Style tables ────────────────────────────────────────────────────────────

const STAGE_STYLES: Record<string, { label: string; color: string }> = {
  problem:    { label: "Problem",      color: "bg-orange-100 text-orange-700 border-orange-200" },
  draft:      { label: "Draft",        color: "bg-gray-100 text-gray-600 border-gray-200" },
  deliberate: { label: "Deliberating", color: "bg-amber-100 text-amber-700 border-amber-200" },
  mobilise:   { label: "Mobilising",   color: "bg-indigo-100 text-indigo-700 border-indigo-200" },
  resolved:   { label: "Resolved",     color: "bg-green-100 text-green-700 border-green-200" },
};

const SCOPE_STYLES: Record<string, string> = {
  federal: "bg-blue-50 text-blue-700",
  state:   "bg-violet-50 text-violet-700",
  local:   "bg-teal-50 text-teal-700",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Component ───────────────────────────────────────────────────────────────

export function InitiativeCard({ initiative }: { initiative: InitiativeCardData }) {
  const stageStyle = STAGE_STYLES[initiative.stage] ?? STAGE_STYLES.draft!;
  const scopeCls   = SCOPE_STYLES[initiative.scope] ?? "bg-gray-50 text-gray-600";

  return (
    <Link
      href={`/initiatives/${initiative.id}`}
      className="group block h-full rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
    >
      <div className="flex h-full flex-col">
        {/* Tags row */}
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${stageStyle.color}`}>
            {stageStyle.label}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${scopeCls}`}>
            {initiative.scope}
          </span>
          {initiative.authorship_type === "community" && (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
              Community
            </span>
          )}
          {initiative.issue_area_tags.slice(0, 3).map((t) => (
            <span
              key={t}
              className="rounded-full bg-gray-100 px-2 py-0.5 text-xs capitalize text-gray-600"
            >
              {t.replace(/_/g, " ")}
            </span>
          ))}
        </div>

        {/* Title */}
        <h2 className="text-base font-semibold leading-snug text-gray-900 line-clamp-2 group-hover:text-indigo-700 transition-colors">
          {initiative.title}
        </h2>

        {/* Summary */}
        {initiative.summary && (
          <p className="mt-1 text-sm text-gray-500 line-clamp-2">{initiative.summary}</p>
        )}

        {/* Spacer so footer stays at bottom when used in equal-height grids */}
        <div className="flex-1" />

        {/* Footer */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400">
          {typeof initiative.upvoteCount === "number" && initiative.upvoteCount > 0 && (
            <span className="inline-flex items-center gap-1 font-medium text-indigo-600">
              <svg
                aria-hidden="true"
                className="h-3 w-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
              </svg>
              {initiative.upvoteCount.toLocaleString()} upvote
              {initiative.upvoteCount === 1 ? "" : "s"}
            </span>
          )}
          <span>Started {formatDate(initiative.created_at)}</span>
          {initiative.mobilise_started_at && (
            <span>Mobilising since {formatDate(initiative.mobilise_started_at)}</span>
          )}
          {initiative.target_district && <span>{initiative.target_district}</span>}
        </div>
      </div>
    </Link>
  );
}
