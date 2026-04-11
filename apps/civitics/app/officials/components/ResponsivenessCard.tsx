import Link from "next/link";
import type { ResponsivenessData, ResponsivenessGrade } from "../../api/officials/[id]/responsiveness/route";

// ─── Grade config ──────────────────────────────────────────────────────────────

const GRADE_CONFIG: Record<
  ResponsivenessGrade,
  { label: string; color: string; bg: string; border: string; ring: string }
> = {
  A: { label: "Highly responsive",     color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200", ring: "ring-emerald-400" },
  B: { label: "Generally responsive",  color: "text-green-700",   bg: "bg-green-50",   border: "border-green-200",   ring: "ring-green-400"   },
  C: { label: "Partially responsive",  color: "text-amber-700",   bg: "bg-amber-50",   border: "border-amber-200",   ring: "ring-amber-400"   },
  D: { label: "Low responsiveness",    color: "text-orange-700",  bg: "bg-orange-50",  border: "border-orange-200",  ring: "ring-orange-400"  },
  F: { label: "Non-responsive",        color: "text-red-700",     bg: "bg-red-50",     border: "border-red-200",     ring: "ring-red-400"     },
};

const RESPONSE_LABELS: Record<string, { label: string; color: string }> = {
  support:     { label: "Supports",           color: "bg-green-100 text-green-800 border-green-200" },
  oppose:      { label: "Opposes",            color: "bg-red-100 text-red-800 border-red-200" },
  pledge:      { label: "Pledged to Sponsor", color: "bg-indigo-100 text-indigo-800 border-indigo-200" },
  refer:       { label: "Referred",           color: "bg-amber-100 text-amber-800 border-amber-200" },
  no_response: { label: "No Response",        color: "bg-gray-100 text-gray-500 border-gray-200" },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

// ─── ResponsivenessCard ────────────────────────────────────────────────────────

interface ResponsivenessCardProps {
  data: ResponsivenessData;
}

export function ResponsivenessCard({ data }: ResponsivenessCardProps) {
  const { responded, no_response, open, total_closed, response_rate, grade, recent } = data;
  const gc = grade ? GRADE_CONFIG[grade] : null;
  const now = new Date();

  // If no windows at all, don't render — no civic initiatives have reached this official yet
  if (total_closed === 0 && open === 0) return null;

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Civic responsiveness</h3>
        <span className="text-xs text-gray-400">Initiative response windows</span>
      </div>

      <div className="p-4">
        {/* Score row */}
        <div className="flex items-center gap-4 mb-4">
          {/* Grade badge */}
          {gc ? (
            <div className={`flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full ring-2 ${gc.ring} ${gc.bg}`}>
              <span className={`text-2xl font-black ${gc.color}`}>{grade}</span>
            </div>
          ) : (
            <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full ring-2 ring-gray-200 bg-gray-50">
              <span className="text-lg font-bold text-gray-400">—</span>
            </div>
          )}

          <div>
            {response_rate !== null ? (
              <>
                <p className={`text-2xl font-bold tabular-nums ${gc?.color ?? "text-gray-900"}`}>
                  {response_rate}%
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {gc?.label}
                </p>
              </>
            ) : (
              <>
                <p className="text-base font-semibold text-gray-500">No closed windows</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {open > 0 ? `${open} open window${open !== 1 ? "s" : ""} in progress` : "Score will appear once windows close"}
                </p>
              </>
            )}
          </div>
        </div>

        {/* Breakdown bar */}
        {total_closed > 0 && (
          <div className="mb-4">
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full bg-emerald-400 transition-all"
                style={{ width: `${Math.round((responded / total_closed) * 100)}%` }}
              />
            </div>
            <div className="mt-1.5 flex justify-between text-[10px] text-gray-400">
              <span className="text-emerald-600 font-medium">{responded} responded</span>
              <span className="text-red-500 font-medium">{no_response} no response</span>
            </div>
          </div>
        )}

        {/* Stat pills */}
        <div className="mb-4 flex flex-wrap gap-2">
          {responded > 0 && (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
              {responded} responded
            </span>
          )}
          {no_response > 0 && (
            <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700">
              {no_response} no response
            </span>
          )}
          {open > 0 && (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
              {open} open
            </span>
          )}
        </div>

        {/* Recent windows */}
        {recent.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
              Recent windows
            </p>
            <div className="space-y-2">
              {recent.map((r) => {
                const rl     = RESPONSE_LABELS[r.response_type] ?? RESPONSE_LABELS.no_response;
                const isOpen = !r.responded_at && new Date(r.window_closes_at) >= now;
                const daysLeft = isOpen
                  ? Math.max(0, Math.ceil((new Date(r.window_closes_at).getTime() - now.getTime()) / 86_400_000))
                  : null;

                return (
                  <div key={r.initiative_id} className="flex items-start justify-between gap-2 rounded-md border border-gray-100 bg-gray-50 px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <Link
                        href={`/initiatives/${r.initiative_id}`}
                        className="text-xs font-medium text-indigo-600 hover:underline line-clamp-1"
                      >
                        {r.initiative_title}
                      </Link>
                      <p className="text-[10px] text-gray-400 mt-0.5 capitalize">
                        {r.scope} ·{" "}
                        {r.responded_at
                          ? `Responded ${formatDate(r.responded_at)}`
                          : isOpen
                          ? `${daysLeft}d remaining`
                          : `Closed ${formatDate(r.window_closes_at)}`
                        }
                      </p>
                    </div>
                    <span className={`flex-shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${rl.color}`}>
                      {rl.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Permanence note */}
        {no_response > 0 && (
          <p className="mt-3 text-[10px] text-gray-400 italic">
            No Response records are permanent public record. Silence is data.
          </p>
        )}
      </div>
    </div>
  );
}
