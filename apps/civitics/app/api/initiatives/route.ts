import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@civitics/db";

export const dynamic = "force-dynamic";

// QWEN-ADDED: type definitions for civic initiatives API responses
type InitiativeRow = {
  id: string;
  title: string;
  summary: string | null;
  stage: "draft" | "deliberate" | "mobilise" | "resolved";
  scope: "federal" | "state" | "local";
  authorship_type: "individual" | "community";
  issue_area_tags: string[];
  target_district: string | null;
  mobilise_started_at: string | null;
  created_at: string;
  resolved_at: string | null;
};

const VALID_STAGES = ["draft", "deliberate", "mobilise", "resolved"] as const;
const VALID_SCOPES = ["federal", "state", "local"] as const;

// ─── GET /api/initiatives ─────────────────────────────────────────────────────
// Paginated list of initiatives, filterable by stage/scope/tag.

export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(cookieStore);

    const { searchParams } = request.nextUrl;
    const stage = searchParams.get("stage");
    const scope = searchParams.get("scope");
    const tag = searchParams.get("tag");
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1") || 1);
    const limit = Math.min(
      Math.max(1, parseInt(searchParams.get("limit") ?? "20") || 20),
      50
    );
    const offset = (page - 1) * limit;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    let query = db
      .from("civic_initiatives")
      .select(
        "id,title,summary,stage,scope,authorship_type,issue_area_tags,target_district,mobilise_started_at,created_at,resolved_at",
        { count: "exact" }
      );

    if (stage && VALID_STAGES.includes(stage as (typeof VALID_STAGES)[number])) {
      query = query.eq("stage", stage);
    }
    if (scope && VALID_SCOPES.includes(scope as (typeof VALID_SCOPES)[number])) {
      query = query.eq("scope", scope);
    }
    if (tag) {
      query = query.contains("issue_area_tags", [tag]);
    }

    const { data, error, count } = await query
      .order("mobilise_started_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return NextResponse.json(
        { error: "Failed to fetch initiatives" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      initiatives: (data ?? []) as InitiativeRow[],
      total: count ?? 0,
      page,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch initiatives" },
      { status: 500 }
    );
  }
}

// ─── POST /api/initiatives ────────────────────────────────────────────────────
// Create a new initiative. Auth required.

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(cookieStore);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "Sign in to create an initiative" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { title, summary, body_md, scope, issue_area_tags, linked_proposal_id } = body;

    // Validation
    if (!title || typeof title !== "string") {
      return NextResponse.json(
        { error: "Title is required" },
        { status: 400 }
      );
    }
    if (title.length < 10 || title.length > 120) {
      return NextResponse.json(
        { error: "Title must be between 10 and 120 characters" },
        { status: 400 }
      );
    }
    if (!body_md || typeof body_md !== "string" || body_md.trim().length === 0) {
      return NextResponse.json(
        { error: "Body text is required" },
        { status: 400 }
      );
    }
    if (summary && typeof summary === "string" && summary.length > 500) {
      return NextResponse.json(
        { error: "Summary must be 500 characters or less" },
        { status: 400 }
      );
    }
    if (!scope || !VALID_SCOPES.includes(scope as (typeof VALID_SCOPES)[number])) {
      return NextResponse.json(
        { error: "Scope must be one of: federal, state, local" },
        { status: 400 }
      );
    }

    // Use supabase (authenticated server client) — not createAdminClient.
    // RLS civic_initiatives_insert_own enforces primary_author_id = auth.uid() at DB level.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;

    const { data, error } = await db
      .from("civic_initiatives")
      .insert({
        title: title.trim(),
        summary: summary?.trim() ?? null,
        body_md: body_md.trim(),
        scope,
        issue_area_tags: Array.isArray(issue_area_tags) ? issue_area_tags : [],
        linked_proposal_id: linked_proposal_id ?? null,
        primary_author_id: user.id,
        stage: "draft",
        authorship_type: "individual",
      })
      .select("id,title,stage")
      .single();

    if (error) {
      return NextResponse.json(
        { error: "Failed to create initiative" },
        { status: 500 }
      );
    }

    return NextResponse.json({ initiative: data }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Failed to create initiative" },
      { status: 500 }
    );
  }
}
