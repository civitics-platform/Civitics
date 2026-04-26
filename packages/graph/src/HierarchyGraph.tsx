"use client";

/**
 * packages/graph/src/HierarchyGraph.tsx
 *
 * Agency org chart — D3 tree/dendrogram rooted at a federal department or any
 * agency picked via the `rootEntityId` prop. Node radius can encode budget
 * (sum of contract amount_cents from financial_relationships), employee count,
 * or be uniform. Per FIX-144 / GRAPH_PLAN §5.1.
 *
 * Used in two places:
 *   - the full graph canvas (vizType === 'hierarchy')
 *   - a compact embed on /agencies (compact=true)
 */

import { useEffect, useRef, useState, useCallback } from "react";
import * as d3 from "d3";
import type { RefObject } from "react";
import type { GraphNode as NewGraphNode, NodeActions, HierarchyOptions } from "./types";
import { Tooltip, useTooltip } from "./components/Tooltip";
import { NodePopup } from "./components/NodePopup";

// ── Types ─────────────────────────────────────────────────────────────────────

interface HierarchyApiNode {
  id: string;
  name: string;
  acronym: string | null;
  agency_type: string;
  budget_cents: number;
  award_count: number;
  children: HierarchyApiNode[];
}

interface HierarchyApiResponse {
  tree: HierarchyApiNode | null;
  total_budget_cents: number;
}

