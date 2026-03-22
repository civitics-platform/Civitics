"use client";

/**
 * packages/graph/src/components/EntityBrowse.tsx
 *
 * Browse entities by category. Used inside FocusTree.
 * Fetches top officials/agencies; also fetches unique industries.
 */

import { useEffect, useState } from 'react';
import type { FocusEntity } from '../types';
import { TreeNode } from './TreeNode';
import { TreeSection } from './TreeNode';

export interface EntityBrowseProps {
  onSelect: (entity: FocusEntity) => void;
}

interface BrowseEntity {
  id: string;
  name: string;
  type: FocusEntity['type'];
  role?: string;
  party?: string;
  photoUrl?: string;
}

function useBrowseEntities(scope: string, limit = 20) {
  const [entities, setEntities] = useState<BrowseEntity[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/graph/entities?browse=${scope}&limit=${limit}`)
      .then(r => r.json())
      .then((data: unknown) => {
        const arr = Array.isArray(data)
          ? data
          : (data as Record<string, unknown>)?.entities ?? [];
        setEntities(
          (arr as Record<string, unknown>[]).map(e => ({
            id:       String(e.id ?? ''),
            name:     String(e.name ?? e.label ?? ''),
            type:     (e.type as FocusEntity['type']) ?? 'official',
            role:     e.role as string | undefined,
            party:    e.party as string | undefined,
            photoUrl: e.photo_url as string | undefined,
          }))
        );
      })
      .catch(() => setEntities([]))
      .finally(() => setLoading(false));
  }, [scope, limit]);

  return { entities, loading };
}

function useIndustries() {
  const [industries, setIndustries] = useState<string[]>([]);

  useEffect(() => {
    fetch('/api/graph/entities/industries')
      .then(r => r.json())
      .then((data: unknown) => {
        const arr = Array.isArray(data) ? data : [];
        setIndustries(arr.map(String));
      })
      .catch(() => setIndustries([]));
  }, []);

  return industries;
}

function BrowseCategory({
  title,
  scope,
  limit,
  onSelect,
}: {
  title: string;
  scope: string;
  limit: number;
  onSelect: (e: FocusEntity) => void;
}) {
  const { entities, loading } = useBrowseEntities(scope, limit);

  return (
    <TreeSection label={title} defaultExpanded={false} separator={false} depth={1}>
      {loading ? (
        <div className="px-3 py-1 text-xs text-gray-400">Loading…</div>
      ) : entities.length === 0 ? (
        <div className="px-3 py-1 text-xs text-gray-400">None available</div>
      ) : (
        entities.map(entity => (
          <TreeNode
            key={entity.id}
            label={entity.name}
            variant="entity"
            party={entity.party}
            photoUrl={entity.photoUrl}
            collapsible={false}
            depth={2}
            separator={false}
            actions={[{
              icon: '+',
              label: 'Add to focus',
              onClick: () => onSelect(entity),
            }]}
          >
            {null}
          </TreeNode>
        ))
      )}
    </TreeSection>
  );
}

export function EntityBrowse({ onSelect }: EntityBrowseProps) {
  const industries = useIndustries();

  return (
    <TreeSection label="Browse by Category" defaultExpanded={false} separator={false}>
      <BrowseCategory title="Federal Officials" scope="federal_officials" limit={20} onSelect={onSelect} />
      <BrowseCategory title="Agencies" scope="agencies" limit={10} onSelect={onSelect} />

      {industries.length > 0 && (
        <TreeSection label="By Industry" defaultExpanded={false} separator={false} depth={1}>
          {industries.map(industry => (
            <TreeNode
              key={industry}
              label={industry}
              variant="item"
              collapsible={false}
              depth={2}
              separator={false}
              onClick={() => {
                // Clicking an industry could open a sub-panel in G3.
                // For now it's a no-op placeholder.
              }}
            >
              {null}
            </TreeNode>
          ))}
        </TreeSection>
      )}
    </TreeSection>
  );
}
