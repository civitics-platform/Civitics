/**
 * FIX-743: weekly/Sunday day-gate for the nightly orchestrator's heavy ingest
 * block (FEC bulk, IRS-990, LittleSis, EDGAR-weekly, OpenStates API,
 * agencies/OPM/PLUM/elections/committees/agency-*, tag-industry). Normally these
 * run only on Sunday (`getDay() === 0`). A `workflow_dispatch` on nightly.yml
 * with `force_weekly=true` sets NIGHTLY_FORCE_WEEKLY=true (forwarded to all three
 * phase jobs) so the whole heavy path can be run SUPERVISED in a low-traffic
 * window without waiting for the calendar. This is a heavy, prod-writing run when
 * forced — idempotent upserts, but IOWait-heavy on the Pro Micro — intended for
 * off-peak/supervised use only.
 *
 * With the flag unset/anything-but-"true" the gate is identical to the pre-FIX-743
 * `getDay() === 0` behavior, so scheduled cron runs and plain dispatches are
 * unchanged.
 *
 * This lives in its own module (not inline in index.ts) so it stays pure and
 * unit-testable without dragging in index.ts's heavy import graph (createAdminClient,
 * ai-tagger's module-level createAiClient(), etc.) — mirrors selectKillTarget.
 *
 * ---------------------------------------------------------------------------
 * FIX-1163 — THE NOMINAL DAY IS DERIVED FROM THE SLOT, NOT FROM WALL CLOCK.
 *
 * The gate above reads the day off the moment the process happens to start.
 * That was safe only while the cron and the run shared a calendar day. It no
 * longer does: nightly.yml's cron moved to `0 21 * * *`, i.e. the slot fires on
 * the UTC day BEFORE the run it names, because GitHub applies a large offset to
 * this workflow's scheduled start (measured 4h43–6h41 over the eleven
 * consecutive scheduled starts 2026-08-29 → 2026-09-09, and 1h04–11h51 over the
 * fortnight before that).
 *
 * Under that cron a wall-clock gate makes Sunday's heavy ingest CONDITIONAL ON
 * GITHUB BEING LATE. The slot fires Sat 21:00 UTC; a late start lands Sunday and
 * runs the weekly block, but an ON-TIME start is still Saturday, skips it, and
 * silently drops a week of FEC ingest. Fixing that by hoping the offset stays
 * large is not a fix.
 *
 * So the run carries its slot offset — NIGHTLY_SLOT_OFFSET_HOURS, set beside the
 * cron in nightly.yml — and the day is read off `now + offset`. The window that
 * maps to a given nominal day is then exactly [slot, slot + 24h): every start
 * from the fire instant up to a full day late names the same day, which is the
 * widest correct window available and covers every offset ever observed for this
 * workflow, including the 11h51 outlier.
 *
 * The offset defaults to 0 and 0 is byte-identical to the pre-FIX-1163 gate, so
 * nothing outside nightly.yml's scheduled runs changes behaviour — plain
 * `workflow_dispatch` runs deliberately pass 0 and keep wall-clock semantics.
 */
export type WeeklyMode = "forced" | "sunday" | "skipped";

/** Env var carrying the cron slot's offset from the nominal day, in hours. */
export const SLOT_OFFSET_ENV = "NIGHTLY_SLOT_OFFSET_HOURS";

const MS_PER_HOUR = 3_600_000;

/**
 * Parse NIGHTLY_SLOT_OFFSET_HOURS. Absent, empty, or unparseable → 0, which is
 * exactly the pre-FIX-1163 wall-clock gate.
 *
 * The range is [0, 23] written as plain digits; anything else is REFUSED (→ 0) rather
 * than applied: a fat-fingered `30` would rotate the nominal day by more than a
 * day and turn "which day is this run" into a silent lie, which is the failure
 * this parameter exists to prevent. Refusing degrades to the old behaviour,
 * which is wrong in a way the receipts already describe; accepting would be
 * wrong in a way nothing measures.
 */
export function readSlotOffsetHours(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return 0;
  // Plain decimal digits only. Number() would happily read "1e1" as 10 and
  // "0x3" as 3; neither is something a human types into a YAML env block, and
  // accepting them would make the refusal set unexplainable in a comment.
  const trimmed = raw.trim();
  const n = /^\d{1,2}$/.test(trimmed) ? Number(trimmed) : Number.NaN;
  if (!Number.isInteger(n) || n < 0 || n > 23) {
    console.warn(
      `  [nightly] ${SLOT_OFFSET_ENV}=${JSON.stringify(raw)} is not an integer in [0,23] — ` +
        "ignoring it and reading the nominal day off the wall clock.",
    );
    return 0;
  }
  return n;
}

/**
 * The instant whose calendar day names this run. `now` when the offset is 0.
 *
 * Exported so the orchestrator can log the nominal date it actually gated on —
 * with the cron on the previous UTC day, "Sunday" in a log line that carries a
 * Saturday timestamp is otherwise indistinguishable from a bug.
 */
export function nominalSlotInstant(now: Date, slotOffsetHours: number): Date {
  return slotOffsetHours === 0 ? now : new Date(now.getTime() + slotOffsetHours * MS_PER_HOUR);
}

export function computeRunWeekly(
  now: Date,
  forceEnv: string | undefined,
  slotOffsetHours = 0,
): { runWeekly: boolean; mode: WeeklyMode } {
  const isSunday = nominalSlotInstant(now, slotOffsetHours).getDay() === 0;
  const forced = forceEnv === "true";
  if (forced) return { runWeekly: true, mode: "forced" };
  return { runWeekly: isSunday, mode: isSunday ? "sunday" : "skipped" };
}
