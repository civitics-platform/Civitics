"use client";

import { useState, useCallback } from "react";
import { ForceGraph } from "@civitics/graph";
import type { GraphNode, GraphEdge } from "@civitics/graph";

// ── Placeholder data ──────────────────────────────────────────────────────────
// Story: CleanTech Industries PAC donated $450k to Sen. Vasquez, who voted YES
// on the Clean Energy Investment Act. Rep. Bellamy — a revolving-door hire from
// the fossil industry — voted NO, funded by the Fossil Fuels United PAC.
// Individual major donors visible at both ends. The cluster structure tells
// the story before you read a single label.

const NODES: GraphNode[] = [
  // ── Officials ──
  {
    id: "vasquez",
    type: "official",
    label: "Sen. Maria Vasquez",
    party: "democrat",
    metadata: {
      role: "U.S. Senator",
      state: "California",
      donorsOnRecord: 4821,
      promisesKept: 14,
      promisesMade: 22,
    },
  },
  {
    id: "bellamy",
    type: "official",
    label: "Rep. James Bellamy",
    party: "republican",
    metadata: {
      role: "U.S. Representative",
      state: "Florida · District 7",
      donorsOnRecord: 1892,
      promisesKept: 6,
      promisesMade: 18,
    },
  },

  // ── Governing bodies ──
  {
    id: "senate-energy",
    type: "governing_body",
    label: "Senate Energy Cmte.",
    metadata: { memberCount: 22, chair: "Sen. Vasquez" },
  },
  {
    id: "epa",
    type: "governing_body",
    label: "EPA",
    metadata: {
      fullName: "Environmental Protection Agency",
      annualBudgetB: 9.7,
      activeProposals: 14,
    },
  },

  // ── Proposal ──
  {
    id: "clean-energy-act",
    type: "proposal",
    label: "S. 2847",
    metadata: {
      fullTitle: "Clean Energy Investment and Grid Modernization Act",
      status: "In Committee",
      introduced: "Feb 14, 2026",
      amountB: 180,
      commentCount: 12841,
    },
  },

  // ── Corporations ──
  {
    id: "cleantech-corp",
    type: "corporation",
    label: "CleanTech Industries",
    metadata: {
      industry: "Renewable Energy",
      revenue2025B: 4.2,
      lobbyingSpend2025: 2100000,
      employees: 8400,
    },
  },
  {
    id: "meridian-energy",
    type: "corporation",
    label: "Meridian Energy Co.",
    metadata: {
      industry: "Natural Gas / Petroleum",
      revenue2025B: 18.7,
      lobbyingSpend2025: 9800000,
      employees: 22000,
    },
  },

  // ── PACs ──
  {
    id: "cleantech-pac",
    type: "pac",
    label: "CleanTech PAC",
    metadata: {
      fullName: "CleanTech Industries Political Action Committee",
      pacType: "Corporate PAC",
      totalDonations2026Cents: 89400000,
      registeredFEC: "C00812345",
    },
  },
  {
    id: "fossil-pac",
    type: "pac",
    label: "Fossil Fuels United PAC",
    metadata: {
      fullName: "Fossil Fuels United Super PAC",
      pacType: "Super PAC",
      totalDonations2026Cents: 182000000,
      registeredFEC: "C00198765",
    },
  },

  // ── Individual donors ──
  {
    id: "donor-chen",
    type: "individual",
    label: "Robert Chen",
    metadata: {
      occupation: "CEO, CleanTech Industries",
      totalGiven2026Cents: 33000000, // $330,000
      note: "CleanTech Industries CEO",
    },
  },
  {
    id: "donor-holt",
    type: "individual",
    label: "Sandra Holt",
    metadata: {
      occupation: "Partner, Greenfield Capital",
      totalGiven2026Cents: 11500000, // $115,000
      note: "Clean energy VC",
    },
  },
  {
    id: "donor-pryce",
    type: "individual",
    label: "William Pryce",
    metadata: {
      occupation: "Fmr. VP, Meridian Energy Co.",
      totalGiven2026Cents: 29400000, // $294,000
      note: "Former Meridian executive",
    },
  },
];

