"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { ForceGraph } from "@civitics/graph";
import type { GraphNode, GraphEdge, EdgeType } from "@civitics/graph";
import { EDGE_COLORS } from "@civitics/graph";
import { SharePanel } from "./SharePanel";
import { ScreenshotPanel } from "./ScreenshotPanel";
import { GhostGraph } from "./GhostGraph";

// ── Preset definitions ─────────────────────────────────────────────────────

type PresetId =
  | "follow_the_money"
  | "votes_and_bills"
  | "revolving_door"
  | "full_picture"
  | "clean_view";

interface Preset {
  label: string;
  edgeTypes: EdgeType[] | null; // null = all
  minStrength?: number;
  description: string;
}

const PRESETS: Record<PresetId, Preset> = {
  follow_the_money: {
    label: "Follow the Money",
    edgeTypes: ["donation"],
    description: "Who funds who and how much",
  },
  votes_and_bills: {
    label: "Votes & Bills",
    edgeTypes: ["vote_yes", "vote_no", "co_sponsorship"],
    description: "Legislative patterns and alliances",
  },
  revolving_door: {
    label: "The Revolving Door",
    edgeTypes: ["revolving_door", "appointment"],
    description: "Movement between government and industry",
  },
  full_picture: {
    label: "Full Picture",
    edgeTypes: null,
    description: "Every connection type visible",
  },
  clean_view: {
    label: "Clean View",
    edgeTypes: null,
    minStrength: 0.7,
    description: "High-confidence connections only",
  },
};

const PRESET_ORDER: PresetId[] = [
  "follow_the_money",
  "votes_and_bills",
  "revolving_door",
  "full_picture",
  "clean_view",
];

// ── GraphPage ──────────────────────────────────────────────────────────────

interface GraphPageProps {
  initialCode?: string;
  initialState?: Record<string, unknown>;
}

