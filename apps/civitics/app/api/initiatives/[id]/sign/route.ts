import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, createAdminClient } from "@civitics/db";

export const dynamic = "force-dynamic";

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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adminDb = createAdminClient() as any;

    // Fetch initiative to check stage
    const { data: initiative, error: initError } = await adminDb
      .from("civic_initiatives")
      .select("id,stage")
      .eq("id", params.id)
      .single();

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
    const { data: existingSig, error: sigError } = await adminDb
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
      const { error: deleteError } = await adminDb
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
    const { error: insertError } = await adminDb
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

    return NextResponse.json({ signed: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to process signature" },
      { status: 500 }
    );
  }
}
