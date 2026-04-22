import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, createAdminClient } from "@civitics/db";

export const dynamic = "force-dynamic";

// ─── Types ────────────────────────────────────────────────────────────────────

type ArgumentRow = {
  id: string;
  initiative_id: string;
  parent_id: string | null;
  side: "for" | "against";
  body: string;
  author_id: string | null;
  is_deleted: boolean;
  flag_count: number;
  created_at: string;
  updated_at: string;
  vote_count: number;   // injected after fetch
};

// ─── GET /api/initiatives/[id]/arguments ─────────────────────────────────────
// Returns all comments for an initiative as a recursive tree.
// Response: { comments: CommentTree[], total: number }

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(cookieStore);

    const { data: initiative } = await supabase
      .from("initiative_details")
      .select("proposal_id")
      .eq("proposal_id", params.id)
      .maybeSingle();

    if (!initiative) {
      return NextResponse.json({ error: "Initiative not found" }, { status: 404 });
    }

    const { data: args, error } = await supabase
      .from("civic_initiative_arguments")
      .select("id,initiative_id,parent_id,side,comment_type,body,author_id,is_deleted,flag_count,created_at,updated_at")
      .eq("initiative_id", params.id)
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ error: "Failed to fetch arguments" }, { status: 500 });
    }

    const rows = args ?? [];

    const argIds = rows.map((a) => a.id);
    const voteCounts: Record<string, number> = {};

    if (argIds.length > 0) {
      const { data: voteRows } = await supabase
        .from("civic_initiative_argument_votes")
        .select("argument_id")
        .in("argument_id", argIds);

      for (const v of voteRows ?? []) {
        voteCounts[v.argument_id] = (voteCounts[v.argument_id] ?? 0) + 1;
      }
    }

    type BaseRow = typeof rows[number] & { vote_count: number };
    type CommentTree = BaseRow & { replies: CommentTree[] };

    const enriched: BaseRow[] = rows.map((a) => ({
      ...a,
      body: a.is_deleted ? "[deleted]" : a.body,
      vote_count: voteCounts[a.id] ?? 0,
    }));

    // Build recursive tree using a map
    const map: Record<string, CommentTree> = {};
    for (const a of enriched) map[a.id] = { ...a, replies: [] };

    const roots: CommentTree[] = [];
    for (const a of enriched) {
      const node = map[a.id]!;
      if (a.parent_id === null) {
        roots.push(node);
      } else {
        map[a.parent_id]?.replies.push(node);
      }
    }

    roots.sort((a, b) => b.vote_count - a.vote_count || new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    return NextResponse.json({ comments: roots, total: roots.length });
  } catch {
    return NextResponse.json({ error: "Failed to fetch arguments" }, { status: 500 });
  }
}

// ─── POST /api/initiatives/[id]/arguments ────────────────────────────────────
// Submit a new argument (top-level or reply). Auth required.
// Body: { side: 'for' | 'against', body: string, parent_id?: string }

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(cookieStore);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Sign in to submit an argument" }, { status: 401 });
    }

    // Verify initiative exists and is in deliberate or mobilise stage
    const { data: initiative } = await supabase
      .from("initiative_details")
      .select("proposal_id,stage")
      .eq("proposal_id", params.id)
      .maybeSingle();

    if (!initiative) {
      return NextResponse.json({ error: "Initiative not found" }, { status: 404 });
    }
    if (!["problem", "deliberate", "mobilise"].includes(initiative.stage)) {
      return NextResponse.json(
        { error: "Arguments can only be submitted during problem identification, deliberation, or mobilisation." },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { side, body: argBody, parent_id, comment_type } = body;

    const SIDED_TYPES = ["for", "against", "support", "oppose"];
    const ALL_TYPES = [
      ...SIDED_TYPES,
      "concern", "amendment", "question", "evidence", "precedent",
      "tradeoff", "stakeholder_impact", "experience", "cause", "solution",
      "discussion",
    ];

    const resolvedType: string | null = comment_type ?? null;
    const resolvedSide: string | null = side ?? null;

    if (resolvedType && !ALL_TYPES.includes(resolvedType)) {
      return NextResponse.json({ error: `Invalid comment_type '${resolvedType}'` }, { status: 400 });
    }
    // Side required only when stage demands it (deliberate/mobilise) AND type is sided
    const stageDemandsSide = initiative.stage !== "problem";
    const typeDemandsSide = !resolvedType || SIDED_TYPES.includes(resolvedType);
    if (stageDemandsSide && typeDemandsSide) {
      if (!resolvedSide || !["for", "against"].includes(resolvedSide)) {
        return NextResponse.json({ error: "Side must be 'for' or 'against'" }, { status: 400 });
      }
    }

    if (!argBody || typeof argBody !== "string") {
      return NextResponse.json({ error: "Argument body is required" }, { status: 400 });
    }
    if (argBody.trim().length < 10) {
      return NextResponse.json({ error: "Argument must be at least 10 characters" }, { status: 400 });
    }
    if (argBody.trim().length > 1000) {
      return NextResponse.json({ error: "Argument must be 1000 characters or fewer" }, { status: 400 });
    }

    // If reply: verify parent exists and belongs to this initiative
    if (parent_id) {
      const { data: parent } = await supabase
        .from("civic_initiative_arguments")
        .select("id,initiative_id,side,parent_id")
        .eq("id", parent_id)
        .single();

      if (!parent || parent.initiative_id !== params.id) {
        return NextResponse.json({ error: "Parent argument not found" }, { status: 400 });
      }
    }

    const admin = createAdminClient();
    const { data: inserted, error: insertErr } = await admin
      .from("civic_initiative_arguments")
      .insert({
        initiative_id: params.id,
        parent_id: parent_id ?? null,
        side: resolvedSide as "for" | "against" | null,
        comment_type: resolvedType,
        body: argBody.trim(),
        author_id: user.id,
      })
      .select("id,side,comment_type,body,parent_id,created_at")
      .single();

    if (insertErr) {
      return NextResponse.json({ error: "Failed to submit argument" }, { status: 500 });
    }

    return NextResponse.json({ comment: inserted }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to submit argument" }, { status: 500 });
  }
}
