import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, createAdminClient } from "@civitics/db";
import { checkAndFireMilestones } from "../../_lib/milestones";

export const dynamic = "force-dynamic";

// ─── GET /api/initiatives/[id]/sign ───────────────────────────────────────────
// Returns whether the current user has signed this initiative.
// Returns { signed: false } for unauthenticated requests.

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(cookieStore);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ signed: false });
    }

    const { data } = await supabase
      .from("civic_initiative_signatures")
      .select("id")
      .eq("initiative_id", params.id)
      .eq("user_id", user.id)
      .maybeSingle();

    return NextResponse.json({ signed: !!data });
  } catch {
    return NextResponse.json({ signed: false });
  }
}

// ─── POST /api/initiatives/[id]/sign ──────────────────────────────────────────
// Toggle a signature: if already signed, unsign (DELETE); otherwise sign (INSERT).
// Only initiatives in 'mobilise' stage accept signatures.

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
        { error: "Sign in to sign an initiative" },
        { status: 401 }
      );
    }

    // Use supabase (authenticated server client) throughout — not createAdminClient.
    // civic_initiatives has a public read policy so supabase can read it fine.
    // civic_initiative_signatures RLS policies (insert_own / delete_own) rely on
    // auth.uid() being set, which createServerClient provides correctly.

    // Fetch initiative to check stage
    const { data: initiative, error: initError } = await supabase
      .from("initiative_details")
      .select("proposal_id,stage")
      .eq("proposal_id", params.id)
      .maybeSingle();

    if (initError || !initiative) {
      return NextResponse.json(
        { error: "Initiative not found" },
        { status: 404 }
      );
    }

    // QWEN-ADDED: stage validation — only mobilise stage accepts signatures
    if (initiative.stage === "resolved") {
      return NextResponse.json(
        { error: "This initiative is resolved and no longer accepting signatures." },
        { status: 400 }
      );
    }

    if (initiative.stage !== "mobilise") {
      return NextResponse.json(
        { error: "This initiative is not currently accepting signatures." },
        { status: 400 }
      );
    }

    // Check if user already signed
    const { data: existingSig, error: sigError } = await supabase
      .from("civic_initiative_signatures")
      .select("id")
      .eq("initiative_id", params.id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (sigError) {
      return NextResponse.json(
        { error: "Failed to check signature status" },
        { status: 500 }
      );
    }

    if (existingSig) {
      // Unsign — delete the existing signature
      // RLS policy civic_sigs_delete_own (USING user_id = auth.uid()) enforces ownership.
      const { error: deleteError } = await supabase
        .from("civic_initiative_signatures")
        .delete()
        .eq("id", existingSig.id);

      if (deleteError) {
        return NextResponse.json(
          { error: "Failed to remove signature" },
          { status: 500 }
        );
      }

      return NextResponse.json({ signed: false });
    }

    // Sign — insert new signature
    // RLS policy civic_sigs_insert_own (WITH CHECK user_id = auth.uid()) enforces ownership.
    const { error: insertError } = await supabase
      .from("civic_initiative_signatures")
      .insert({
        initiative_id: params.id,
        user_id: user.id,
        verification_tier: "unverified",
      });

    if (insertError) {
      return NextResponse.json(
        { error: "Failed to add signature" },
        { status: 500 }
      );
    }

    // ── Milestone check ──────────────────────────────────────────────────────
    // After a new signature is added, check if any thresholds have been crossed.
    // Runs async (fire-and-forget) so it never delays the sign response.
    const adminClient = createAdminClient();
    const [totalRes, constituentRes] = await Promise.all([
      adminClient
        .from("civic_initiative_signatures")
        .select("*", { count: "exact", head: true })
        .eq("initiative_id", params.id),
      adminClient
        .from("civic_initiative_signatures")
        .select("*", { count: "exact", head: true })
        .eq("initiative_id", params.id)
        .eq("verification_tier", "district"),
    ]);

    checkAndFireMilestones(
      adminClient,
      params.id,
      totalRes.count ?? 0,
      constituentRes.count ?? 0,
    ).catch(() => { /* silent — never fail the sign request over milestone logic */ });

    return NextResponse.json({ signed: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to process signature" },
      { status: 500 }
    );
  }
}