// d3 datum stored on each node
interface TreeDatum {
  id: string;
  name: string;
  acronym: string | null;
  agency_type: string;
  budget_cents: number;
  award_count: number;
  // Required by d3.hierarchy().sum() — we set it from budget at build time.
  value?: number;
  children?: TreeDatum[];
  /** Hidden children — restored when the node is uncollapsed. */
  _children?: TreeDatum[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMoney(cents: number): string {
  const d = cents / 100;
  if (d >= 1_000_000_000) return `$${(d / 1_000_000_000).toFixed(1)}B`;
  if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(1)}M`;
  if (d >= 1_000) return `$${(d / 1_000).toFixed(0)}K`;
  if (d > 0) return `$${d.toFixed(0)}`;
  return "—";
}

function toTreeDatum(api: HierarchyApiNode): TreeDatum {
  return {
    id: api.id,
    name: api.name,
    acronym: api.acronym,
    agency_type: api.agency_type,
    budget_cents: api.budget_cents,
    award_count: api.award_count,
    children: api.children.map(toTreeDatum),
  };
}

function applyCollapse(node: TreeDatum, depth: number, maxDepth: number) {
  if (!node.children) return;
  if (depth >= maxDepth && node.children.length > 0) {
    node._children = node.children;
    node.children = undefined;
    return;
  }
  for (const c of node.children) applyCollapse(c, depth + 1, maxDepth);
}

function agencyToGraphNode(d: TreeDatum): NewGraphNode {
  return {
    id: d.id,
    name: d.acronym ? `${d.name} (${d.acronym})` : d.name,
    type: "agency",
    metadata: {
      budget_cents: d.budget_cents,
      award_count: d.award_count,
    },
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface HierarchyGraphProps {
  className?: string;
  svgRef?: RefObject<SVGSVGElement>;
  vizOptions?: Partial<HierarchyOptions>;
  /** When set, the API tree is rooted at this agency UUID. */
  rootEntityId?: string | null;
  /** Compact mode — smaller margins, smaller fonts, no popup. Used in /agencies embed. */
  compact?: boolean;
}

const DEFAULTS: HierarchyOptions = {
  orientation: "horizontal",
  nodeSizeBy: "budget",
  collapseDepth: 2,
  showLabels: true,
};

export function HierarchyGraph({
  className = "",
  svgRef: externalSvgRef,
  vizOptions,
  rootEntityId,
  compact = false,
}: HierarchyGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const internalSvgRef = useRef<SVGSVGElement>(null);
  const svgRef = externalSvgRef ?? internalSvgRef;

  const [tree, setTree] = useState<TreeDatum | null>(null);
  const [totalBudget, setTotalBudget] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { tooltip, show: showTip, hide: hideTip } = useTooltip();
  const [popup, setPopup] = useState<NewGraphNode | null>(null);

  const orientation = vizOptions?.orientation ?? DEFAULTS.orientation;
  const nodeSizeBy = vizOptions?.nodeSizeBy ?? DEFAULTS.nodeSizeBy;
  const collapseDepth = vizOptions?.collapseDepth ?? DEFAULTS.collapseDepth;
  const showLabels = vizOptions?.showLabels ?? DEFAULTS.showLabels;

  // ── Fetch data ──────────────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (rootEntityId) params.set("root", rootEntityId);
    const url = `/api/graph/hierarchy${params.toString() ? `?${params}` : ""}`;

    fetch(url)
      .then((r) => r.json())
      .then((data: HierarchyApiResponse | { error: string }) => {
        if ("error" in data) throw new Error(data.error);
        if (!data.tree) {
          setTree(null);
          setTotalBudget(0);
          return;
        }
        const built = toTreeDatum(data.tree);
        applyCollapse(built, 0, collapseDepth);
        setTree(built);
        setTotalBudget(data.total_budget_cents);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  // collapseDepth intentionally excluded — applied here on initial fetch only;
  // changing it later goes through the render path so users keep their drill state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootEntityId]);

  // Reapply collapseDepth when the option changes (without re-fetching).
  useEffect(() => {
    setTree((prev) => {
      if (!prev) return prev;
      // Re-build from the un-collapsed snapshot — flatten _children back in then collapse.
      const restore = (n: TreeDatum): TreeDatum => {
        const kids = n.children ?? n._children ?? [];
        return {
          ...n,
          children: kids.map(restore),
          _children: undefined,
        };
      };
      const restored = restore(prev);
      applyCollapse(restored, 0, collapseDepth);
      return restored;
    });
  }, [collapseDepth]);

  // ── Render ──────────────────────────────────────────────────────────────────
  const render = useCallback(() => {
    const container = containerRef.current;
    const svg = svgRef.current;
    if (!container || !svg || !tree) return;

    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;

    d3.select(svg).selectAll("*").remove();
    d3.select(svg).attr("width", width).attr("height", height);

    const root = d3.hierarchy<TreeDatum>(tree, (d) => d.children);

    // Node size encoding — scale leaf radii based on budget / award count / uniform.
    const allBudgets = root.descendants().map((n) => n.data.budget_cents);
    const maxBudget = Math.max(...allBudgets, 1);
    const allAwards = root.descendants().map((n) => n.data.award_count);
    const maxAwards = Math.max(...allAwards, 1);

    function radiusFor(node: d3.HierarchyNode<TreeDatum>): number {
      const base = compact ? 4 : 6;
      const maxR = compact ? 12 : 22;
      if (nodeSizeBy === "uniform") return base;
      if (nodeSizeBy === "employees") {
        // Use award_count as a proxy for "size" until employees data is wired up.
        const ratio = node.data.award_count / maxAwards;
        return base + Math.sqrt(Math.max(ratio, 0)) * (maxR - base);
      }
      // budget
      const ratio = node.data.budget_cents / maxBudget;
      return base + Math.sqrt(Math.max(ratio, 0)) * (maxR - base);
    }

    // Layout
    const margin = compact
      ? { top: 16, right: 90, bottom: 16, left: 90 }
      : { top: 24, right: 160, bottom: 24, left: 160 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const layout = d3
      .tree<TreeDatum>()
      .size(orientation === "horizontal" ? [innerH, innerW] : [innerW, innerH])
      .separation((a, b) => (a.parent === b.parent ? 1 : 1.4));
    layout(root);

    // d3.tree assigns x/y based on its 2D layout — translate into screen coords
    // depending on orientation.
    function projectX(n: d3.HierarchyPointNode<TreeDatum>): number {
      return orientation === "horizontal" ? n.y + margin.left : n.x + margin.left;
    }
    function projectY(n: d3.HierarchyPointNode<TreeDatum>): number {
      return orientation === "horizontal" ? n.x + margin.top : n.y + margin.top;
    }

    const g = d3.select(svg).append("g");

    // ── Links ────────────────────────────────────────────────────────────────
    const linkGen =
      orientation === "horizontal"
        ? d3
            .linkHorizontal<
              d3.HierarchyPointLink<TreeDatum>,
              d3.HierarchyPointNode<TreeDatum>
            >()
            .x((n) => projectX(n))
            .y((n) => projectY(n))
        : d3
            .linkVertical<
              d3.HierarchyPointLink<TreeDatum>,
              d3.HierarchyPointNode<TreeDatum>
            >()
            .x((n) => projectX(n))
            .y((n) => projectY(n));

    g.selectAll("path.link")
      .data(root.links() as d3.HierarchyPointLink<TreeDatum>[])
      .join("path")
      .attr("class", "link")
      .attr("fill", "none")
      .attr("stroke", "#475569")
      .attr("stroke-opacity", 0.5)
      .attr("stroke-width", 1)
      .attr("d", (d) => linkGen(d));

    // ── Nodes ────────────────────────────────────────────────────────────────
    const nodeG = g
      .selectAll("g.node")
      .data(root.descendants() as d3.HierarchyPointNode<TreeDatum>[])
      .join("g")
      .attr("class", "node")
      .attr("transform", (d) => `translate(${projectX(d)},${projectY(d)})`)
      .style("cursor", "pointer");

    nodeG
      .append("circle")
      .attr("r", (d) => radiusFor(d))
      .attr("fill", (d) => (d.data._children ? "#1e3a5f" : "#0f172a"))
      .attr("stroke", (d) => {
        if (d.data._children) return "#fbbf24";
        if (d.depth === 0) return "#a855f7";
        return "#3b82f6";
      })
      .attr("stroke-width", (d) => (d.depth === 0 ? 2 : 1.25))
      .on("mouseenter", function (event: MouseEvent, d) {
        d3.select(this).attr("stroke-width", 2.5);
        const rect = (containerRef.current ?? svg).getBoundingClientRect();
        showTip(
          agencyToGraphNode(d.data),
          event.clientX - rect.left,
          event.clientY - rect.top,
        );
      })
      .on("mousemove", function (event: MouseEvent, d) {
        const rect = (containerRef.current ?? svg).getBoundingClientRect();
        showTip(
          agencyToGraphNode(d.data),
          event.clientX - rect.left,
          event.clientY - rect.top,
        );
      })
      .on("mouseleave", function (_e, d) {
        d3.select(this).attr("stroke-width", d.depth === 0 ? 2 : 1.25);
        hideTip();
      })
      .on("click", (_event: MouseEvent, d) => {
        // Click toggles collapse for nodes with children, otherwise opens popup.
        const data = d.data;
        if (data.children && data.children.length > 0) {
          // Collapse
          data._children = data.children;
          data.children = undefined;
          render();
          return;
        }
        if (data._children && data._children.length > 0) {
          // Expand
          data.children = data._children;
          data._children = undefined;
          render();
          return;
        }
        if (!compact && data.id !== "root") {
          setPopup(agencyToGraphNode(data));
        }
      });

    // Labels
    if (showLabels) {
      const labelOffset = compact ? 8 : 12;
      nodeG
        .append("text")
        .attr("dy", "0.32em")
        .attr("x", (d) => {
          if (orientation === "horizontal") {
            return d.children ? -labelOffset : labelOffset;
          }
          return 0;
        })
        .attr("y", (d) => {
          if (orientation === "vertical") {
            return d.children ? -labelOffset - 6 : labelOffset + 6;
          }
          return 0;
        })
        .attr("text-anchor", (d) => {
          if (orientation === "horizontal") return d.children ? "end" : "start";
          return "middle";
        })
        .attr("font-size", compact ? 9 : 11)
        .attr("font-family", "system-ui, sans-serif")
        .attr("fill", "#e2e8f0")
        .attr("pointer-events", "none")
        .style("user-select", "none")
        .style("-webkit-user-select", "none")
        .text((d) => d.data.acronym ?? d.data.name);
    }

    // Pan & zoom
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.4, 3])
      .on("zoom", (event) => {
        g.attr("transform", event.transform.toString());
      });
    d3.select(svg).call(zoom).on("dblclick.zoom", null);
  }, [tree, orientation, nodeSizeBy, showLabels, compact, showTip, hideTip, svgRef]);

  // Render on data / option change + on resize
  useEffect(() => {
    render();
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(render);
    ro.observe(container);
    return () => ro.disconnect();
  }, [render]);

  const nodeActions: NodeActions = {
    recenter: () => {},
    openProfile: (id) => window.open(`/agencies/${id}`, "_blank"),
    addToComparison: () => {},
    expandNode: () => {},
  };

  // ── Header / states ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <div className="text-center">
          <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Loading agency hierarchy…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <p className="text-red-400 text-sm">Failed to load hierarchy: {error}</p>
      </div>
    );
  }

  if (!tree) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <p className="text-gray-500 text-sm">No agencies available.</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`relative overflow-hidden flex flex-col ${className}`}>
      {!compact && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
          <span className="text-xs text-gray-400 bg-gray-950/70 px-2 py-0.5 rounded-full">
            {tree.id === "root"
              ? "Federal Government"
              : tree.acronym
                ? `${tree.name} (${tree.acronym})`
                : tree.name}
            {totalBudget > 0 && tree.id === "root" && (
              <span className="ml-2 text-emerald-400 font-medium">
                {fmtMoney(totalBudget)} contracted
              </span>
            )}
          </span>
        </div>
      )}

      <svg id="hierarchy-svg" ref={svgRef} className="w-full flex-1" />

      <Tooltip
        node={tooltip.node}
        x={tooltip.x}
        y={tooltip.y}
        visible={tooltip.visible}
        containerWidth={containerRef.current?.clientWidth}
      />

      {!compact && (
        <NodePopup
          node={popup}
          onClose={() => setPopup(null)}
          actions={nodeActions}
          vizType="hierarchy"
        />
      )}

      {!compact && (
        <div className="absolute bottom-3 right-3 flex items-center gap-3 bg-gray-950/80 rounded-lg px-3 py-1.5">
          <span className="text-[10px] text-gray-500">
            Click node to {nodeSizeBy === "uniform" ? "open" : "expand/collapse"} · Color = depth
          </span>
        </div>
      )}
    </div>
  );
}
