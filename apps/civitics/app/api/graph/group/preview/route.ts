/**
 * GET /api/graph/group/preview — FIX-127
 *
 * Lightweight HEAD-only count for a GroupFilter. Powers the live "47
 * matching" badge in the custom group builder. Mirrors the filter logic of
 * /api/graph/group's full mode but skips every join, aggregation, and node
 * build — the only thing the caller needs is the row count.
 *
 * Query params (all from GroupFilter shape):
 *   entity_type=official|pac|agency  (required)
 *   chamber=senate|house              (official only)
 *   party=democrat|republican|independent (official only)
 *   state=XX                          (official only)
 *   industry=Finance|...              (pac only)
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, fetchEntityIdsByIndustryTag } from "@civitics/db";
import { supabaseUnavailable, unavailableResponse } from "@/lib/supabase-check";

export const dynamic = "force-dynamic";

const VALID_TYPES   = new Set(["official", "pac", "agency"]);
const VALID_CHAMBER = new Set(["senate", "house"]);

export async function GET(req: NextRequest) {
  if (supabaseUnavailable()) return unavailableResponse();

  const { searchParams } = req.nextUrl;
  const entityType = searchParams.get("entity_type") ?? "";
  if (!VALID_TYPES.has(entityType)) {
    return NextResponse.json({ error: "entity_type must be official|pac|agency" }, { status: 400 });
  }

  const supabase = createAdminClient();

  if (entityType === "official") {
    const chamber = searchParams.get("chamber");
    const party   = searchParams.get("party");
    const state   = searchParams.get("state");
    if (chamber && !VALID_CHAMBER.has(chamber)) {
      return NextResponse.json({ error: "chamber must be senate|house" }, { status: 400 });
    }

    let q = supabase
      .from("officials")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true);

    if (chamber === "senate") q = q.eq("role_title", "Senator");
    else if (chamber === "house") q = q.eq("role_title", "Representative");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (party) q = q.eq("party", party as any);
    if (state) q = q.or(`metadata->>state.eq.${state},metadata->>state_abbr.eq.${state}`);

    const { count, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ count: count ?? 0 });
  }

  if (entityType === "pac") {
    const industry = searchParams.get("industry");

    // Industry filter resolves through `entity_tags` (FIX-167). Resolve the
    // tagged entity IDs first, then count PACs in that set.
    const taggedIds = industry ? await fetchEntityIdsByIndustryTag(supabase, industry) : null;
    if (taggedIds && taggedIds.length === 0) {
      return NextResponse.json({ count: 0 });
    }

    let q = supabase
      .from("financial_entities")
      .select("id", { count: "exact", head: true })
      .eq("entity_type", "pac")
      .not("display_name", "ilike", "%PAC/Committee%");

    if (taggedIds) q = q.in("id", taggedIds);

    const { count, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ count: count ?? 0 });
  }

  // entity_type === "agency"
  // GroupFilter doesn't expose agency-specific facets yet (agency_type would be
  // a future addition), so this is a flat count of active agencies.
  const { count, error } = await supabase
    .from("agencies")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ count: count ?? 0 });
}
