"use client";

/**
 * packages/graph/src/components/GraphConfigPanel.tsx
 *
 * Right panel — 220px wide, full height, collapsed by default to 40px icon strip.
 * Hosts: viz type picker, presets, type-specific settings, display options.
 *
 * Keyboard shortcut: ] toggles right panel (managed by GraphPage)
 */

import type { GraphView, VizType } from '../types';
import type { UseGraphViewReturn } from '../hooks/useGraphView';
import type { GraphMeta } from '../hooks/useGraphData';
import { VIZ_REGISTRY } from '../visualizations/registry';
import { BUILT_IN_PRESETS } from '../presets';
import { TreeNode, TreeSection } from './TreeNode';

export interface GraphConfigPanelProps {
  view: GraphView;
  hooks: UseGraphViewReturn;
  collapsed: boolean;
  onCollapse: () => void;
  onSavePreset: () => void;
  /** Optional: derived from loaded graph data. Used to self-configure visible options. */
  graphMeta?: GraphMeta;
}

// Emoji for each preset
const PRESET_EMOJI: Record<string, string> = {
  'follow-the-money': '💰',
  'votes-and-bills':  '🗳',
  'nominations':      '⭐',
  'committee-power':  '👁',
  'full-record':      '📋',
  'clean-view':       '✨',
};

// Standard viz types from registry
const STD_VIZ   = VIZ_REGISTRY.filter(v => v.group === 'standard');
const COMING_VIZ = VIZ_REGISTRY.filter(v => v.group === 'coming_soon');

// ── Sliders ────────────────────────────────────────────────────────────────────

function LabeledSlider({
  label, min, max, step, value, onChange,
}: {
  label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-1">
      <span className="text-[10px] text-gray-500 w-20 shrink-0">{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="flex-1 h-1 accent-indigo-500"
      />
    </div>
  );
}

function LabeledSelect({
  label, value, options, onChange,
}: {
  label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-1">
      <span className="text-[10px] text-gray-500 w-20 shrink-0">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="flex-1 text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white focus:outline-none focus:border-indigo-400"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function LabeledToggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between px-3 py-1">
      <span className="text-[10px] text-gray-500">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] text-gray-400">{value ? 'On' : 'Off'}</span>
        <button
          onClick={() => onChange(!value)}
          className={`w-7 h-4 rounded-full transition-colors relative ${value ? 'bg-indigo-500' : 'bg-gray-300'}`}
        >
          <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
        </button>
      </div>
    </div>
  );
}

// ── Vote/donation count helpers (shared across settings panels) ────────────────

const VOTE_EDGE_TYPES = ['vote_yes', 'vote_no', 'vote_abstain', 'nomination_vote_yes', 'nomination_vote_no'];

function voteCountFrom(graphMeta?: GraphMeta): number {
  if (!graphMeta) return 0;
  return VOTE_EDGE_TYPES.reduce((s, t) => s + (graphMeta.connectionTypes[t]?.count ?? 0), 0);
}

function donationCountFrom(graphMeta?: GraphMeta): number {
  return graphMeta?.connectionTypes['donation']?.count ?? 0;
}

// ── Force settings ─────────────────────────────────────────────────────────────

