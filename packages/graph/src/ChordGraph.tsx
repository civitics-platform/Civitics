"use client";

import * as d3 from "d3";
import React, { useEffect, useRef, useState, useCallback } from "react";

interface ChordGroup {
  id: string;
  label: string;
  icon: string;
  color: string;
  kind: "donor" | "recipient";
}

export interface ChordGraphProps {
  className?: string;
}

const DONOR_GROUPS: ChordGroup[] = [
  { id: "pharma",      label: "Pharma",      icon: "💊", color: "#ec4899", kind: "donor" },
  { id: "oil_gas",     label: "Oil & Gas",   icon: "🛢",  color: "#f97316", kind: "donor" },
  { id: "finance",     label: "Finance",     icon: "📈", color: "#06b6d4", kind: "donor" },
  { id: "tech",        label: "Technology",  icon: "💻", color: "#6366f1", kind: "donor" },
  { id: "defense",     label: "Defense",     icon: "🛡",  color: "#64748b", kind: "donor" },
  { id: "real_estate", label: "Real Estate", icon: "🏠", color: "#a78bfa", kind: "donor" },
  { id: "labor",       label: "Labor",       icon: "👷", color: "#fbbf24", kind: "donor" },
  { id: "agriculture", label: "Agriculture", icon: "🌾", color: "#4ade80", kind: "donor" },
  { id: "other",       label: "Other",       icon: "⚙",  color: "#94a3b8", kind: "donor" },
];

const RECIPIENT_GROUPS: ChordGroup[] = [
  { id: "dem_senate",  label: "Dem Senators",  icon: "🔵", color: "#3b82f6", kind: "recipient" },
  { id: "rep_senate",  label: "Rep Senators",  icon: "🔴", color: "#ef4444", kind: "recipient" },
  { id: "dem_house",   label: "Dem Reps",      icon: "🔵", color: "#2563eb", kind: "recipient" },
  { id: "rep_house",   label: "Rep Reps",      icon: "🔴", color: "#dc2626", kind: "recipient" },
  { id: "independent", label: "Independent",   icon: "⚪", color: "#a855f7", kind: "recipient" },
];

const ALL_GROUPS = [...DONOR_GROUPS, ...RECIPIENT_GROUPS];

type Tooltip = { x: number; y: number; html: string } | null;

