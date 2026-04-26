"use client";

/**
 * GroupBrowser
 *
 * Replaces EntityBrowse.
 * Shows premade groups by category
 * and a custom filter builder.
 * Groups are queries not lists —
 * adding a group stores a filter,
 * not individual entity IDs.
 */

import {
  BUILT_IN_GROUPS,
  GROUP_CATEGORIES,
  createCustomGroup,
} from '../groups';
import type { FocusGroup } from '../types';
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
  async function handleCustomSave({ filter, name }: { filter: import('../types').GroupFilter; name: string }) {
    let persisted = false;
    try {
      const res = await fetch('/api/graph/custom-groups', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name, filter }),
        credentials: 'include',
      });
      persisted = res.ok;
    } catch {
      persisted = false;
    }
    const group = createCustomGroup(filter, name);
    onAddGroup(group);
    if (!persisted) {
      // Silent fallback — user's group still works in-session even if persistence fails.
    }
  }

  return (
    <div className="pb-2">

      {/* ── Premade groups by category ───────────── */}
      {Object.entries(GROUP_CATEGORIES).map(([category, ids]) => (
        <TreeSection
          key={category}
          label={category}
          defaultExpanded={true}
          separator={false}
          depth={1}
        >
          {ids.map(id => {
            const group = groupMap.get(id);
            if (!group) return null;
            const isActive = activeGroupIds.includes(id);

            return (
              <div
                key={id}
                className="flex items-center justify-between px-3 py-1.5 hover:bg-gray-50 group/row"
              >
                {/* Icon + name */}
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

                {/* Add button */}
                <button
                  onClick={() => onAddGroup(group)}
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
          })}
        </TreeSection>
      ))}

      {/* ── By State section ───────────── */}
      <TreeSection
        label="By State"
        defaultExpanded={false}
        separator={false}
        depth={1}
      >
        <div className="px-3 py-2">
          <select
            className="w-full text-xs border border-gray-200 rounded px-2 py-1 bg-white text-gray-700 focus:outline-none focus:border-indigo-400"
            defaultValue=""
            onChange={e => {
              const state = e.target.value;
              if (!state) return;
              const group = createCustomGroup(
                { entity_type: 'official', state },
                `${state} Delegation`
              );
              onAddGroup(group);
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
      </TreeSection>

      {/* ── Build custom group ─────────────────────── */}
      <TreeSection
        label="+ Build custom group"
        defaultExpanded={false}
        separator={false}
        depth={1}
      >
        <div className="px-3 py-2">
          <CustomGroupForm onSave={handleCustomSave} />
        </div>
      </TreeSection>
    </div>
  );
}
