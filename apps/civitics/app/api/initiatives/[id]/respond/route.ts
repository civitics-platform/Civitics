import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, createAdminClient } from "@civitics/db";

export const dynamic = "force-dynamic";

// ─── POST /api/initiatives/[id]/respond ──────────────────────────────────────
// Officials (or their verified staff) submit a formal response to an initiative
// that has an open response window.
//
// v1 identity model: any authenticated user may submit on behalf of an official_id.
// is_verified_staff = true when the submitter's email ends in .gov.
// This is intentionally permissive — a proper claim+verification flow comes later.
// The response becomes permanent public record; false submissions are flaggable.
//
// Request body:
//   official_id         — UUID of the official responding
//   response_type       — 'support' | 'oppose' | 'pledge' | 'refer'
//   body_text?          — optional explanation (≤2000 chars)
//   committee_referred? — committee name if response_type = 'refer'

const VALID_RESPONSE_TYPES = ["support", "oppose", "pledge", "refer"] as const;
type ResponseType = (typeof VALID_RESPONSE_TYPES)[number];

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(cookieStore);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "Authentication required to submit a response" },
        { status: 401 }
      );
    }

    // ── Parse + validate body ─────────────────────────────────────────────────
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const { official_id, response_type, body_text, committee_referred } = body;

    if (!official_id || typeof official_id !== "string") {
      return NextResponse.json(
        { error: "official_id is required" },
        { status: 400 }
      );
    }

    if (!response_type || !VALID_RESPONSE_TYPES.includes(response_type as ResponseType)) {
      return NextResponse.json(
        { error: `response_type must be one of: ${VALID_RESPONSE_TYPES.join(", ")}` },
        { status: 400 }
      );
    }

    if (body_text !== undefined && typeof body_text !== "string") {
      return NextResponse.json({ error: "body_text must be a string" }, { status: 400 });
    }

    if (body_text && (body_text as string).length > 2000) {
      return NextResponse.json({ error: "body_text must be 2000 characters or fewer" }, { status: 400 });
    }

    if (response_type === "refer" && !committee_referred) {
      return NextResponse.json(
        { error: "committee_referred is required when response_type is 'refer'" },
        { status: 400 }
      );
    }

    // ── Validate initiative stage ─────────────────────────────────────────────
    const { data: initiative, error: initError } = await supabase
      .from("initiative_details")
      .select("proposal_id, stage")
      .eq("proposal_id", params.id)
      .maybeSingle();

    if (initError || !initiative) {
      return NextResponse.json({ error: "Initiative not found" }, { status: 404 });
    }

    if (initiative.stage !== "mobilise") {
      return NextResponse.json(
        { error: "Official responses are only accepted for initiatives in mobilise stage" },
        { status: 400 }
      );
    }

    const adminClient = createAdminClient();

    // ── Validate official exists ──────────────────────────────────────────────
    const { data: official, error: officialError } = await adminClient
      .from("officials")
      .select("id, full_name")
      .eq("id", official_id)
      .single();

    if (officialError || !official) {
      return NextResponse.json({ error: "Official not found" }, { status: 404 });
    }

    // ── Check response window exists and is still open ────────────────────────
    const { data: existing, error: windowError } = await adminClient
      .from("civic_initiative_responses")
      .select("id, window_closes_at, responded_at")
      .eq("initiative_id", params.id)
      .eq("official_id", official_id)
      .maybeSingle();

    if (windowError) {
      return NextResponse.json(
        { error: "Failed to check response window" },
        { status: 500 }
      );
    }

    if (!existing) {
      return NextResponse.json(
        { error: "No response window found for this official on this initiative" },
        { status: 404 }
      );
    }

    if (new Date(existing.window_closes_at) < new Date()) {
      return NextResponse.json(
        { error: "The 30-day response window has closed" },
        { status: 400 }
      );
    }

    if (existing.responded_at) {
      return NextResponse.json(
        { error: "A response has already been submitted for this window" },
        { status: 409 }
      );
    }

    // ── Determine verification level ──────────────────────────────────────────
    // v1: .gov email = treated as verified government staff.
    // A proper domain + claim verification flow is deferred.
    const is_verified_staff = (user.email ?? "").toLowerCase().endsWith(".gov");

    // ── Submit response ───────────────────────────────────────────────────────
    const { error: updateError } = await adminClient
      .from("civic_initiative_responses")
      .update({
        response_type:      response_type as ResponseType,
        body_text:          typeof body_text === "string" ? body_text : null,
        committee_referred: typeof committee_referred === "string" ? committee_referred : null,
        responded_at:       new Date().toISOString(),
        is_verified_staff,
      })
      .eq("id", existing.id);

    if (updateError) {
      return NextResponse.json(
        { error: "Failed to submit response" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success:          true,
      official_name:    official.full_name,
      response_type,
      is_verified_staff,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to process response" },
      { status: 500 }
    );
  }
}
