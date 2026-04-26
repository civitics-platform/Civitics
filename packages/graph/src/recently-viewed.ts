/**
 * Recently-viewed entities (FIX-140).
 *
 * localStorage-backed list of the last 20 FocusEntities the user added to
 * focus. Most-recent-first. Survives across sessions, scoped per browser.
 */

import type { FocusEntity } from './types'

const STORAGE_KEY = 'civitics:graph:recent-entities'
const MAX_ENTRIES = 20

/**
 * Subset of FocusEntity stored in localStorage. Per-entity overrides
 * (depth, pinned, highlight, color) are intentionally dropped — they belong
 * to a specific session, not the user's history.
 */
export interface RecentEntity {
  id: string
  name: string
  type: FocusEntity['type']
  role?: string
  party?: string
  photoUrl?: string
}

function isStorageAvailable(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage
  } catch {
    return false
  }
}

export function recordRecent(entity: FocusEntity): void {
  if (!isStorageAvailable()) return

  const slim: RecentEntity = {
    id: entity.id,
    name: entity.name,
    type: entity.type,
    ...(entity.role     ? { role:     entity.role }     : {}),
    ...(entity.party    ? { party:    entity.party }    : {}),
    ...(entity.photoUrl ? { photoUrl: entity.photoUrl } : {}),
  }

  try {
    const current = loadRecent()
    const next = [slim, ...current.filter(e => e.id !== slim.id)].slice(0, MAX_ENTRIES)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // localStorage quota exceeded or stringify failure — silently no-op so
    // the entity still gets added to focus.
  }
}

export function loadRecent(): RecentEntity[] {
  if (!isStorageAvailable()) return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (e): e is RecentEntity =>
        !!e && typeof e === 'object' &&
        typeof (e as RecentEntity).id === 'string' &&
        typeof (e as RecentEntity).name === 'string' &&
        typeof (e as RecentEntity).type === 'string',
    )
  } catch {
    return []
  }
}

export function clearRecent(): void {
  if (!isStorageAvailable()) return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // no-op
  }
}
