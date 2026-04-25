import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, createAdminClient } from "@civitics/db";

export const dynamic = "force-dynamic";

interface AlignmentScore {
  alignment_ratio: number | null;
  matched_votes: number;
  total_votes: number;
  vote_details: Array<{
    proposal_id: string;
    title: string;
    user_pos: string;
    official_vote: string;
    aligned: boolean;
  }>;
}

// GET /api/graph/my-representatives
// Returns the signed-in user's federal representatives (2 senators + 1 house rep)
// derived from user_preferences.home_state / home_district, with alignment scores
// computed via compute_alignment_score() RPC.
//
// Response: { configured: boolean, reps: RepNode[] }
// configured = false when the user has not set home_state yet.
export async function GET() {
  const cookieStore = await cookies();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServerClient(cookieStore) as any;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: prefs } = await supabase
    .from("user_preferences")
    .select("home_state, home_district")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!prefs?.home_state) {
    return NextResponse.json({ configured: false, reps: [] });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const [senatorsRes, houseRes] = await Promise.all([
    admin
      .from("officials")
      .select("id, full_name, role_title, party, photo_url, metadata")
      .eq("is_active", true)
      .ilike("role_title", "%Senator%")
      .filter("metadata->>state_abbr", "eq", prefs.home_state)
      .limit(2),
    prefs.home_district
      ? admin
          .from("officials")
          .select("id, full_name, role_title, party, photo_url, metadata")
          .eq("is_active", true)
          .ilike("role_title", "%Representative%")
          .filter("metadata->>state_abbr", "eq", prefs.home_state)
          .filter("metadata->>district", "eq", String(prefs.home_district))
          .limit(1)
      : Promise.resolve({ data: [] }),
  ]);

  const officials: Array<{
    id: string;
    full_name: string;
    role_title: string;
    party: string | null;
    photo_url: string | null;
    metadata: Record<string, unknown>;
  }> = [
    ...(senatorsRes.data ?? []),
    ...(houseRes.data ?? []),
  ];

  if (!officials.length) {
    return NextResponse.json({ configured: true, reps: [] });
  }

  const reps = await Promise.all(
    officials.map(async (official) => {
      const { data: scoreRows } = await admin.rpc("compute_alignment_score", {
        p_user_id: user.id,
        p_official_id: official.id,
      });

      const score: AlignmentScore = scoreRows?.[0] ?? {
        alignment_ratio: null,
        matched_votes: 0,
        total_votes: 0,
        vote_details: [],
      };

      return {
        id: official.id,
        name: official.full_name,
        type: "official" as const,
        role: official.role_title,
        party: (official.party?.toLowerCase() ?? undefined) as
          | "democrat"
          | "republican"
          | "independent"
          | undefined,
        photoUrl: official.photo_url ?? undefined,
        alignment: {
          ratio: score.alignment_ratio,
          matchedVotes: score.matched_votes,
          totalVotes: score.total_votes,
          voteDetails: score.vote_details,
        },
      };
    })
  );

  return NextResponse.json({ configured: true, reps });
}
