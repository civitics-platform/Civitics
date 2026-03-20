"use client";

import { useState, useEffect } from "react";
import { CollapsiblePanel } from "./CollapsiblePanel";
import type { EdgeType, VisualConfig, EntitySearchResult } from "./index";
import { FilterPills } from "./FilterPills";

// ── Industry filter config ────────────────────────────────────────────────────

const INDUSTRY_FILTERS: { id: string; label: string; keywords: string[] }[] = [
  { id: "pharma",      label: "Pharma",      keywords: ["pharma", "drug", "medical", "health", "biotech"] },
  { id: "oil_gas",     label: "Oil & Gas",   keywords: ["oil", "gas", "energy", "petroleum", "pipeline"] },
  { id: "finance",     label: "Finance",     keywords: ["bank", "financial", "investment", "securities"] },
  { id: "tech",        label: "Tech",        keywords: ["tech", "software", "google", "amazon", "meta", "apple"] },
  { id: "defense",     label: "Defense",     keywords: ["defense", "military", "lockheed", "boeing", "raytheon"] },
  { id: "labor",       label: "Labor",       keywords: ["union", "workers", "seiu", "teamsters", "afl"] },
  { id: "real_estate", label: "Real Estate", keywords: ["real estate", "realty", "housing"] },
  { id: "agriculture", label: "Agriculture", keywords: ["farm", "agri", "crop", "cattle"] },
];

// ── Preset config ─────────────────────────────────────────────────────────────

export type PresetId =
  | "follow_the_money"
  | "votes_and_bills"
  | "revolving_door"
  | "full_picture"
  | "clean_view";

interface Preset {
  label: string;
  description: string;
  edgeTypes: EdgeType[] | null;
  minStrength?: number;
  defaultDepth?: number;
}

export const PRESETS: Record<PresetId, Preset> = {
  follow_the_money: {
    label: "Follow the Money",
    description: "Who funds who and how much",
    edgeTypes: ["donation"],
    defaultDepth: 1,
  },
  votes_and_bills: {
    label: "Votes & Bills",
    description: "Legislative patterns and alliances",
    edgeTypes: ["vote_yes", "vote_no", "co_sponsorship"],
  },
  revolving_door: {
    label: "The Revolving Door",
    description: "Movement between government and industry",
    edgeTypes: ["revolving_door", "appointment"],
  },
  full_picture: {
    label: "Full Picture",
    description: "Every connection type visible",
    edgeTypes: null,
  },
  clean_view: {
    label: "Clean View",
    description: "High-confidence connections only",
    edgeTypes: null,
    minStrength: 0.7,
  },
};

export const PRESET_ORDER: PresetId[] = [
  "follow_the_money",
  "votes_and_bills",
  "revolving_door",
  "full_picture",
  "clean_view",
];

// ── Node size / color labels ──────────────────────────────────────────────────

const NODE_SIZE_LABELS: Record<VisualConfig["nodeSizeEncoding"], string> = {
  connection_count: "Connection count",
  donation_total:   "Donations received",
  votes_cast:       "Votes cast",
  bills_sponsored:  "Bills sponsored",
  years_in_office:  "Years in office",
  uniform:          "Uniform",
};

const NODE_COLOR_LABELS: Record<VisualConfig["nodeColorEncoding"], string> = {
  entity_type:       "Entity type",
  party_affiliation: "Party affiliation",
  industry_sector:   "Industry / sector",
  state_region:      "State / region",
  single_color:      "Single color",
};

const EDGE_THICKNESS_LABELS: Record<VisualConfig["edgeThicknessEncoding"], string> = {
  amount_proportional:   "Amount (default)",
  strength_proportional: "Strength",
  uniform:               "Uniform",
};

// ── Icons (inline SVG paths) ──────────────────────────────────────────────────

function Icon({ path, className = "w-4 h-4" }: { path: string; className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={path} />
    </svg>
  );
}

