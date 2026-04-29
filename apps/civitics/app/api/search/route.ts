/**
 * GET /api/search?q=query&type=all|officials|proposals|agencies|financial
 *
 * Universal search across officials, proposals, agencies, and financial entities.
 * Uses ILIKE with GIN trigram indexes (migration 0008, 0030).
 * Runs all four searches in parallel via Promise.all.
 *
 * Returns:
 *   { query, officials[], proposals[], agencies[], financial_entities[], total, timing_ms }
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, fetchIndustryTagsByEntityId } from "@civitics/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SearchOfficial = {
  id: string;
  full_name: string;
  role_title: string;
  party: string | null;
  state: string | null;
  photo_url: string | null;
  is_active: boolean;
  relevance_score: number;
};

export type SearchProposal = {
  id: string;
  title: string;
  status: string;
  type: string;
  comment_period_end: string | null;
  agency_acronym: string | null;
  ai_summary: string | null;
  relevance_score: number;
};

export type SearchAgency = {
  id: string;
  name: string;
  acronym: string | null;
  agency_type: string;
  description: string | null;
  relevance_score: number;
};

export type SearchFinancialEntity = {
  id: string;
  name: string;
  entity_type: string; // 'pac' | 'corporation' | 'individual' | etc.
  industry: string | null;
  total_amount_cents: number | null;
  relevance_score: number;
};

export type SearchResults = {
  query: string;
  officials: SearchOfficial[];
  proposals: SearchProposal[];
  agencies: SearchAgency[];
  financial_entities: SearchFinancialEntity[];
  total: number;
  timing_ms: number;
};

// ---------------------------------------------------------------------------
// Relevance scoring helpers
// ---------------------------------------------------------------------------

/** Base relevance score (0–100) for a name match against query. */
function baseRelevance(name: string, q: string): number {
  const nameLower = name.toLowerCase();
  const qLower = q.toLowerCase();
  if (nameLower === qLower) return 100;
  if (nameLower.startsWith(qLower)) return 80;
  // whole word check: query appears surrounded by word boundaries
  const wordBoundary = new RegExp(`\\b${qLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  if (wordBoundary.test(name)) return 60;
  if (nameLower.includes(qLower)) return 40;
  return 0;
}

/** Relevance when query appears in a description/summary field (not name). */
const DESC_SCORE = 20;

// ---------------------------------------------------------------------------
// Special query handlers
// ---------------------------------------------------------------------------

const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
  NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina",
  ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee",
  TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia",
};

const PARTY_KEYWORDS: Record<string, string> = {
  democrat: "democrat", democratic: "democrat", dem: "democrat",
  republican: "republican", rep: "republican", gop: "republican",
  independent: "independent", ind: "independent",
};

const ROLE_KEYWORDS: Record<string, string> = {
  senator: "Senator", senators: "Senator",
  representative: "Representative", representatives: "Representative",
  congressman: "Representative", congresswoman: "Representative",
};

// ---------------------------------------------------------------------------
// Route Handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const t0 = Date.now();
  const { searchParams } = req.nextUrl;
  const q = (searchParams.get("q") ?? "").trim();
  const typeFilter = searchParams.get("type") ?? "all";
  const limitParam = parseInt(searchParams.get("limit") ?? "10");
  const limit = Math.min(isNaN(limitParam) ? 10 : limitParam, 50);

  // Minimum 2 characters — return empty for very short queries
  if (q.length < 2) {
    return NextResponse.json({
      query: q,
      officials: [],
      proposals: [],
      agencies: [],
      financial_entities: [],
      total: 0,
      timing_ms: Date.now() - t0,
    } satisfies SearchResults);
  }

  const db = createAdminClient();
  const qLower = q.toLowerCase();

  // Detect special query patterns
  const stateAbbr = q.length === 2 ? q.toUpperCase() : null;
  const stateName = stateAbbr ? US_STATES[stateAbbr] : null;
  const partyFilter = PARTY_KEYWORDS[qLower];
  const roleFilter = ROLE_KEYWORDS[qLower];

  // ── Officials search ───────────────────────────────────────────────────────
  const searchOfficials = async (): Promise<SearchOfficial[]> => {
    if (typeFilter !== "all" && typeFilter !== "officials") return [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (db as any)
      .from("officials")
      .select("id, full_name, role_title, party, photo_url, is_active, metadata, source_ids")
      .eq("is_active", true)
      .limit(limit * 3); // fetch more so ranking can pick the best

    if (partyFilter) {
      query = query.eq("party", partyFilter);
    } else if (roleFilter) {
      query = query.eq("role_title", roleFilter);
    } else if (stateName) {
      query = query.filter("metadata->>state", "eq", stateAbbr);
    } else {
      query = query.or(`full_name.ilike.%${q}%,role_title.ilike.%${q}%`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await query;
    const officials: Array<{
      id: string; full_name: string; role_title: string; party: string | null;
      photo_url: string | null; is_active: boolean;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      metadata: any; source_ids: Record<string, string> | null;
    }> = data ?? [];

    if (officials.length === 0) return [];

    // Batch connection count lookup via RPC (avoids .in() large array bug)
    const ids = officials.map((o) => o.id);
    const { data: countData } = await (db as any).rpc('get_connection_counts', { entity_ids: ids });
    const countMap = new Map<string, number>();
    for (const r of countData ?? []) {
      countMap.set(r.entity_id, Number(r.connection_count));
    }

    // Rank priority (mirrors /api/graph/search logic)
    const rankPriority = (o: typeof officials[0]): number => {
      const name = o.full_name.toLowerCase();
      if (name === qLower) return 0;
      const lastName = (o.full_name.split(" ").pop() ?? "").toLowerCase();
      if (lastName === qLower) return 1;
      if (name.startsWith(qLower)) return 2;
      const isFederal = !!o.source_ids?.["congress_gov"];
      const connCount = countMap.get(o.id) ?? 0;
      if (isFederal && connCount > 0) return 3;
      if (isFederal) return 4;
      if (connCount > 0) return 5;
      return 6;
    };

    return officials
      .sort((a, b) => {
        const pa = rankPriority(a);
        const pb = rankPriority(b);
        if (pa !== pb) return pa - pb;
        const ca = countMap.get(a.id) ?? 0;
        const cb = countMap.get(b.id) ?? 0;
        if (cb !== ca) return cb - ca;
        return a.full_name.localeCompare(b.full_name);
      })
      .slice(0, limit)
      .map((o) => {
        const connCount = countMap.get(o.id) ?? 0;
        const isFederal = !!o.source_ids?.["congress_gov"];
        let score = baseRelevance(o.full_name, q);
        if (score === 0) score = DESC_SCORE; // matched role_title
        if (isFederal) score += 15;
        if (o.is_active) score += 10;
        if (connCount > 100) score += 5;
        return {
          id: o.id,
          full_name: o.full_name,
          role_title: o.role_title,
          party: o.party ?? null,
          state: o.metadata?.state ?? null,
          photo_url: o.photo_url ?? null,
          is_active: o.is_active,
          relevance_score: Math.min(score, 100),
        };
      });
  };

  // ── Proposals search ───────────────────────────────────────────────────────
  const searchProposals = async (): Promise<SearchProposal[]> => {
    if (typeFilter !== "all" && typeFilter !== "proposals") return [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: proposalData } = await (db as any)
      .from("proposals")
      .select("id, title, status, type, comment_period_end, metadata, summary_plain")
      .or(`title.ilike.%${q}%,summary_plain.ilike.%${q}%`)
      .limit(limit);

    // Fetch AI summaries for matched proposals
    const ids = (proposalData ?? []).map((p: { id: string }) => p.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const summaryRes = ids.length > 0
      ? await (db as any)
          .from("ai_summary_cache")
          .select("entity_id, summary_text")
          .eq("entity_type", "proposal")
          .in("entity_id", ids)
      : { data: [] };

    const summaryMap: Record<string, string> = {};
    for (const s of summaryRes.data ?? []) {
      summaryMap[s.entity_id] = s.summary_text;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (proposalData ?? []).map((p: any) => {
      let score = baseRelevance(p.title, q);
      if (score === 0) score = DESC_SCORE; // matched summary_plain
      if (p.status === "open_comment") score += 10;
      return {
        id: p.id,
        title: p.title,
        status: p.status,
        type: p.type,
        comment_period_end: p.comment_period_end ?? null,
        agency_acronym: p.metadata?.agency_id ?? null,
        ai_summary: summaryMap[p.id] ?? null,
        relevance_score: Math.min(score, 100),
      };
    });
  };

  // ── Agencies search ────────────────────────────────────────────────────────
  const searchAgencies = async (): Promise<SearchAgency[]> => {
    if (typeFilter !== "all" && typeFilter !== "agencies") return [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: agencyData } = await (db as any)
      .from("agencies")
      .select("id, name, acronym, agency_type, description")
      .eq("is_active", true)
      .or(`name.ilike.%${q}%,acronym.ilike.%${q}%,description.ilike.%${q}%`)
      .limit(limit);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (agencyData ?? []).map((a: any) => {
      const exactAcronym = a.acronym?.toUpperCase() === q.toUpperCase();
      let score = baseRelevance(a.name, q);
      if (score === 0) score = DESC_SCORE; // matched description
      if (exactAcronym) score += 20;
      return {
        id: a.id,
        name: a.name,
        acronym: a.acronym ?? null,
        agency_type: a.agency_type,
        description: a.description ?? null,
        relevance_score: Math.min(score, 100),
      };
    }).sort((a: SearchAgency, b: SearchAgency) => b.relevance_score - a.relevance_score);
  };

  // ── Financial entities search ──────────────────────────────────────────────
  const searchFinancialEntities = async (): Promise<SearchFinancialEntity[]> => {
    if (typeFilter !== "all" && typeFilter !== "financial") return [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (db as any)
      .from("financial_entities")
      .select("id, name, entity_type, total_amount_cents")
      .ilike("name", `%${q}%`)
      .order("total_amount_cents", { ascending: false, nullsFirst: false })
      .limit(limit);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (data ?? []) as any[];
    const industryByEntityId = await fetchIndustryTagsByEntityId(
      db,
      rows.map((f) => f.id as string),
    );

    return rows.map((f) => {
      let score = baseRelevance(f.name, q);
      if (f.total_amount_cents != null && f.total_amount_cents > 100_000_00) score += 5; // > $1M
      return {
        id: f.id,
        name: f.name,
        entity_type: f.entity_type,
        industry: industryByEntityId.get(f.id)?.display_label ?? null,
        total_amount_cents: f.total_amount_cents ?? null,
        relevance_score: Math.min(score, 100),
      };
    });
  };

  // ── Run in parallel ────────────────────────────────────────────────────────
  const [officials, proposals, agencies, financial_entities] = await Promise.all([
    searchOfficials(),
    searchProposals(),
    searchAgencies(),
    searchFinancialEntities(),
  ]);

  const total = officials.length + proposals.length + agencies.length + financial_entities.length;

  return NextResponse.json({
    query: q,
    officials,
    proposals,
    agencies,
    financial_entities,
    total,
    timing_ms: Date.now() - t0,
  } satisfies SearchResults);
}
