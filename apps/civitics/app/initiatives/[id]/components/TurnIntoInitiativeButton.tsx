"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function TurnIntoInitiativeButton({ initiativeId }: { initiativeId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConvert() {
    if (loading) return;
    setLoading(true);
    setError(null);

    try {
      // PATCH the stage from 'problem' → 'draft' so the normal initiative workflow begins
      const res = await fetch(`/api/initiatives/${initiativeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: "draft" }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to convert. Please try again.");
        return;
      }

      // Reload the page so the author sees the draft banner + QualityGate
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-3">
      <button
        onClick={handleConvert}
        disabled={loading}
        className="rounded-lg border border-orange-400 bg-white px-3 py-1.5 text-xs font-semibold text-orange-700 shadow-sm hover:bg-orange-50 focus:outline-none focus:ring-2 focus:ring-orange-400 disabled:opacity-50 transition-colors"
      >
        {loading ? "Converting…" : "Turn into a full initiative →"}
      </button>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}