const ICONS = {
  visualization: "M4 6h16M4 10h16M4 14h16M4 18h16",
  focus:         "M3 10l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z",
  filters:       "M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z",
  appearance:    "M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4",
  presets:       "M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z",
  export:        "M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z",
  chevronRight:  "M9 5l7 7-7 7",
  chevronLeft:   "M15 19l-7-7 7-7",
};

// ── Props ─────────────────────────────────────────────────────────────────────

export interface GraphSidebarProps {
  // Visualization
  viewMode: "force" | "treemap";
  onViewModeChange: (mode: "force" | "treemap") => void;

  // Focus
  depth: number;
  onDepthChange: (d: number) => void;
  centerEntity: { id: string; type: string; label: string } | null;
  onEntitySelect: (entity: { id: string; type: string; label: string }) => void;
  searchFn: (query: string) => Promise<EntitySearchResult[]>;

  // Filters
  edges: import("./index").GraphEdge[];
  activeFilters: EdgeType[] | null;
  onFiltersChange: (types: EdgeType[] | null) => void;
  minStrength: number;
  onMinStrengthChange: (v: number) => void;
  industryFilter: string | null;
  onIndustryFilterChange: (id: string | null) => void;

  // Appearance
  visualConfig: VisualConfig;
  onVisualConfigChange: (c: VisualConfig) => void;

  // Presets
  activePreset: PresetId;
  onPresetChange: (p: PresetId) => void;

