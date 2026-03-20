"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { ForceGraph } from "@civitics/graph";
import type { GraphNode, GraphEdge, EdgeType, VisualConfig, EntitySearchResult } from "@civitics/graph";
import { EDGE_COLORS, DEFAULT_VISUAL_CONFIG } from "@civitics/graph";
import { EntitySelector } from "@civitics/graph";
import { DepthControl } from "@civitics/graph";
import { FilterPills } from "@civitics/graph";
import { CustomizePanel } from "@civitics/graph";
import { SharePanel } from "./SharePanel";
import { ScreenshotPanel } from "./ScreenshotPanel";
import { GhostGraph } from "./GhostGraph";

// ── Industry keyword matching for donor filter ────────────────────────────

const INDUSTRY_FILTERS: { id: string; label: string; icon: string; keywords: string[] }[] = [
  { id: "pharma",      label: "Pharma",      icon: "💊", keywords: ["pharma", "drug", "medical", "health", "biotech", "pfizer", "merck", "ama"] },
  { id: "oil_gas",     label: "Oil & Gas",   icon: "🛢", keywords: ["oil", "gas", "energy", "petroleum", "exxon", "chevron", "koch", "pipeline"] },
  { id: "finance",     label: "Finance",     icon: "📈", keywords: ["bank", "financial", "investment", "securities", "goldman", "jpmorgan", "wells"] },
  { id: "tech",        label: "Tech",        icon: "💻", keywords: ["tech", "software", "google", "amazon", "meta", "apple", "microsoft"] },
  { id: "defense",     label: "Defense",     icon: "🛡", keywords: ["defense", "military", "lockheed", "boeing", "raytheon", "northrop"] },
  { id: "real_estate", label: "Real Estate", icon: "🏠", keywords: ["real estate", "realty", "housing", "property"] },
  { id: "labor",       label: "Labor",       icon: "👷", keywords: ["union", "workers", "seiu", "afscme", "teamsters", "afl"] },
  { id: "agriculture", label: "Agriculture", icon: "🌾", keywords: ["farm", "agri", "crop", "cattle", "dairy"] },
];

const FINANCIAL_NODE_TYPES = new Set(["pac", "individual", "corporation"]);

// ── Preset definitions ─────────────────────────────────────────────────────

type PresetId =
  | "follow_the_money"
  | "votes_and_bills"
  | "revolving_door"
  | "full_picture"
  | "clean_view";

interface Preset {
  label: string;
  edgeTypes: EdgeType[] | null;
  minStrength?: number;
  defaultDepth?: number;
  description: string;
}

