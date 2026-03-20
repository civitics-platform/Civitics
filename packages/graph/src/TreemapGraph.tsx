"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as d3 from "d3";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TreemapOfficial {
  official_id: string;
  official_name: string;
  party: string;
  state: string;
  total_donated_cents: number;
}

// D3 hierarchy datum for internal nodes
interface GroupDatum {
  name: string;
  children?: GroupDatum[];
  value?: number;
  official?: TreemapOfficial;
}

// ── Party colors ──────────────────────────────────────────────────────────────

const PARTY_FILL: Record<string, string> = {
  democrat:    "#1e3a5f",  // deep blue
  republican:  "#5f1e1e",  // deep red
  independent: "#3b1e5f",  // deep purple
  nonpartisan: "#1e3040",  // dark slate
};

const PARTY_STROKE: Record<string, string> = {
  democrat:    "#3b82f6",
  republican:  "#ef4444",
  independent: "#a855f7",
  nonpartisan: "#64748b",
};

const PARTY_LABEL: Record<string, string> = {
  democrat:    "Democrat",
  republican:  "Republican",
  independent: "Independent",
  nonpartisan: "Nonpartisan",
};

// ── Lookup helpers (guarantee string return for D3 attr) ─────────────────────

function getFill(party: string): string { return PARTY_FILL[party] ?? "#1e3040"; }
function getStroke(party: string): string { return PARTY_STROKE[party] ?? "#64748b"; }
function getLabel(party: string): string { return PARTY_LABEL[party] ?? party; }

// ── TreemapGraph ──────────────────────────────────────────────────────────────

export interface TreemapGraphProps {
  className?: string;
}

