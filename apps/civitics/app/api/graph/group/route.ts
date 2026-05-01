export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, fetchIndustryTagsByEntityId, fetchEntityIdsByIndustryTag } from "@civitics/db";
import { supabaseUnavailable, unavailableResponse, withDbTimeout } from "@/lib/supabase-check";
import type { GraphEdgeV2 as GraphEdge, GraphNodeV2 as GraphNode, NodeTypeV2 as NodeType } from "@civitics/graph";

// Local extensions — group route adds metadata and id fields not in base types
type ResponseNode = GraphNode & { metadata?: Record<string, unknown> };
type ResponseEdge = GraphEdge & { id?: string; metadata?: Record<string, unknown> };

export async function GET(req: NextRequest) {
  if (supabaseUnavailable()) return unavailableResponse();

  const { searchParams } = req.nextUrl;
  const groupId    = searchParams.get("groupId")    ?? "group-unknown";
  const entityType = searchParams.get("entity_type") ?? "official";
  const chamber    = searchParams.get("chamber");
  const party      = searchParams.get("party");
  const state      = searchParams.get("state");
  const industry   = searchParams.get("industry");
  const tag        = searchParams.get("tag");
  const committeeId = searchParams.get("committeeId");
  const groupName  = searchParams.get("groupName")  ?? "Group";
  const groupIcon  = searchParams.get("groupIcon")  ?? "👥";
  const groupColor = searchParams.get("groupColor") ?? "#6366f1";
  const limit      = Math.min(parseInt(searchParams.get("limit") ?? "50"), 100);

  const supabase = createAdminClient();

  // ── Official group mode ──────────────────────────────────────────────────────
  // Who donated to this group of officials, and how much in aggregate?

  if (entityType === "official") {
    // Committee membership (FIX-139) is a join, not a direct officials column,
    // so resolve the cohort first and skip the officials.* filters when present.
    let memberIds: string[] = [];
    let memberCount: number | null = null;

    if (committeeId) {
      const { data: memberRows, error: memberErr } = await supabase
        .from("official_committee_memberships")
        .select("official_id")
        .eq("committee_id", committeeId)
        .is("ended_at", null);

      if (memberErr) {
        return NextResponse.json({ error: memberErr.message }, { status: 500 });
      }

      memberIds   = [...new Set((memberRows ?? []).map(r => r.official_id))];
      memberCount = memberIds.length;
    } else {
      let memberQuery = supabase
        .from("officials")
        .select("id", { count: "exact" })
        .eq("is_active", true);

      if (chamber === "senate")
        memberQuery = memberQuery.eq("role_title", "Senator");
      else if (chamber === "house")
        memberQuery = memberQuery.eq("role_title", "Representative");

      if (party)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        memberQuery = memberQuery.eq("party", party as any);

      if (state)
        // FIX-175: match metadata.state OR metadata.state_abbr to mirror the
        // treemap route's filter. FIX-124 backfilled state_abbr for federal
        // officials whose state lives in source_ids/jurisdictions; checking
        // only metadata.state silently drops them from state-filtered groups.
        memberQuery = memberQuery.or(
          `metadata->>state.eq.${state},metadata->>state_abbr.eq.${state}`,
        );

      // QWEN-ADDED: Add generic type to withDbTimeout for officials query with count
      const { count, data: memberData } = await withDbTimeout<{
        count: number | null;
        data: Array<{ id: string }> | null;
        error: { message: string } | null;
      }>(memberQuery.limit(1000));

      memberIds   = (memberData ?? []).map((m) => m.id);
      memberCount = count;
    }

    if (memberIds.length === 0) {
      return NextResponse.json({
        group: { id: groupId, name: groupName, count: 0 },
        nodes: [],
        edges: [],
      });
    }

    // Batch the .in() query — PostgREST URL limits break with hundreds of UUIDs
    const BATCH_SIZE = 100;
    const allDonationRows: Array<{ from_id: string; amount_cents: number | null }> = [];
    for (let i = 0; i < memberIds.length; i += BATCH_SIZE) {
      const batch = memberIds.slice(i, i + BATCH_SIZE);
      const { data: batchData } = await supabase
        .from("financial_relationships")
        .select("from_id, amount_cents")
        .eq("relationship_type", "donation")
        .eq("to_type", "official")
        .in("to_id", batch)
        .eq("from_type", "financial_entity")
        .order("amount_cents", { ascending: false })
        .limit(550);
      if (batchData) allDonationRows.push(...batchData);
    }

    // Resolve donor entity names + industry tags. Industry comes from
    // `entity_tags` (FIX-167): the legacy `financial_entities.industry` column
    // was dropped because it had been polluted with FEC CONNECTED_ORG_NM.
    const donorIds = [...new Set(allDonationRows.map((r) => r.from_id))];
    const donorInfo = new Map<string, { name: string; sector: string | null }>();
    if (donorIds.length > 0) {
      const [{ data: entities }, industryByEntityId] = await Promise.all([
        supabase
          .from("financial_entities")
          .select("id, display_name")
          .in("id", donorIds),
        fetchIndustryTagsByEntityId(supabase, donorIds),
      ]);
      for (const e of entities ?? []) {
        donorInfo.set(e.id, {
          name:   e.display_name,
          sector: industryByEntityId.get(e.id)?.display_label ?? null,
        });
      }
    }

    // Aggregate by donor across all group members
    const donorMap = new Map<string, {
      donorName: string;
      totalUsd: number;
      memberCount: number;
      sector: string | null;
    }>();

    for (const row of allDonationRows) {
      const info = donorInfo.get(row.from_id);
      if (!info) continue;
      // Skip generic "PAC/Committee" aggregate placeholder rows
      if (/PAC\/Committee/i.test(info.name)) continue;

      const key = info.name;
      const usd = (row.amount_cents ?? 0) / 100;

      if (donorMap.has(key)) {
        const existing = donorMap.get(key)!;
        existing.totalUsd    += usd;
        existing.memberCount += 1;
      } else {
        donorMap.set(key, { donorName: key, totalUsd: usd, memberCount: 1, sector: info.sector });
      }
    }

    const topDonors = [...donorMap.values()]
      .sort((a, b) => b.totalUsd - a.totalUsd)
      .slice(0, limit);

    // Group node represents the whole cohort as a single graph node
    const groupNode: ResponseNode = {
      id: groupId,
      name: groupName,
      type: "group" as NodeType,
      collapsed: false,
      metadata: {
        icon: groupIcon,
        color: groupColor,
        memberCount: memberCount ?? 0,
        isGroup: true,
      },
    };

    const connectedNodes: ResponseNode[] = topDonors.map((donor, i) => ({
      id: `donor-${groupId}-${i}`,
      name: donor.donorName,
      type: "financial" as NodeType,
      collapsed: false,
      metadata: { sector: donor.sector },
    }));

    const edges: ResponseEdge[] = topDonors.map((donor, i) => ({
      id: `edge-${groupId}-${i}`,
      fromId: `donor-${groupId}-${i}`,
      toId: groupId,
      connectionType: "donation",
      amountUsd: donor.totalUsd,
      strength: Math.min(donor.totalUsd / 1_000_000, 1),
      metadata: {
        memberCount: donor.memberCount,
        pctOfGroup: memberCount
          ? Math.round((donor.memberCount / memberCount) * 100)
          : 0,
      },
    }));

    return NextResponse.json({
      group: {
        id: groupId,
        name: groupName,
        icon: groupIcon,
        color: groupColor,
        count: memberCount ?? 0,
        filter: { entity_type: entityType, chamber, party, state, committeeId },
      },
      nodes: [groupNode, ...connectedNodes],
      edges,
      meta: {
        memberCount:      memberCount ?? 0,
        donorCount:       donorMap.size,
        topDonorsShown:   topDonors.length,
        totalDonatedUsd:  topDonors.reduce((s, d) => s + d.totalUsd, 0),
      },
    });
  }

  // ── PAC group mode ───────────────────────────────────────────────────────────
  // Which officials received the most money from PACs in this industry?

  if (entityType === "pac") {
    // Step 1: find the PAC financial_entities tagged with this industry.
    // Industry filter comes from `entity_tags.tag` now (FIX-167) — the legacy
    // `financial_entities.industry` column was dropped.
    const taggedIds = industry ? await fetchEntityIdsByIndustryTag(supabase, industry) : [];

    const pacEntitiesRows: Array<{ id: string; display_name: string }> = [];
    if (taggedIds.length > 0) {
      const BATCH_FILTER = 200;
      for (let i = 0; i < taggedIds.length; i += BATCH_FILTER) {
        const batch = taggedIds.slice(i, i + BATCH_FILTER);
        const { data } = await withDbTimeout<{
          data: Array<{ id: string; display_name: string }> | null;
          error: { message: string } | null;
        }>(
          supabase
            .from("financial_entities")
            .select("id, display_name")
            .eq("entity_type", "pac")
            .in("id", batch)
            .not("display_name", "ilike", "%PAC/Committee%"),
        );
        if (data) pacEntitiesRows.push(...data);
      }
    }

    const pacIds = pacEntitiesRows.map((p) => p.id);

    // Step 2: pull their donations to officials.
    const pacData: Array<{ to_id: string; amount_cents: number | null }> = [];
    if (pacIds.length > 0) {
      const BATCH = 200;
      for (let i = 0; i < pacIds.length; i += BATCH) {
        const batch = pacIds.slice(i, i + BATCH);
        const { data } = await supabase
          .from("financial_relationships")
          .select("to_id, amount_cents")
          .eq("relationship_type", "donation")
          .eq("from_type", "financial_entity")
          .in("from_id", batch)
          .eq("to_type", "official")
          .limit(5000);
        if (data) pacData.push(...data);
      }
    }

    const officialMap = new Map<string, {
      officialId: string;
      totalUsd: number;
      pacCount: number;
    }>();

    for (const row of pacData) {
      const id  = row.to_id;
      const usd = (row.amount_cents ?? 0) / 100;

      if (officialMap.has(id)) {
        const ex = officialMap.get(id)!;
        ex.totalUsd  += usd;
        ex.pacCount  += 1;
      } else {
        officialMap.set(id, { officialId: id, totalUsd: usd, pacCount: 1 });
      }
    }

    const topRecipients = [...officialMap.values()]
      .sort((a, b) => b.totalUsd - a.totalUsd)
      .slice(0, limit);

    const officialIds = topRecipients.map((r) => r.officialId);

    type OfficialRow = { id: string; full_name: string; party: string | null; metadata: Record<string, unknown> | null };
    const { data: officialsData } = officialIds.length > 0
      ? await supabase
          .from("officials")
          .select("id, full_name, party, metadata")
          .in("id", officialIds)
      : { data: [] as OfficialRow[] };

    const officialLookup = new Map(
      (officialsData ?? []).map((o) => [o.id, o as OfficialRow])
    );

    const groupNode: ResponseNode = {
      id: groupId,
      name: groupName,
      type: "group" as NodeType,
      collapsed: false,
      metadata: {
        icon: groupIcon,
        color: groupColor,
        memberCount: officialMap.size,
        isGroup: true,
        isPacGroup: true,
      },
    };

    const connectedNodes: ResponseNode[] = topRecipients.map((r) => {
      const official = officialLookup.get(r.officialId);
      return {
        id: r.officialId,
        name: official?.full_name ?? "Unknown",
        type: "official" as NodeType,
        collapsed: false,
        metadata: {
          party: official?.party,
          state: (official?.metadata as Record<string, unknown> | null)?.state,
        },
      };
    });

    // Edges flow from group to officials — PAC industry → recipients
    const edges: ResponseEdge[] = topRecipients.map((r) => ({
      id: `edge-${groupId}-${r.officialId}`,
      fromId: groupId,
      toId: r.officialId,
      connectionType: "donation",
      amountUsd: r.totalUsd,
      strength: Math.min(r.totalUsd / 100_000, 1),
      metadata: { pacCount: r.pacCount },
    }));

    return NextResponse.json({
      group: {
        id: groupId,
        name: groupName,
        icon: groupIcon,
        color: groupColor,
        count: officialMap.size,
        filter: { entity_type: entityType, industry },
      },
      nodes: [groupNode, ...connectedNodes],
      edges,
      meta: {
        totalPacDonors:      officialMap.size,
        topRecipientsShown:  topRecipients.length,
        totalDonatedUsd:     topRecipients.reduce((s, r) => s + r.totalUsd, 0),
      },
    });
  }

  // ── Proposal/topic-tag group mode (FIX-137) ───────────────────────────────
  // Surface a single group node carrying memberCount. Drill-down into the
  // member proposals and their connections (votes, sponsorships) is a future
  // enhancement — for now the tag bubble is the visible artifact and the
  // count is what the user reads.

  if (entityType === "proposal") {
    if (!tag) {
      return NextResponse.json(
        { error: "tag query param required for entity_type=proposal" },
        { status: 400 },
      );
    }

    const { count: rawCount } = await supabase
      .from("entity_tags")
      .select("entity_id", { count: "exact", head: true })
      .eq("entity_type", "proposal")
      .eq("tag_category", "topic")
      .eq("tag", tag)
      .neq("visibility", "internal");

    const memberCount = rawCount ?? 0;

    const groupNode: ResponseNode = {
      id: groupId,
      name: groupName,
      type: "group" as NodeType,
      collapsed: false,
      metadata: {
        icon: groupIcon,
        color: groupColor,
        memberCount,
        isGroup: true,
        isTagGroup: true,
        tag,
      },
    };

    return NextResponse.json({
      group: {
        id: groupId,
        name: groupName,
        icon: groupIcon,
        color: groupColor,
        count: memberCount,
        filter: { entity_type: entityType, tag },
      },
      nodes: [groupNode],
      edges: [],
      meta: { memberCount, tag },
    });
  }

  return NextResponse.json({ error: "Invalid entity_type" }, { status: 400 });
}
