import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, createAdminClient } from "@civitics/db";

export const dynamic = "force-dynamic";

type ContentType = "civic_comment" | "official_community_comment";

// Admin guard. Matches the convention used in /api/admin/* routes.
async function requireAdmin(): Promise<string | null> {
  const adminEmail = process.env["ADMIN_EMAIL"];
  if (!adminEmail) return null;

  const cookieStore = await cookies();
  const supabase = createServerClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.email !== adminEmail) return null;
  return user.id;
}

// GET /api/admin/moderation?resolved=0|1
// Returns flagged content + the body of each flagged comment for review.
export async function GET(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const resolved = request.nextUrl.searchParams.get("resolved") === "1";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any;

  const { data: flags } = await db
    .from("content_flags")
    .select(
      "id, content_type, content_id, user_id, reason, note, resolved, resolved_at, resolved_by, action_taken, created_at"
    )
    .eq("resolved", resolved)
    .order("created_at", { ascending: false })
    .limit(100);

  const flagRows: Array<{
    id: string;
    content_type: ContentType;
    content_id: string;
    user_id: string;
    reason: string;
    note: string | null;
    resolved: boolean;
    resolved_at: string | null;
    resolved_by: string | null;
    action_taken: string | null;
    created_at: string;
  }> = flags ?? [];

  // Hydrate content bodies so admins don't have to chase each flag down
  // individually. Fetch each content type in bulk.
  const civicIds = flagRows
    .filter((f) => f.content_type === "civic_comment")
    .map((f) => f.content_id);
  const officialIds = flagRows
    .filter((f) => f.content_type === "official_community_comment")
    .map((f) => f.content_id);

  const civicLookup = new Map<
    string,
    { body: string; proposal_id: string | null; user_id: string; is_deleted: boolean }
  >();
  const officialLookup = new Map<
    string,
    { body: string; official_id: string; user_id: string; is_deleted: boolean }
  >();

  if (civicIds.length > 0) {
    const { data } = await db
      .from("civic_comments")
      .select("id, body, proposal_id, user_id, is_deleted")
      .in("id", civicIds);
    for (const r of data ?? []) {
      civicLookup.set(r.id, {
        body:        r.body,
        proposal_id: r.proposal_id,
        user_id:     r.user_id,
        is_deleted:  r.is_deleted,
      });
    }
  }

  if (officialIds.length > 0) {
    const { data } = await db
      .from("official_community_comments")
      .select("id, body, official_id, user_id, is_deleted")
      .in("id", officialIds);
    for (const r of data ?? []) {
      officialLookup.set(r.id, {
        body:        r.body,
        official_id: r.official_id,
        user_id:     r.user_id,
        is_deleted:  r.is_deleted,
      });
    }
  }

  const hydrated = flagRows.map((f) => {
    const content =
      f.content_type === "civic_comment"
        ? civicLookup.get(f.content_id) ?? null
        : officialLookup.get(f.content_id) ?? null;
    return { ...f, content };
  });

  return NextResponse.json({ flags: hydrated });
}

// POST /api/admin/moderation
// Body: { flag_id, action: 'dismiss' | 'delete' }
// 'dismiss' → resolved with no content change.
// 'delete'  → soft-deletes the comment row (is_deleted = true) + resolved.
export async function POST(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let body: { flag_id?: string; action?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.flag_id || (body.action !== "dismiss" && body.action !== "delete")) {
    return NextResponse.json(
      { error: "flag_id and action (dismiss|delete) are required" },
      { status: 400 }
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any;

  const { data: flag } = await db
    .from("content_flags")
    .select("id, content_type, content_id, resolved")
    .eq("id", body.flag_id)
    .single();

  if (!flag) {
    return NextResponse.json({ error: "Flag not found" }, { status: 404 });
  }
  if (flag.resolved) {
    return NextResponse.json({ error: "Already resolved" }, { status: 400 });
  }

  if (body.action === "delete") {
    const table =
      flag.content_type === "civic_comment"
        ? "civic_comments"
        : "official_community_comments";
    await db.from(table).update({ is_deleted: true }).eq("id", flag.content_id);
  }

  // Resolve this flag plus any other unresolved flags on the same content so
  // admins don't have to re-action duplicates of the same report.
  await db
    .from("content_flags")
    .update({
      resolved:     true,
      resolved_at:  new Date().toISOString(),
      resolved_by:  adminId,
      action_taken: body.action,
    })
    .eq("content_type", flag.content_type)
    .eq("content_id", flag.content_id)
    .eq("resolved", false);

  return NextResponse.json({ ok: true });
}
