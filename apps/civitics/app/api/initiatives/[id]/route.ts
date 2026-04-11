import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, createAdminClient } from "@civitics/db";
import type { Database } from "@civitics/db";

export const dynamic = "force-dynamic";

type InitiativeDetail = Database["public"]["Tables"]["civic_initiatives"]["Row"];
type ResponseRow = Database["public"]["Tables"]["civic_initiative_responses"]["Row"];

const VALID_STAGES = ["draft", "deliberate", "mobilise", "resolved"] as const;
const VALID_SCOPES = ["federal", "state", "local"] as const;

// ─── GET /api/initiatives/[id] ────────────────────────────────────────────────
// Full initiative detail with signature counts and official responses.

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(cookieStore);

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

    // Fetch counts and responses in parallel
    const [totalRes, verifiedRes, upvoteRes, responsesRes] = await Promise.all([
      supabase
        .from("civic_initiative_signatures")
        .select("*", { count: "exact", head: true })
        .eq("initiative_id", params.id),
      supabase
        .from("civic_initiative_signatures")
        .select("*", { count: "exact", head: true })
        .eq("initiative_id", params.id)
        .eq("verification_tier", "district"),
      supabase
        .from("civic_initiative_upvotes")
        .select("*", { count: "exact", head: true })
        .eq("initiative_id", params.id),
      supabase
        .from("civic_initiative_responses")
        .select(
          "id,official_id,response_type,body_text,committee_referred,window_opened_at,window_closes_at,responded_at,is_verified_staff"
        )
        .eq("initiative_id", params.id),
    ]);

    return NextResponse.json({
      initiative: initiative as InitiativeDetail,
      signature_counts: {
        total: totalRes.count ?? 0,
        constituent_verified: verifiedRes.count ?? 0,
      },
      upvote_count: upvoteRes.count ?? 0,
      responses: (responsesRes.data ?? []) as ResponseRow[],
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch initiative" },
      { status: 500 }
    );
  }
}

// ─── PATCH /api/initiatives/[id] ─────────────────────────────────────────────
// Update an initiative (draft/deliberate stage only). Snapshots current body_md
// as a version before applying the update.

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(cookieStore);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "Sign in to edit an initiative" },
        { status: 401 }
      );
    }

    // Fetch current initiative — must be author, and stage must be draft or deliberate
    const { data: current, error: fetchErr } = await supabase
      .from("civic_initiatives")
      .select("id,title,body_md,stage,primary_author_id")
      .eq("id", params.id)
      .single();

    if (fetchErr || !current) {
      return NextResponse.json({ error: "Initiative not found" }, { status: 404 });
    }
    if (current.primary_author_id !== user.id) {
      return NextResponse.json({ error: "Only the author can edit this initiative" }, { status: 403 });
    }
    if (current.stage !== "draft" && current.stage !== "deliberate") {
      return NextResponse.json(
        { error: "Proposal text is frozen once mobilising begins" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { title, summary, body_md, scope, issue_area_tags } = body;

    // Validate
    if (title !== undefined) {
      if (typeof title !== "string" || title.length < 10 || title.length > 120) {
        return NextResponse.json({ error: "Title must be 10–120 characters" }, { status: 400 });
      }
    }
    if (summary !== undefined && typeof summary === "string" && summary.length > 500) {
      return NextResponse.json({ error: "Summary must be 500 characters or less" }, { status: 400 });
    }
    if (scope !== undefined && !VALID_SCOPES.includes(scope as (typeof VALID_SCOPES)[number])) {
      return NextResponse.json({ error: "Scope must be federal, state, or local" }, { status: 400 });
    }

    const admin = createAdminClient();

    // Snapshot the current version before overwriting
    const bodyChanged = body_md !== undefined && body_md.trim() !== current.body_md;
    const titleChanged = title !== undefined && title.trim() !== current.title;

    if (bodyChanged || titleChanged) {
      // Get highest version number for this initiative
      const { data: latestVersion } = await admin
        .from("civic_initiative_versions")
        .select("version_number")
        .eq("initiative_id", params.id)
        .order("version_number", { ascending: false })
        .limit(1)
        .single();

      const nextVersion = (latestVersion?.version_number ?? 0) + 1;

      await admin.from("civic_initiative_versions").insert({
        initiative_id: params.id,
        version_number: nextVersion,
        body_md: current.body_md,
        title: current.title,
        edited_by: user.id,
      });
    }

    // Apply update
    const updates: Record<string, unknown> = {};
    if (title !== undefined) updates.title = title.trim();
    if (summary !== undefined) updates.summary = summary?.trim() ?? null;
    if (body_md !== undefined) updates.body_md = body_md.trim();
    if (scope !== undefined) updates.scope = scope;
    if (Array.isArray(issue_area_tags)) updates.issue_area_tags = issue_area_tags;

    const { data: updated, error: updateErr } = await admin
      .from("civic_initiatives")
      .update(updates)
      .eq("id", params.id)
      .select("id,title,stage,updated_at")
      .single();

    if (updateErr) {
      return NextResponse.json({ error: "Failed to update initiative" }, { status: 500 });
    }

    return NextResponse.json({ initiative: updated });
  } catch {
    return NextResponse.json({ error: "Failed to update initiative" }, { status: 500 });
  }
}
