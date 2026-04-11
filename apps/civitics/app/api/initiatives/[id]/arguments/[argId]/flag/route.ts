import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, createAdminClient } from "@civitics/db";

export const dynamic = "force-dynamic";

const VALID_FLAG_TYPES = ["off_topic", "misleading", "duplicate", "other"] as const;

// ─── POST /api/initiatives/[id]/arguments/[argId]/flag ───────────────────────
// Flag an argument. One flag per user per argument. Idempotent.
// Body: { flag_type: 'off_topic' | 'misleading' | 'duplicate' | 'other' }

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; argId: string } }
) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(cookieStore);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Sign in to flag an argument" }, { status: 401 });
    }

    // Verify argument belongs to this initiative
    const { data: argument } = await supabase
      .from("civic_initiative_arguments")
      .select("id,initiative_id,author_id")
      .eq("id", params.argId)
      .single();

    if (!argument || argument.initiative_id !== params.id) {
      return NextResponse.json({ error: "Argument not found" }, { status: 404 });
    }
    if (argument.author_id === user.id) {
      return NextResponse.json({ error: "Cannot flag your own argument" }, { status: 400 });
    }

    const body = await request.json();
    const { flag_type } = body;

    if (!flag_type || !VALID_FLAG_TYPES.includes(flag_type as (typeof VALID_FLAG_TYPES)[number])) {
      return NextResponse.json(
        { error: "flag_type must be one of: off_topic, misleading, duplicate, other" },
        { status: 400 }
      );
    }

    const admin = createAdminClient();

    // Idempotent — if already flagged, just return success
    const { data: existing } = await admin
      .from("civic_initiative_argument_flags")
      .select("id")
      .eq("argument_id", params.argId)
      .eq("user_id", user.id)
      .single();

    if (existing) {
      return NextResponse.json({ flagged: true });
    }

    // Insert flag record
    const { error } = await admin.from("civic_initiative_argument_flags").insert({
      argument_id: params.argId,
      user_id: user.id,
      flag_type,
    });

    if (error) {
      return NextResponse.json({ error: "Failed to submit flag" }, { status: 500 });
    }

    // Update denormalised flag_count on the argument row
    const { count: flagCount } = await admin
      .from("civic_initiative_argument_flags")
      .select("*", { count: "exact", head: true })
      .eq("argument_id", params.argId);

    await admin
      .from("civic_initiative_arguments")
      .update({ flag_count: flagCount ?? 1 })
      .eq("id", params.argId);

    return NextResponse.json({ flagged: true });
  } catch {
    return NextResponse.json({ error: "Failed to submit flag" }, { status: 500 });
  }
}
