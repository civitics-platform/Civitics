import { createAdminClient } from "@civitics/db";
import { supabaseUnavailable, unavailableResponse, withDbTimeout } from "@/lib/supabase-check";

export const dynamic = "force-dynamic";

interface TreemapRow {
  official_id: string;
  official_name: string;
  party: string;
  state: string;
  chamber: string;
  total_donated_cents: number;
}

export interface DonorRow {
  donor_id: string;
  donor_name: string;
  industry_category: string;
  amount_usd: number;
  entity_type: string;
}

export async function GET(request: Request) {
  if (supabaseUnavailable()) return unavailableResponse();
  const supabase = createAdminClient();

  const { searchParams } = new URL(request.url);
  const entityId = searchParams.get("entityId");

  // Validate UUID format — reject group IDs like 'group-pac-finance'
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const validEntityId = entityId && UUID_RE.test(entityId) ? entityId : null;

  // ── Entity mode: donors for one official ─────────────────────────────────
  if (validEntityId) {
    type RpcRow = {
      financial_entity_id: string | null;
      entity_name: string;
      entity_type: string;
      industry_category: string;
      total_amount_usd: number;
      transaction_count: number;
    };

    const { data, error } = await withDbTimeout<{
      data: Array<{ financial_entity_id: string | null; entity_name: string; entity_type: string; industry_category: string; total_amount_usd: number; transaction_count: number }> | null;
      error: { message: string } | null;
    }>(
      supabase.rpc("get_official_donors", {
        p_official_id: validEntityId,
      })
    );

    if (error) {
      console.error("[graph/treemap/entity] RPC error:", error.message);
      return Response.json({ error: error.message }, { status: 500 });
    }

    const rows: DonorRow[] = (data ?? []).map((row) => ({
      donor_id:          row.financial_entity_id ?? "",
      donor_name:        row.entity_name,
      industry_category: row.industry_category,
      amount_usd:        Number(row.total_amount_usd),
      entity_type:       row.entity_type,
    }));

    return Response.json(rows);
  }

  // ── Aggregate mode: all officials by party / chamber ─────────────────────
  // groupBy and sizeBy are accepted for API compatibility and passed to the client.
  // Actual grouping is done client-side in TreemapGraph; chamber data is always returned.
  void searchParams.get("groupBy");  // accepted, used client-side
  void searchParams.get("sizeBy");   // accepted, used client-side

  const chamber = searchParams.get("chamber");
  const party   = searchParams.get("party");
  const state   = searchParams.get("state");

  // Pass filters to the RPC so the DB aggregates only the relevant officials.
  // e.g. senate+democrat: ~50 rows instead of 8k — much faster.
  // Use a longer timeout (10s) for this heavy aggregation RPC.
  // QWEN-ADDED: Add generic type to withDbTimeout for treemap_officials_by_donations RPC
  const { data, error } = await withDbTimeout<{
    data: Array<{ official_id: string; official_name: string; party: string; state: string; chamber: string; total_donated_cents: number }> | null;
    error: { message: string } | null;
  }>(
    supabase.rpc("treemap_officials_by_donations", {
      lim:       200,
      p_chamber: chamber ?? null,
      p_party:   party   ?? null,
      p_state:   state   ?? null,
    }),
    10000
  );

  if (error) {
    console.error("[graph/treemap] RPC error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json((data ?? []) as TreemapRow[]);
}
