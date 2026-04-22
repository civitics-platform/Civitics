import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, createAdminClient } from "@civitics/db";

export const dynamic = "force-dynamic";

// ─── POST /api/initiatives/[id]/upvote ───────────────────────────────────────
// Toggle upvote on an initiative. Returns { upvoted: boolean, count: number }.

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(cookieStore);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "Sign in to upvote" },
        { status: 401 }
      );
    }

    // Verify initiative exists
    const { data: initiative } = await supabase
      .from("initiative_details")
      .select("proposal_id")
      .eq("proposal_id", params.id)
      .maybeSingle();

    if (!initiative) {
      return NextResponse.json({ error: "Initiative not found" }, { status: 404 });
    }

    const admin = createAdminClient();

    // Check existing upvote
    const { data: existing } = await admin
      .from("civic_initiative_upvotes")
      .select("id")
      .eq("initiative_id", params.id)
      .eq("user_id", user.id)
      .single();

    let upvoted: boolean;

    if (existing) {
      // Remove upvote
      await admin
        .from("civic_initiative_upvotes")
        .delete()
        .eq("initiative_id", params.id)
        .eq("user_id", user.id);
      upvoted = false;
    } else {
      // Add upvote
      await admin.from("civic_initiative_upvotes").insert({
        initiative_id: params.id,
        user_id: user.id,
      });
      upvoted = true;
    }

    // Return updated count
    const { count } = await admin
      .from("civic_initiative_upvotes")
      .select("*", { count: "exact", head: true })
      .eq("initiative_id", params.id);

    return NextResponse.json({ upvoted, count: count ?? 0 });
  } catch {
    return NextResponse.json(
      { error: "Failed to toggle upvote" },
      { status: 500 }
    );
  }
}

// ─── GET /api/initiatives/[id]/upvote ────────────────────────────────────────
// Check whether the current user has upvoted. Returns { upvoted: boolean }.

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(cookieStore);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ upvoted: false });
    }

    const { data } = await supabase
      .from("civic_initiative_upvotes")
      .select("id")
      .eq("initiative_id", params.id)
      .eq("user_id", user.id)
      .single();

    return NextResponse.json({ upvoted: !!data });
  } catch {
    return NextResponse.json({ upvoted: false });
  }
}
