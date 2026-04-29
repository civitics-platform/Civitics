import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database";

type DB = SupabaseClient<Database>;

export interface IndustryTag {
  tag: string;
  display_label: string;
}

/**
 * Industry tag for each financial entity, sourced from `entity_tags`
 * (`tag_category='industry'`). This replaced the dropped
 * `financial_entities.industry` column, which was being polluted by the FEC
 * bulk pipeline writing CONNECTED_ORG_NM into a column that should have held
 * a sector code.
 */
export async function fetchIndustryTagsByEntityId(
  db: DB,
  entityIds: string[],
): Promise<Map<string, IndustryTag>> {
  if (entityIds.length === 0) return new Map();

  const out = new Map<string, IndustryTag>();
  // BATCH must keep the PostgREST URI under ~4KB. UUIDs are 36 chars; 100 IDs
  // ≈ 3.7KB plus overhead. 300 hit "URI too long" against the local API.
  const BATCH = 100;
  for (let i = 0; i < entityIds.length; i += BATCH) {
    const batch = entityIds.slice(i, i + BATCH);
    const { data, error } = await db
      .from("entity_tags")
      .select("entity_id, tag, display_label")
      .eq("entity_type", "financial_entity")
      .eq("tag_category", "industry")
      .in("entity_id", batch);
    if (error) throw error;
    for (const r of (data ?? []) as Array<{ entity_id: string; tag: string; display_label: string | null }>) {
      if (out.has(r.entity_id)) continue;
      out.set(r.entity_id, { tag: r.tag, display_label: r.display_label ?? r.tag });
    }
  }
  return out;
}

/** Resolve the entity_ids that match a given industry tag (canonical form, e.g. 'pharma'). */
export async function fetchEntityIdsByIndustryTag(
  db: DB,
  tag: string,
): Promise<string[]> {
  const { data, error } = await db
    .from("entity_tags")
    .select("entity_id")
    .eq("entity_type", "financial_entity")
    .eq("tag_category", "industry")
    .eq("tag", tag);
  if (error) throw error;
  return (data ?? []).map((r) => r.entity_id as string);
}
