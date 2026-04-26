"use client";

import { HierarchyGraph } from "@civitics/graph";
import Link from "next/link";

/**
 * Compact agency-hierarchy embed for the /agencies page (FIX-144 / GRAPH_PLAN §5.1).
 * Renders a top-of-page department drill-down. Clicking through to the full
 * graph opens the Hierarchy viz with the federal root.
 */
export function HierarchyEmbed() {
  return (
    <div className="mb-8 rounded-xl border border-gray-200 bg-gray-950 p-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white">Department Org Chart</h2>
          <p className="text-xs text-gray-400">
            Federal departments and sub-agencies, sized by FY contract budget.
          </p>
        </div>
        <Link
          href="/graph?viz=hierarchy"
          className="text-[11px] font-medium text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          Open in Graph →
        </Link>
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-900/50" style={{ height: 320 }}>
        <HierarchyGraph
          className="w-full h-full"
          compact
          vizOptions={{
            orientation: "horizontal",
            nodeSizeBy: "budget",
            collapseDepth: 1,
            showLabels: true,
          }}
        />
      </div>
    </div>
  );
}