function ForceSettings({ view, hooks, graphMeta }: { view: GraphView; hooks: UseGraphViewReturn; graphMeta?: GraphMeta }) {
  const opts = view.style.vizOptions.force;
  function set(key: string, value: unknown) { hooks.setVizOption('force', key, value); }

  const voteCount     = voteCountFrom(graphMeta);
  const donationCount = donationCountFrom(graphMeta);

  const nodeSizeOptions = [
    { value: 'connection_count', label: 'Connections',                                                     available: true },
    { value: 'donation_total',   label: donationCount > 0 ? `Donations (${donationCount})` : 'Donations',  available: graphMeta?.hasDonations ?? true },
    { value: 'bills_sponsored',  label: voteCount > 0     ? `Bills (${voteCount})`         : 'Bills',      available: graphMeta?.hasVotes ?? true },
    { value: 'years_in_office',  label: 'Seniority',                                                       available: true },
    { value: 'uniform',          label: 'Uniform',                                                         available: true },
  ].filter(o => o.available);

  // If the current encoding is no longer available (e.g. graph switched to PAC focus), reset to default
  const sizeEncoding = opts?.nodeSizeEncoding ?? 'connection_count';
  const validSizeEncoding = nodeSizeOptions.some(o => o.value === sizeEncoding)
    ? sizeEncoding
    : 'connection_count';

  return (
    <>
      <LabeledSelect
        label="Layout"
        value={opts?.layout ?? 'force_directed'}
        options={[
          { value: 'force_directed', label: 'Force directed' },
          { value: 'radial',         label: 'Radial'         },
          { value: 'hierarchical',   label: 'Hierarchical'   },
          { value: 'circular',       label: 'Circular'       },
        ]}
        onChange={v => set('layout', v)}
      />
      <LabeledSelect
        label="Node size"
        value={validSizeEncoding}
        options={nodeSizeOptions}
        onChange={v => set('nodeSizeEncoding', v)}
      />
      <LabeledSelect
        label="Color by"
        value={opts?.nodeColorEncoding ?? 'entity_type'}
        options={[
          { value: 'entity_type',      label: 'Entity type' },
          { value: 'party_affiliation', label: 'Party'      },
          { value: 'industry_sector',  label: 'Industry'    },
          { value: 'state_region',     label: 'State'       },
        ]}
        onChange={v => set('nodeColorEncoding', v)}
      />
      <LabeledSlider label="Edge opacity" min={0} max={1} step={0.05} value={opts?.edgeOpacity ?? 0.7} onChange={v => set('edgeOpacity', v)} />
      <LabeledSelect
        label="Labels"
        value={opts?.labels ?? 'hover'}
        options={[
          { value: 'always', label: 'Always' },
          { value: 'hover',  label: 'Hover'  },
          { value: 'never',  label: 'Never'  },
        ]}
        onChange={v => set('labels', v)}
      />
      <div className="px-3 pt-1 pb-0.5 text-[9px] font-semibold text-gray-400 uppercase tracking-wide">Physics</div>
      <LabeledSlider label="Charge" min={-1000} max={-50} step={50} value={opts?.charge ?? -300} onChange={v => set('charge', v)} />
      <LabeledSlider label="Link dist" min={50} max={500} step={10} value={opts?.linkDistance ?? 150} onChange={v => set('linkDistance', v)} />
      <LabeledSlider label="Gravity" min={0} max={1} step={0.05} value={opts?.gravity ?? 0.1} onChange={v => set('gravity', v)} />
    </>
  );
}

// ── Chord settings ─────────────────────────────────────────────────────────────

function ChordSettings({ view, hooks, graphMeta }: { view: GraphView; hooks: UseGraphViewReturn; graphMeta?: GraphMeta }) {
  const opts = view.style.vizOptions.chord;
  function set(key: string, value: unknown) { hooks.setVizOption('chord', key, value); }

  // Chord diagram only shows meaningful data when donation connections are present.
  // When graphMeta is loaded and confirms no donations, show a note instead of useless controls.
  const noDonations = graphMeta !== undefined && !graphMeta.hasDonations;

  if (noDonations) {
    return (
      <div className="px-3 py-2 text-[10px] text-gray-400 italic">
        No donation data in this graph — chord diagram will be empty.
      </div>
    );
  }

  return (
    <>
      <LabeledToggle label="Normalize" value={opts?.normalizeMode ?? false} onChange={v => set('normalizeMode', v)} />
      <LabeledToggle label="Show labels" value={opts?.showLabels ?? true} onChange={v => set('showLabels', v)} />
      <LabeledSelect
        label="Min flow"
        value={String(opts?.minFlowUsd ?? 0)}
        options={[
          { value: '0',        label: 'Show all' },
          { value: '100000',   label: '$100K+'   },
          { value: '1000000',  label: '$1M+'     },
          { value: '10000000', label: '$10M+'    },
        ]}
        onChange={v => set('minFlowUsd', parseInt(v))}
      />
    </>
  );
}

// ── Treemap settings ───────────────────────────────────────────────────────────

