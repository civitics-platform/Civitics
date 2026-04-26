"use client";

/**
 * GroupBrowser
 *
 * Recursive 5-category browse hierarchy (FIX-135) with by-state drill-down
 * (FIX-136). Walks GROUP_TREE — each category is a TreeSection, each leaf is
 * a premade-group row, a state-list row, or the custom-group form.
 * Groups are queries, not lists — adding one stores a filter, not entity IDs.
 */

import {
  BUILT_IN_GROUPS,
  GROUP_TREE,
  createCustomGroup,
  type GroupTreeNode,
} from '../groups';
import type { FocusGroup, GroupFilter } from '../types';
import { TreeSection } from './TreeNode';
import { CustomGroupForm } from './CustomGroupForm';

export interface GroupBrowserProps {
  onAddGroup: (group: FocusGroup) => void;
  /** IDs of groups already in focus so we can show them as active */
  activeGroupIds?: string[];
}

// Alphabetical by full name so the drill-down reads naturally.
// Abbreviations stay in sync with officials.metadata.state_abbr (FIX-124).
const US_STATES: Array<{ abbr: string; name: string }> = [
  { abbr: 'AL', name: 'Alabama' },        { abbr: 'AK', name: 'Alaska' },
  { abbr: 'AZ', name: 'Arizona' },        { abbr: 'AR', name: 'Arkansas' },
  { abbr: 'CA', name: 'California' },     { abbr: 'CO', name: 'Colorado' },
  { abbr: 'CT', name: 'Connecticut' },    { abbr: 'DE', name: 'Delaware' },
  { abbr: 'DC', name: 'District of Columbia' },
  { abbr: 'FL', name: 'Florida' },        { abbr: 'GA', name: 'Georgia' },
  { abbr: 'HI', name: 'Hawaii' },         { abbr: 'ID', name: 'Idaho' },
  { abbr: 'IL', name: 'Illinois' },       { abbr: 'IN', name: 'Indiana' },
  { abbr: 'IA', name: 'Iowa' },           { abbr: 'KS', name: 'Kansas' },
  { abbr: 'KY', name: 'Kentucky' },       { abbr: 'LA', name: 'Louisiana' },
  { abbr: 'ME', name: 'Maine' },          { abbr: 'MD', name: 'Maryland' },
  { abbr: 'MA', name: 'Massachusetts' },  { abbr: 'MI', name: 'Michigan' },
  { abbr: 'MN', name: 'Minnesota' },      { abbr: 'MS', name: 'Mississippi' },
  { abbr: 'MO', name: 'Missouri' },       { abbr: 'MT', name: 'Montana' },
  { abbr: 'NE', name: 'Nebraska' },       { abbr: 'NV', name: 'Nevada' },
  { abbr: 'NH', name: 'New Hampshire' },  { abbr: 'NJ', name: 'New Jersey' },
  { abbr: 'NM', name: 'New Mexico' },     { abbr: 'NY', name: 'New York' },
  { abbr: 'NC', name: 'North Carolina' }, { abbr: 'ND', name: 'North Dakota' },
  { abbr: 'OH', name: 'Ohio' },           { abbr: 'OK', name: 'Oklahoma' },
  { abbr: 'OR', name: 'Oregon' },         { abbr: 'PA', name: 'Pennsylvania' },
  { abbr: 'RI', name: 'Rhode Island' },   { abbr: 'SC', name: 'South Carolina' },
  { abbr: 'SD', name: 'South Dakota' },   { abbr: 'TN', name: 'Tennessee' },
  { abbr: 'TX', name: 'Texas' },          { abbr: 'UT', name: 'Utah' },
  { abbr: 'VT', name: 'Vermont' },        { abbr: 'VA', name: 'Virginia' },
  { abbr: 'WA', name: 'Washington' },     { abbr: 'WV', name: 'West Virginia' },
  { abbr: 'WI', name: 'Wisconsin' },      { abbr: 'WY', name: 'Wyoming' },
];

// Deterministic id so a state delegation already in focus shows as active.
function stateGroupId(abbr: string): string {
  return `group-state-${abbr}`;
}

function buildStateGroup(abbr: string, name: string): FocusGroup {
  return {
    id: stateGroupId(abbr),
    name: `${name} Delegation`,
    type: 'group',
    icon: '🗺',
    color: '#6366f1',
    filter: { entity_type: 'official', state: abbr },
    isPremade: false,
    description: `Officials representing ${name}`,
  };
}

