import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, createAdminClient } from "@civitics/db";
import { computeGate } from "../../_lib/gate";

export const dynamic = "force-dynamic";

// ─── POST /api/initiatives/[id]/advance ──────────────────────────────────────
// Advance an initiative to the next stage. Two valid transitions:
//
//   draft → deliberate   (no gate — author decision to open for input)
//   deliberate → mobilise (quality gate enforced)
//
// Auth required. Only the primary_author_id may advance their initiative.
//
// On success, persists the gate score to quality_gate_score JSONB.

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(cookieStore);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Sign in to advance this initiative" }, { status: 401 });
    }

    // Fetch initiative — must be author
    const { data: initiative } = await supabase
      .from("civic_initiatives")
      .select("id,stage,primary_author_id,mobilise_started_at,jurisdiction_id,scope")
      .eq("id", params.id)
      .single();

    if (!initiative) {
      return NextResponse.json({ error: "Initiative not found" }, { status: 404 });
    }
    if (initiative.primary_author_id !== user.id) {
      return NextResponse.json({ error: "Only the author can advance this initiative" }, { status: 403 });
    }

    const currentStage = initiative.stage;

    // ── draft → deliberate ────────────────────────────────────────────────────
    if (currentStage === "draft") {
      const admin = createAdminClient();
      const { data: updated, error } = await admin
        .from("civic_initiatives")
        .update({ stage: "deliberate" })
        .eq("id", params.id)
        .select("id,stage,updated_at")
        .single();

      if (error) {
        return NextResponse.json({ error: "Failed to advance initiative" }, { status: 500 });
      }

      return NextResponse.json({
        stage: updated.stage,
        message: "Initiative is now open for community deliberation.",
      });
    }

    // ── deliberate → mobilise ─────────────────────────────────────────────────
    if (currentStage === "deliberate") {
      // Run quality gate (v2 — population-normalised)
      const gate = await computeGate(supabase, params.id, initiative.mobilise_started_at, {
        jurisdictionId: initiative.jurisdiction_id,
        scope:          initiative.scope,
      });

      const admin = createAdminClient();

      // Always persist the latest gate score
      await admin
        .from("civic_initiatives")
        .update({ quality_gate_score: gate as unknown as Record<string, unknown> })
        .eq("id", params.id);

      if (!gate.can_advance) {
        return NextResponse.json(
          {
            error: "Quality gate not passed",
            gate,
          },
          { status: 422 }
        );
      }

      // Advance to mobilise
      const { data: updated, error } = await admin
        .from("civic_initiatives")
        .update({
          stage: "mobilise",
          mobilise_started_at: new Date().toISOString(),
          quality_gate_score: gate as unknown as Record<string, unknown>,
        })
        .eq("id", params.id)
        .select("id,stage,mobilise_started_at")
        .single();

      if (error) {
        return NextResponse.json({ error: "Failed to advance initiative" }, { status: 500 });
      }

      return NextResponse.json({
        stage: updated.stage,
        mobilise_started_at: updated.mobilise_started_at,
        message: "Initiative is now mobilising — signature gathering has begun.",
        gate,
      });
    }

    // ── already at or past mobilise ───────────────────────────────────────────
    return NextResponse.json(
      { error: `Cannot advance from '${currentStage}' stage` },
      { status: 400 }
    );
  } catch {
    return NextResponse.json({ error: "Failed to advance initiative" }, { status: 500 });
  }
}