function TreemapSettings({ view, hooks, graphMeta }: { view: GraphView; hooks: UseGraphViewReturn; graphMeta?: GraphMeta }) {
  const opts = view.style.vizOptions.treemap;
  function set(key: string, value: unknown) { hooks.setVizOption('treemap', key, value); }

  // Auto-default to PAC sector view when a PAC group is focused
  const defaultDataMode = (graphMeta?.isPacFocus ?? false) ? 'pac_sector' : 'officials';
  const dataMode = opts?.dataMode ?? defaultDataMode;
  const isPacMode = dataMode === 'pac_sector' || dataMode === 'pac_party';

  // Filter size options by available data
  const voteCount     = voteCountFrom(graphMeta);
  const donationCount = donationCountFrom(graphMeta);

  const sizeByOptions = [
    { value: 'donation_total',   label: donationCount > 0 ? `Donations (${donationCount})` : 'Donations',  available: graphMeta?.hasDonations ?? true },
    { value: 'connection_count', label: 'Connections',                                                       available: true },
    { value: 'vote_count',       label: voteCount > 0     ? `Votes cast (${voteCount})`    : 'Votes cast',  available: graphMeta?.hasVotes ?? true },
  ].filter(o => o.available);

  const sizeBy = opts?.sizeBy ?? 'donation_total';
  const validSizeBy = sizeByOptions.some(o => o.value === sizeBy)
    ? sizeBy
    : (sizeByOptions[0]?.value ?? 'connection_count');

  return (
    <>
      <LabeledSelect
        label="Data"
        value={dataMode}
        options={[
          { value: 'officials',  label: 'Officials'      },
          { value: 'pac_sector', label: 'PACs by Sector' },
          { value: 'pac_party',  label: 'PACs by Party'  },
        ]}
        onChange={v => set('dataMode', v)}
      />
      {!isPacMode && (
        <>
          <LabeledSelect
            label="Group by"
            value={opts?.groupBy ?? 'party'}
            options={[
              { value: 'party',   label: 'Party'   },
              { value: 'state',   label: 'State'   },
              { value: 'chamber', label: 'Chamber' },
            ]}
            onChange={v => set('groupBy', v)}
          />
          <LabeledSelect
            label="Size by"
            value={validSizeBy}
            options={sizeByOptions}
            onChange={v => set('sizeBy', v)}
          />
          <LabeledSelect
            label="Color by"
            value={opts?.colorBy ?? 'party'}
            options={[
              { value: 'party',   label: 'Party'   },
              { value: 'chamber', label: 'Chamber' },
            ]}
            onChange={v => set('colorBy', v)}
          />
        </>
      )}
    </>
  );
}

// ── Sunburst settings ──────────────────────────────────────────────────────────