const EDGES: GraphEdge[] = [
  // ── PAC → official donations ──
  { id: "e1", source: "cleantech-pac", target: "vasquez", type: "donation", amountCents: 45000000, occurredAt: "2025-11-01", strength: 0.9 },
  { id: "e2", source: "fossil-pac", target: "bellamy", type: "donation", amountCents: 28000000, occurredAt: "2025-10-15", strength: 0.85 },

  // ── Individual → official donations ──
  { id: "e3", source: "donor-chen", target: "vasquez", type: "donation", amountCents: 33000000, occurredAt: "2025-09-20", strength: 0.8 },
  { id: "e4", source: "donor-holt", target: "vasquez", type: "donation", amountCents: 11500000, occurredAt: "2025-10-05", strength: 0.6 },
  { id: "e5", source: "donor-pryce", target: "bellamy", type: "donation", amountCents: 29400000, occurredAt: "2025-11-12", strength: 0.8 },

  // ── Votes ──
  { id: "e6", source: "vasquez", target: "clean-energy-act", type: "vote_yes", occurredAt: "2026-02-28", strength: 1 },
  { id: "e7", source: "bellamy", target: "clean-energy-act", type: "vote_no", occurredAt: "2026-02-28", strength: 1 },

  // ── Institutional oversight ──
  { id: "e8", source: "vasquez", target: "senate-energy", type: "oversight", strength: 0.8 },
  { id: "e9", source: "senate-energy", target: "epa", type: "oversight", strength: 0.6 },
  { id: "e10", source: "epa", target: "clean-energy-act", type: "oversight", strength: 0.5 },

  // ── Corporate → PAC funding ──
  { id: "e11", source: "cleantech-corp", target: "cleantech-pac", type: "co_sponsorship", strength: 0.9 },
  { id: "e12", source: "meridian-energy", target: "fossil-pac", type: "co_sponsorship", strength: 0.9 },

  // ── Revolving door ──
  { id: "e13", source: "bellamy", target: "meridian-energy", type: "revolving_door", occurredAt: "2019-06-01", strength: 0.95 },
  { id: "e14", source: "donor-pryce", target: "meridian-energy", type: "revolving_door", occurredAt: "2021-03-01", strength: 0.7 },
];

// ── Legend ────────────────────────────────────────────────────────────────────

const NODE_LEGEND = [
  { shape: "circle-solid", color: "#6366f1", label: "Official" },
  { shape: "rect",         color: "#94a3b8", label: "Committee / Agency" },
  { shape: "doc",          color: "#f59e0b", label: "Proposal / Bill" },
  { shape: "diamond",      color: "#16a34a", label: "Corporation" },
  { shape: "triangle",     color: "#ea580c", label: "PAC / Super PAC" },
  { shape: "circle-dash",  color: "#3b82f6", label: "Individual donor" },
] as const;

const EDGE_LEGEND = [
  { color: "#22c55e", dash: false, label: "Donation (width = $)" },
  { color: "#3b82f6", dash: false, label: "Vote yes" },
  { color: "#ef4444", dash: false, label: "Vote no" },
  { color: "#f97316", dash: false, label: "Revolving door" },
  { color: "#94a3b8", dash: false, label: "Oversight" },
  { color: "#a855f7", dash: true, label: "Appointment" },
] as const;

// ── Detail panel ──────────────────────────────────────────────────────────────

