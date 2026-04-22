import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, createAdminClient } from "@civitics/db";

export const dynamic = "force-dynamic";

// ─── POST /api/initiatives/[id]/link-proposal ─────────────────────────────────
// Link or unlink a legislative proposal to this initiative.
// Only the initiative's primary author can manage links.
//
// Request body:
//   proposal_id  — UUID of the proposal to link
//   unlink?      — set true to remove the link instead of creating it

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
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const { proposal_id, unlink } = body;

    if (!proposal_id || typeof proposal_id !== "string") {
      return NextResponse.json(
        { error: "proposal_id is required" },
        { status: 400 }
      );
    }

    // Verify initiative exists and user is the primary author
    const { data: initiative, error: initError } = await supabase
      .from("initiative_details")
      .select("proposal_id, primary_author_id")
      .eq("proposal_id", params.id)
      .maybeSingle();

    if (initError || !initiative) {
      return NextResponse.json({ error: "Initiative not found" }, { status: 404 });
    }

    if (initiative.primary_author_id !== user.id) {
      return NextResponse.json(
        { error: "Only the initiative author can manage proposal links" },
        { status: 403 }
      );
    }

    const adminClient = createAdminClient();

    if (unlink === true) {
      // Remove link
      const { error: deleteError } = await adminClient
        .from("civic_initiative_proposal_links")
        .delete()
        .eq("initiative_id", params.id)
        .eq("proposal_id", proposal_id);

      if (deleteError) {
        return NextResponse.json(
          { error: "Failed to remove link" },
          { status: 500 }
        );
      }

      return NextResponse.json({ linked: false });
    }

    // Verify proposal exists
    const { data: proposal, error: propError } = await adminClient
      .from("proposals")
      .select("id, title, bill_details(bill_number)")
      .eq("id", proposal_id)
      .single();

    if (propError || !proposal) {
      return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bd = Array.isArray(proposal.bill_details) ? (proposal.bill_details[0] as any) : (proposal.bill_details as any);

    // Create link (idempotent — ignore if already linked)
    const { error: insertError } = await adminClient
      .from("civic_initiative_proposal_links")
      .insert({
        initiative_id: params.id,
        proposal_id,
        linked_by: user.id,
      });

    if (insertError && insertError.code !== "23505") {
      return NextResponse.json(
        { error: "Failed to create link" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      linked:       true,
      proposal_id:  proposal.id,
      title:        proposal.title,
      bill_number:  bd?.bill_number ?? null,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to process link" },
      { status: 500 }
    );
  }
}

// ─── GET /api/initiatives/[id]/link-proposal ──────────────────────────────────
// Returns all proposals linked to this initiative.

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(cookieStore);

    const { data, error } = await supabase
      .from("civic_initiative_proposal_links")
      .select("proposal_id, proposals!proposal_id(id, title, short_title, status, type, bill_details(bill_number))")
      .eq("initiative_id", params.id)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { error: "Failed to fetch links" },
        { status: 500 }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proposals = (data ?? []).map((row: any) => {
      const p = row.proposals;
      if (!p) return null;
      const bd = Array.isArray(p.bill_details) ? p.bill_details[0] : p.bill_details;
      return {
        id:          p.id,
        title:       p.title,
        short_title: p.short_title,
        status:      p.status,
        type:        p.type,
        bill_number: bd?.bill_number ?? null,
      };
    }).filter(Boolean);
    return NextResponse.json({ proposals });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch links" },
      { status: 500 }
    );
  }
}
