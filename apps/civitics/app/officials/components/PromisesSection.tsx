// QWEN-ADDED: Promises accountability section for official detail pages
// FIXED: enum values corrected to match promise_status in 0001_initial_schema.sql

type PromiseRow = {
  id: string;
  title: string;
  description: string | null;
  status: 'made' | 'in_progress' | 'kept' | 'broken' | 'partially_kept' | 'expired' | 'modified';
  made_at: string | null;
  deadline: string | null;
  resolved_at: string | null;
  source_url: string | null;
  source_quote: string | null;
};

/** Format a date string as "Jan 2022" or return null if missing. */
function formatMonthYear(dateStr: string | null): string | null {
  if (!dateStr) return null;
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
}

const STATUS_STYLES: Record<PromiseRow['status'], { label: string; cls: string }> = {
  made:          { label: 'Made',           cls: 'bg-gray-100 text-gray-600' },
  in_progress:   { label: 'In Progress',    cls: 'bg-blue-100 text-blue-700' },
  kept:          { label: 'Kept \u2713',    cls: 'bg-green-100 text-green-700' },
  broken:        { label: 'Broken',         cls: 'bg-red-100 text-red-700' },
  partially_kept:{ label: 'Partial \u2713', cls: 'bg-orange-100 text-orange-700' },
  expired:       { label: 'Expired',        cls: 'bg-gray-200 text-gray-500' },
  modified:      { label: 'Modified',       cls: 'bg-purple-100 text-purple-700' },
};

/**
 * Server component — data passed as props.
 * Returns null if promises.length === 0.
 */
export function PromisesSection({ promises }: { promises: PromiseRow[] }) {
  if (promises.length === 0) return null;

  // Summary counts — only the three most meaningful statuses shown in footer
  const summary = { kept: 0, broken: 0, in_progress: 0 };
  for (const p of promises) {
    if (p.status in summary) summary[p.status as keyof typeof summary]++;
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden mb-6">
      {/* Header with count badge */}
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-900">Promises</h2>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500">
            {promises.length}
          </span>
        </div>
      </div>

      {/* Promise list */}
      <div className="divide-y divide-gray-100">
        {promises.map((p) => {
          const style = STATUS_STYLES[p.status] ?? STATUS_STYLES.made;
          const madeDate = formatMonthYear(p.made_at);
          const deadlineDate = formatMonthYear(p.deadline);
          const showDeadline = (p.status === 'made' || p.status === 'in_progress') && deadlineDate;
          const truncatedQuote = p.source_quote
            ? (p.source_quote.length > 200
                ? p.source_quote.slice(0, 200) + '\u2026'
                : p.source_quote)
            : null;

          return (
            <div key={p.id} className="px-5 py-4">
              {/* Title + status */}
              <div className="flex flex-wrap items-start gap-2">
                <span className="text-sm font-semibold text-gray-900 flex-1 min-w-0">
                  {p.title}
                </span>
                <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-bold ${style.cls}`}>
                  {style.label}
                </span>
              </div>

              {/* Dates */}
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-[10px] text-gray-400">
                {madeDate && <span>Made {madeDate}</span>}
                {showDeadline && <span>Due {deadlineDate}</span>}
              </div>

              {/* Source quote */}
              {truncatedQuote && (
                <blockquote className="mt-2 text-xs text-gray-500 italic border-l-2 border-gray-200 pl-3 leading-relaxed">
                  &ldquo;{truncatedQuote}&rdquo;
                </blockquote>
              )}

              {/* Source link */}
              {p.source_url && (
                <a
                  href={p.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1.5 inline-block text-[10px] text-indigo-600 hover:text-indigo-800 font-medium"
                >
                  Source &rarr;
                </a>
              )}
            </div>
          );
        })}
      </div>

      {/* Summary row */}
      {(summary.kept > 0 || summary.broken > 0 || summary.in_progress > 0) && (
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 text-xs text-gray-500">
          {[
            summary.kept > 0 && `${summary.kept} kept`,
            summary.broken > 0 && `${summary.broken} broken`,
            summary.in_progress > 0 && `${summary.in_progress} in progress`,
          ]
            .filter(Boolean)
            .join(', ')}
        </div>
      )}
    </div>
  );
}
