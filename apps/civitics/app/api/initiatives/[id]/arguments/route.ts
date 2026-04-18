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
// Returns all top-level arguments + their replies for an initiative.
// Also returns vote counts per argument.
// Response: { for: ArgumentRow[], against: ArgumentRow[] }
// Each top-level row has a `replies` array.

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(cookieStore);

    // Verify initiative exists
    const { data: initiative } = await supabase
      .from("civic_initiatives")
      .select("id")
      .eq("id", params.id)
      .single();

    if (!initiative) {
      return NextResponse.json({ error: "Initiative not found" }, { status: 404 });
    }

    // Fetch all arguments (top-level + replies) in one query, newest first
    const { data: args, error } = await supabase
      .from("civic_initiative_arguments")
      .select("id,initiative_id,parent_id,side,body,author_id,is_deleted,flag_count,created_at,updated_at")
      .eq("initiative_id", params.id)
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ error: "Failed to fetch arguments" }, { status: 500 });
    }

    const rows = args ?? [];

    // Fetch vote counts for all arguments in one pass
    // We need count(*) per argument_id from civic_initiative_argument_votes
    const argIds = rows.map((a) => a.id);
    let voteCounts: Record<string, number> = {};

    if (argIds.length > 0) {
      // Use individual counts — array is small enough to be fine
      const { data: voteRows } = await supabase
        .from("civic_initiative_argument_votes")
        .select("argument_id")
        .in("argument_id", argIds);

      for (const v of voteRows ?? []) {
        voteCounts[v.argument_id] = (voteCounts[v.argument_id] ?? 0) + 1;
      }
    }

    // Attach vote counts and redact deleted bodies
    const enriched: (typeof rows[number] & { vote_count: number })[] = rows.map((a) => ({
      ...a,
      body: a.is_deleted ? "[deleted]" : a.body,
      vote_count: voteCounts[a.id] ?? 0,
    }));

    // Build tree: separate top-level from replies
    type EnrichedArg = typeof enriched[number] & { replies: typeof enriched };
    const topLevel = enriched.filter((a) => a.parent_id === null) as EnrichedArg[];
    const byParent: Record<string, typeof enriched> = {};
    for (const a of enriched) {
      if (a.parent_id) {
        if (!byParent[a.parent_id]) byParent[a.parent_id] = [];
        byParent[a.parent_id]!.push(a);
      }
    }

    // Attach replies to each top-level argument
    for (const arg of topLevel) {
      arg.replies = byParent[arg.id] ?? [];
    }

    // Sort top-level by vote_count desc (best rises), then created_at asc
    const sorted = topLevel.sort((a, b) => b.vote_count - a.vote_count || new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    return NextResponse.json({
      for:     sorted.filter((a) => a.side === "for"),
      against: sorted.filter((a) => a.side === "against"),
      total:   topLevel.length,
    });
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
      .from("civic_initiatives")
      .select("id,stage")
      .eq("id", params.id)
      .single();

    if (!initiative) {
      return NextResponse.json({ error: "Initiative not found" }, { status: 404 });
    }
    if (initiative.stage !== "deliberate" && initiative.stage !== "mobilise") {
      return NextResponse.json(
        { error: "Arguments can only be submitted during deliberation or mobilisation." },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { side, body: argBody, parent_id } = body;

    // Validate
    if (!side || !["for", "against"].includes(side)) {
      return NextResponse.json({ error: "Side must be 'for' or 'against'" }, { status: 400 });
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
      // Replies cannot be nested more than one level deep (keep thread flat)
      if (parent.parent_id !== null) {
        return NextResponse.json(
          { error: "Replies cannot be nested — reply to the top-level argument instead." },
          { status: 400 }
        );
      }
    }

    const admin = createAdminClient();
    const { data: inserted, error: insertErr } = await admin
      .from("civic_initiative_arguments")
      .insert({
        initiative_id: params.id,
        parent_id: parent_id ?? null,
        side,
        body: argBody.trim(),
        author_id: user.id,
      })
      .select("id,side,body,parent_id,created_at")
      .single();

    if (insertErr) {
      return NextResponse.json({ error: "Failed to submit argument" }, { status: 500 });
    }

    return NextResponse.json({ argument: inserted }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to submit argument" }, { status: 500 });
  }
}