export function GroupBrowser({
  onAddGroup,
  activeGroupIds = [],
}: GroupBrowserProps) {

  // Build lookup map for quick access by ID
  const groupMap = new Map(BUILT_IN_GROUPS.map(g => [g.id, g]));

  // Save flow: build a FocusGroup, optionally persist via /api/graph/custom-groups,
  // then add to the active view. Persistence is best-effort — anonymous users
  // and network errors fall back to in-memory groups so the user never loses
  // their selection.
  async function handleCustomSave({ filter, name }: { filter: GroupFilter; name: string }) {
    try {
      await fetch('/api/graph/custom-groups', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name, filter }),
        credentials: 'include',
      });
    } catch {
      // Silent fallback — user's group still works in-session even if persistence fails.
    }
    const group = createCustomGroup(filter, name);
    onAddGroup(group);
  }

  function handleStateSelect(abbr: string, name: string) {
    onAddGroup(buildStateGroup(abbr, name));
  }

  function renderNode(node: GroupTreeNode, depth: number, key: string): React.ReactNode {
    if (node.kind === 'category') {
      const hasContent = node.children.some(c => isLeafRenderable(c, groupMap));
      if (!hasContent) return null;
      return (
        <TreeSection
          key={key}
          label={node.label}
          icon={node.icon}
          defaultExpanded={node.defaultExpanded ?? false}
          separator={false}
          depth={depth}
        >
          {node.children.map((child, i) => renderNode(child, depth + 1, `${key}-${i}`))}
        </TreeSection>
      );
    }

    if (node.kind === 'group') {
      const group = groupMap.get(node.id);
      if (!group) return null;
      const isActive = activeGroupIds.includes(node.id);
      return (
        <GroupRow
          key={key}
          group={group}
          isActive={isActive}
          depth={depth}
          onAdd={() => onAddGroup(group)}
        />
      );
    }

    if (node.kind === 'state-list') {
      return (
        <StateList
          key={key}
          depth={depth}
          activeIds={activeGroupIds}
          onSelect={handleStateSelect}
        />
      );
    }

    if (node.kind === 'custom-form') {
      return (
        <div key={key} className="px-3 py-2" style={{ paddingLeft: `${8 + depth * 12}px` }}>
          <CustomGroupForm onSave={handleCustomSave} />
        </div>
      );
    }

    return null;
  }

  return (
    <div className="pb-2">
      {GROUP_TREE.map((node, i) => renderNode(node, 1, `root-${i}`))}
    </div>
  );
}

// ── Subcomponents ──────────────────────────────────────────────────────────────

function GroupRow({
  group,
  isActive,
  depth,
  onAdd,
}: {
  group: FocusGroup;
  isActive: boolean;
  depth: number;
  onAdd: () => void;
}) {
  return (
    <div
      className="flex items-center justify-between py-1.5 hover:bg-gray-50 group/row"
      style={{ paddingLeft: `${8 + depth * 12}px`, paddingRight: '12px' }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm shrink-0">{group.icon}</span>
        <div className="min-w-0">
          <div className="text-xs font-medium text-gray-700 truncate">
            {group.name}
          </div>
          {group.description && (
            <div className="text-[10px] text-gray-400 truncate">
              {group.description}
            </div>
          )}
        </div>
      </div>
      <button
        onClick={onAdd}
        disabled={isActive}
        title={isActive ? 'Already in focus' : `Add ${group.name} to focus`}
        className={`shrink-0 ml-2 w-5 h-5 rounded text-xs font-bold transition-colors flex items-center justify-center ${
          isActive
            ? 'bg-indigo-100 text-indigo-400 cursor-default'
            : 'bg-gray-100 text-gray-500 hover:bg-indigo-600 hover:text-white group-hover/row:bg-indigo-50 group-hover/row:text-indigo-600'
        }`}
      >
        {isActive ? '✓' : '+'}
      </button>
    </div>
  );
}

function StateList({
  depth,
  activeIds,
  onSelect,
}: {
  depth: number;
  activeIds: string[];
  onSelect: (abbr: string, name: string) => void;
}) {
  return (
    <div>
      {US_STATES.map(s => {
        const isActive = activeIds.includes(stateGroupId(s.abbr));
        return (
          <div
            key={s.abbr}
            className="flex items-center justify-between py-1.5 hover:bg-gray-50 group/row"
            style={{ paddingLeft: `${8 + depth * 12}px`, paddingRight: '12px' }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[10px] font-semibold text-gray-400 shrink-0 w-6 tabular-nums">
                {s.abbr}
              </span>
              <span className="text-xs font-medium text-gray-700 truncate">
                {s.name}
              </span>
            </div>
            <button
              onClick={() => onSelect(s.abbr, s.name)}
              disabled={isActive}
              title={isActive ? 'Already in focus' : `Add ${s.name} delegation to focus`}
              className={`shrink-0 ml-2 w-5 h-5 rounded text-xs font-bold transition-colors flex items-center justify-center ${
                isActive
                  ? 'bg-indigo-100 text-indigo-400 cursor-default'
                  : 'bg-gray-100 text-gray-500 hover:bg-indigo-600 hover:text-white group-hover/row:bg-indigo-50 group-hover/row:text-indigo-600'
              }`}
            >
              {isActive ? '✓' : '+'}
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Is this leaf renderable right now? Used to skip empty categories so users
 * don't see hollow "Government" / "Legislation" headers before later FIX-NNN
 * land. A category counts as renderable iff at least one descendant is.
 */
function isLeafRenderable(
  node: GroupTreeNode,
  groupMap: Map<string, FocusGroup>,
): boolean {
  if (node.kind === 'group')       return groupMap.has(node.id);
  if (node.kind === 'state-list')  return true;
  if (node.kind === 'custom-form') return true;
  return node.children.some(c => isLeafRenderable(c, groupMap));
}
