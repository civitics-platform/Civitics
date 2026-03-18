export const dynamic = "force-dynamic";

import { createAdminClient } from "@civitics/db";
import { NextResponse } from "next/server";

export async function GET() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any;

  const [officials, proposals, votes, financial, connections, comments, breakdown] =
    await Promise.all([
      db.from("officials").select("*", { count: "exact", head: true }),
      db.from("proposals").select("*", { count: "exact", head: true }),
      db.from("votes").select("*", { count: "exact", head: true }),
      db.from("financial_relationships").select("*", { count: "exact", head: true }),
      db.from("entity_connections").select("*", { count: "exact", head: true }),
      db.from("civic_comments").select("*", { count: "exact", head: true }),
      db.rpc("get_officials_breakdown"),
    ]);

  type BreakdownRow = { category: string; count: number };
  const breakdownRows: BreakdownRow[] = breakdown.data ?? [];
  const getBreakdown = (cat: string) =>
    breakdownRows.find((r) => r.category === cat)?.count ?? 0;

  return NextResponse.json(
    {
      counts: {
        officials: officials.count ?? 0,
        proposals: proposals.count ?? 0,
        votes: votes.count ?? 0,
        financial: financial.count ?? 0,
        connections: connections.count ?? 0,
        comments: comments.count ?? 0,
      },
      officialsBreakdown: {
        federal: getBreakdown("federal"),
        state: getBreakdown("state"),
        judges: getBreakdown("judges"),
      },
      fetchedAt: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
