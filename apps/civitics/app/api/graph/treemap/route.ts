import { createAdminClient } from "@civitics/db";
import { supabaseUnavailable, unavailableResponse } from "@/lib/supabase-check";

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
  // get_official_donors RPC was retired in the shadow→public promotion.
  // Direct query: financial_relationships → aggregate by from_id → join financial_entities.
  if (validEntityId) {
    const { data: donations, error: donationsErr } = await supabase
      .from("financial_relationships")
      .select("from_id, amount_cents")
      .eq("relationship_type", "donation")
      .eq("to_type", "official")
      .eq("to_id", validEntityId)
      .eq("from_type", "financial_entity");

    if (donationsErr) {
      console.error("[graph/treemap/entity] donations error:", donationsErr.message);
      return Response.json({ error: donationsErr.message }, { status: 500 });
    }

    const byDonor = new Map<string, number>();
    for (const d of donations ?? []) {
      byDonor.set(d.from_id, (byDonor.get(d.from_id) ?? 0) + (d.amount_cents ?? 0));
    }

    const donorIds = [...byDonor.keys()];
    const donorInfo = new Map<string, { name: string; industry: string | null; entity_type: string | null }>();
    if (donorIds.length > 0) {
      const BATCH = 300;
      for (let i = 0; i < donorIds.length; i += BATCH) {
        const batch = donorIds.slice(i, i + BATCH);
        const { data: entities } = await supabase
          .from("financial_entities")
          .select("id, display_name, industry, entity_type")
          .in("id", batch);
        for (const e of entities ?? []) {
          donorInfo.set(e.id, {
            name: e.display_name,
            industry: e.industry,
            entity_type: e.entity_type,
          });
        }
      }
    }

    const rows: DonorRow[] = [];
    for (const [donorId, cents] of byDonor) {
      const info = donorInfo.get(donorId);
      if (!info) continue;
      rows.push({
        donor_id: donorId,
        donor_name: info.name,
        industry_category: info.industry ?? "Other",
        amount_usd: cents / 100,
        entity_type: info.entity_type ?? "financial",
      });
    }
    rows.sort((a, b) => b.amount_usd - a.amount_usd);

    return Response.json(rows, {
      headers: { "Cache-Control": "public, max-age=0, s-maxage=86400, stale-while-revalidate=172800" },
    });
  }

  // ── Aggregate mode: all officials by party / chamber ─────────────────────
  // groupBy and sizeBy are accepted for API compatibility and passed to the client.
  // Actual grouping is done client-side in TreemapGraph; chamber data is always returned.
  void searchParams.get("groupBy");  // accepted, used client-side
  void searchParams.get("sizeBy");   // accepted, used client-side

  const chamber = searchParams.get("chamber");
  const party   = searchParams.get("party");
  const state   = searchParams.get("state");

  // treemap_officials_by_donations RPC was retired in the shadow→public promotion.
  // Query the filtered officials + aggregate their donations app-side.
  // FIX-124: select source_ids + jurisdictions.short_name so we can derive
  // state with the same fallback chain the old RPC used. Pure metadata lookups
  // missed every federal Senator/Rep before the state_abbr backfill.
  let officialsQuery = supabase
    .from("officials")
    .select("id, full_name, party, role_title, metadata, source_ids, jurisdictions:jurisdiction_id(short_name)")
    .eq("is_active", true);

  if (chamber === "senate") officialsQuery = officialsQuery.eq("role_title", "Senator");
  else if (chamber === "house") officialsQuery = officialsQuery.eq("role_title", "Representative");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (party) officialsQuery = officialsQuery.eq("party", party as any);
  if (state) {
    // Match either metadata field — they're kept in sync by the FIX-124 backfill
    // but accept both for robustness.
    officialsQuery = officialsQuery.or(`metadata->>state.eq.${state},metadata->>state_abbr.eq.${state}`);
  }

  const { data: officials, error: officialsErr } = await officialsQuery.limit(1000);
  if (officialsErr) {
    console.error("[graph/treemap] officials error:", officialsErr.message);
    return Response.json({ error: officialsErr.message }, { status: 500 });
  }

  const VALID_STATES = new Set([
    "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
    "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
    "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
    "VA","WA","WV","WI","WY","DC","PR","GU","VI","AS","MP",
  ]);
  function deriveState(
    metadata: Record<string, unknown> | null,
    sourceIds: Record<string, unknown> | null,
    jurShortName: string | null,
  ): string {
    const meta = metadata ?? {};
    if (typeof meta["state_abbr"] === "string" && meta["state_abbr"]) return meta["state_abbr"] as string;
    if (typeof meta["state"]      === "string" && meta["state"])      return meta["state"]      as string;
    if (jurShortName && jurShortName.length === 2 && VALID_STATES.has(jurShortName)) return jurShortName;
    const cand = (sourceIds?.["fec_candidate_id"] as string | undefined) ?? "";
    if (/^[SH][0-9][A-Z]{2}/.test(cand)) {
      const code = cand.substring(2, 4);
      if (VALID_STATES.has(code)) return code;
    }
    return "";
  }

  const officialById = new Map<string, {
    full_name: string;
    party: string | null;
    role_title: string | null;
    state: string;
  }>();
  for (const o of officials ?? []) {
    // jurisdictions:jurisdiction_id(short_name) collapses to a single object
    // because jurisdiction_id is a singular FK.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jur = (o as any).jurisdictions as { short_name: string | null } | null;
    officialById.set(o.id, {
      full_name: o.full_name,
      party: o.party,
      role_title: o.role_title,
      state: deriveState(
        o.metadata as Record<string, unknown> | null,
        o.source_ids as Record<string, unknown> | null,
        jur?.short_name ?? null,
      ),
    });
  }

  const totalByOfficial = new Map<string, number>();
  const officialIds = [...officialById.keys()];
  if (officialIds.length > 0) {
    const BATCH = 200;
    for (let i = 0; i < officialIds.length; i += BATCH) {
      const batch = officialIds.slice(i, i + BATCH);
      const { data: donations } = await supabase
        .from("financial_relationships")
        .select("to_id, amount_cents")
        .eq("relationship_type", "donation")
        .eq("to_type", "official")
        .in("to_id", batch);
      for (const d of donations ?? []) {
        totalByOfficial.set(d.to_id, (totalByOfficial.get(d.to_id) ?? 0) + (d.amount_cents ?? 0));
      }
    }
  }

  const rows: TreemapRow[] = [];
  for (const [officialId, totalCents] of totalByOfficial) {
    const o = officialById.get(officialId);
    if (!o) continue;
    rows.push({
      official_id: officialId,
      official_name: o.full_name,
      party: o.party ?? "Unknown",
      state: o.state,
      chamber: o.role_title === "Senator" ? "senate" : o.role_title === "Representative" ? "house" : (o.role_title ?? ""),
      total_donated_cents: totalCents,
    });
  }
  rows.sort((a, b) => b.total_donated_cents - a.total_donated_cents);
  const top = rows.slice(0, 200);

  return Response.json(top, {
    headers: { "Cache-Control": "public, max-age=0, s-maxage=86400, stale-while-revalidate=172800" },
  });
}
