"use client";

import { useEffect, useState, useRef } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AgencyRow {
  id: string;
  name: string;
  acronym: string;
  total_cents: number;
  award_count: number;
}

interface SectorRow {
  sector: string;
  total_cents: number;
  award_count: number;
}

interface ChordData {
  agencies: AgencyRow[];
  sectors: SectorRow[];
  total_cents: number;
}

interface RecipientRow {
  entity_id: string;
  entity_name: string;
  industry: string;
  naics_code: string | null;
  total_cents: number;
  award_count: number;
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtMoney(cents: number): string {
  const d = cents / 100;
  if (d >= 1_000_000_000) return `$${(d / 1_000_000_000).toFixed(1)}B`;
  if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(1)}M`;
  if (d >= 1_000) return `$${(d / 1_000).toFixed(0)}K`;
  return `$${d.toFixed(0)}`;
}

// ── Mini bar component ────────────────────────────────────────────────────────

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="flex-1 h-2 rounded-full bg-gray-800 overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${Math.max(pct * 100, 1)}%`, backgroundColor: color }}
      />
    </div>
  );
}

// ── Empty / Loading states ─────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-gray-500">
      <svg className="w-12 h-12 mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
      <p className="text-sm font-medium">No contract data yet</p>
      <p className="text-xs mt-1 opacity-60">Run the USASpending pipeline to populate contract flows.</p>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-3 p-4">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="w-16 h-3 bg-gray-700 rounded" />
          <div className="flex-1 h-2 bg-gray-700 rounded" />
          <div className="w-12 h-3 bg-gray-700 rounded" />
        </div>
      ))}
    </div>
  );
}

// ── NAICS sector colors ───────────────────────────────────────────────────────

const SECTOR_COLORS: Record<string, string> = {
  'Manufacturing':          '#3b82f6',
  'Professional Services':  '#8b5cf6',
  'Information Technology': '#06b6d4',
  'Construction':           '#f59e0b',
  'Healthcare':             '#10b981',
  'Transportation':         '#f97316',
  'Finance':                '#6366f1',
  'Administrative Services':'#84cc16',
  'Government':             '#64748b',
  'Education':              '#ec4899',
  'Agriculture':            '#22c55e',
  'Wholesale Trade':        '#a78bfa',
  'Utilities':              '#fbbf24',
  'Other Services':         '#94a3b8',
  'Other':                  '#475569',
};

function sectorColor(sector: string): string {
  return SECTOR_COLORS[sector] ?? '#475569';
}

// ── Main component ────────────────────────────────────────────────────────────

export interface SpendingGraphProps {
  className?: string;
  svgRef?: React.RefObject<SVGSVGElement>;
}

export function SpendingGraph({ className = "" }: SpendingGraphProps) {
  const [chord, setChord]           = useState<ChordData | null>(null);
  const [recipients, setRecipients] = useState<RecipientRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.all([
      fetch("/api/graph/spending?type=chord").then(r => r.json()),
      fetch("/api/graph/spending?type=treemap&lim=20").then(r => r.json()),
    ])
      .then(([chordData, treemapData]) => {
        if (cancelled) return;
        setChord(chordData as ChordData);
        setRecipients((treemapData as RecipientRow[]).slice(0, 20));
      })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, []);

  const hasData = !loading && chord && (chord.agencies.length > 0 || recipients.length > 0);

  const topAgencies = chord?.agencies.slice(0, 8) ?? [];
  const topSectors  = chord?.sectors.slice(0, 8) ?? [];
  const maxAgency   = topAgencies[0]?.total_cents ?? 1;
  const maxSector   = topSectors[0]?.total_cents ?? 1;
  const maxRecipient = recipients[0]?.total_cents ?? 1;

  return (
    <div
      id="spending-panel"
      ref={panelRef}
      className={`flex flex-col h-full bg-gray-950 text-white overflow-auto ${className}`}
    >
      {/* Header */}
      <div className="shrink-0 px-6 py-4 border-b border-gray-800 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white">Government Contract Flows</h2>
          <p className="text-[11px] text-gray-400 mt-0.5">USASpending · procurement contracts &gt;$1M · current FY</p>
        </div>
        {chord && chord.total_cents > 0 && (
          <span className="text-lg font-bold text-emerald-400">{fmtMoney(chord.total_cents)}</span>
        )}
      </div>

      {loading && <Skeleton />}
      {!loading && !hasData && <EmptyState />}

      {hasData && (
        <div className="flex-1 overflow-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 divide-y lg:divide-y-0 lg:divide-x divide-gray-800">

            {/* ── Left: Agency breakdown + Sector breakdown ── */}
            <div className="p-5 space-y-6">

              {/* By Agency */}
              {topAgencies.length > 0 && (
                <section>
                  <h3 className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-3">
                    By Agency
                  </h3>
                  <div className="space-y-2">
                    {topAgencies.map(ag => (
                      <div key={ag.id} className="flex items-center gap-3">
                        <span className="text-[11px] text-gray-300 w-12 shrink-0 truncate" title={ag.name}>
                          {ag.acronym}
                        </span>
                        <Bar pct={ag.total_cents / maxAgency} color="#3b82f6" />
                        <span className="text-[11px] font-semibold text-white tabular-nums w-14 text-right shrink-0">
                          {fmtMoney(ag.total_cents)}
                        </span>
                        <span className="text-[10px] text-gray-500 w-10 text-right shrink-0 tabular-nums">
                          {ag.award_count.toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* By Sector */}
              {topSectors.length > 0 && (
                <section>
                  <h3 className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-3">
                    By Sector (NAICS)
                  </h3>
                  <div className="space-y-2">
                    {topSectors.map(sc => (
                      <div key={sc.sector} className="flex items-center gap-3">
                        <span className="text-[11px] text-gray-300 w-32 shrink-0 truncate" title={sc.sector}>
                          {sc.sector}
                        </span>
                        <Bar pct={sc.total_cents / maxSector} color={sectorColor(sc.sector)} />
                        <span className="text-[11px] font-semibold text-white tabular-nums w-14 text-right shrink-0">
                          {fmtMoney(sc.total_cents)}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>

            {/* ── Right: Top recipients ── */}
            <div className="p-5">
              <h3 className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-3">
                Top Recipients
              </h3>
              {recipients.length === 0 ? (
                <p className="text-xs text-gray-500">No recipient data yet.</p>
              ) : (
                <div className="space-y-2">
                  {recipients.map((r, i) => (
                    <div key={r.entity_id} className="flex items-center gap-3">
                      <span className="text-[10px] text-gray-600 w-4 shrink-0 tabular-nums">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-medium text-gray-200 truncate" title={r.entity_name}>
                          {r.entity_name}
                        </p>
                        {r.industry && r.industry !== 'Other' && (
                          <p className="text-[10px] text-gray-500">{r.industry}</p>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <span
                          className="inline-block w-24 h-1.5 rounded-full"
                          style={{
                            background: `linear-gradient(to right, ${sectorColor(r.industry)} ${Math.round((r.total_cents / maxRecipient) * 100)}%, #1f2937 0%)`,
                          }}
                        />
                      </div>
                      <span className="text-[11px] font-semibold text-white tabular-nums w-14 text-right shrink-0">
                        {fmtMoney(r.total_cents)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
