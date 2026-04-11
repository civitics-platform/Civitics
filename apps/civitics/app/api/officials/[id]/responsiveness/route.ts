import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@civitics/db";

export const dynamic = "force-dynamic";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ResponsivenessGrade = "A" | "B" | "C" | "D" | "F";

export type ResponsivenessData = {
  responded:     number;         // windows where responded_at IS NOT NULL
  no_response:   number;         // windows where closed + no response
  open:          number;         // windows still within deadline
  total_closed:  number;         // responded + no_response
  response_rate: number | null;  // 0–100, null if no closed windows yet
  grade:         ResponsivenessGrade | null;
  recent: Array<{
    initiative_id:    string;
    initiative_title: string;
    scope:            string;
    response_type:    string;
    responded_at:     string | null;
    window_closes_at: string;
    window_opened_at: string;
  }>;
};

// ─── Grade helper ──────────────────────────────────────────────────────────────

export function gradeFromRate(rate: number): ResponsivenessGrade {
  if (rate >= 90) return "A";
  if (rate >= 70) return "B";
  if (rate >= 50) return "C";
  if (rate >= 30) return "D";
  return "F";
}

// ─── GET /api/officials/[id]/responsiveness ────────────────────────────────────
// Returns the official's responsiveness score across all civic initiative
// response windows. Used by the official profile page and graph overlays.
//
// Scoring:
//   responded   = rows with responded_at IS NOT NULL
//   no_response = rows with responded_at IS NULL AND window_closes_at < NOW()
//   open        = rows with responded_at IS NULL AND window_closes_at >= NOW()
//   rate        = responded / (responded + no_response) × 100

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(cookieStore);

    const { data: rows, error } = await supabase
      .from("civic_initiative_responses")
      .select(
        "id, initiative_id, response_type, responded_at, window_closes_at, window_opened_at, is_verified_staff, civic_initiatives!initiative_id(id, title, scope)"
      )
      .eq("official_id", params.id)
      .order("window_opened_at", { ascending: false })
      .limit(50);

    if (error) {
      return NextResponse.json(
        { error: "Failed to fetch responsiveness data" },
        { status: 500 }
      );
    }

    const now = new Date();

    let responded    = 0;
    let no_response  = 0;
    let open         = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of (rows ?? []) as any[]) {
      if (r.responded_at) {
        responded++;
      } else if (new Date(r.window_closes_at) < now) {
        no_response++;
      } else {
        open++;
      }
    }

    const total_closed = responded + no_response;
    const response_rate = total_closed > 0
      ? Math.round((responded / total_closed) * 100)
      : null;
    const grade = response_rate !== null ? gradeFromRate(response_rate) : null;

    // Build recent list (most recent first, capped at 10)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recent = ((rows ?? []) as any[]).slice(0, 10).map((r) => ({
      initiative_id:    r.initiative_id as string,
      initiative_title: (r.civic_initiatives?.title ?? "Unknown initiative") as string,
      scope:            (r.civic_initiatives?.scope ?? "federal") as string,
      response_type:    r.response_type as string,
      responded_at:     r.responded_at as string | null,
      window_closes_at: r.window_closes_at as string,
      window_opened_at: r.window_opened_at as string,
    }));

    const data: ResponsivenessData = {
      responded,
      no_response,
      open,
      total_closed,
      response_rate,
      grade,
      recent,
    };

    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "Failed to compute responsiveness score" },
      { status: 500 }
    );
  }
}
