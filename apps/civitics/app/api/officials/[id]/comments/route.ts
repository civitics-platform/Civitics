import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, createAdminClient } from "@civitics/db";

export const dynamic = "force-dynamic";

// ─── GET /api/officials/[id]/comments ─────────────────────────────────────────
// Returns community comments for an official, ordered by created_at DESC, limit 50.
// Uses official_community_comments table (separate from civic_comments which is
// proposal-specific). Requires migration 20260415223406_official_community_comments.

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const cookieStore = await cookies();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createServerClient(cookieStore) as any;

    const { data, error } = await supabase
      .from("official_community_comments")
      .select("id,body,created_at,upvotes,user_id,is_deleted")
      .eq("official_id", params.id)
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

// ─── POST /api/officials/[id]/comments ────────────────────────────────────────
// Creates a community comment on an official's profile. Requires auth.

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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adminDb = createAdminClient() as any;

    const { data, error } = await adminDb
      .from("official_community_comments")
      .insert({
        official_id: params.id,
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
