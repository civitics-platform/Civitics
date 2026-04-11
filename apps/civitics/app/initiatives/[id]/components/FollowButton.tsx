"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface FollowButtonProps {
  initiativeId:   string;
  initialCount:   number;
}

export function FollowButton({ initiativeId, initialCount }: FollowButtonProps) {
  const router  = useRouter();
  const [following, setFollowing] = useState<boolean | null>(null); // null = checking
  const [count,     setCount]     = useState(initialCount);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  // ── Fetch initial follow state ─────────────────────────────────────────────
  useEffect(() => {
    fetch(`/api/initiatives/${initiativeId}/follow`)
      .then((r) => r.json())
      .then((d) => {
        setFollowing(d.following ?? false);
        setCount(d.count ?? initialCount);
      })
      .catch(() => setFollowing(false));
  }, [initiativeId, initialCount]);

  // ── Toggle follow ──────────────────────────────────────────────────────────
  async function handleFollow() {
    setError(null);
    setLoading(true);
    try {
      const res  = await fetch(`/api/initiatives/${initiativeId}/follow`, { method: "POST" });
      const data = await res.json();

      if (res.status === 401) {
        router.push(`/auth/sign-in?next=/initiatives/${initiativeId}`);
        return;
      }
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }

      setFollowing(data.following);
      setCount(data.count ?? 0);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {following === null ? (
        // Skeleton while checking state
        <div className="h-9 animate-pulse rounded-lg bg-gray-100" />
      ) : following ? (
        <button
          onClick={handleFollow}
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
        >
          <span className="text-indigo-500">★</span>
          {loading ? "Updating…" : `Following · ${count.toLocaleString()}`}
        </button>
      ) : (
        <button
          onClick={handleFollow}
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50"
        >
          <span className="text-gray-400">☆</span>
          {loading ? "Updating…" : count > 0 ? `Follow · ${count.toLocaleString()}` : "Follow"}
        </button>
      )}
      {error && (
        <p className="mt-1 text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}
