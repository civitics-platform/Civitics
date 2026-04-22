import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@civitics/db";

export const dynamic = "force-dynamic";

// ─── GET /api/initiatives/[id]/follow ─────────────────────────────────────────
// Returns whether the current user is following this initiative, plus follower count.
// Returns { following: false, count: N } for unauthenticated users.

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(cookieStore);
    const { data: { user } } = await supabase.auth.getUser();

    const [followingRes, countRes] = await Promise.all([
      user
        ? supabase
            .from("civic_initiative_follows")
            .select("id")
            .eq("initiative_id", params.id)
            .eq("user_id", user.id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase
        .from("civic_initiative_follows")
        .select("*", { count: "exact", head: true })
        .eq("initiative_id", params.id),
    ]);

    return NextResponse.json({
      following: !!followingRes.data,
      count:     countRes.count ?? 0,
    });
  } catch {
    return NextResponse.json({ following: false, count: 0 });
  }
}

// ─── POST /api/initiatives/[id]/follow ────────────────────────────────────────
// Toggle follow: if already following, unfollow (DELETE); otherwise follow (INSERT).
// Returns { following: boolean, count: number }.

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
        { error: "Sign in to follow an initiative" },
        { status: 401 }
      );
    }

    // Verify initiative exists
    const { data: initiative, error: initError } = await supabase
      .from("initiative_details")
      .select("proposal_id")
      .eq("proposal_id", params.id)
      .maybeSingle();

    if (initError || !initiative) {
      return NextResponse.json({ error: "Initiative not found" }, { status: 404 });
    }

    // Check existing follow
    const { data: existing, error: checkError } = await supabase
      .from("civic_initiative_follows")
      .select("id")
      .eq("initiative_id", params.id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (checkError) {
      return NextResponse.json(
        { error: "Failed to check follow status" },
        { status: 500 }
      );
    }

    if (existing) {
      // Unfollow
      const { error: deleteError } = await supabase
        .from("civic_initiative_follows")
        .delete()
        .eq("id", existing.id);

      if (deleteError) {
        return NextResponse.json(
          { error: "Failed to unfollow" },
          { status: 500 }
        );
      }
    } else {
      // Follow
      const { error: insertError } = await supabase
        .from("civic_initiative_follows")
        .insert({ initiative_id: params.id, user_id: user.id });

      if (insertError) {
        return NextResponse.json(
          { error: "Failed to follow" },
          { status: 500 }
        );
      }
    }

    // Return updated count
    const { count } = await supabase
      .from("civic_initiative_follows")
      .select("*", { count: "exact", head: true })
      .eq("initiative_id", params.id);

    return NextResponse.json({
      following: !existing,
      count:     count ?? 0,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to toggle follow" },
      { status: 500 }
    );
  }
}
