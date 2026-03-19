"use client";

/**
 * AiProfileSection
 *
 * Used on the official profile page when no cached summary is available
 * at render time. Fetches on mount and displays a 2-sentence civic profile.
 * Result is cached server-side — subsequent visitors see it instantly.
 */

import { useEffect, useState } from "react";

type Props = {
  officialId: string;
};

export function AiProfileSection({ officialId }: Props) {
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/officials/${officialId}/summary`)
      .then((r) => r.json())
      .then((data: { summary: string | null }) => {
        if (!cancelled) {
          setSummary(data.summary ?? null);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [officialId]);

  if (loading) {
    return (
      <div className="mt-3 flex items-center gap-2 text-xs text-indigo-400">
        <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-500" />
        Generating civic profile…
      </div>
    );
  }

  if (!summary) return null;

  return (
    <div className="mt-3 rounded-md border border-indigo-100 bg-indigo-50 px-4 py-3">
      <p className="text-sm text-gray-700 leading-relaxed">{summary}</p>
      <p className="mt-1.5 text-[10px] text-indigo-400">Civic profile · AI generated</p>
    </div>
  );
}
