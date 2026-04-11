"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";

// ─── Milestones ────────────────────────────────────────────────────────────────

type MilestoneMetric = "total" | "constituent";

type Milestone = {
  id:          string;
  count:       number;
  metric:      MilestoneMetric;
  label:       string;
  description: string;
  icon:        string;
};

// Milestones are ordered — each is a meaningful civic escalation step.
// "constituent" metric = district-verified signatures only (stronger signal).
const MILESTONES: Milestone[] = [
  {
    id:          "listed",
    count:       100,
    metric:      "total",
    label:       "Listed publicly",
    description: "Initiative appears in public listings",
    icon:        "👁",
  },
  {
    id:          "notify",
    count:       250,
    metric:      "constituent",
    label:       "Officials notified",
    description: "Relevant officials receive formal notice",
    icon:        "📢",
  },
  {
    id:          "window",
    count:       1_000,
    metric:      "constituent",
    label:       "30-day response window",
    description: "Officials must respond or receive a permanent No Response",
    icon:        "⏱",
  },
  {
    id:          "featured",
    count:       5_000,
    metric:      "constituent",
    label:       "Featured on homepage",
    description: "Initiative spotlighted for the broader community",
    icon:        "⭐",
  },
];

// ─── MilestoneRow ─────────────────────────────────────────────────────────────

function MilestoneRow({
  milestone,
  total,
  constituent,
}: {
  milestone:   Milestone;
  total:       number;
  constituent: number;
}) {
  const current = milestone.metric === "total" ? total : constituent;
  const pct     = Math.min(100, Math.round((current / milestone.count) * 100));
  const hit     = current >= milestone.count;

  return (
    <div className={`rounded-lg border p-2.5 ${hit ? "border-emerald-200 bg-emerald-50" : "border-gray-200 bg-white"}`}>
      <div className="flex items-start gap-2">
        {/* Icon / checkmark */}
        <div className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center">
          {hit ? (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white text-xs font-bold">
              ✓
            </span>
          ) : (
            <span className="text-sm">{milestone.icon}</span>
          )}
        </div>

        <div className="flex-1 min-w-0">
          {/* Label + count */}
          <div className="flex items-baseline justify-between gap-1">
            <p className={`text-xs font-semibold ${hit ? "text-emerald-800" : "text-gray-700"}`}>
              {milestone.label}
            </p>
            <span className={`flex-shrink-0 text-xs tabular-nums ${hit ? "text-emerald-700 font-semibold" : "text-gray-400"}`}>
              {current.toLocaleString()} / {milestone.count.toLocaleString()}
              {milestone.metric === "constituent" && (
                <span className="ml-0.5 text-gray-300">✓</span>
              )}
            </span>
          </div>

          {/* Description */}
          <p className="text-xs text-gray-400 mt-0.5 leading-snug">
            {milestone.description}
          </p>

          {/* Progress bar (only shown when not yet hit) */}
          {!hit && (
            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-indigo-400 transition-all duration-700"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── SignaturePanel ────────────────────────────────────────────────────────────

interface SignaturePanelProps {
  initiativeId:       string;
  mobiliseStartedAt:  string | null;
  initialTotal:       number;
  initialConstituent: number;
}

export function SignaturePanel({
  initiativeId,
  mobiliseStartedAt,
  initialTotal,
  initialConstituent,
}: SignaturePanelProps) {
  const router = useRouter();

  const [total,       setTotal]       = useState(initialTotal);
  const [constituent, setConstituent] = useState(initialConstituent);
  const [signed,      setSigned]      = useState<boolean | null>(null); // null = checking
  const [signing,     setSigning]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  // ── Fetch initial sign state ───────────────────────────────────────────────
  useEffect(() => {
    fetch(`/api/initiatives/${initiativeId}/sign`)
      .then((r) => r.json())
      .then((d) => setSigned(d.signed ?? false))
      .catch(() => setSigned(false));
  }, [initiativeId]);

  // ── Poll signature counts every 30s ───────────────────────────────────────
  const refreshCounts = useCallback(async () => {
    try {
      const r = await fetch(`/api/initiatives/${initiativeId}/signature-count`);
      const d = await r.json();
      if (r.ok) {
        setTotal(d.total ?? 0);
        setConstituent(d.constituent_verified ?? 0);
      }
    } catch { /* silent */ }
  }, [initiativeId]);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    pollRef.current = setInterval(refreshCounts, 30_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [refreshCounts]);

  // ── Sign / unsign ──────────────────────────────────────────────────────────
  async function handleSign() {
    setError(null);
    setSigning(true);

    try {
      const res  = await fetch(`/api/initiatives/${initiativeId}/sign`, { method: "POST" });
      const data = await res.json();

      if (res.status === 401) {
        router.push(`/auth/sign-in?next=/initiatives/${initiativeId}`);
        return;
      }

      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }

      const newSigned = data.signed as boolean;
      setSigned(newSigned);
      // Optimistic count update; authoritative refresh follows shortly
      setTotal((prev) => newSigned ? prev + 1 : Math.max(0, prev - 1));
      setTimeout(refreshCounts, 800);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSigning(false);
    }
  }

  // ── Days mobilising ────────────────────────────────────────────────────────
  const daysMobilising = mobiliseStartedAt
    ? Math.floor((Date.now() - new Date(mobiliseStartedAt).getTime()) / 86_400_000)
    : null;

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-5 shadow-sm">
      {/* Header */}
      <div className="mb-4 flex items-baseline justify-between">
        <p className="text-sm font-bold text-indigo-900">Signatures</p>
        {daysMobilising !== null && (
          <span className="text-xs text-indigo-500">
            Day {daysMobilising + 1} of mobilising
          </span>
        )}
      </div>

      {/* Count grid */}
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-indigo-200 bg-white p-3 text-center">
          <p className="text-2xl font-bold tabular-nums text-indigo-900">
            {total.toLocaleString()}
          </p>
          <p className="text-xs text-indigo-600 mt-0.5">Total signed</p>
        </div>
        <div className="rounded-lg border border-indigo-200 bg-white p-3 text-center">
          <p className="text-2xl font-bold tabular-nums text-indigo-900">
            {constituent.toLocaleString()}
          </p>
          <p className="text-xs text-indigo-600 mt-0.5">
            District-verified
            <span className="ml-0.5 text-indigo-400">✓</span>
          </p>
        </div>
      </div>

      {/* Sign button */}
      {signed === null ? (
        // Checking signed state — show skeleton
        <div className="h-10 animate-pulse rounded-lg bg-indigo-200" />
      ) : signed ? (
        <button
          onClick={handleSign}
          disabled={signing}
          className="w-full rounded-lg border-2 border-emerald-500 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50"
        >
          {signing ? "Removing…" : "✓ You signed this — click to unsign"}
        </button>
      ) : (
        <button
          onClick={handleSign}
          disabled={signing}
          className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-50"
        >
          {signing ? "Signing…" : "Sign this initiative"}
        </button>
      )}

      {/* Error feedback */}
      {error && (
        <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">
          {error}
        </p>
      )}

      {/* Milestone ladder */}
      <div className="mt-5 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
          Milestones
        </p>
        <p className="text-xs text-indigo-500 -mt-1">
          ✓ = district-verified signatures
        </p>
        {MILESTONES.map((m) => (
          <MilestoneRow
            key={m.id}
            milestone={m}
            total={total}
            constituent={constituent}
          />
        ))}
      </div>
    </div>
  );
}
