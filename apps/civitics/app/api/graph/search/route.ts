import { createAdminClient } from "@civitics/db";

export const dynamic = "force-dynamic";

interface SearchRow {
  id: string;
  label: string;
  entity_type: string;
  subtitle: string | null;
  party: string | null;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return Response.json([]);

  const supabase = createAdminClient();

  // Single RPC call: fuzzy (trigram + ILIKE) across officials, agencies,
  // proposals, and financial_entities. Returns up to 5 per type.
  const { data, error } = await supabase.rpc("search_graph_entities", {
    q,
    lim: 5,
  });

  if (error) {
    console.error("[graph/search] RPC error:", error.message);
    return Response.json([], { status: 500 });
  }

  const rows = (data ?? []) as SearchRow[];

  // Attach connection counts for all result entities
  const allIds = rows.map((r) => r.id);
  if (allIds.length === 0) return Response.json([]);

  const [fromRes, toRes] = await Promise.all([
    supabase.from("entity_connections").select("from_id").in("from_id", allIds),
    supabase.from("entity_connections").select("to_id").in("to_id", allIds),
  ]);

  const countMap = new Map<string, number>();
  for (const r of fromRes.data ?? []) countMap.set(r.from_id, (countMap.get(r.from_id) ?? 0) + 1);
  for (const r of toRes.data ?? []) countMap.set(r.to_id, (countMap.get(r.to_id) ?? 0) + 1);

  const results = rows.map((r) => ({
    id: r.id,
    label: r.label,
    type: r.entity_type as "official" | "agency" | "proposal" | "financial_entity",
    subtitle: r.subtitle ?? undefined,
    party: r.party ?? undefined,
    connectionCount: countMap.get(r.id) ?? 0,
  }));

  return Response.json(results);
}
