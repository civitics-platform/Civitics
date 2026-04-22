import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database";

type DB = SupabaseClient<Database>;
type Row = Database["public"]["Tables"]["financial_relationships"]["Row"];

/** All donations TO a specific official (polymorphic: to_type='official'). */
export async function listDonationsByOfficial(
  db: DB,
  officialId: string,
  cycleYear?: number,
  limit = 100
): Promise<Row[]> {
  let query = db
    .from("financial_relationships")
    .select("*")
    .eq("relationship_type", "donation")
    .eq("to_type", "official")
    .eq("to_id", officialId)
    .order("amount_cents", { ascending: false })
    .limit(limit);

  if (cycleYear !== undefined) {
    query = query.eq("cycle_year", cycleYear);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/**
 * Top donors to an official — aggregates by from_id (financial_entities row),
 * then joins financial_entities.display_name for labels.
 */
export async function getTopDonorsByOfficial(
  db: DB,
  officialId: string,
  cycleYear?: number,
  topN = 20
): Promise<{ donor_name: string; donor_type: string; total_cents: number }[]> {
  const rows = await listDonationsByOfficial(db, officialId, cycleYear, 1000);

  const totals = new Map<string, number>();
  for (const r of rows) {
    totals.set(r.from_id, (totals.get(r.from_id) ?? 0) + (r.amount_cents ?? 0));
  }

  if (totals.size === 0) return [];

  const { data: entities, error } = await db
    .from("financial_entities")
    .select("id, display_name, entity_type")
    .in("id", Array.from(totals.keys()));
  if (error) throw error;

  return (entities ?? [])
    .map((e) => ({
      donor_name:  e.display_name,
      donor_type:  e.entity_type as string,
      total_cents: totals.get(e.id) ?? 0,
    }))
    .sort((a, b) => b.total_cents - a.total_cents)
    .slice(0, topN);
}

/** Donations FROM a named donor (ilike on financial_entities.display_name). */
export async function listDonationsByDonor(
  db: DB,
  donorName: string
): Promise<Row[]> {
  const { data: entities, error: entityErr } = await db
    .from("financial_entities")
    .select("id")
    .ilike("display_name", `%${donorName}%`);
  if (entityErr) throw entityErr;
  const ids = (entities ?? []).map((e) => e.id);
  if (ids.length === 0) return [];

  const { data, error } = await db
    .from("financial_relationships")
    .select("*")
    .eq("relationship_type", "donation")
    .in("from_id", ids)
    .order("amount_cents", { ascending: false });
  if (error) throw error;
  return data;
}

/** Donation totals by industry for an official (industry on financial_entities). */
export async function getDonationsByIndustry(
  db: DB,
  officialId: string,
  cycleYear?: number
): Promise<{ industry: string; total_cents: number }[]> {
  const rows = await listDonationsByOfficial(db, officialId, cycleYear, 5000);
  if (rows.length === 0) return [];

  const { data: entities, error } = await db
    .from("financial_entities")
    .select("id, industry")
    .in("id", Array.from(new Set(rows.map((r) => r.from_id))));
  if (error) throw error;

  const industryById = new Map<string, string>(
    (entities ?? []).map((e) => [e.id, (e.industry as string | null) ?? "Unknown"])
  );

  const totals = new Map<string, number>();
  for (const r of rows) {
    const key = industryById.get(r.from_id) ?? "Unknown";
    totals.set(key, (totals.get(key) ?? 0) + (r.amount_cents ?? 0));
  }

  return Array.from(totals.entries())
    .map(([industry, total_cents]) => ({ industry, total_cents }))
    .sort((a, b) => b.total_cents - a.total_cents);
}
