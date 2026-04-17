"use client";

type Props = {
  commentPeriodEnd: string; // ISO timestamp
  compact?: boolean;
};

function daysUntil(isoDate: string): number {
  return Math.ceil(
    (new Date(isoDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );
}

function formatDate(isoDate: string): string {
  // timeZone: "UTC" ensures server (Node UTC) and browser produce identical output
  return new Date(isoDate).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function CommentPeriodBadge({ commentPeriodEnd, compact = false }: Props) {
  const days = daysUntil(commentPeriodEnd);

  if (days <= 0) return null; // already closed

  const urgency =
    days <= 7
      ? { bg: "bg-red-50", border: "border-red-200", text: "text-red-700", dot: "bg-red-500" }
      : days <= 14
      ? { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", dot: "bg-amber-500" }
      : { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", dot: "bg-emerald-500" };

  const label =
    days === 1
      ? "Closes tomorrow"
      : days <= 7
      ? `Closes in ${days} days`
      : `Closes in ${days} days`;

  if (compact) {
    return (
      // suppressHydrationWarning: urgency classes and label text are derived from
      // Date.now() — tiny SSR/hydration time gap can't change the day count in
      // practice, but suppress the dev warning to be safe.
      <span
        suppressHydrationWarning
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium border ${urgency.bg} ${urgency.border} ${urgency.text}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${urgency.dot}`} />
        {label}
      </span>
    );
  }

  return (
    <div
      suppressHydrationWarning
      className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm ${urgency.bg} ${urgency.border} ${urgency.text}`}
    >
      <span suppressHydrationWarning className="font-medium">💬 {label}</span>
      <span className="opacity-75">Deadline: {formatDate(commentPeriodEnd)}</span>
    </div>
  );
}
