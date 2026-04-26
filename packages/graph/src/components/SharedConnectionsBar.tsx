"use client";

/**
 * packages/graph/src/components/SharedConnectionsBar.tsx
 *
 * Floating pill bar that lists nodes connected to ≥2 currently-focused
 * entities. The headline civic insight: "PACs that gave to BOTH Warren AND
 * Cruz" — those nodes are quietly the most analytically interesting.
 * Per FIX-149 / GRAPH_PLAN §6.1.
 *
 * Hidden when fewer than 2 entities are in focus; the parent should also
 * gate by viz type (only meaningful in force).
 */

import { useMemo } from "react";
import type { GraphNode, GraphEdge, FocusItem } from "../types";
import { isFocusEntity } from "../types";

// ── Helper ────────────────────────────────────────────────────────────────────

export interface SharedConnection {
  /** Node id of the third party */
  id: string;
  name: string;
  type: GraphNode["type"];
  /** How many focused entities are connected to this node. */
  focusCount: number;
}

/**
 * Find nodes connected to ≥2 of the focused entity ids. Returns them sorted by
 * focusCount desc, then name asc — most-shared first.
 */
export function findSharedConnections(
  focusIds: ReadonlySet<string>,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): SharedConnection[] {
  if (focusIds.size < 2) return [];

  // Build neighbour map: node id → set of focused entity ids it's connected to.
  const neighbourFocus = new Map<string, Set<string>>();
  for (const e of edges) {
    const fromIsFocus = focusIds.has(e.fromId);
    const toIsFocus = focusIds.has(e.toId);
    if (fromIsFocus && !toIsFocus) {
      const set = neighbourFocus.get(e.toId) ?? new Set<string>();
      set.add(e.fromId);
      neighbourFocus.set(e.toId, set);
    }
    if (toIsFocus && !fromIsFocus) {
      const set = neighbourFocus.get(e.fromId) ?? new Set<string>();
      set.add(e.toId);
      neighbourFocus.set(e.fromId, set);
    }
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const out: SharedConnection[] = [];
  for (const [nodeId, focusSet] of neighbourFocus) {
    if (focusSet.size < 2) continue;
    const node = nodeById.get(nodeId);
    if (!node) continue;
    out.push({
      id: nodeId,
      name: node.name,
      type: node.type,
      focusCount: focusSet.size,
    });
  }

  out.sort((a, b) => b.focusCount - a.focusCount || a.name.localeCompare(b.name));
  return out;
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface SharedConnectionsBarProps {
  /** Currently focused items. Only entities (not groups) participate in shared analysis. */
  focusItems: FocusItem[];
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  /** Currently highlighted shared node, drives pill active state. */
  highlightedNodeId?: string | null;
  /** Click a pill — pass null to clear. */
  onHighlight?: (nodeId: string | null) => void;
  /** Optional cap on the number of pills rendered before "+N more". Default 8. */
  maxPills?: number;
  className?: string;
}

const TYPE_DOT_COLORS: Record<string, string> = {
  official: "#3b82f6",
  agency: "#7c3aed",
  proposal: "#f59e0b",
  financial: "#16a34a",
  pac: "#ea580c",
  corporation: "#16a34a",
  organization: "#3b82f6",
  individual: "#3b82f6",
  user: "#a855f7",
  group: "#94a3b8",
};

export function SharedConnectionsBar({
  focusItems,
  nodes,
  edges,
  highlightedNodeId,
  onHighlight,
  maxPills = 8,
  className = "",
}: SharedConnectionsBarProps) {
  // Only consider focused entities (not groups) for the headline pair label.
  const focusEntities = useMemo(
    () => focusItems.filter(isFocusEntity),
    [focusItems],
  );

  const focusIds = useMemo(
    () => new Set(focusEntities.map((e) => e.id)),
    [focusEntities],
  );

  const shared = useMemo(
    () => findSharedConnections(focusIds, nodes, edges),
    [focusIds, nodes, edges],
  );

  if (focusEntities.length < 2 || shared.length === 0) return null;

  const visible = shared.slice(0, maxPills);
  const hidden = shared.length - visible.length;

  // Build the headline: "between Warren and Cruz" / "between 3 entities"
  let headline: string;
  if (focusEntities.length === 2) {
    const a = focusEntities[0]?.name ?? "";
    const b = focusEntities[1]?.name ?? "";
    headline = `between ${a} and ${b}`;
  } else {
    headline = `across ${focusEntities.length} focused entities`;
  }

  return (
    <div
      className={`flex items-center gap-2 max-w-full overflow-x-auto pointer-events-auto ${className}`}
      role="region"
      aria-label="Shared connections"
    >
      <div className="shrink-0 text-[11px] text-gray-300 bg-gray-950/85 backdrop-blur-sm border border-gray-800 rounded-full px-3 py-1">
        <span className="font-semibold text-emerald-400">{shared.length}</span>{" "}
        shared {headline}
      </div>

      {visible.map((s) => {
        const dot = TYPE_DOT_COLORS[s.type] ?? "#94a3b8";
        const active = s.id === highlightedNodeId;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onHighlight?.(active ? null : s.id)}
            className={[
              "shrink-0 inline-flex items-center gap-1.5 text-[11px] rounded-full px-2.5 py-1 transition-colors",
              active
                ? "bg-emerald-500 text-gray-950 border border-emerald-400"
                : "bg-gray-900/80 text-gray-200 border border-gray-700 hover:bg-gray-800",
            ].join(" ")}
            title={`${s.name} — connected to ${s.focusCount} focused entities`}
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: dot }}
            />
            <span className="truncate max-w-[160px]">{s.name}</span>
            {s.focusCount > 2 && (
              <span className="text-[10px] opacity-70 tabular-nums">×{s.focusCount}</span>
            )}
          </button>
        );
      })}

      {hidden > 0 && (
        <span className="shrink-0 text-[11px] text-gray-500">+{hidden} more</span>
      )}
    </div>
  );
}
