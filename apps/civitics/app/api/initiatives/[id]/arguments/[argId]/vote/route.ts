import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, createAdminClient } from "@civitics/db";

export const dynamic = "force-dynamic";

// ─── POST /api/initiatives/[id]/arguments/[argId]/vote ───────────────────────
// Toggle vote on an argument. Returns { voted: boolean, vote_count: number }.

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string; argId: string } }
) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(cookieStore);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Sign in to vote" }, { status: 401 });
    }

    // Verify argument exists and belongs to this initiative
    const { data: argument } = await supabase
      .from("civic_initiative_arguments")
      .select("id,initiative_id,is_deleted")
      .eq("id", params.argId)
      .single();

    if (!argument || argument.initiative_id !== params.id) {
      return NextResponse.json({ error: "Argument not found" }, { status: 404 });
    }
    if (argument.is_deleted) {
      return NextResponse.json({ error: "Cannot vote on a deleted argument" }, { status: 400 });
    }

    const admin = createAdminClient();

    // Check existing vote
    const { data: existing } = await admin
      .from("civic_initiative_argument_votes")
      .select("id")
      .eq("argument_id", params.argId)
      .eq("user_id", user.id)
      .single();

    let voted: boolean;

    if (existing) {
      await admin
        .from("civic_initiative_argument_votes")
        .delete()
        .eq("argument_id", params.argId)
        .eq("user_id", user.id);
      voted = false;
    } else {
      await admin.from("civic_initiative_argument_votes").insert({
        argument_id: params.argId,
        user_id: user.id,
      });
      voted = true;
    }

    // Return updated count
    const { count } = await admin
      .from("civic_initiative_argument_votes")
      .select("*", { count: "exact", head: true })
      .eq("argument_id", params.argId);

    return NextResponse.json({ voted, vote_count: count ?? 0 });
  } catch {
    return NextResponse.json({ error: "Failed to toggle vote" }, { status: 500 });
  }
}

// ─── GET /api/initiatives/[id]/arguments/[argId]/vote ────────────────────────
// Check if current user has voted on this argument.

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string; argId: string } }
) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(cookieStore);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ voted: false });
    }

    const { data } = await supabase
      .from("civic_initiative_argument_votes")
      .select("id")
      .eq("argument_id", params.argId)
      .eq("user_id", user.id)
      .single();

    return NextResponse.json({ voted: !!data });
  } catch {
    return NextResponse.json({ voted: false });
  }
}
