import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, createAdminClient } from "@civitics/db";

export const dynamic = "force-dynamic";

// ─── GET /api/proposals/[id]/position ─────────────────────────────────────────
// Returns aggregated position counts for a proposal

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(cookieStore);

    const { data, error } = await supabase
      .from("civic_comments")
      .select("position")
      .eq("proposal_id", params.id)
      .eq("is_deleted", false)
      .not("position", "is", null);

    if (error) {
      return NextResponse.json(
        { error: "Failed to fetch positions" },
        { status: 500 }
      );
    }

    const counts = { support: 0, oppose: 0, neutral: 0, question: 0, total: 0 };
    for (const row of data ?? []) {
      const pos = row.position;
      if (pos && pos in counts) {
        counts[pos as keyof typeof counts]++;
      }
      counts.total++;
    }

    return NextResponse.json(counts);
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch positions" },
      { status: 500 }
    );
  }
}

// ─── POST /api/proposals/[id]/position ────────────────────────────────────────
// Records or updates a user's position on a proposal.
// Body: { position: 'support' | 'oppose' | 'neutral' | 'question' }
// Requires auth.

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
        { error: "Sign in to record your position" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { position } = body;

    if (!position || !["support", "oppose", "neutral", "question"].includes(position)) {
      return NextResponse.json(
        { error: "Valid position is required" },
        { status: 400 }
      );
    }

    const adminDb = createAdminClient();

    // Check if user already has a position for this proposal
    const { data: existing } = await adminDb
      .from("civic_comments")
      .select("id")
      .eq("proposal_id", params.id)
      .eq("user_id", user.id)
      .not("position", "is", null)
      .eq("is_deleted", false)
      .maybeSingle();

    let result;
    if (existing) {
      // Update existing row
      result = await adminDb
        .from("civic_comments")
        .update({ position })
        .eq("id", existing.id)
        .select("id,position,created_at,updated_at")
        .single();
    } else {
      // Insert new row
      result = await adminDb
        .from("civic_comments")
        .insert({
          proposal_id: params.id,
          user_id: user.id,
          position,
          body: "", // body is NOT NULL in schema — set empty for position-only rows
        })
        .select("id,position,created_at,updated_at")
        .single();
    }

    if (result.error) {
      return NextResponse.json(
        { error: "Failed to record position" },
        { status: 500 }
      );
    }

    return NextResponse.json({ recorded: result.data }, { status: 200 });
  } catch {
    return NextResponse.json(
      { error: "Failed to record position" },
      { status: 500 }
    );
  }
}