export function GraphPage({ initialCode, initialState }: GraphPageProps = {}) {
  const [allNodes, setAllNodes] = useState<GraphNode[]>([]);
  const [allEdges, setAllEdges] = useState<GraphEdge[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [activePreset, setActivePreset] = useState<PresetId>(
    (initialState?.preset as PresetId | undefined) ?? "full_picture"
  );
  const [shareCode, setShareCode] = useState<string | null>(initialCode ?? null);
  const [showShare, setShowShare] = useState(false);
  const [showScreenshot, setShowScreenshot] = useState(false);

  // Ref forwarded into ForceGraph so ScreenshotPanel can capture the SVG
  const svgRef = useRef<SVGSVGElement>(null);

  // ── Load data ──────────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/graph/connections")
      .then((r) => r.json())
      .then((data: { nodes: GraphNode[]; edges: GraphEdge[]; count: number; error?: string }) => {
        if (data.error) throw new Error(data.error);
        setAllNodes(data.nodes);
        setAllEdges(data.edges);
        setCount(data.count);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // ── Apply preset filter ────────────────────────────────────────────────
  const filteredEdges = (() => {
    const preset = PRESETS[activePreset];
    let edges = allEdges;
    if (preset.edgeTypes !== null) {
      const allowed = new Set<EdgeType>(preset.edgeTypes);
      edges = edges.filter((e) => allowed.has(e.type));
    }
    if (preset.minStrength !== undefined) {
      edges = edges.filter((e) => e.strength >= preset.minStrength!);
    }
    return edges;
  })();

  // Keep only nodes that appear in filtered edges
  const visibleNodeIds = new Set<string>();
  filteredEdges.forEach((e) => {
    visibleNodeIds.add(e.source);
    visibleNodeIds.add(e.target);
  });
  const filteredNodes =
    filteredEdges.length === allEdges.length
      ? allNodes
      : allNodes.filter((n) => visibleNodeIds.has(n.id));

  const handleNodeClick = useCallback((node: GraphNode | null) => {
    setSelectedNode(node);
  }, []);

  const handlePresetChange = useCallback((preset: PresetId) => {
    setActivePreset(preset);
    setSelectedNode(null);
  }, []);

  // ── Node detail panel ──────────────────────────────────────────────────
  const nodeEdges = selectedNode
    ? allEdges.filter(
        (e) => e.source === selectedNode.id || e.target === selectedNode.id
      )
    : [];

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white overflow-hidden">
      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-5 py-3 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-4">
          <a href="/" className="text-gray-400 hover:text-white text-sm transition-colors">
            ← Civitics
          </a>
          <span className="text-gray-700">|</span>
          <h1 className="text-sm font-semibold text-white tracking-wide">
            Connection Graph
          </h1>
          {!loading && count > 0 && (
            <span className="text-xs text-gray-500">
              {count} connections · {allNodes.length} entities
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {shareCode && (
            <span className="text-xs text-indigo-400 font-mono border border-indigo-800 rounded px-2 py-1">
              {shareCode}
            </span>
          )}
          <button
            onClick={() => { setShowShare(true); setShowScreenshot(false); }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-gray-800 hover:bg-gray-700 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
            Share
          </button>
          <button
            onClick={() => { setShowScreenshot(true); setShowShare(false); }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-gray-800 hover:bg-gray-700 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Screenshot
          </button>
        </div>
      </header>

      {/* ── Preset bar ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 px-5 py-2 border-b border-gray-800 bg-gray-950 shrink-0 overflow-x-auto">
        {PRESET_ORDER.map((id) => {
          const preset = PRESETS[id];
          const active = activePreset === id;
          return (
            <button
              key={id}
              onClick={() => handlePresetChange(id)}
              title={preset.description}
              className={`
                whitespace-nowrap px-3 py-1.5 text-xs font-medium rounded-full border transition-all
                ${active
                  ? "bg-indigo-600 border-indigo-500 text-white shadow-sm shadow-indigo-900"
                  : "bg-gray-900 border-gray-700 text-gray-400 hover:text-white hover:border-gray-500"
                }
              `}
            >
              {preset.label}
            </button>
          );
        })}
        <span className="ml-auto text-xs text-gray-600 whitespace-nowrap pr-1">
          {PRESETS[activePreset].description}
        </span>
      </div>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Graph area */}
        <div className="flex-1 relative overflow-hidden" id="graph-container">
          {/* Loading spinner */}
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center z-10">
              <div className="text-center">
                <div className="w-10 h-10 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin mx-auto mb-4" />
                <p className="text-gray-500 text-sm">Loading connections…</p>
              </div>
            </div>
          )}

          {/* API error */}
          {!loading && error && (
            <div className="absolute inset-0 flex items-center justify-center z-10">
              <div className="text-center">
                <p className="text-red-400 text-sm">Failed to load: {error}</p>
                <button
                  onClick={() => window.location.reload()}
                  className="mt-3 text-xs text-indigo-400 hover:underline"
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          {/* Empty state — pipeline not yet populated */}
          {!loading && !error && allNodes.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
              {/* Ghost graph placeholder */}
              <GhostGraph className="w-full h-full absolute inset-0 opacity-30" />
              {/* Message — sits on top of ghost graph */}
              <div className="relative z-10 text-center max-w-sm px-8 py-10 rounded-2xl bg-gray-950/80 backdrop-blur-sm border border-gray-800">
                <div className="w-10 h-10 mx-auto mb-4 rounded-full border border-gray-700 flex items-center justify-center">
                  <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <p className="text-gray-300 text-sm font-medium leading-relaxed">
                  Connections are being mapped
                </p>
                <p className="text-gray-500 text-xs mt-2 leading-relaxed">
                  Check back soon as we process donor, vote,
                  and relationship data from Congress, FEC,
                  and federal agencies.
                </p>
                <div className="flex gap-3 mt-6 justify-center">
                  <a
                    href="/officials"
                    className="px-4 py-2 text-xs font-medium rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors"
                  >
                    View Officials →
                  </a>
                  <a
                    href="/agencies"
                    className="px-4 py-2 text-xs font-medium rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors"
                  >
                    View Agencies →
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* Preset-filtered empty state — data exists but nothing matches filter */}
          {!loading && !error && allNodes.length > 0 && filteredEdges.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
              <div className="text-center">
                <p className="text-gray-500 text-sm">No connections match this filter.</p>
                <p className="text-gray-600 text-xs mt-1">Try a different preset view.</p>
              </div>
            </div>
          )}

          <ForceGraph
            ref={svgRef}
            nodes={filteredNodes}
            edges={filteredEdges}
            onNodeClick={handleNodeClick}
            className="w-full h-full"
          />
        </div>

        {/* Right panel: selected node detail */}
        {selectedNode && (
          <aside className="w-72 border-l border-gray-800 bg-gray-950 p-4 overflow-y-auto shrink-0">
            <div className="flex items-start justify-between mb-3">
              <h2 className="text-sm font-semibold text-white leading-snug">
                {selectedNode.label}
              </h2>
              <button
                onClick={() => setSelectedNode(null)}
                className="text-gray-500 hover:text-white ml-2 shrink-0"
              >
                ✕
              </button>
            </div>

            <div className="space-y-1 mb-4">
              <p className="text-xs text-gray-500 capitalize">
                {selectedNode.type.replace(/_/g, " ")}
                {selectedNode.party && (
                  <span
                    className={`ml-2 inline-block px-1.5 py-0.5 rounded text-xs font-medium ${
                      selectedNode.party === "democrat"
                        ? "bg-blue-900 text-blue-300"
                        : selectedNode.party === "republican"
                        ? "bg-red-900 text-red-300"
                        : "bg-purple-900 text-purple-300"
                    }`}
                  >
                    {selectedNode.party.charAt(0).toUpperCase()}
                  </span>
                )}
              </p>
            </div>

            {nodeEdges.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
                  Connections ({nodeEdges.length})
                </h3>
                <ul className="space-y-2">
                  {nodeEdges.slice(0, 15).map((edge) => {
                    const isSource = edge.source === selectedNode.id;
                    const otherId = isSource ? edge.target : edge.source;
                    const otherNode = allNodes.find((n) => n.id === otherId);
                    const color = EDGE_COLORS[edge.type] ?? "#6b7280";
                    return (
                      <li key={edge.id} className="flex items-start gap-2 text-xs">
                        <span
                          className="w-2 h-2 rounded-full mt-0.5 shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <div>
                          <span className="text-gray-300">
                            {edge.type.replace(/_/g, " ")}
                          </span>
                          {" → "}
                          <span className="text-gray-400">
                            {otherNode?.label ?? "Unknown"}
                          </span>
                          {edge.amountCents && (
                            <span className="text-green-400 ml-1">
                              ${(edge.amountCents / 100).toLocaleString()}
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </aside>
        )}

        {/* Floating panels */}
        {showShare && (
          <div className="absolute top-4 right-4 z-20">
            <SharePanel
              graphState={{
                preset: activePreset,
                edgeTypes: PRESETS[activePreset].edgeTypes,
                minStrength: PRESETS[activePreset].minStrength,
                nodeCount: filteredNodes.length,
                edgeCount: filteredEdges.length,
              }}
              onCodeGenerated={(code) => {
                setShareCode(code);
                setShowShare(false);
              }}
              onClose={() => setShowShare(false)}
            />
          </div>
        )}
        {showScreenshot && (
          <div className="absolute top-4 right-4 z-20">
            <ScreenshotPanel
              svgRef={svgRef}
              shareCode={shareCode}
              onClose={() => setShowScreenshot(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
