import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Thresholds ────────────────────────────────────────────────────────────────
// Keep in sync with MILESTONES in SignaturePanel.tsx (UI labels/descriptions).
// "constituent" = district-verified signatures only (stronger democratic signal).

const THRESHOLDS = [
  { milestone: "listed",           totalMin: 100,  constituentMin: null  },
  { milestone: "notify_officials", totalMin: null, constituentMin: 250   },
  { milestone: "response_window",  totalMin: null, constituentMin: 1_000 },
  { milestone: "featured",         totalMin: null, constituentMin: 5_000 },
] as const;

type MilestoneKey = (typeof THRESHOLDS)[number]["milestone"];

// ─── checkAndFireMilestones ────────────────────────────────────────────────────
/**
 * Compares current signature counts against thresholds.
 * For each unfired milestone whose threshold is now crossed, inserts an event row.
 * Idempotent: UNIQUE(initiative_id, milestone) guards against double-firing.
 *
 * Side effect for 'response_window': calls openResponseWindows() async.
 *
 * MUST be called with createAdminClient() — event INSERTs bypass RLS.
 * Returns array of milestone keys newly fired in this call.
 */
export async function checkAndFireMilestones(
  adminClient: SupabaseClient,
  initiativeId: string,
  totalCount: number,
  constituentCount: number,
): Promise<MilestoneKey[]> {
  // Fetch already-fired milestones (idempotency guard)
  const { data: fired } = await adminClient
    .from("civic_initiative_milestone_events")
    .select("milestone")
    .eq("initiative_id", initiativeId);

  const firedSet = new Set((fired ?? []).map((r) => r.milestone as string));
  const newlyFired: MilestoneKey[] = [];

  for (const t of THRESHOLDS) {
    if (firedSet.has(t.milestone)) continue;

    const crossed =
      (t.totalMin       !== null && totalCount       >= t.totalMin)       ||
      (t.constituentMin !== null && constituentCount >= t.constituentMin);

    if (!crossed) continue;

    const { error } = await adminClient
      .from("civic_initiative_milestone_events")
      .insert({
        initiative_id:     initiativeId,
        milestone:         t.milestone,
        constituent_count: constituentCount,
        total_count:       totalCount,
      });

    // Code 23505 = unique_violation — another request raced us; not an error
    if (error && error.code !== "23505") continue;

    newlyFired.push(t.milestone);

    if (t.milestone === "response_window") {
      // Fire-and-forget — don't block sign response while we look up officials
      openResponseWindows(adminClient, initiativeId).catch(() => { /* silent */ });
    }
  }

  return newlyFired;
}

// ─── openResponseWindows ──────────────────────────────────────────────────────
/**
 * Creates civic_initiative_responses rows for relevant officials when the
 * 1000-constituent-signature milestone fires.
 *
 * Rows are created with response_type='no_response', responded_at=NULL.
 * After window_closes_at passes with no response → permanent No Response.
 * Silence is public record.
 *
 * v1 matching strategy: officials where metadata->>'level' = initiative scope.
 * For state/local: additionally narrow by state code extracted from target_district.
 * Capped at 50 officials to guard against data quality edge cases.
 *
 * ignoreDuplicates: true — safe to call multiple times, rows never overwritten.
 */
async function openResponseWindows(
  adminClient: SupabaseClient,
  initiativeId: string,
): Promise<void> {
  const { data: initiative } = await adminClient
    .from("initiative_details")
    .select("scope, target_district")
    .eq("proposal_id", initiativeId)
    .maybeSingle();

  if (!initiative) return;

  // Build officials query — match by metadata->>'level'
  const levelMap: Record<string, string> = {
    federal: "federal",
    state:   "state",
    local:   "local",
  };
  const level = levelMap[initiative.scope as string];
  if (!level) return;

  let query = adminClient
    .from("officials")
    .select("id")
    .eq("is_active", true)
    .filter("metadata->>level", "eq", level)
    .limit(50);

  // Narrow by state for sub-federal scope when target_district gives us a state code.
  // e.g. "CA-12" → "CA", "TX-Sen" → "TX", "NY" → "NY"
  if (initiative.target_district && initiative.scope !== "federal") {
    const stateCode = String(initiative.target_district).slice(0, 2).toUpperCase();
    if (/^[A-Z]{2}$/.test(stateCode)) {
      query = query.filter("metadata->>state", "eq", stateCode);
    }
  }

  const { data: officials } = await query;
  if (!officials || officials.length === 0) return;

  const now    = new Date().toISOString();
  const closes = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  await adminClient
    .from("civic_initiative_responses")
    .upsert(
      officials.map((o) => ({
        initiative_id:    initiativeId,
        official_id:      o.id,
        response_type:    "no_response",
        window_opened_at: now,
        window_closes_at: closes,
      })),
      { onConflict: "initiative_id,official_id", ignoreDuplicates: true },
    );
}
