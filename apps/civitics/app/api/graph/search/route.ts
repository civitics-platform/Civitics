import { createAdminClient } from "@civitics/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return Response.json([]);

  const supabase = createAdminClient();
  const pattern = `%${q}%`;

  const [officialsRes, agenciesRes, proposalsRes] = await Promise.all([
    supabase
      .from("officials")
      .select("id, full_name, role_title, party, metadata")
      .ilike("full_name", pattern)
      .limit(5),
    supabase
      .from("agencies")
      .select("id, name, acronym")
      .or(`name.ilike.${pattern},acronym.ilike.${pattern}`)
      .limit(3),
    supabase
      .from("proposals")
      .select("id, title, status")
      .ilike("title", pattern)
      .limit(3),
  ]);

  const results = [
    ...(officialsRes.data ?? []).map((o: { id: string; full_name: string; role_title: string | null; party: string | null; metadata: unknown }) => ({
      id: o.id,
      label: o.full_name,
      type: "official" as const,
      subtitle: [(o.metadata as Record<string, unknown> | null)?.state, o.role_title]
        .filter(Boolean)
        .join(" · ") || undefined,
      party: o.party ?? undefined,
    })),
    ...(agenciesRes.data ?? []).map((a: { id: string; name: string; acronym: string | null }) => ({
      id: a.id,
      label: a.name,
      type: "agency" as const,
      subtitle: a.acronym ?? undefined,
    })),
    ...(proposalsRes.data ?? []).map((p: { id: string; title: string; status: string | null }) => ({
      id: p.id,
      label: p.title,
      type: "proposal" as const,
      subtitle: p.status ?? undefined,
    })),
  ];

  // Attach connection counts for all result entities
  const allIds = results.map((r) => r.id);
  if (allIds.length > 0) {
    const [fromRes, toRes] = await Promise.all([
      supabase.from("entity_connections").select("from_id").in("from_id", allIds),
      supabase.from("entity_connections").select("to_id").in("to_id", allIds),
    ]);
    const countMap = new Map<string, number>();
    for (const r of fromRes.data ?? []) countMap.set(r.from_id, (countMap.get(r.from_id) ?? 0) + 1);
    for (const r of toRes.data ?? []) countMap.set(r.to_id, (countMap.get(r.to_id) ?? 0) + 1);
    const resultsWithCounts = results.map((r) => ({ ...r, connectionCount: countMap.get(r.id) ?? 0 }));
    return Response.json(resultsWithCounts);
  }

  return Response.json(results);
}
