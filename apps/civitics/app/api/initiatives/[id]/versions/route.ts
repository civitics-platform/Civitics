import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@civitics/db";

export const dynamic = "force-dynamic";

// ─── GET /api/initiatives/[id]/versions ──────────────────────────────────────
// Returns version history for an initiative, newest first.
// Each version is a snapshot of body_md + title before an edit was applied.

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(cookieStore);

    // Verify initiative exists (RLS: public read)
    const { data: initiative } = await supabase
      .from("civic_initiatives")
      .select("id")
      .eq("id", params.id)
      .single();

    if (!initiative) {
      return NextResponse.json({ error: "Initiative not found" }, { status: 404 });
    }

    // Fetch versions newest first
    const { data: versions, error } = await supabase
      .from("civic_initiative_versions")
      .select("id,version_number,title,body_md,edited_by,created_at")
      .eq("initiative_id", params.id)
      .order("version_number", { ascending: false });

    if (error) {
      return NextResponse.json({ error: "Failed to fetch versions" }, { status: 500 });
    }

    return NextResponse.json({ versions: versions ?? [] });
  } catch {
    return NextResponse.json({ error: "Failed to fetch versions" }, { status: 500 });
  }
}
