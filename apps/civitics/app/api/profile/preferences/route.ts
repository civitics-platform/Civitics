import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@civitics/db";

export const dynamic = "force-dynamic";

// GET /api/profile/preferences
// Returns the signed-in user's home_state + home_district from user_preferences.
export async function GET() {
  const cookieStore = await cookies();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServerClient(cookieStore) as any;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data } = await supabase
    .from("user_preferences")
    .select("home_state, home_district")
    .eq("user_id", user.id)
    .maybeSingle();

  return NextResponse.json({
    preferences: data ?? { home_state: null, home_district: null },
  });
}

// PUT /api/profile/preferences
// Upserts home_state + home_district for the signed-in user.
export async function PUT(request: Request) {
  const cookieStore = await cookies();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServerClient(cookieStore) as any;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json() as { home_state?: string | null; home_district?: number | null };

  const { error } = await supabase
    .from("user_preferences")
    .upsert(
      {
        user_id: user.id,
        home_state: body.home_state ?? null,
        home_district: body.home_district ?? null,
      },
      { onConflict: "user_id" }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
