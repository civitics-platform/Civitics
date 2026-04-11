import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@civitics/db";
import type { Database } from "@civitics/db";

export const dynamic = "force-dynamic";

type InitiativeDetail = Database["public"]["Tables"]["civic_initiatives"]["Row"];
type ResponseRow = Database["public"]["Tables"]["civic_initiative_responses"]["Row"];

// ─── GET /api/initiatives/[id] ────────────────────────────────────────────────
// Full initiative detail with signature counts and official responses.

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(cookieStore);

    // Fetch initiative detail
    const { data: initiative, error: initError } = await supabase
      .from("civic_initiatives")
      .select("*")
      .eq("id", params.id)
      .single();

    if (initError || !initiative) {
      return NextResponse.json(
        { error: "Initiative not found" },
        { status: 404 }
      );
    }

    // Fetch signature counts in parallel
    const [totalRes, verifiedRes] = await Promise.all([
      supabase
        .from("civic_initiative_signatures")
        .select("*", { count: "exact", head: true })
        .eq("initiative_id", params.id),
      supabase
        .from("civic_initiative_signatures")
        .select("*", { count: "exact", head: true })
        .eq("initiative_id", params.id)
        .eq("verification_tier", "district"),
    ]);

    // Fetch official responses
    const { data: responses } = await supabase
      .from("civic_initiative_responses")
      .select(
        "id,official_id,response_type,body_text,committee_referred,window_opened_at,window_closes_at,responded_at,is_verified_staff"
      )
      .eq("initiative_id", params.id);

    return NextResponse.json({
      initiative: initiative as InitiativeDetail,
      signature_counts: {
        total: totalRes.count ?? 0,
        constituent_verified: verifiedRes.count ?? 0,
      },
      responses: (responses ?? []) as ResponseRow[],
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch initiative" },
      { status: 500 }
    );
  }
}