const PRESETS: Record<PresetId, Preset> = {
  follow_the_money: {
    label: "Follow the Money",
    edgeTypes: ["donation"],
    defaultDepth: 1,  // Financial networks are dense; depth 1 shows who funds THIS official
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

// ── Depth filter utility ──────────────────────────────────────────────────

function filterEdgesByDepth(
  allEdges: GraphEdge[],
  centerId: string,
  maxDepth: number
): GraphEdge[] {
  if (maxDepth >= 5) return allEdges;
  const visited = new Set<string>([centerId]);
  let frontier = new Set<string>([centerId]);
  for (let hop = 0; hop < maxDepth; hop++) {
    const next = new Set<string>();
    for (const edge of allEdges) {
      if (frontier.has(edge.source) && !visited.has(edge.target)) {
        next.add(edge.target);
        visited.add(edge.target);
      }
      if (frontier.has(edge.target) && !visited.has(edge.source)) {
        next.add(edge.source);
        visited.add(edge.source);
      }
    }
    frontier = next;
    if (next.size === 0) break;
  }
  return allEdges.filter((e) => visited.has(e.source) && visited.has(e.target));
}

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

  // Preset state — kept for UI button highlighting and minStrength
  const [activePreset, setActivePreset] = useState<PresetId>(
    (initialState?.preset as PresetId | undefined) ?? "full_picture"
  );

  // New state for 4 new components
  const [centerEntity, setCenterEntity] = useState<{ id: string; type: string; label: string } | null>(null);
  const [depth, setDepth] = useState<number>(
    typeof initialState?.depth === "number" ? initialState.depth : 2
  );
  const [activeFilters, setActiveFilters] = useState<EdgeType[] | null>(
    (initialState?.activeFilters as EdgeType[] | null | undefined) ??
    (PRESETS[(initialState?.preset as PresetId | undefined) ?? "full_picture"].edgeTypes)
  );
  const [visualConfig, setVisualConfig] = useState<VisualConfig>(
    (initialState?.visualConfig as VisualConfig | undefined) ?? DEFAULT_VISUAL_CONFIG
  );
  const [minStrength, setMinStrength] = useState<number>(
    typeof initialState?.minStrength === "number" ? initialState.minStrength : 0
  );
  const [showCustomize, setShowCustomize] = useState(false);
  const [industryFilter, setIndustryFilter] = useState<string | null>(null);

  // Share / screenshot
  const [shareCode, setShareCode] = useState<string | null>(initialCode ?? null);
  const [showShare, setShowShare] = useState(false);
  const [showScreenshot, setShowScreenshot] = useState(false);

  const [expandingNodeId, setExpandingNodeId] = useState<string | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const lastFetchUrl = useRef<string | null>(null);
  const hasAutoFilteredRef = useRef(false);

  // ── Load data ──────────────────────────────────────────────────────────
  // Server handles depth 1 (direct only) vs depth 2+ (direct + one expansion).
  // Client-side BFS then filters further based on the selected depth.
  useEffect(() => {
    const serverDepth = centerEntity ? Math.min(depth, 2) : undefined;
    const url = centerEntity
      ? `/api/graph/connections?entityId=${encodeURIComponent(centerEntity.id)}&depth=${serverDepth}`
      : "/api/graph/connections";

    // Skip if same URL as last fetch (e.g. depth changed in global mode)
    if (url === lastFetchUrl.current) return;
    lastFetchUrl.current = url;

    setLoading(true);
    setError(null);
    fetch(url)
      .then((r) => r.json())
      .then((data: { nodes: GraphNode[]; edges: GraphEdge[]; count: number; error?: string }) => {
        if (data.error) throw new Error(data.error);
        hasAutoFilteredRef.current = false; // allow auto-filter to re-arm for new data
        setAllNodes(data.nodes);
        setAllEdges(data.edges);
        setCount(data.count);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [centerEntity, depth]);

  // ── Expand a collapsed node: fetch its connections and merge ──────────
  const handleExpandNode = useCallback(async (node: GraphNode) => {
    const entityId = node.metadata?.entityId as string | undefined;
    if (!entityId) return;
    setExpandingNodeId(entityId);
    try {
      const res = await fetch(`/api/graph/connections?entityId=${encodeURIComponent(entityId)}&depth=1`);
      const data = await res.json() as { nodes: GraphNode[]; edges: GraphEdge[]; count: number };
      // Merge nodes: add new ones, mark the expanded node as no longer collapsed
      setAllNodes((prev) => {
        const nodeMap = new Map(prev.map((n) => [n.id, n]));
        for (const n of data.nodes) {
          if (!nodeMap.has(n.id)) nodeMap.set(n.id, n);
        }
        // Remove collapsed flag from the expanded node
        for (const [nodeId, n] of nodeMap) {
          if (n.metadata?.entityId === entityId && n.metadata?.collapsed) {
            nodeMap.set(nodeId, {
              ...n,
              metadata: { ...n.metadata, collapsed: false, connectionCount: undefined },
            });
          }
        }
        return [...nodeMap.values()];
      });
      // Merge edges (dedup by id)
      setAllEdges((prev) => {
        const edgeMap = new Map(prev.map((e) => [e.id, e]));
        for (const e of data.edges) edgeMap.set(e.id, e);
        return [...edgeMap.values()];
      });
      // Update selectedNode if it was the expanded one
      setSelectedNode((prev) => {
        if (prev?.metadata?.entityId === entityId) {
          return { ...prev, metadata: { ...prev.metadata, collapsed: false, connectionCount: undefined } };
        }
        return prev;
      });
    } catch (err) {
      console.error("[expand node]", err);
    } finally {
      setExpandingNodeId(null);
    }
  }, []);

  // ── Search function for EntitySelector ────────────────────────────────
  const searchEntities = useCallback(async (query: string): Promise<EntitySearchResult[]> => {
    try {
      const res = await fetch(`/api/graph/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) return [];
      return res.json() as Promise<EntitySearchResult[]>;
    } catch {
      return [];
    }
  }, []);

  // ── Handle entity selection ────────────────────────────────────────────
  const handleEntitySelect = useCallback(
    (entity: { id: string; type: string; label: string }) => {
      if (!entity.id) {
        setCenterEntity(null);
        return;
      }
      setCenterEntity(entity);
      setSelectedNode(null);
    },
    []
  );

  // ── Handle preset change — updates preset UI, filters, strength, depth ─
  const handlePresetChange = useCallback((preset: PresetId) => {
    setActivePreset(preset);
    setActiveFilters(PRESETS[preset].edgeTypes);
    setMinStrength(PRESETS[preset].minStrength ?? 0);
    if (PRESETS[preset].defaultDepth !== undefined) {
      setDepth(PRESETS[preset].defaultDepth!);
    }
    setSelectedNode(null);
  }, []);

  // ── Compute filtered edges ────────────────────────────────────────────
  const filteredEdges = useMemo(() => {
    let edges = allEdges;

    // 1. Apply filter pills (activeFilters)
    if (activeFilters !== null) {
      const allowed = new Set<EdgeType>(activeFilters);
      edges = edges.filter((e) => allowed.has(e.type));
    }

    // 2. Apply strength slider (client-side, instant, no re-fetch)
    if (minStrength > 0) {
      edges = edges.filter((e) => e.strength >= minStrength);
    }

    // 3. Apply depth filter if centerEntity is set (client-side BFS)
    if (centerEntity) {
      const centerId = allNodes.find(
        (n) =>
          n.metadata?.entityId === centerEntity.id &&
          String(n.metadata?.entityType) === centerEntity.type
      )?.id ?? centerEntity.id;
      edges = filterEdgesByDepth(edges, centerId, depth);
    }

    // 4. Industry filter — only show donation edges from matching financial nodes
    if (industryFilter) {
      const industryDef = INDUSTRY_FILTERS.find((f) => f.id === industryFilter);
      if (industryDef) {
        const matchingNodeIds = new Set(
          allNodes
            .filter(
              (n) =>
                FINANCIAL_NODE_TYPES.has(n.type) &&
                industryDef.keywords.some((kw) => n.label.toLowerCase().includes(kw))
            )
            .map((n) => n.id)
        );
        edges = edges.filter(
          (e) =>
            e.type === "donation" &&
            (matchingNodeIds.has(e.source) || matchingNodeIds.has(e.target))
        );
      }
    }

    return edges;
  }, [allEdges, activeFilters, minStrength, centerEntity, allNodes, depth, industryFilter]);

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

  // ── Auto-filter safety net: prevent browser freeze at 1000+ nodes ────
  // Must be declared after filteredNodes (can't use it before its declaration).
  // Only fires once per graph load (ref prevents loop). Resets when new data loads.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (filteredNodes.length > 1000 && minStrength < 0.5 && !hasAutoFilteredRef.current) {
      hasAutoFilteredRef.current = true;
      setMinStrength(0.5);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredNodes.length]);

  const handleNodeClick = useCallback((node: GraphNode | null) => {
    setSelectedNode(node);
  }, []);

  const nodeEdges = selectedNode
    ? allEdges.filter(
        (e) => e.source === selectedNode.id || e.target === selectedNode.id
      )
    : [];

  // Determine if pills are in "custom" mode (diverged from preset)
  const presetTypes = PRESETS[activePreset].edgeTypes;
  const pillsMatchPreset =
    activeFilters === null
      ? presetTypes === null
      : presetTypes !== null &&
        activeFilters.length === presetTypes.length &&
        activeFilters.every((t) => presetTypes.includes(t));

  // Background color based on theme
  const bgClass =
    visualConfig.theme === "light"
      ? "bg-white text-gray-900"
      : visualConfig.theme === "print"
      ? "bg-white text-black"
      : "bg-gray-950 text-white";

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className={`flex flex-col h-screen overflow-hidden ${bgClass}`}>

      {/* ── EntitySelector ─────────────────────────────────────────── */}
      <div className="shrink-0">
        <EntitySelector
          selectedEntity={centerEntity}
          onSelect={handleEntitySelect}
          searchFn={searchEntities}
        />
      </div>

      {/* ── Toolbar ────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-5 py-2.5 border-b border-gray-800 shrink-0 gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <a href="/" className="text-gray-400 hover:text-white text-sm transition-colors shrink-0">
            ← Civitics
          </a>
          <span className="text-gray-700 shrink-0">|</span>
          <h1 className="text-sm font-semibold tracking-wide shrink-0">
            Connection Graph
          </h1>
          {!loading && (
            <span className="text-xs text-gray-500 truncate">
              {count} connections · {allNodes.length} entities
            </span>
          )}
          <span className="text-xs text-gray-700 font-mono hidden sm:inline shrink-0">
            v:{process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev"}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {shareCode && (
            <span className="text-xs text-indigo-400 font-mono border border-indigo-800 rounded px-2 py-1 hidden sm:inline">
              {shareCode}
            </span>
          )}

          <button
            onClick={() => { setShowShare(true); setShowScreenshot(false); setShowCustomize(false); }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-gray-800 hover:bg-gray-700 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
            Share
          </button>

          <button
            onClick={() => { setShowScreenshot(true); setShowShare(false); setShowCustomize(false); }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-gray-800 hover:bg-gray-700 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Screenshot
          </button>

          <div className="w-px h-5 bg-gray-700 mx-1" />

          <DepthControl depth={depth} onChange={setDepth} />

          <div className="w-px h-5 bg-gray-700 mx-1" />

          <button
            onClick={() => { setShowCustomize((v) => !v); setShowShare(false); setShowScreenshot(false); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors ${
              showCustomize ? "bg-indigo-700 text-white" : "bg-gray-800 hover:bg-gray-700 text-gray-300"
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
            Customize
          </button>
        </div>
      </header>

      {/* ── Preset bar ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 px-5 py-2 border-b border-gray-800 bg-gray-950 shrink-0 overflow-x-auto">
        {PRESET_ORDER.map((id) => {
          const preset = PRESETS[id];
          const active = activePreset === id && pillsMatchPreset;
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
        {!pillsMatchPreset && (
          <span className="text-xs text-indigo-400 border border-indigo-800 rounded-full px-2 py-0.5">
            Custom
          </span>
        )}
        <span className="ml-auto text-xs text-gray-600 whitespace-nowrap pr-1">
          {PRESETS[activePreset].description}
        </span>
      </div>

      {/* ── Depth warning ──────────────────────────────────────────── */}
      {centerEntity && depth >= 3 && (
        <div className="flex items-center gap-2 px-5 py-1.5 bg-amber-950/40 border-b border-amber-900/50 shrink-0">
          <svg className="w-3.5 h-3.5 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span className="text-xs text-amber-400">Large graph — may be slow at depth {depth}. Use the strength slider to focus on significant connections.</span>
        </div>
      )}

      {/* ── Filter pills ───────────────────────────────────────────── */}
      <FilterPills
        edges={allEdges}
        activeTypes={activeFilters}
        onChange={setActiveFilters}
      />

      {/* ── Industry donor filter ───────────────────────────────────── */}
      <div className="flex items-center gap-2 px-5 py-2 border-b border-gray-800 bg-gray-950 shrink-0 overflow-x-auto">
        <span className="text-[11px] text-gray-600 whitespace-nowrap shrink-0">Donor industry:</span>
        <button
          onClick={() => setIndustryFilter(null)}
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap transition-colors ${
            industryFilter === null
              ? "bg-gray-600 text-white"
              : "bg-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-700"
          }`}
        >
          All Industries
        </button>
        {INDUSTRY_FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setIndustryFilter(industryFilter === f.id ? null : f.id)}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap transition-colors ${
              industryFilter === f.id
                ? "bg-green-700 text-white"
                : "bg-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-700"
            }`}
          >
            <span>{f.icon}</span>
            {f.label}
          </button>
        ))}
        {industryFilter && (
          <span className="ml-2 text-[11px] text-amber-400 whitespace-nowrap shrink-0">
            Showing only {INDUSTRY_FILTERS.find((f) => f.id === industryFilter)?.label} donation connections
          </span>
        )}
      </div>

      {/* ── Strength filter slider ─────────────────────────────────── */}
      <div className="flex items-center gap-3 px-5 py-2 border-b border-gray-800 bg-gray-950 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-500 whitespace-nowrap">Min strength</span>
          <span
            className="text-gray-600 cursor-help"
            title={"Donations: 0.0–0.3 = under $10k · 0.3–0.5 = $10k–$100k · 0.5–0.7 = $100k–$500k · 0.7–1.0 = over $500k\nVotes: always 1.0 (certain)\nOversight: always 1.0 (certain)"}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </span>
        </div>
        <div className="flex items-center gap-2 flex-1 max-w-xs">
          <span className="text-xs text-gray-700 shrink-0">Weak</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={minStrength}
            onChange={(e) => setMinStrength(parseFloat(e.target.value))}
            className="flex-1 accent-indigo-500 cursor-pointer"
            style={{ height: "4px" }}
          />
          <span className="text-xs text-gray-700 shrink-0">Strong</span>
        </div>
        <div className="flex items-center gap-2 whitespace-nowrap">
          <span className="text-xs text-gray-400">
            {minStrength > 0
              ? `Showing connections ≥ ${minStrength.toFixed(2)}`
              : "Showing all connections"
            }
          </span>
          {minStrength > 0 && (
            <button
              onClick={() => setMinStrength(0)}
              className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
              title="Reset to show all"
            >
              ×
            </button>
          )}
        </div>
        {filteredEdges.length < allEdges.length && (
          <span className="text-xs text-gray-600 whitespace-nowrap ml-auto">
            {filteredEdges.length.toLocaleString()} / {allEdges.length.toLocaleString()}
          </span>
        )}
      </div>

      {/* ── Node count warnings ──────────────────────────────────────── */}
      {!loading && filteredNodes.length > 200 && (() => {
        const n = filteredNodes.length;
        const isCritical = n > 1000;
        const isHigh = n > 500;
        const bg = isCritical ? "bg-red-950/40 border-red-900/50" : isHigh ? "bg-orange-950/40 border-orange-900/50" : "bg-amber-950/40 border-amber-900/50";
        const textColor = isCritical ? "text-red-400" : isHigh ? "text-orange-400" : "text-amber-400";
        const msg = isCritical
          ? `Graph too large to render smoothly (${n.toLocaleString()} nodes) — increase strength filter above 0.5 or reduce depth to 1`
          : isHigh
          ? `Very large graph: ${n.toLocaleString()} nodes — may be slow`
          : `Large graph: ${n.toLocaleString()} nodes — consider increasing strength filter or reducing depth`;
        return (
          <div className={`flex items-center gap-2 px-5 py-1.5 border-b shrink-0 ${bg}`}>
            <svg className={`w-3.5 h-3.5 shrink-0 ${textColor}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className={`text-xs ${textColor}`}>{msg}</span>
            {isHigh && minStrength < 0.5 && (
              <button
                onClick={() => setMinStrength(0.5)}
                className={`ml-2 text-xs underline ${textColor}`}
              >
                Apply strength ≥ 0.5
              </button>
            )}
            {n > 500 && (
              <span className="ml-auto text-xs text-gray-600 hidden sm:inline">WebGL rendering in Phase 3</span>
            )}
          </div>
        );
      })()}

      {/* ── Main content ─────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Graph area */}
        <div className="flex-1 relative overflow-hidden" id="graph-container">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center z-10">
              <div className="text-center">
                <div className="w-10 h-10 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin mx-auto mb-4" />
                <p className="text-gray-500 text-sm">Loading connections…</p>
              </div>
            </div>
          )}

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

          {!loading && !error && allNodes.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
              <GhostGraph className="w-full h-full absolute inset-0 opacity-30" />
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
                  <a href="/officials" className="px-4 py-2 text-xs font-medium rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors">
                    View Officials →
                  </a>
                  <a href="/agencies" className="px-4 py-2 text-xs font-medium rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors">
                    View Agencies →
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* Default view hint — shown when graph is loaded but no entity is selected */}
          {!loading && !error && allNodes.length > 0 && !centerEntity && (
            <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
              <div className="bg-gray-900/80 backdrop-blur-sm border border-gray-700 rounded-lg px-4 py-2 text-center">
                <p className="text-xs text-gray-500">
                  Top 10 most connected officials ·{" "}
                  <span className="text-indigo-400">Select any official to explore their full network</span>
                </p>
              </div>
            </div>
          )}

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
            visualConfig={visualConfig}
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

            {/* Expand panel for collapsed nodes */}
            {selectedNode?.metadata?.collapsed === true && (() => {
              const connCount = Number(selectedNode.metadata.connectionCount ?? 0);
              const entityId = String(selectedNode.metadata.entityId ?? "");
              const isExpanding = expandingNodeId === entityId;
              return (
                <div className="mb-4 p-3 rounded-lg bg-orange-950/40 border border-orange-900/50">
                  <p className="text-xs text-orange-400 font-medium mb-1">
                    {connCount.toLocaleString()} connections not shown
                  </p>
                  <p className="text-xs text-gray-500 mb-3">
                    This node connects to many entities. Expanding may slow the graph.
                  </p>
                  <button
                    onClick={() => handleExpandNode(selectedNode)}
                    disabled={isExpanding}
                    className="w-full px-3 py-1.5 text-xs font-medium rounded bg-orange-900/60 hover:bg-orange-800/60 text-orange-300 hover:text-orange-200 transition-colors disabled:opacity-50"
                  >
                    {isExpanding
                      ? "Expanding…"
                      : connCount > 200
                      ? `Expand Anyway (${connCount.toLocaleString()} nodes)`
                      : `Expand (${connCount.toLocaleString()} connections)`}
                  </button>
                </div>
              );
            })()}

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
                edgeTypes: activeFilters,
                minStrength,
                nodeCount: filteredNodes.length,
                edgeCount: filteredEdges.length,
                centerEntityId: centerEntity?.id,
                centerEntityType: centerEntity?.type,
                depth,
                activeFilters,
                visualConfig: visualConfig as unknown as Record<string, unknown>,
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
        {showCustomize && (
          <div className="absolute top-4 right-4 z-20">
            <CustomizePanel
              config={visualConfig}
              onChange={setVisualConfig}
              onClose={() => setShowCustomize(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
