export const dynamic = "force-dynamic";

/**
 * GET /api/admin/enrichment/pending?task=tag|summary&limit=25
 *
 * Claims up to `limit` pending rows from enrichment_queue atomically
 * (SELECT FOR UPDATE SKIP LOCKED inside claim_enrichment_batch RPC) and
 * flips them to status='processing'. The worker enriches in-session and
 * POSTs results to /api/admin/enrichment/submit.
 *
 * Admin-only — matches /api/admin/run-pipeline auth (ADMIN_EMAIL via
 * Supabase Auth session cookies). No new secret.
 */

import { createServerClient, createAdminClient } from "@civitics/db";
import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { supabaseUnavailable, unavailableResponse } from "@/lib/supabase-check";

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (supabaseUnavailable()) return unavailableResponse();
  const adminEmail = process.env["ADMIN_EMAIL"];
  if (!adminEmail) {
    return NextResponse.json({ error: "ADMIN_EMAIL not configured" }, { status: 503 });
  }

  const supabase = createServerClient(cookies());
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.email !== adminEmail) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const url = new URL(request.url);
  const task = url.searchParams.get("task");
  if (task !== "tag" && task !== "summary") {
    return NextResponse.json(
      { error: "task must be 'tag' or 'summary'" },
      { status: 400 },
    );
  }

  const limitRaw = Number(url.searchParams.get("limit") ?? 25);
  const limit = Math.max(
    1,
    Math.min(100, Number.isFinite(limitRaw) ? limitRaw : 25),
  );

  const claimedBy =
    request.headers.get("x-worker-id") ??
    `worker:${crypto.randomUUID().slice(0, 8)}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data, error } = await admin.rpc("claim_enrichment_batch", {
    p_task_type: task,
    p_limit: limit,
    p_claimed_by: claimedBy,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = (data ?? []).map((r: any) => ({
    queue_id: r.id,
    entity_id: r.entity_id,
    entity_type: r.entity_type,
    task_type: r.task_type,
    context: r.context,
  }));

  return NextResponse.json({ items });
}
