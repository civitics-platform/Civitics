/**
 * GET /api/search
 *
 * Params:
 *   q           — text query (optional when explicit filters are present)
 *   type        — all|officials|proposals|agencies|financial
 *   cursor      — opaque pagination cursor (base64 JSON {offset})
 *   limit       — override per-page size (max 50, default PAGE_SIZE)
 *
 * Official filters:    party, state, chamber (senate|house), is_active
 * Proposal filters:    status, proposal_type, date_from, date_to
 * Agency filters:      agency_type
 * Financial filters:   entity_type, industry, min_amount, max_amount (USD)
 *
 * Returns SearchResults — same shape as before but with has_more, next_cursor,
 * and connection_count on every result item.
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
  connection_count: number;
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
  connection_count: number;
};

export type SearchAgency = {
  id: string;
  name: string;
  acronym: string | null;
  agency_type: string;
  description: string | null;
  relevance_score: number;
  connection_count: number;
};

export type SearchFinancialEntity = {
  id: string;
  name: string;
  entity_type: string;
  industry: string | null;
  total_amount_cents: number | null;
  relevance_score: number;
  connection_count: number;
};

export type SearchResults = {
  query: string;
  officials: SearchOfficial[];
  proposals: SearchProposal[];
  agencies: SearchAgency[];
  financial_entities: SearchFinancialEntity[];
  total: number;
  timing_ms: number;
  has_more: boolean;
  next_cursor: string | null;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20;

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
// Helpers
// ---------------------------------------------------------------------------

function baseRelevance(name: string, q: string): number {
  const nameLower = name.toLowerCase();
  const qLower = q.toLowerCase();
  if (nameLower === qLower) return 100;
  if (nameLower.startsWith(qLower)) return 80;
  const wordBoundary = new RegExp(`\\b${qLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  if (wordBoundary.test(name)) return 60;
  if (nameLower.includes(qLower)) return 40;
  return 0;
}

const DESC_SCORE = 20;

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset })).toString("base64");
}

function decodeCursor(cursor: string): number {
  try {
    return (JSON.parse(Buffer.from(cursor, "base64").toString("utf-8")) as { offset?: number }).offset ?? 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Route Handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const t0 = Date.now();
  const sp = req.nextUrl.searchParams;

  const q = (sp.get("q") ?? "").trim();
  const typeFilter = sp.get("type") ?? "all";
  const cursor = sp.get("cursor") ?? null;
  const offset = cursor ? decodeCursor(cursor) : 0;
  const limitParam = parseInt(sp.get("limit") ?? String(PAGE_SIZE));
  const pageSize = Math.min(isNaN(limitParam) ? PAGE_SIZE : limitParam, 50);

  // Explicit filter params — officials
  const filterParty    = sp.get("party")     ?? null;
  const filterState    = sp.get("state")     ?? null;
  const filterChamber  = sp.get("chamber")   ?? null; // senate|house
  const filterIsActive = sp.get("is_active") !== "false"; // default: true

  // Explicit filter params — proposals
  const filterStatus       = sp.get("status")        ?? null;
  const filterProposalType = sp.get("proposal_type") ?? null;
  const filterDateFrom     = sp.get("date_from")     ?? null;
  const filterDateTo       = sp.get("date_to")       ?? null;

  // Explicit filter params — agencies
  const filterAgencyType = sp.get("agency_type") ?? null;

  // Explicit filter params — financial
  const filterEntityType     = sp.get("entity_type") ?? null;
  const filterIndustry       = sp.get("industry")    ?? null;
  const filterMinAmountCents = sp.get("min_amount")  ? Number(sp.get("min_amount")) * 100 : null;
  const filterMaxAmountCents = sp.get("max_amount")  ? Number(sp.get("max_amount")) * 100 : null;

  const hasExplicitFilters = !!(
    filterParty || filterState || filterChamber ||
    filterStatus || filterProposalType || filterDateFrom || filterDateTo ||
    filterAgencyType ||
    filterEntityType || filterIndustry || filterMinAmountCents || filterMaxAmountCents
  );

  // Allow empty query only when explicit filters are present (browse mode)
  if (q.length < 2 && !hasExplicitFilters) {
    return NextResponse.json({
      query: q, officials: [], proposals: [], agencies: [], financial_entities: [],
      total: 0, timing_ms: Date.now() - t0, has_more: false, next_cursor: null,
    } satisfies SearchResults);
  }

  const db = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db2 = db as any;
  const qLower = q.toLowerCase();

  // Text-based heuristics (skipped when explicit filter covers the same dimension)
  const stateAbbr  = !filterState  && q.length === 2 ? q.toUpperCase() : null;
  const stateMatch = stateAbbr && US_STATES[stateAbbr] ? stateAbbr : null;
  const partyMatch = !filterParty   ? (PARTY_KEYWORDS[qLower] ?? null) : null;
  const roleMatch  = !filterChamber ? (ROLE_KEYWORDS[qLower] ?? null)  : null;

  // Pagination mode: single-type uses cursor pagination; "all" returns first page only
  const isPaginated = typeFilter !== "all";
  const fetchLimit  = isPaginated ? pageSize + 1 : pageSize * 3;

  // Batch connection count helper (single RPC call per search function)
  async function getConnectionCounts(ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const { data } = await db2.rpc("get_connection_counts", { entity_ids: ids });
    const map = new Map<string, number>();
    for (const r of (data ?? []) as Array<{ entity_id: string; connection_count: number | string }>) {
      map.set(r.entity_id, Number(r.connection_count));
    }
    return map;
  }

  // ── Officials ──────────────────────────────────────────────────────────────
  const searchOfficials = async (): Promise<{ results: SearchOfficial[]; hasMore: boolean }> => {
    if (typeFilter !== "all" && typeFilter !== "officials") return { results: [], hasMore: false };

    let qb = db2
      .from("officials")
      .select("id, full_name, role_title, party, photo_url, is_active, metadata, source_ids");

    // Structural filters
    if (filterIsActive) qb = qb.eq("is_active", true);
    if (filterParty) qb = qb.eq("party", filterParty);
    if (filterState) qb = qb.filter("metadata->>state", "eq", filterState);
    if (filterChamber === "senate") qb = qb.eq("role_title", "Senator");
    if (filterChamber === "house")  qb = qb.ilike("role_title", "Representative%");

    // Text search or heuristic filters (only when no explicit override for that dimension)
    if (q.length >= 2) {
      if (!filterParty && partyMatch) {
        qb = qb.eq("party", partyMatch);
      } else if (!filterChamber && roleMatch) {
        qb = qb.eq("role_title", roleMatch);
      } else if (!filterState && stateMatch) {
        qb = qb.filter("metadata->>state", "eq", stateMatch);
      } else if (!filterParty && !filterChamber && !filterState) {
        qb = qb.or(`full_name.ilike.%${q}%,role_title.ilike.%${q}%`);
      }
    }

    // Ordering + pagination
    if (isPaginated) {
      qb = qb.order("full_name", { ascending: true }).range(offset, offset + fetchLimit - 1);
    } else {
      qb = qb.limit(fetchLimit); // no explicit order — JS ranks below
    }

    const { data } = await qb;
    const rows: Array<{
      id: string; full_name: string; role_title: string; party: string | null;
      photo_url: string | null; is_active: boolean;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      metadata: any; source_ids: Record<string, string> | null;
    }> = data ?? [];

    if (rows.length === 0) return { results: [], hasMore: false };

    const hasMore = isPaginated && rows.length > pageSize;
    const resultRows = isPaginated ? rows.slice(0, pageSize) : rows;
    const countMap = await getConnectionCounts(resultRows.map((r) => r.id));

    // JS ranking for the "all" tab (first-page quality)
    let ranked = resultRows;
    if (!isPaginated) {
      ranked = rows
        .sort((a, b) => {
          const pri = (o: typeof rows[0]): number => {
            const name = o.full_name.toLowerCase();
            if (name === qLower) return 0;
            const last = (o.full_name.split(" ").pop() ?? "").toLowerCase();
            if (last === qLower) return 1;
            if (name.startsWith(qLower)) return 2;
            const isFed = !!o.source_ids?.["congress_gov"];
            const conn = countMap.get(o.id) ?? 0;
            if (isFed && conn > 0) return 3;
            if (isFed) return 4;
            if (conn > 0) return 5;
            return 6;
          };
          const pa = pri(a), pb = pri(b);
          if (pa !== pb) return pa - pb;
          return (countMap.get(b.id) ?? 0) - (countMap.get(a.id) ?? 0);
        })
        .slice(0, pageSize);
    }

    const results = ranked.map((o) => {
      const connCount = countMap.get(o.id) ?? 0;
      const isFederal = !!o.source_ids?.["congress_gov"];
      let score = q.length >= 2 ? baseRelevance(o.full_name, q) : 50;
      if (score === 0) score = DESC_SCORE;
      if (isFederal) score += 15;
      if (o.is_active) score += 10;
      if (connCount > 100) score += 5;
      return {
        id: o.id, full_name: o.full_name, role_title: o.role_title,
        party: o.party ?? null, state: o.metadata?.state ?? null,
        photo_url: o.photo_url ?? null, is_active: o.is_active,
        relevance_score: Math.min(score, 100),
        connection_count: connCount,
      };
    });
    return { results, hasMore };
  };

  // ── Proposals ──────────────────────────────────────────────────────────────
  const searchProposals = async (): Promise<{ results: SearchProposal[]; hasMore: boolean }> => {
    if (typeFilter !== "all" && typeFilter !== "proposals") return { results: [], hasMore: false };

    let qb = db2
      .from("proposals")
      .select("id, title, status, type, comment_period_end, metadata, summary_plain");

    // Structural filters
    if (filterStatus) qb = qb.eq("status", filterStatus);
    if (filterProposalType) qb = qb.eq("type", filterProposalType);
    if (filterDateFrom) qb = qb.gte("comment_period_end", filterDateFrom);
    if (filterDateTo)   qb = qb.lte("comment_period_end", filterDateTo);

    // Text search
    if (q.length >= 2) {
      qb = qb.or(`title.ilike.%${q}%,summary_plain.ilike.%${q}%`);
    }

    // Order + pagination
    if (isPaginated) {
      qb = qb.order("comment_period_end", { ascending: false, nullsFirst: false })
             .range(offset, offset + fetchLimit - 1);
    } else {
      qb = qb.limit(pageSize);
    }

    const { data: proposalData } = await qb;
    const rows = proposalData ?? [];
    if (rows.length === 0) return { results: [], hasMore: false };

    const hasMore = isPaginated && rows.length > pageSize;
    const resultRows = isPaginated ? rows.slice(0, pageSize) : rows;

    const ids = resultRows.map((p: { id: string }) => p.id);
    const [summaryRes, countMap] = await Promise.all([
      ids.length > 0
        ? db2.from("ai_summary_cache").select("entity_id, summary_text")
             .eq("entity_type", "proposal").in("entity_id", ids)
        : Promise.resolve({ data: [] }),
      getConnectionCounts(ids),
    ]);
    const summaryMap: Record<string, string> = {};
    for (const s of summaryRes.data ?? []) summaryMap[s.entity_id] = s.summary_text;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results = resultRows.map((p: any) => {
      let score = q.length >= 2 ? baseRelevance(p.title, q) : 50;
      if (score === 0) score = DESC_SCORE;
      if (p.status === "open_comment") score += 10;
      return {
        id: p.id, title: p.title, status: p.status, type: p.type,
        comment_period_end: p.comment_period_end ?? null,
        agency_acronym: p.metadata?.agency_id ?? null,
        ai_summary: summaryMap[p.id] ?? null,
        relevance_score: Math.min(score, 100),
        connection_count: countMap.get(p.id) ?? 0,
      };
    });
    return { results, hasMore };
  };

  // ── Agencies ───────────────────────────────────────────────────────────────
  const searchAgencies = async (): Promise<{ results: SearchAgency[]; hasMore: boolean }> => {
    if (typeFilter !== "all" && typeFilter !== "agencies") return { results: [], hasMore: false };

    let qb = db2
      .from("agencies")
      .select("id, name, acronym, agency_type, description")
      .eq("is_active", true);

    if (filterAgencyType) qb = qb.eq("agency_type", filterAgencyType);

    if (q.length >= 2) {
      qb = qb.or(`name.ilike.%${q}%,acronym.ilike.%${q}%,description.ilike.%${q}%`);
    }

    if (isPaginated) {
      qb = qb.order("name", { ascending: true }).range(offset, offset + fetchLimit - 1);
    } else {
      qb = qb.limit(pageSize);
    }

    const { data: agencyData } = await qb;
    const rows = agencyData ?? [];
    if (rows.length === 0) return { results: [], hasMore: false };

    const hasMore = isPaginated && rows.length > pageSize;
    const resultRows = isPaginated ? rows.slice(0, pageSize) : rows;
    const countMap = await getConnectionCounts(resultRows.map((a: { id: string }) => a.id));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results = resultRows.map((a: any) => {
      const exactAcronym = a.acronym?.toUpperCase() === q.toUpperCase();
      let score = q.length >= 2 ? baseRelevance(a.name, q) : 50;
      if (score === 0) score = DESC_SCORE;
      if (exactAcronym) score += 20;
      return {
        id: a.id, name: a.name, acronym: a.acronym ?? null,
        agency_type: a.agency_type, description: a.description ?? null,
        relevance_score: Math.min(score, 100),
        connection_count: countMap.get(a.id) ?? 0,
      };
    }).sort((a: SearchAgency, b: SearchAgency) => b.relevance_score - a.relevance_score);
    return { results, hasMore };
  };

  // ── Financial entities ─────────────────────────────────────────────────────
  const searchFinancialEntities = async (): Promise<{ results: SearchFinancialEntity[]; hasMore: boolean }> => {
    if (typeFilter !== "all" && typeFilter !== "financial") return { results: [], hasMore: false };

    let qb = db
      .from("financial_entities")
      .select("id, display_name, entity_type, total_donated_cents")
      .neq("entity_type", "individual");

    if (filterEntityType) qb = qb.eq("entity_type", filterEntityType);
    if (filterMinAmountCents) qb = qb.gte("total_donated_cents", filterMinAmountCents);
    if (filterMaxAmountCents) qb = qb.lte("total_donated_cents", filterMaxAmountCents);

    // Industry filter: look up entity_ids from entity_tags, then filter
    if (filterIndustry) {
      const { data: tagRows } = await db2
        .from("entity_tags")
        .select("entity_id")
        .eq("tag_type", "industry")
        .ilike("tag_value", filterIndustry);
      const tagIds = (tagRows ?? []).map((r: { entity_id: string }) => r.entity_id);
      if (tagIds.length === 0) return { results: [], hasMore: false };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      qb = (qb as any).in("id", tagIds);
    }

    if (q.length >= 2) {
      qb = qb.ilike("display_name", `%${q}%`);
    }

    qb = qb.order("total_donated_cents", { ascending: false, nullsFirst: false });

    if (isPaginated) {
      qb = qb.range(offset, offset + fetchLimit - 1);
    } else {
      qb = qb.limit(pageSize);
    }

    const { data } = await qb;
    const rows = data ?? [];
    if (rows.length === 0) return { results: [], hasMore: false };

    const hasMore = isPaginated && rows.length > pageSize;
    const resultRows = isPaginated ? rows.slice(0, pageSize) : rows;
    const [industryByEntityId, countMap] = await Promise.all([
      fetchIndustryTagsByEntityId(db, resultRows.map((f: { id: string }) => f.id)),
      getConnectionCounts(resultRows.map((f: { id: string }) => f.id)),
    ]);

    const results = resultRows.map((f: { id: string; display_name: string; entity_type: string; total_donated_cents: number | null }) => {
      const amountCents = f.total_donated_cents ?? null;
      let score = q.length >= 2 ? baseRelevance(f.display_name, q) : 50;
      if (amountCents != null && amountCents > 100_000_00) score += 5;
      return {
        id: f.id, name: f.display_name, entity_type: f.entity_type,
        industry: industryByEntityId.get(f.id)?.display_label ?? null,
        total_amount_cents: amountCents,
        relevance_score: Math.min(score, 100),
        connection_count: countMap.get(f.id) ?? 0,
      };
    });
    return { results, hasMore };
  };

  // ── Run in parallel ────────────────────────────────────────────────────────
  const [
    { results: officials,          hasMore: officialsMore },
    { results: proposals,          hasMore: proposalsMore },
    { results: agencies,           hasMore: agenciesMore },
    { results: financial_entities, hasMore: financialMore },
  ] = await Promise.all([
    searchOfficials(),
    searchProposals(),
    searchAgencies(),
    searchFinancialEntities(),
  ]);

  const has_more = officialsMore || proposalsMore || agenciesMore || financialMore;
  const next_cursor = has_more && isPaginated ? encodeCursor(offset + pageSize) : null;
  const total = officials.length + proposals.length + agencies.length + financial_entities.length;

  return NextResponse.json({
    query: q, officials, proposals, agencies, financial_entities,
    total, timing_ms: Date.now() - t0, has_more, next_cursor,
  } satisfies SearchResults);
}