  // Export
  onShare: () => void;
  onScreenshot: () => void;
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

export function GraphSidebar(props: GraphSidebarProps) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("graph_sidebar_collapsed") === "true";
  });

  useEffect(() => {
    const saved = localStorage.getItem("graph_sidebar_collapsed");
    if (saved !== null) setCollapsed(saved === "true");
  }, []);

  function toggleSidebar() {
    setCollapsed((v) => {
      const next = !v;
      localStorage.setItem("graph_sidebar_collapsed", String(next));
      return next;
    });
  }

  return (
    <aside
      className={`
        shrink-0 bg-gray-950 border-r border-gray-800 flex flex-col overflow-hidden
        transition-all duration-200
        ${collapsed ? "w-12" : "w-[280px]"}
      `}
    >
      {/* Collapse toggle */}
      <button
        onClick={toggleSidebar}
        className="flex items-center justify-end px-2 py-2.5 border-b border-gray-800 hover:bg-gray-800/50 transition-colors"
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <Icon path={collapsed ? ICONS.chevronRight : ICONS.chevronLeft} className="w-4 h-4 text-gray-500" />
      </button>

      {collapsed ? (
        // Icon rail — vertical icons only
        <div className="flex flex-col items-center gap-3 py-3">
          {(["visualization", "focus", "filters", "appearance", "presets", "export"] as const).map((k) => (
            <button
              key={k}
              onClick={toggleSidebar}
              className="w-8 h-8 flex items-center justify-center rounded text-gray-600 hover:text-gray-300 hover:bg-gray-800 transition-colors"
              title={k.charAt(0).toUpperCase() + k.slice(1)}
            >
              <Icon path={ICONS[k]} className="w-4 h-4" />
            </button>
          ))}
        </div>
      ) : (
        // Full sidebar with collapsible panels
        <div className="overflow-y-auto flex-1">

          {/* ── Visualization ── */}
          <CollapsiblePanel
            id="visualization"
            label="Visualization"
            icon={<Icon path={ICONS.visualization} />}
            defaultOpen={true}
          >
            <div className="flex rounded-md overflow-hidden border border-gray-700 mt-1">
              {(["force", "treemap"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => props.onViewModeChange(m)}
                  className={`flex-1 py-1.5 text-xs font-medium capitalize transition-colors ${
                    props.viewMode === m
                      ? "bg-indigo-600 text-white"
                      : "bg-gray-800 text-gray-400 hover:text-white"
                  }`}
                >
                  {m === "force" ? "Force Graph" : "Treemap"}
                </button>
              ))}
            </div>
            {props.viewMode === "treemap" && (
              <p className="text-[11px] text-gray-500 mt-2 leading-relaxed">
                Officials by PAC donations received. Sized by total received, grouped by party → state.
              </p>
            )}
          </CollapsiblePanel>

          {/* ── Focus ── */}
          <CollapsiblePanel
            id="focus"
            label="Focus"
            icon={<Icon path={ICONS.focus} />}
            defaultOpen={true}
          >
            {/* Mini entity search */}
            <SidebarEntitySearch
              centerEntity={props.centerEntity}
              onSelect={props.onEntitySelect}
              searchFn={props.searchFn}
            />

            {/* Depth control */}
            <div className="mt-3">
              <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-1.5">Depth</p>
              <div className="flex items-center rounded-md overflow-hidden border border-gray-700">
                {[1, 2, 3, 4, 5].map((d) => (
                  <button
                    key={d}
                    onClick={() => props.onDepthChange(d)}
                    title={
                      d === 1 ? "Direct connections only"
                      : d === 2 ? "Friends of friends"
                      : d === 3 ? "Extended network"
                      : d === 4 ? "Deep connections"
                      : "Full network (slow)"
                    }
                    className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
                      d === props.depth
                        ? "bg-indigo-600 text-white"
                        : "bg-gray-800 text-gray-400 hover:text-white"
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
              {props.depth >= 4 && (
                <p className="text-[11px] text-amber-500 mt-1.5">Large graphs may load slowly</p>
              )}
            </div>
          </CollapsiblePanel>

          {/* ── Filters ── */}
          <CollapsiblePanel
            id="filters"
            label="Filters"
            icon={<Icon path={ICONS.filters} />}
            defaultOpen={true}
          >
            {/* Connection type pills */}
            <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-1.5">Connection type</p>
            <div className="flex flex-wrap gap-1">
              <FilterPills
                edges={props.edges}
                activeTypes={props.activeFilters}
                onChange={props.onFiltersChange}
                compact
              />
            </div>

            {/* Strength slider */}
            <div className="mt-3">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[11px] text-gray-500 uppercase tracking-wider">Min strength</p>
                <span className="text-[11px] text-gray-400 font-mono">
                  {props.minStrength > 0 ? props.minStrength.toFixed(2) : "All"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-700">Weak</span>
                <input
                  type="range" min="0" max="1" step="0.05"
                  value={props.minStrength}
                  onChange={(e) => props.onMinStrengthChange(parseFloat(e.target.value))}
                  className="flex-1 accent-indigo-500 cursor-pointer"
                  style={{ height: "4px" }}
                />
                <span className="text-[10px] text-gray-700">Strong</span>
              </div>
            </div>

            {/* Industry donor filter */}
            <div className="mt-3">
              <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-1.5">Donor industry</p>
              <div className="flex flex-wrap gap-1">
                <button
                  onClick={() => props.onIndustryFilterChange(null)}
                  className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                    props.industryFilter === null
                      ? "bg-gray-600 border-gray-500 text-white"
                      : "border-gray-700 text-gray-500 hover:text-gray-300"
                  }`}
                >
                  All
                </button>
                {INDUSTRY_FILTERS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => props.onIndustryFilterChange(props.industryFilter === f.id ? null : f.id)}
                    className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                      props.industryFilter === f.id
                        ? "bg-green-700 border-green-600 text-white"
                        : "border-gray-700 text-gray-500 hover:text-gray-300"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </CollapsiblePanel>

          {/* ── Appearance ── */}
          <CollapsiblePanel
            id="appearance"
            label="Appearance"
            icon={<Icon path={ICONS.appearance} />}
          >
            {/* Node size */}
            <SidebarSection label="Node size">
              <SidebarSelect
                value={props.visualConfig.nodeSizeEncoding}
                options={Object.entries(NODE_SIZE_LABELS) as [string, string][]}
                onChange={(v) => props.onVisualConfigChange({ ...props.visualConfig, nodeSizeEncoding: v as VisualConfig["nodeSizeEncoding"] })}
              />
            </SidebarSection>

            {/* Node color */}
            <SidebarSection label="Node color">
              <SidebarSelect
                value={props.visualConfig.nodeColorEncoding}
                options={Object.entries(NODE_COLOR_LABELS) as [string, string][]}
                onChange={(v) => props.onVisualConfigChange({ ...props.visualConfig, nodeColorEncoding: v as VisualConfig["nodeColorEncoding"] })}
              />
              {props.visualConfig.nodeColorEncoding === "single_color" && (
                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="color"
                    value={props.visualConfig.singleColor}
                    onChange={(e) => props.onVisualConfigChange({ ...props.visualConfig, singleColor: e.target.value })}
                    className="w-7 h-7 rounded border border-gray-700 cursor-pointer bg-transparent"
                  />
                  <span className="text-[11px] text-gray-400 font-mono">{props.visualConfig.singleColor}</span>
                </div>
              )}
            </SidebarSection>

            {/* Edge thickness */}
            <SidebarSection label="Edge thickness">
              <SidebarSelect
                value={props.visualConfig.edgeThicknessEncoding}
                options={Object.entries(EDGE_THICKNESS_LABELS) as [string, string][]}
                onChange={(v) => props.onVisualConfigChange({ ...props.visualConfig, edgeThicknessEncoding: v as VisualConfig["edgeThicknessEncoding"] })}
              />
            </SidebarSection>

            {/* Edge opacity */}
            <SidebarSection label="Edge opacity">
              <div className="flex items-center gap-2">
                <input
                  type="range" min="0" max="1" step="0.05"
                  value={props.visualConfig.edgeOpacity}
                  onChange={(e) => props.onVisualConfigChange({ ...props.visualConfig, edgeOpacity: parseFloat(e.target.value) })}
                  className="flex-1 accent-indigo-500"
                  style={{ height: "4px" }}
                />
                <span className="text-[11px] text-gray-400 font-mono w-8 text-right">
                  {Math.round(props.visualConfig.edgeOpacity * 100)}%
                </span>
              </div>
            </SidebarSection>

            {/* Theme */}
            <SidebarSection label="Theme">
              <div className="flex rounded-md overflow-hidden border border-gray-700">
                {(["dark", "light", "print"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => props.onVisualConfigChange({ ...props.visualConfig, theme: v })}
                    className={`flex-1 py-1 text-[11px] font-medium capitalize transition-colors ${
                      props.visualConfig.theme === v
                        ? "bg-indigo-600 text-white"
                        : "bg-gray-800 text-gray-400 hover:text-white"
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </SidebarSection>

            <button
              onClick={() => props.onVisualConfigChange({
                nodeSizeEncoding: "connection_count",
                nodeColorEncoding: "entity_type",
                singleColor: "#3b82f6",
                edgeThicknessEncoding: "amount_proportional",
                edgeOpacity: 0.7,
                layout: "force",
                theme: "dark",
              })}
              className="mt-2 w-full py-1.5 text-[11px] rounded bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
            >
              Reset to defaults
            </button>
          </CollapsiblePanel>

          {/* ── Presets ── */}
          <CollapsiblePanel
            id="presets"
            label="Presets"
            icon={<Icon path={ICONS.presets} />}
            defaultOpen={true}
          >
            <div className="flex flex-col gap-1">
              {PRESET_ORDER.map((id) => {
                const preset = PRESETS[id];
                const active = props.activePreset === id;
                return (
                  <button
                    key={id}
                    onClick={() => props.onPresetChange(id)}
                    title={preset.description}
                    className={`w-full text-left px-2.5 py-2 rounded text-xs font-medium transition-colors ${
                      active
                        ? "bg-indigo-600 text-white"
                        : "bg-gray-800/50 text-gray-400 hover:text-white hover:bg-gray-800"
                    }`}
                  >
                    {preset.label}
                    {active && (
                      <span className="block text-[10px] font-normal text-indigo-300 mt-0.5">
                        {preset.description}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </CollapsiblePanel>

          {/* ── Export ── */}
          <CollapsiblePanel
            id="export"
            label="Export"
            icon={<Icon path={ICONS.export} />}
          >
            <div className="flex flex-col gap-2">
              <button
                onClick={props.onShare}
                className="w-full flex items-center gap-2 px-3 py-2 rounded text-xs font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors"
              >
                <Icon path="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" className="w-3.5 h-3.5 shrink-0" />
                Share / Get link
              </button>
              <button
                onClick={props.onScreenshot}
                className="w-full flex items-center gap-2 px-3 py-2 rounded text-xs font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors"
              >
                <Icon path="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" className="w-3.5 h-3.5 shrink-0" />
                Screenshot / Export
              </button>
            </div>
          </CollapsiblePanel>

        </div>
      )}
    </aside>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SidebarSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2.5">
      <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      {children}
    </div>
  );
}

function SidebarSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-gray-800 border border-gray-700 rounded text-xs text-gray-300 px-2 py-1.5 focus:outline-none focus:border-indigo-500"
    >
      {options.map(([v, label]) => (
        <option key={v} value={v}>{label}</option>
      ))}
    </select>
  );
}

/** Compact inline entity search for the sidebar Focus panel */
function SidebarEntitySearch({
  centerEntity,
  onSelect,
  searchFn,
}: {
  centerEntity: { id: string; type: string; label: string } | null;
  onSelect: (e: { id: string; type: string; label: string }) => void;
  searchFn: (q: string) => Promise<EntitySearchResult[]>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EntitySearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query.trim()) { setResults([]); setOpen(false); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await searchFn(query);
        setResults(r);
        setOpen(r.length > 0);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query, searchFn]);

  function handleSelect(r: EntitySearchResult) {
    onSelect({ id: r.id, type: r.type, label: r.label });
    setQuery("");
    setOpen(false);
  }

  const partyColor: Record<string, string> = {
    democrat: "#3b82f6",
    republican: "#ef4444",
    independent: "#a855f7",
  };

  return (
    <div className="relative">
      {centerEntity && !query && (
        <div className="flex items-center gap-1.5 mb-2">
          <span className="text-[11px] text-indigo-400 truncate flex-1">{centerEntity.label}</span>
          <button
            onClick={() => onSelect({ id: "", type: "", label: "" })}
            className="text-gray-600 hover:text-gray-400 text-xs shrink-0"
            title="Clear"
          >
            ✕
          </button>
        </div>
      )}
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search entities…"
          className="w-full px-2 py-1.5 text-xs bg-gray-800 border border-gray-700 rounded text-gray-300 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
        />
        {loading && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border border-gray-500 border-t-transparent animate-spin" />
        )}
      </div>

      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-50 bg-gray-900 border border-gray-700 rounded-b shadow-xl max-h-52 overflow-y-auto">
          {results.map((r) => (
            <button
              key={r.id}
              onMouseDown={(e) => { e.preventDefault(); handleSelect(r); }}
              className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-xs hover:bg-gray-800 transition-colors text-left"
            >
              {r.party ? (
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: partyColor[r.party.toLowerCase()] ?? "#94a3b8" }}
                />
              ) : (
                <span className="w-1.5 h-1.5 rounded-sm shrink-0 bg-gray-600" />
              )}
              <span className="text-gray-300 truncate flex-1">{r.label}</span>
              {r.subtitle && <span className="text-gray-600 truncate">{r.subtitle}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
