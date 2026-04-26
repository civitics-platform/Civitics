"use client";

/**
 * GroupBrowser
 *
 * Recursive 5-category browse hierarchy (FIX-135).
 * Walks GROUP_TREE — each category is a TreeSection, each leaf is either a
 * premade-group row, the By-State dropdown, or the custom-group form.
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

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO',
  'CT','DE','FL','GA','HI','ID',
  'IL','IN','IA','KS','KY','LA',
  'ME','MD','MA','MI','MN','MS',
  'MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK',
  'OR','PA','RI','SC','SD','TN',
  'TX','UT','VT','VA','WA','WV',
  'WI','WY','DC',
];

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

  function handleStateSelect(state: string) {
    if (!state) return;
    const group = createCustomGroup(
      { entity_type: 'official', state },
      `${state} Delegation`,
    );
    onAddGroup(group);
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

    if (node.kind === 'state-picker') {
      return <StatePicker key={key} depth={depth} onSelect={handleStateSelect} />;
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

function StatePicker({
  depth,
  onSelect,
}: {
  depth: number;
  onSelect: (state: string) => void;
}) {
  return (
    <div className="py-2" style={{ paddingLeft: `${8 + depth * 12}px`, paddingRight: '12px' }}>
      <select
        className="w-full text-xs border border-gray-200 rounded px-2 py-1 bg-white text-gray-700 focus:outline-none focus:border-indigo-400"
        defaultValue=""
        onChange={e => {
          onSelect(e.target.value);
          e.target.value = '';
        }}
      >
        <option value="" disabled>Select a state...</option>
        {US_STATES.map(s => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <p className="text-[10px] text-gray-400 mt-1">
        Adds all officials from that state to focus
      </p>
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
  if (node.kind === 'group')        return groupMap.has(node.id);
  if (node.kind === 'state-picker') return true;
  if (node.kind === 'custom-form')  return true;
  return node.children.some(c => isLeafRenderable(c, groupMap));
}
