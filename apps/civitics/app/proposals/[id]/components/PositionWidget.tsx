"use client";

import { useState, useEffect, useCallback } from "react";

// QWEN-ADDED: Position tracking widget for proposal pages

type PositionCounts = {
  support: number;
  oppose: number;
  neutral: number;
  question: number;
  total: number;
};

type PositionType = "support" | "oppose" | "neutral" | "question";

const POSITION_CONFIG: Record<PositionType, { label: string; color: string; activeColor: string }> = {
  support: {
    label: "Support",
    color: "bg-green-50 border-green-200 text-green-700",
    activeColor: "bg-green-100 border-green-400 text-green-800 ring-2 ring-green-300",
  },
  oppose: {
    label: "Oppose",
    color: "bg-red-50 border-red-200 text-red-700",
    activeColor: "bg-red-100 border-red-400 text-red-800 ring-2 ring-red-300",
  },
  neutral: {
    label: "Neutral",
    color: "bg-gray-50 border-gray-200 text-gray-700",
    activeColor: "bg-gray-100 border-gray-400 text-gray-800 ring-2 ring-gray-300",
  },
  question: {
    label: "Question",
    color: "bg-amber-50 border-amber-200 text-amber-700",
    activeColor: "bg-amber-100 border-amber-400 text-amber-800 ring-2 ring-amber-300",
  },
};

interface PositionWidgetProps {
  proposalId: string;
}

export function PositionWidget({ proposalId }: PositionWidgetProps) {
  const [counts, setCounts] = useState<PositionCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [requiresAuth, setRequiresAuth] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/proposals/${proposalId}/position`);
      if (!res.ok) {
        throw new Error("Failed to fetch positions");
      }
      const data = await res.json();
      setCounts(data);
    } catch {
      setError("Unable to load positions.");
    } finally {
      setLoading(false);
    }
  }, [proposalId]);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  const handlePosition = async (position: PositionType) => {
    setPosting(true);
    setRequiresAuth(false);
    setError(null);

    try {
      const res = await fetch(`/api/proposals/${proposalId}/position`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position }),
      });

      if (res.status === 401) {
        setRequiresAuth(true);
        return;
      }
      if (!res.ok) {
        throw new Error("Failed to record position");
      }

      // Re-fetch counts after successful post
      await fetchCounts();
    } catch {
      setError("Failed to record position");
    } finally {
      setPosting(false);
    }
  };

  if (error && !counts) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-center">
        <p className="text-sm text-red-700">{error}</p>
        <button
          onClick={fetchCounts}
          className="mt-2 text-xs text-red-600 hover:text-red-800 underline"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <section>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
        Community Position
      </h2>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {(Object.keys(POSITION_CONFIG) as PositionType[]).map((pos) => {
          const config = POSITION_CONFIG[pos];
          const count = counts?.[pos] ?? 0;
          const isLoading = loading || posting;

          return (
            <button
              key={pos}
              onClick={() => handlePosition(pos)}
              disabled={isLoading}
              className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                isLoading ? config.color : config.color + " hover:shadow-sm"
              }`}
              aria-label={`Record ${config.label} position`}
            >
              <div className="flex flex-col items-center gap-1">
                <span>{config.label}</span>
                <span className="text-lg font-bold tabular-nums">{count}</span>
              </div>
            </button>
          );
        })}
      </div>

      {requiresAuth && (
        <p className="mt-2 text-xs text-gray-500">
          Sign in to record your position.
        </p>
      )}
      {error && counts && (
        <p className="mt-2 text-xs text-red-600">{error}</p>
      )}
    </section>
  );
}