function SunburstSettings({
  view, hooks, graphMeta,
}: {
  view: GraphView;
  hooks: UseGraphViewReturn;
  graphMeta?: GraphMeta;
}) {
  const opts = view.style.vizOptions.sunburst;
  function set(key: string, value: unknown) { hooks.setVizOption('sunburst', key, value); }

  // Build ring1 options based on available data.
  // Default true (show option) when graphMeta not yet available.
  // Compute counts from graphMeta.connectionTypes for informative labels.
  const voteCount     = voteCountFrom(graphMeta);
  const donationCount = donationCountFrom(graphMeta);

  const ring1Options = [
    {
      value: 'connection_types',
      label: 'All connections',
      available: true, // always available
    },
    {
      value: 'donation_industries',
      label: donationCount > 0 ? `Donor industries (${donationCount})` : 'Donor industries',
      available: graphMeta?.hasDonations ?? true,
    },
    {
      value: 'vote_categories',
      label: voteCount > 0 ? `Vote record (${voteCount})` : 'Vote record',
      // Hide for PAC groups (they don't vote). Show if votes exist.
      available: !(graphMeta?.isPacFocus ?? false) && (graphMeta?.hasVotes ?? true),
    },
  ].filter(o => o.available);

  // If the current ring1 selection is no longer in the available list, reset to default.
  const ring1 = opts?.ring1 ?? 'connection_types';
  const validRing1 = ring1Options.some(o => o.value === ring1)
    ? ring1
    : (ring1Options[0]?.value ?? 'connection_types');

  return (
    <>
      <LabeledSelect
        label="Ring 1"
        value={validRing1}
        options={ring1Options}
        onChange={v => set('ring1', v)}
      />
      <LabeledSelect
        label="Ring 2"
        value={opts?.ring2 ?? 'top_entities'}
        options={[
          { value: 'top_entities', label: 'Top entities' },
          { value: 'by_amount',    label: 'By $ amount'  },
          { value: 'by_count',     label: 'By count'     },
        ]}
        onChange={v => set('ring2', v)}
      />
      <LabeledSelect
        label="Max items"
        value={String(opts?.maxRing1 ?? 8)}
        options={[
          { value: '5',  label: '5'  },
          { value: '8',  label: '8'  },
          { value: '12', label: '12' },
        ]}
        onChange={v => set('maxRing1', parseInt(v))}
      />
      <LabeledToggle
        label="Labels"
        value={(opts?.showLabels ?? 'auto') !== 'never'}
        onChange={v => set('showLabels', v ? 'auto' : 'never')}
      />
      <LabeledSelect
        label="Shape"
        value={opts?.shape ?? 'circle'}
        options={[
          { value: 'circle',  label: '○ Circle'  },
          { value: 'octagon', label: '⬡ Octagon' },
        ]}
        onChange={v => set('shape', v)}
      />
    </>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────────

export function GraphConfigPanel({ view, hooks, collapsed, onCollapse, onSavePreset, graphMeta }: GraphConfigPanelProps) {
  const vizType       = view.style.vizType;
  const activePreset  = view.meta?.presetId ?? null;
  const isDirty       = view.meta?.isDirty  ?? false;

  // Only show presets that match the active viz type (or 'any') and have relevant data.
  const relevantPresets = BUILT_IN_PRESETS.filter(p => {
    // Must match viz type
    if (p.style.vizType !== vizType && (p.style.vizType as string) !== 'any') return false;
    // "Follow the Money" needs donation data
    if (p.meta.presetId === 'follow-the-money' && graphMeta && !graphMeta.hasDonations) return false;
    // "Votes & Bills" needs vote data
    if (p.meta.presetId === 'votes-and-bills' && graphMeta && !graphMeta.hasVotes) return false;
    return true;
  });

  // Collapsed: 40px icon strip
  if (collapsed) {
    return (
      <div className="h-full w-10 flex flex-col items-center py-2 gap-3 border-l border-gray-200 bg-white shrink-0">
        <button
          title="Graph Config — Visualization"
          onClick={onCollapse}
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100 transition-colors text-sm"
        >
          ⬡
        </button>
        <button
          title="Graph Config — Settings"
          onClick={onCollapse}
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100 transition-colors text-sm"
        >
          ⚙
        </button>
      </div>
    );
  }

  // Expanded: 220px panel
  return (
    <div className="h-full w-[220px] flex flex-col border-l border-gray-200 bg-white overflow-hidden shrink-0">

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 shrink-0">
        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
          Graph Config
        </span>
        <button
          onClick={onCollapse}
          title="Collapse panel  (] shortcut)"
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto overscroll-contain">

        {/* Visualization picker */}
        <TreeSection label="Visualization" separator={false} defaultExpanded>
          {STD_VIZ.map(v => (
            <TreeNode
              key={v.id}
              label={v.label}
              variant="item"
              collapsible={false}
              active={vizType === v.id}
              separator={false}
              depth={1}
              icon={undefined}
              onClick={() => hooks.setVizType(v.id as VizType)}
            >
              {null}
            </TreeNode>
          ))}
          {COMING_VIZ.length > 0 && (
            <TreeSection label="Coming Soon" defaultExpanded={false} separator={false} depth={1}>
              {COMING_VIZ.map(v => (
                <TreeNode
                  key={v.id}
                  label={v.label}
                  variant="item"
                  collapsible={false}
                  separator={false}
                  depth={2}
                  onClick={() => {}}
                >
                  {null}
                </TreeNode>
              ))}
            </TreeSection>
          )}
        </TreeSection>

        {/* Presets — filtered to active viz type */}
        <TreeSection label="Presets" defaultExpanded separator>
          {relevantPresets.length > 0
            ? relevantPresets.map(preset => (
                <TreeNode
                  key={preset.meta.presetId}
                  label={preset.meta.name}
                  variant="item"
                  collapsible={false}
                  active={activePreset === preset.meta.presetId}
                  separator={false}
                  depth={1}
                  icon={PRESET_EMOJI[preset.meta.presetId] ?? '📋'}
                  onClick={() => hooks.applyPreset(preset)}
                >
                  {null}
                </TreeNode>
              ))
            : (
                <div className="px-3 py-2 text-xs text-gray-400">
                  No presets for this visualization
                </div>
              )
          }

          <div className="h-px bg-gray-100 mx-2 my-1" />

          <TreeNode
            label="Save current…"
            variant="item"
            collapsible={false}
            separator={false}
            depth={1}
            icon="💾"
            onClick={onSavePreset}
          >
            {null}
          </TreeNode>
        </TreeSection>

        {/* Type-specific settings */}
        <TreeSection
          label={
            <span className="flex items-center gap-2">
              <span>Settings</span>
              <span className="text-[10px] text-indigo-500 font-medium capitalize">{vizType}</span>
            </span>
          }
          separator
        >
          {vizType === 'force'    && <ForceSettings    view={view} hooks={hooks} graphMeta={graphMeta} />}
          {vizType === 'chord'    && <ChordSettings    view={view} hooks={hooks} graphMeta={graphMeta} />}
          {vizType === 'treemap'  && <TreemapSettings  view={view} hooks={hooks} graphMeta={graphMeta} />}
          {vizType === 'sunburst' && <SunburstSettings view={view} hooks={hooks} graphMeta={graphMeta} />}
        </TreeSection>

        {/* Display section removed — per-viz settings now live inside each viz's Settings section */}

      </div>

      {/* Footer */}
      <div className="border-t border-gray-100 px-3 py-2 shrink-0">
        <button
          onClick={onSavePreset}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 transition-colors border border-indigo-100"
        >
          <span>💾</span>
          <span>{isDirty ? 'Save changes' : 'Save preset'}</span>
        </button>
      </div>
    </div>
  );
}