export function TreemapGraph({ className = "" }: TreemapGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [officials, setOfficials] = useState<TreemapOfficial[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<TreemapOfficial | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  // ── Fetch data ──────────────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    fetch("/api/graph/treemap")
      .then((r) => r.json())
      .then((data: TreemapOfficial[] | { error: string }) => {
        if ("error" in data) throw new Error(data.error);
        setOfficials(data);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // ── Render treemap with D3 ──────────────────────────────────────────────────
  const render = useCallback(() => {
    const container = containerRef.current;
    const svg = svgRef.current;
    if (!container || !svg || officials.length === 0) return;

    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;

    // Build hierarchy: Root → Party → Official
    const grouped = d3.group(officials, (d) => d.party);
    const root: GroupDatum = {
      name: "root",
      children: Array.from(grouped, ([party, items]) => ({
        name: party,
        children: items.map((o) => ({
          name: o.official_name,
          value: o.total_donated_cents,
          official: o,
        })),
      })),
    };

    const hierarchy = d3
      .hierarchy<GroupDatum>(root)
      .sum((d) => d.value ?? 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    d3.treemap<GroupDatum>()
      .size([width, height])
      .paddingOuter(4)
      .paddingInner(1)
      .paddingTop(20)
      .tile(d3.treemapSquarify)(hierarchy);

    // Clear previous render
    d3.select(svg).selectAll("*").remove();
    d3.select(svg).attr("width", width).attr("height", height);

    const g = d3.select(svg).append("g");

    // Draw party group backgrounds (depth=1 nodes)
    const partyNodes = hierarchy.descendants().filter((d) => d.depth === 1);
    g.selectAll<SVGRectElement, d3.HierarchyRectangularNode<GroupDatum>>(".party-bg")
      .data(partyNodes as d3.HierarchyRectangularNode<GroupDatum>[])
      .join("rect")
      .attr("class", "party-bg")
      .attr("x", (d) => d.x0)
      .attr("y", (d) => d.y0)
      .attr("width", (d) => d.x1 - d.x0)
      .attr("height", (d) => d.y1 - d.y0)
      .attr("fill", (d) => getFill(d.data.name))
      .attr("rx", 3);

    // Party labels (top of each group)
    g.selectAll<SVGTextElement, d3.HierarchyRectangularNode<GroupDatum>>(".party-label")
      .data(partyNodes as d3.HierarchyRectangularNode<GroupDatum>[])
      .join("text")
      .attr("class", "party-label")
      .attr("x", (d) => d.x0 + 6)
      .attr("y", (d) => d.y0 + 14)
      .attr("fill", (d) => getStroke(d.data.name))
      .attr("font-size", 11)
      .attr("font-weight", "600")
      .attr("font-family", "system-ui, sans-serif")
      .text((d) => getLabel(d.data.name));

    // Draw official leaf cells
    const leafNodes = hierarchy.leaves() as d3.HierarchyRectangularNode<GroupDatum>[];
    const cell = g
      .selectAll<SVGGElement, d3.HierarchyRectangularNode<GroupDatum>>(".leaf")
      .data(leafNodes)
      .join("g")
      .attr("class", "leaf")
      .attr("transform", (d) => `translate(${d.x0},${d.y0})`)
      .style("cursor", "default");

    cell
      .append("rect")
      .attr("width", (d) => Math.max(0, d.x1 - d.x0 - 1))
      .attr("height", (d) => Math.max(0, d.y1 - d.y0 - 1))
      .attr("fill", (d) => getFill(d.data.official?.party ?? "nonpartisan"))
      .attr("stroke", (d) => getStroke(d.data.official?.party ?? "nonpartisan"))
      .attr("stroke-width", 0.5)
      .attr("rx", 2)
      .on("mouseenter", function (event: MouseEvent, d) {
        d3.select(this)
          .attr("stroke-width", 2)
          .attr("fill-opacity", 0.85);
        if (d.data.official) {
          setHovered(d.data.official);
          setTooltipPos({ x: event.clientX, y: event.clientY });
        }
      })
      .on("mousemove", function (event: MouseEvent) {
        setTooltipPos({ x: event.clientX, y: event.clientY });
      })
      .on("mouseleave", function () {
        d3.select(this).attr("stroke-width", 0.5).attr("fill-opacity", 1);
        setHovered(null);
      });

    // Official name labels — only show if cell is wide enough
    cell
      .append("text")
      .attr("x", 4)
      .attr("y", 13)
      .attr("font-size", (d) => {
        const w = d.x1 - d.x0;
        const h = d.y1 - d.y0;
        if (w < 40 || h < 20) return 0;
        return Math.min(11, Math.max(8, Math.sqrt(w * h) / 8));
      })
      .attr("fill", "#e2e8f0")
      .attr("font-family", "system-ui, sans-serif")
      .attr("pointer-events", "none")
      .text((d) => {
        const w = d.x1 - d.x0;
        if (w < 40) return "";
        const name = d.data.official?.official_name ?? d.data.name;
        // Truncate to fit approximate width
        const maxChars = Math.floor(w / 6);
        return name.length > maxChars ? name.slice(0, maxChars - 1) + "…" : name;
      });

    // Dollar label — only in large cells
    cell
      .append("text")
      .attr("x", 4)
      .attr("y", 26)
      .attr("font-size", 9)
      .attr("fill", "#94a3b8")
      .attr("font-family", "system-ui, sans-serif")
      .attr("pointer-events", "none")
      .text((d) => {
        const w = d.x1 - d.x0;
        const h = d.y1 - d.y0;
        if (w < 60 || h < 36) return "";
        const cents = d.data.official?.total_donated_cents ?? 0;
        return "$" + (cents / 100).toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });
      });
  }, [officials]);

  // Render on data change + resize
  useEffect(() => {
    render();
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(render);
    ro.observe(container);
    return () => ro.disconnect();
  }, [render]);

  if (loading) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <div className="text-center">
          <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Loading donation data…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <p className="text-red-400 text-sm">Failed to load treemap: {error}</p>
      </div>
    );
  }

  if (officials.length === 0) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <p className="text-gray-500 text-sm">No donation data available yet.</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`relative overflow-hidden ${className}`}>
      <svg ref={svgRef} className="w-full h-full" />

      {/* Tooltip */}
      {hovered && (
        <div
          className="fixed z-50 pointer-events-none bg-gray-900/95 border border-gray-700 rounded-lg px-3 py-2.5 shadow-xl text-xs"
          style={{
            left: tooltipPos.x + 14,
            top: tooltipPos.y - 10,
            transform: "translateY(-50%)",
          }}
        >
          <p className="font-semibold text-gray-200 mb-1">{hovered.official_name}</p>
          <p className="text-gray-400">
            <span
              className="inline-block w-2 h-2 rounded-full mr-1.5"
              style={{ backgroundColor: PARTY_STROKE[hovered.party] ?? "#94a3b8" }}
            />
            {PARTY_LABEL[hovered.party] ?? hovered.party}
            {hovered.state !== "Unknown" && ` · ${hovered.state}`}
          </p>
          <p className="text-green-400 mt-1 font-mono">
            ${(hovered.total_donated_cents / 100).toLocaleString()} received
          </p>
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-3 right-3 flex items-center gap-3 bg-gray-950/80 rounded-lg px-3 py-1.5">
        {Object.entries(PARTY_LABEL).map(([key, label]) => (
          <div key={key} className="flex items-center gap-1">
            <span
              className="w-2.5 h-2.5 rounded-sm"
              style={{ backgroundColor: PARTY_STROKE[key] }}
            />
            <span className="text-[10px] text-gray-400">{label}</span>
          </div>
        ))}
        <span className="text-[10px] text-gray-600 border-l border-gray-700 pl-3 ml-1">
          Size = donations received
        </span>
      </div>
    </div>
  );
}
