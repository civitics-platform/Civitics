import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@civitics/db";

export const dynamic = "force-dynamic";

// ─── GET /api/initiatives/[id]/signature-count ────────────────────────────────
// Lightweight count endpoint for client-side polling without fetching full detail.

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const cookieStore = await cookies();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createServerClient(cookieStore) as any;

    const [totalRes, verifiedRes] = await Promise.all([
      supabase
        .from("civic_initiative_signatures")
        .select("*", { count: "exact", head: true })
        .eq("initiative_id", params.id),
      supabase
        .from("civic_initiative_signatures")
        .select("*", { count: "exact", head: true })
        .eq("initiative_id", params.id)
        .eq("verification_tier", "district"),
    ]);

    return NextResponse.json({
      total: totalRes.count ?? 0,
      constituent_verified: verifiedRes.count ?? 0,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch signature counts" },
      { status: 500 }
    );
  }
}
