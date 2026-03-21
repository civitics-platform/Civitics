"use client";

import React, { useState, useEffect, useCallback } from "react";

export interface AiNarrativeProps {
  vizType: string;
  entityNames: string[];
  activeFilters: string[];
  isVisible: boolean;
  onClose: () => void;
}

export function AiNarrative({ vizType, entityNames, activeFilters, isVisible, onClose }: AiNarrativeProps) {
  const [narrative, setNarrative] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = useCallback(async () => {
    setLoading(true);
    setNarrative(null);
    setError(null);

    try {
      const res = await fetch("/api/graph/narrative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vizType, entityNames, activeFilters }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { narrative?: string; error?: string };

      if (data.error) throw new Error(data.error);
      setNarrative(data.narrative ?? "No narrative generated.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate narrative.");
    } finally {
      setLoading(false);
    }
  }, [vizType, entityNames, activeFilters]);

  // Auto-generate when panel opens
  useEffect(() => {
    if (isVisible && !narrative && !loading) {
      generate();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible]);

  async function handleCopy() {
    if (!narrative) return;
    try {
      await navigator.clipboard.writeText(narrative);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard not available
    }
  }

  if (!isVisible) return null;

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 w-full max-w-md px-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <span className="text-sm">✨</span>
            <span className="text-xs font-semibold text-gray-200">AI Narrative</span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white transition-colors text-sm leading-none"
            title="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-3 min-h-[80px]">
          {loading && (
            <div className="flex items-center gap-2 text-gray-500">
              <div className="w-3 h-3 rounded-full border border-gray-500 border-t-transparent animate-spin shrink-0" />
              <span className="text-xs">Generating summary…</span>
            </div>
          )}

          {error && !loading && (
            <p className="text-xs text-red-400">{error}</p>
          )}

          {narrative && !loading && (
            <p className="text-xs text-gray-300 leading-relaxed">{narrative}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-800 bg-gray-950/60">
          <p className="text-[10px] text-gray-600">
            ⚠ AI-generated · verify against source data
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={generate}
              disabled={loading}
              className="text-[11px] px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors disabled:opacity-50"
            >
              Regenerate
            </button>
            <button
              onClick={handleCopy}
              disabled={!narrative || loading}
              className="text-[11px] px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors disabled:opacity-50"
            >
              {copied ? "Copied ✓" : "Copy text"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
