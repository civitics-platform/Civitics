import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@civitics/db";
import { computeGate } from "../../_lib/gate";

export const dynamic = "force-dynamic";

// ─── GET /api/initiatives/[id]/gate ──────────────────────────────────────────
// Returns the current quality gate status for the deliberate→mobilise transition.
// Available to anyone (public read) — but practically only shown to the author.
//
// Response: { can_advance, signals: GateSignal[], checked_at }

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(cookieStore);

    // Verify initiative exists and is in deliberate stage
    const { data: initiative } = await supabase
      .from("civic_initiatives")
      .select("id,stage,mobilise_started_at,jurisdiction_id,scope")
      .eq("id", params.id)
      .single();

    if (!initiative) {
      return NextResponse.json({ error: "Initiative not found" }, { status: 404 });
    }

    // Gate only applies to deliberate stage — but return status for any stage
    const gate = await computeGate(supabase, params.id, initiative.mobilise_started_at, {
      jurisdictionId: initiative.jurisdiction_id,
      scope:          initiative.scope,
    });

    return NextResponse.json(gate);
  } catch {
    return NextResponse.json({ error: "Failed to compute gate status" }, { status: 500 });
  }
}