function formatDollars(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(0)}K`;
  return `$${dollars.toFixed(0)}`;
}

export function ChordGraph({ className = "" }: ChordGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [status, setStatus] = useState<"loading" | "empty" | "error" | "ok">("loading");
  const [tooltip, setTooltip] = useState<Tooltip>(null);

  const draw = useCallback((matrix: number[][], width: number, height: number) => {
    const svg = svgRef.current;
    if (!svg) return;

    d3.select(svg).selectAll("*").remove();

    const size = Math.min(width, height);
    const outerR = size / 2 - 80;
    const innerR = outerR - 24;

    const g = d3.select(svg)
      .attr("width", width)
      .attr("height", height)
      .append("g")
      .attr("transform", `translate(${width / 2},${height / 2})`);

    const chord = d3.chord()
      .padAngle(0.05)
      .sortSubgroups(d3.descending);

    const chords = chord(matrix);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arc = d3.arc<d3.ChordGroup>()
      .innerRadius(innerR)
      .outerRadius(outerR) as any;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ribbon = d3.ribbon<d3.Chord, d3.ChordSubgroup>()
      .radius(innerR) as any;

    // Draw group arcs
    const group = g.append("g")
      .selectAll("g")
      .data(chords.groups)
      .join("g");

    group.append("path")
      .attr("fill", (d) => ALL_GROUPS[d.index]?.color ?? "#6b7280")
      .attr("stroke", "#111827")
      .attr("stroke-width", 1)
      .attr("d", arc)
      .style("cursor", "pointer")
      .on("mouseover", (_event, d) => {
        const grp = ALL_GROUPS[d.index];
        const row = matrix[d.index];
        const total = row ? row.reduce((sum, v) => sum + v, 0) : 0;
        if (containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect();
          const angle = (d.startAngle + d.endAngle) / 2 - Math.PI / 2;
          const r = (innerR + outerR) / 2;
          const x = width / 2 + r * Math.cos(angle);
          const y = height / 2 + r * Math.sin(angle);
          setTooltip({
            x: x + rect.left,
            y: y + rect.top,
            html: `<strong>${grp?.icon ?? ""} ${grp?.label ?? `Group ${d.index}`}</strong><br/>${formatDollars(total)} total`,
          });
        }
        g.selectAll("path.ribbon")
          .style("opacity", (rd: unknown) => {
            const r = rd as d3.Chord;
            return r.source.index === d.index || r.target.index === d.index ? 0.9 : 0.1;
          });
      })
      .on("mouseout", () => {
        setTooltip(null);
        g.selectAll("path.ribbon").style("opacity", 0.7);
      });

    // Labels
    group.append("text")
      .each((d) => { (d as d3.ChordGroup & { angle: number }).angle = (d.startAngle + d.endAngle) / 2; })
      .attr("dy", "0.35em")
      .attr("transform", (d) => {
        const angle = (d.startAngle + d.endAngle) / 2;
        const rotate = (angle * 180) / Math.PI - 90;
        const flip = angle > Math.PI;
        return `rotate(${rotate}) translate(${outerR + 8},0)${flip ? " rotate(180)" : ""}`;
      })
      .attr("text-anchor", (d) => ((d.startAngle + d.endAngle) / 2 > Math.PI ? "end" : "start"))
      .attr("fill", "#9ca3af")
      .attr("font-size", "10px")
      .text((d) => {
        const grp = ALL_GROUPS[d.index];
        return grp ? `${grp.icon} ${grp.label}` : `Group ${d.index}`;
      });

    // Draw ribbons
    g.append("g")
      .attr("fill-opacity", 0.7)
      .selectAll("path")
      .data(chords)
      .join("path")
      .attr("class", "ribbon")
      .attr("d", ribbon)
      .attr("fill", (d) => ALL_GROUPS[d.source.index]?.color ?? "#6b7280")
      .attr("stroke", "#111827")
      .attr("stroke-width", 0.5)
      .style("cursor", "pointer")
      .on("mouseover", (_event, d) => {
        const src = ALL_GROUPS[d.source.index];
        const tgt = ALL_GROUPS[d.target.index];
        if (containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect();
          setTooltip({
            x: rect.left + width / 2,
            y: rect.top + height / 2,
            html: `<strong>${src?.label ?? "?"}</strong> → <strong>${tgt?.label ?? "?"}</strong><br/>${formatDollars(d.source.value)}`,
          });
        }
        g.selectAll("path.ribbon")
          .style("opacity", (rd: unknown) => rd === d ? 1 : 0.1);
      })
      .on("mouseout", () => {
        setTooltip(null);
        g.selectAll("path.ribbon").style("opacity", 0.7);
      });
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setStatus("loading");
      try {
        const res = await fetch("/api/graph/chord");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json() as { data?: unknown[]; groups?: unknown[]; matrix?: number[][]; error?: string };

        if (cancelled) return;

        if (json.error || !json.data || json.data.length === 0) {
          setStatus("empty");
          return;
        }

        // If the API returns a pre-built matrix, use it directly
        if (json.matrix && json.matrix.length > 0) {
          setStatus("ok");
          const container = containerRef.current;
          if (!container) return;
          const { width, height } = container.getBoundingClientRect();
          draw(json.matrix, width || 600, height || 500);
          return;
        }

        // Otherwise show empty state — data exists but needs processing
        setStatus("empty");
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    load();
    return () => { cancelled = true; };
  }, [draw]);

  // ResizeObserver
  useEffect(() => {
    if (status !== "ok") return;
    const container = containerRef.current;
    if (!container) return;

    const obs = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      // Re-fetch and re-draw on resize would re-trigger full load; just redraw with last matrix
      // For now, re-draw with a null-safe check
      if (svgRef.current) {
        const svg = d3.select(svgRef.current);
        svg.attr("width", width).attr("height", height);
      }
    });

    obs.observe(container);
    return () => obs.disconnect();
  }, [status]);

  return (
    <div ref={containerRef} className={`relative w-full h-full flex items-center justify-center ${className}`}>
      {status === "loading" && (
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
          <p className="text-gray-500 text-sm">Loading donation flows…</p>
        </div>
      )}

      {status === "error" && (
        <div className="text-center">
          <p className="text-red-400 text-sm">Failed to load chord data.</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-3 text-xs text-indigo-400 hover:underline"
          >
            Retry
          </button>
        </div>
      )}

      {status === "empty" && (
        <div className="text-center max-w-sm px-8 py-10 rounded-2xl bg-gray-900/80 border border-gray-800">
          <div className="w-10 h-10 mx-auto mb-4 rounded-full border border-gray-700 flex items-center justify-center">
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <p className="text-gray-300 text-sm font-medium">No donation flow data available.</p>
          <p className="text-gray-500 text-xs mt-2 leading-relaxed">
            Data is being processed. Industry-to-party donation flows will appear here once the pipeline completes.
          </p>
        </div>
      )}

      {status === "ok" && (
        <svg ref={svgRef} className="w-full h-full" />
      )}

      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 shadow-xl"
          style={{
            left: tooltip.x + 12,
            top: tooltip.y - 28,
            transform: "translateX(-50%)",
          }}
          dangerouslySetInnerHTML={{ __html: tooltip.html }}
        />
      )}
    </div>
  );
}