function DetailPanel({
  node,
  edges,
  nodes,
  onClose,
}: {
  node: GraphNode;
  edges: GraphEdge[];
  nodes: GraphNode[];
  onClose: () => void;
}) {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const connections = edges.filter(
    (e) => e.source === node.id || e.target === node.id
  );

  const PARTY_BG: Record<string, string> = {
    democrat: "bg-blue-100 text-blue-800",
    republican: "bg-red-100 text-red-800",
    independent: "bg-purple-100 text-purple-800",
  };

  const TYPE_LABEL: Record<GraphNode["type"], string> = {
    official: "Official",
    governing_body: "Committee / Agency",
    proposal: "Proposal",
    corporation: "Corporation",
    pac: "PAC",
    individual: "Individual Donor",
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-gray-100 p-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
              {TYPE_LABEL[node.type]}
            </span>
            {node.party && (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${PARTY_BG[node.party] ?? "bg-gray-100 text-gray-700"}`}
              >
                {node.party[0]?.toUpperCase()}
              </span>
            )}
          </div>
          <h2 className="mt-1.5 text-base font-semibold text-gray-900">{node.label}</h2>
          {node.metadata.role && (
            <p className="text-xs text-gray-500">{String(node.metadata.role)}</p>
          )}
          {node.metadata.state && (
            <p className="text-xs text-gray-500">{String(node.metadata.state)}</p>
          )}
          {node.metadata.fullTitle && (
            <p className="mt-1 text-xs text-gray-500 leading-relaxed">
              {String(node.metadata.fullTitle)}
            </p>
          )}
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          ✕
        </button>
      </div>

      {/* Stats */}
      {node.type === "official" && (
        <div className="grid grid-cols-3 gap-px border-b border-gray-100 bg-gray-100">
          {[
            { v: node.metadata.donorsOnRecord as number, l: "Donors" },
            { v: node.metadata.promisesKept as number, l: "Kept" },
            { v: node.metadata.promisesMade as number, l: "Promised" },
          ].map(({ v, l }) => (
            <div key={l} className="bg-white py-3 text-center">
              <p className="text-lg font-bold text-gray-900">{v?.toLocaleString()}</p>
              <p className="text-[10px] text-gray-400">{l}</p>
            </div>
          ))}
        </div>
      )}
      {(node.type === "pac" || node.type === "corporation") && node.metadata.totalDonations2026Cents && (
        <div className="grid grid-cols-2 gap-px border-b border-gray-100 bg-gray-100">
          <div className="bg-white py-3 text-center">
            <p className="text-lg font-bold text-orange-700">
              ${((node.metadata.totalDonations2026Cents as number) / 100).toLocaleString()}
            </p>
            <p className="text-[10px] text-gray-400">2026 donations</p>
          </div>
          {node.metadata.lobbyingSpend2025 && (
            <div className="bg-white py-3 text-center">
              <p className="text-lg font-bold text-gray-900">
                ${((node.metadata.lobbyingSpend2025 as number) / 100).toLocaleString()}
              </p>
              <p className="text-[10px] text-gray-400">2025 lobbying</p>
            </div>
          )}
        </div>
      )}
      {node.type === "individual" && node.metadata.totalGiven2026Cents && (
        <div className="border-b border-gray-100 p-4">
          <p className="text-xs text-gray-400">Total given in 2026 cycle</p>
          <p className="text-lg font-bold text-blue-700">
            ${((node.metadata.totalGiven2026Cents as number) / 100).toLocaleString()}
          </p>
          {node.metadata.occupation && (
            <p className="mt-1 text-xs text-gray-500">{String(node.metadata.occupation)}</p>
          )}
        </div>
      )}
      {node.type === "proposal" && node.metadata.amountB && (
        <div className="grid grid-cols-2 gap-px border-b border-gray-100 bg-gray-100">
          {[
            { v: `$${node.metadata.amountB as number}B`, l: "Authorized" },
            { v: (node.metadata.commentCount as number)?.toLocaleString(), l: "Comments" },
          ].map(({ v, l }) => (
            <div key={l} className="bg-white py-3 text-center">
              <p className="text-lg font-bold text-gray-900">{v}</p>
              <p className="text-[10px] text-gray-400">{l}</p>
            </div>
          ))}
        </div>
      )}

      {/* Connections */}
      <div className="flex-1 overflow-y-auto p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
          Connections ({connections.length})
        </p>
        <div className="flex flex-col gap-2">
          {connections.map((e) => {
            const isSource = e.source === node.id;
            const otherId = isSource ? e.target : e.source;
            const other = nodeById.get(otherId);
            const EDGE_COLORS_MAP: Record<string, string> = {
              donation: "#22c55e",
              vote_yes: "#3b82f6",
              vote_no: "#ef4444",
              revolving_door: "#f97316",
              oversight: "#94a3b8",
              co_sponsorship: "#06b6d4",
            };
            const color = EDGE_COLORS_MAP[e.type] ?? "#6b7280";
            return (
              <div
                key={e.id}
                className="flex items-start gap-2.5 rounded border border-gray-100 bg-gray-50 p-2.5"
              >
                <div
                  className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: color }}
                />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-gray-700">
                    {other?.label ?? otherId}
                  </p>
                  <p className="text-[10px] text-gray-400" style={{ color }}>
                    {e.type.replace(/_/g, " ")}
                    {e.amountCents
                      ? ` — $${(e.amountCents / 100).toLocaleString()}`
                      : ""}
                    {e.occurredAt ? ` · ${e.occurredAt}` : ""}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer actions */}
      <div className="border-t border-gray-100 p-3">
        <button
          disabled
          title="Available in Phase 2 with AI credits"
          className="w-full rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-400 cursor-not-allowed"
        >
          ✦ Explain what I'm seeing — Phase 2
        </button>
      </div>
    </div>
  );
}

// ── Legend pill ───────────────────────────────────────────────────────────────

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {NODE_LEGEND.map(({ shape, color, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            {shape === "circle-solid" && (
              <svg width="14" height="14">
                <circle cx="7" cy="7" r="5.5" fill="#f8fafc" stroke={color} strokeWidth="2" />
              </svg>
            )}
            {shape === "rect" && (
              <svg width="14" height="14">
                <rect x="1" y="3" width="12" height="8" rx="2" fill="#f1f5f9" stroke={color} strokeWidth="2" />
              </svg>
            )}
            {shape === "doc" && (
              <svg width="14" height="14">
                <rect x="1" y="1" width="11" height="12" rx="1" fill="#fffbeb" stroke={color} strokeWidth="2" />
              </svg>
            )}
            {shape === "diamond" && (
              <svg width="14" height="14">
                <path d="M7,1 L13,7 L7,13 L1,7 Z" fill="#f0fdf4" stroke={color} strokeWidth="2" />
              </svg>
            )}
            {shape === "triangle" && (
              <svg width="14" height="14">
                <path d="M7,1 L13,13 L1,13 Z" fill="#fff7ed" stroke={color} strokeWidth="2" />
              </svg>
            )}
            {shape === "circle-dash" && (
              <svg width="14" height="14">
                <circle cx="7" cy="7" r="5.5" fill="#eff6ff" stroke={color} strokeWidth="1.5" strokeDasharray="3,2" />
              </svg>
            )}
            <span className="text-xs text-gray-500">{label}</span>
          </div>
        ))}
      </div>
      <div className="h-3 w-px bg-gray-200" />
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {EDGE_LEGEND.map(({ color, dash, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <svg width="20" height="10">
              <line
                x1="0" y1="5" x2="20" y2="5"
                stroke={color}
                strokeWidth="2"
                strokeDasharray={dash ? "4,2" : undefined}
              />
            </svg>
            <span className="text-xs text-gray-500">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function GraphPage() {
  const [selected, setSelected] = useState<GraphNode | null>(null);

  const handleNodeClick = useCallback((node: GraphNode | null) => {
    setSelected(node);
  }, []);

  return (
    <div className="flex h-screen flex-col bg-gray-50 overflow-hidden">
      {/* Top bar */}
      <header className="shrink-0 border-b border-gray-200 bg-white px-5 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <a href="/" className="text-sm font-medium text-gray-400 hover:text-gray-700">
              ← Civitics
            </a>
            <span className="text-gray-200">/</span>
            <span className="text-sm font-semibold text-gray-900">Connection Graph</span>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
              Placeholder data
            </span>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-xs text-gray-400">
            <span>Drag to pan · Scroll to zoom · Click node for details</span>
          </div>
        </div>
        <div className="mt-2.5">
          <Legend />
        </div>
      </header>

      {/* Context bar */}
      <div className="shrink-0 border-b border-gray-100 bg-indigo-50 px-5 py-2.5">
        <p className="text-xs text-indigo-800">
          <span className="font-semibold">Investigation:</span> Clean Energy Investment Act
          S.2847 — who funded the yes votes, who funded the no votes, and who oversees
          implementation.{" "}
          <span className="text-indigo-500">
            Dense clusters = deep entanglement. Orange edges = revolving door.
          </span>
        </p>
      </div>

      {/* Graph + panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Graph canvas */}
        <div className="relative flex-1 overflow-hidden">
          <ForceGraph
            nodes={NODES}
            edges={EDGES}
            onNodeClick={handleNodeClick}
            className="h-full w-full"
          />
          {/* Empty state hint */}
          {!selected && (
            <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full border border-gray-200 bg-white px-4 py-2 text-xs text-gray-400 shadow-sm">
              Click any node to see its connections
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="w-72 shrink-0 overflow-hidden border-l border-gray-200 bg-white">
            <DetailPanel
              node={selected}
              edges={EDGES}
              nodes={NODES}
              onClose={() => setSelected(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
