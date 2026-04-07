import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, createAdminClient } from "@civitics/db";

export const dynamic = "force-dynamic";

// ─── GET /api/proposals/[id]/comments ─────────────────────────────────────────
// Returns comments for a proposal, ordered by created_at DESC, limit 50

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(cookieStore);

    const { data, error } = await supabase
      .from("civic_comments")
      .select("id,body,created_at,upvotes,user_id,is_deleted")
      .eq("proposal_id", params.id)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      return NextResponse.json(
        { error: "Failed to fetch comments" },
        { status: 500 }
      );
    }

    return NextResponse.json({ comments: data ?? [] });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch comments" },
      { status: 500 }
    );
  }
}

// ─── POST /api/proposals/[id]/comments ────────────────────────────────────────
// Creates a comment. Body: { text: string }.
// Requires auth — civic_comments.user_id is NOT NULL REFERENCES users(id).
// Anonymous posting will be enabled once auth (Phase 1 remaining task) is wired.

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Auth gate — user_id is NOT NULL in schema, so we need a real session.
    // Once Supabase auth is wired (Phase 1 remaining), replace this with:
    //   const cookieStore = await cookies();
    //   const supabase = createServerClient(cookieStore);
    //   const { data: { user } } = await supabase.auth.getUser();
    //   if (!user) return NextResponse.json({ error: "Sign in to comment" }, { status: 401 });
    const cookieStore = await cookies();
    const supabase = createServerClient(cookieStore);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "Sign in to comment" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { text } = body;

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "Text is required" },
        { status: 400 }
      );
    }

    if (text.length > 2000) {
      return NextResponse.json(
        { error: "Comment must be less than 2000 characters" },
        { status: 400 }
      );
    }

    const adminDb = createAdminClient();

    const { data, error } = await adminDb
      .from("civic_comments")
      .insert({
        proposal_id: params.id,
        body: text.trim(),
        user_id: user.id,
      })
      .select("id,body,created_at,upvotes,user_id,is_deleted")
      .single();

    if (error) {
      return NextResponse.json(
        { error: "Failed to create comment" },
        { status: 500 }
      );
    }

    return NextResponse.json({ comment: data }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Failed to create comment" },
      { status: 500 }
    );
  }
}
