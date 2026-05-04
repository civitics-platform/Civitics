"use client";

import { useState } from "react";
import type { AnySearchResult } from "./SearchResultCard";

const MAX_INDIVIDUAL = 5;

interface SearchActionBarProps {
  selected: AnySearchResult[];
  onClear: () => void;
}

export function SearchActionBar({ selected, onClear }: SearchActionBarProps) {
  const [bundleDialogOpen, setBundleDialogOpen] = useState(false);
  const [bundleName, setBundleName] = useState("");

  if (selected.length === 0) return null;

  // ── Path A: add as individual entities ────────────────────────────────────
  function handleAddIndividually() {
    const toAdd = selected.slice(0, MAX_INDIVIDUAL);
    const ids   = toAdd.map((r) => r.data.id).join(",");
    const types = toAdd.map((r) => r.kind).join(",");
    window.location.href = `/graph?addEntityIds=${encodeURIComponent(ids)}&addEntityTypes=${encodeURIComponent(types)}`;
  }

  // ── Path B: bundle as group ────────────────────────────────────────────────
  function handleBundleConfirm() {
    if (!bundleName.trim()) return;

    // Derive a GroupFilter from the selection (best-effort: use the dominant type)
    const typeCounts: Record<string, number> = {};
    for (const r of selected) typeCounts[r.kind] = (typeCounts[r.kind] ?? 0) + 1;
    const dominantType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "official";

    // Map to entity_type that the GroupFilter understands
    const entityType = dominantType === "financial" ? "pac" : dominantType;

    const params = new URLSearchParams({
      groupType: entityType,
      groupName: bundleName.trim(),
    });
    window.location.href = `/graph?${params.toString()}`;
  }

  const tooMany = selected.length > MAX_INDIVIDUAL;

  return (
    <>
      <div className="sticky bottom-0 left-0 right-0 border-t border-gray-200 bg-white/95 backdrop-blur-sm px-4 py-3 flex items-center gap-3 z-20 shadow-[0_-1px_4px_rgba(0,0,0,0.06)]">
        <span className="text-sm font-medium text-gray-700 shrink-0">
          {selected.length} selected
        </span>

        <button
          onClick={onClear}
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors shrink-0"
        >
          Clear
        </button>

        <div className="flex-1" />

        {/* Add individually */}
        <div className="relative group">
          <button
            onClick={handleAddIndividually}
            className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-indigo-300 hover:text-indigo-700 transition-colors"
          >
            Add to graph individually
          </button>
          {tooMany && (
            <div className="absolute bottom-full mb-1.5 right-0 hidden group-hover:block z-30 w-52 rounded-md bg-gray-900 px-2.5 py-1.5 text-[11px] text-white shadow-lg">
              Limited to {MAX_INDIVIDUAL} entities. First {MAX_INDIVIDUAL} will be added.
            </div>
          )}
        </div>

        {/* Bundle as group */}
        <button
          onClick={() => { setBundleDialogOpen(true); setBundleName(""); }}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 transition-colors"
        >
          Bundle as group
        </button>
      </div>

      {/* Bundle dialog */}
      {bundleDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-xl bg-white shadow-xl p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-1">Name your group</h3>
            <p className="text-xs text-gray-500 mb-3">
              {selected.length} item{selected.length !== 1 ? "s" : ""} will be sent to the graph as a group.
            </p>
            <input
              type="text"
              autoFocus
              value={bundleName}
              onChange={(e) => setBundleName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleBundleConfirm(); if (e.key === "Escape") setBundleDialogOpen(false); }}
              placeholder="e.g. Climate advocates"
              className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setBundleDialogOpen(false)}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleBundleConfirm}
                disabled={!bundleName.trim()}
                className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Open in graph
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
