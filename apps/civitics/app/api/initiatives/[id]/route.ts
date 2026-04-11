import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@civitics/db";

export const dynamic = "force-dynamic";

// QWEN-ADDED: type definitions for initiative detail response
type InitiativeDetail = {
  id: string;
  title: string;
  summary: string | null;
  body_md: string;
  stage: "draft" | "deliberate" | "mobilise" | "resolved";
  authorship_type: "individual" | "community";
  primary_author_id: string | null;
  linked_proposal_id: string | null;
  scope: "federal" | "state" | "local";
  target_district: string | null;
  issue_area_tags: string[];
  quality_gate_score: Record<string, unknown>;
  mobilise_started_at: string | null;
  resolved_at: string | null;
  resolution_type: string | null;
  created_at: string;
  updated_at: string;
};

// QWEN-ADDED: type for official response rows
type ResponseRow = {
  id: string;
  official_id: string;
  response_type: "support" | "oppose" | "pledge" | "refer" | "no_response";
  body_text: string | null;
  committee_referred: string | null;
  window_opened_at: string;
  window_closes_at: string;
  responded_at: string | null;
  is_verified_staff: boolean;
};

// ─── GET /api/initiatives/[id] ────────────────────────────────────────────────
// Full initiative detail with signature counts and official responses.

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const cookieStore = await cookies();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createServerClient(cookieStore) as any;

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
