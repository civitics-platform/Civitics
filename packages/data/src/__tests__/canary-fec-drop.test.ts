/**
 * FIX-1166 — the FEC drop-collection state machine.
 *
 * Runs via:  tsx --test src/__tests__/canary-fec-drop.test.ts
 *
 * Pure functions over plain data, so like canary-transitions.test.ts these need
 * no Postgres and are meaningful in CI. Every case pins either the condition
 * being detected or a false positive the detector has to survive — the FEC
 * publish cadence guarantees a `pending` probe once a week, so a detector that
 * tiers on `pending` alone would page weekly by design.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROBE_STALE_HOURS,
  RING_DEPTH,
  UNCOLLECTED_DAYS,
  blindStreak,
  classifyFecDrop,
  probeRing,
  pushRing,
  type StoredDropProbe,
} from "../scripts/canary-fec-drop";

const NOW = new Date("2026-09-10T00:00:00.000Z");
const hoursBefore = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const daysBefore = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

/** A readable, level probe an hour old — the healthy baseline. */
const healthy = (over: Partial<StoredDropProbe> = {}): StoredDropProbe => ({
  cycle: "2026",
  pending: false,
  remote_last_modified: "Sun, 06 Sep 2026 15:54:54 GMT",
  watermark_last_modified: "Sun, 06 Sep 2026 15:54:54 GMT",
  probed_at: hoursBefore(1),
  phase: "enrichment-light",
  ...over,
});

// ---------------------------------------------------------------------------
// collected
// ---------------------------------------------------------------------------

test("FIX-1166 collected: level watermark, readable probe, fresh probe — no tier", () => {
  const s = classifyFecDrop(healthy(), daysBefore(3), NOW);
  assert.equal(s.state, "collected");
  assert.equal(s.tier, null);
  assert.equal(s.blindStreak, 0);
  assert.equal(s.pending, false);
});

test("FIX-1166 collected: prod's actual 2026-09-09 row shape classifies healthy", () => {
  // Copied verbatim from pipeline_state.fec_drop_probe on prod, read 2026-09-10.
  // It carries no `recent` — the ring is additive and older rows lack it.
  const prodRow: StoredDropProbe = {
    cycle: "2026",
    phase: "enrichment-light",
    pending: false,
    probed_at: "2026-09-09T07:36:00.979Z",
    remote_last_modified: "Sun, 06 Sep 2026 15:54:54 GMT",
    watermark_last_modified: "Sun, 06 Sep 2026 15:54:54 GMT",
  };
  const s = classifyFecDrop(prodRow, "2026-09-07T08:46:15.720Z", NOW);
  assert.equal(s.state, "collected");
  assert.equal(s.tier, null);
  // A ringless row must read as one entry, never as a blind streak.
  assert.equal(s.blindStreak, 0);
});

// ---------------------------------------------------------------------------
// pending-within-window vs pending-uncollected
// ---------------------------------------------------------------------------

test("FIX-1166 pending-within-window: the ordinary Sunday-publish shape does NOT tier", () => {
  const probe = healthy({
    pending: true,
    remote_last_modified: "Sun, 13 Sep 2026 15:31:02 GMT",
    watermark_last_modified: "Sun, 06 Sep 2026 15:54:54 GMT",
    probed_at: hoursBefore(2),
  });
  const s = classifyFecDrop(probe, daysBefore(1), NOW);
  assert.equal(s.state, "pending-within-window");
  assert.equal(s.tier, null, "a one-day lag is normal and must never page");
});

test("FIX-1166 pending-uncollected ESCALATES past two days", () => {
  const probe = healthy({
    pending: true,
    remote_last_modified: "Sun, 13 Sep 2026 15:31:02 GMT",
    probed_at: hoursBefore(1),
  });
  const s = classifyFecDrop(probe, daysBefore(5), NOW);
  assert.equal(s.state, "pending-uncollected");
  assert.equal(s.tier, "escalate");
  assert.ok(s.daysSinceCollect !== null && s.daysSinceCollect > UNCOLLECTED_DAYS);
  assert.ok(s.detail.includes("uncollected"));
});

test("FIX-1166 pending with NO fec_bulk completion on record escalates", () => {
  const s = classifyFecDrop(healthy({ pending: true }), null, NOW);
  assert.equal(s.state, "pending-uncollected");
  assert.equal(s.tier, "escalate");
  assert.equal(s.daysSinceCollect, null);
  assert.ok(s.detail.includes("NONE on record"));
});

test("FIX-1166 the two-day boundary: exactly 2d is within-window, a hair past escalates", () => {
  const probedAt = hoursBefore(1);
  const probe = healthy({ pending: true, probed_at: probedAt });
  const probedMs = Date.parse(probedAt);

  // Exactly UNCOLLECTED_DAYS before the PROBE — inclusive, so still normal.
  const exact = new Date(probedMs - UNCOLLECTED_DAYS * 86_400_000).toISOString();
  assert.equal(classifyFecDrop(probe, exact, NOW).state, "pending-within-window");

  // One minute older tips it. (The classifier rounds to 0.1d ≈ 2.4h, so the
  // step has to clear the rounding to be a boundary test rather than a coin flip.)
  const past = new Date(probedMs - UNCOLLECTED_DAYS * 86_400_000 - 3 * 3_600_000).toISOString();
  assert.equal(classifyFecDrop(probe, past, NOW).state, "pending-uncollected");
});

test("FIX-1166 the lag is measured from the PROBE, not from the canary's clock", () => {
  // Probe is 30h old (still fresh), collection was 1d before the probe. Measured
  // from `now` that reads as 2.25d and would escalate; measured from the probe
  // it is 1d and must not.
  const probe = healthy({ pending: true, probed_at: hoursBefore(30) });
  const collect = new Date(Date.parse(probe.probed_at!) - 86_400_000).toISOString();
  assert.equal(classifyFecDrop(probe, collect, NOW).state, "pending-within-window");
});

// ---------------------------------------------------------------------------
// probe-blind — the fail-closed trap
// ---------------------------------------------------------------------------

test("FIX-1166 one blind probe is named but does NOT report", () => {
  const probe = healthy({ remote_last_modified: null });
  const s = classifyFecDrop(probe, daysBefore(1), NOW);
  assert.equal(s.state, "probe-blind", "pending=false on a failed HEAD is not health");
  assert.equal(s.tier, null, "a single transient HEAD failure is ordinary");
  assert.equal(s.blindStreak, 1);
});

test("FIX-1166 two blind probes still do not report; three do", () => {
  const two = healthy({
    remote_last_modified: null,
    recent: [
      { probed_at: hoursBefore(1), remote_last_modified: null },
      { probed_at: hoursBefore(25), remote_last_modified: null },
      { probed_at: hoursBefore(49), remote_last_modified: "Sun, 06 Sep 2026 15:54:54 GMT" },
    ],
  });
  const s2 = classifyFecDrop(two, daysBefore(1), NOW);
  assert.equal(s2.state, "probe-blind");
  assert.equal(s2.tier, null);
  assert.equal(s2.blindStreak, 2);

  const three = healthy({
    remote_last_modified: null,
    recent: [
      { probed_at: hoursBefore(1), remote_last_modified: null },
      { probed_at: hoursBefore(25), remote_last_modified: null },
      { probed_at: hoursBefore(49), remote_last_modified: null },
    ],
  });
  const s3 = classifyFecDrop(three, daysBefore(1), NOW);
  assert.equal(s3.state, "probe-blind");
  assert.equal(s3.tier, "report", "three consecutive blind probes is a broken probe");
  assert.equal(s3.blindStreak, RING_DEPTH);
});

test("FIX-1166 blind is checked before pending, so a failed HEAD never reads as collected", () => {
  // The trap: fail-closed sets pending=false, which without the null check
  // would fall straight through to `collected`.
  const s = classifyFecDrop(healthy({ remote_last_modified: null, pending: false }), null, NOW);
  assert.notEqual(s.state, "collected");
  assert.equal(s.state, "probe-blind");
});

// ---------------------------------------------------------------------------
// probe-missing — says nothing about FEC
// ---------------------------------------------------------------------------

test("FIX-1166 no probe row at all reports as missing", () => {
  const s = classifyFecDrop(null, daysBefore(1), NOW);
  assert.equal(s.state, "probe-missing");
  assert.equal(s.tier, "report");
  assert.equal(s.hoursSinceProbe, null);
  assert.ok(s.detail.includes("does not exist"));
});

test("FIX-1166 a row with an unparseable probed_at reports as missing", () => {
  const s = classifyFecDrop(healthy({ probed_at: "not a timestamp" }), daysBefore(1), NOW);
  assert.equal(s.state, "probe-missing");
  assert.equal(s.tier, "report");
});

test("FIX-1166 the 36h boundary: exactly 36h is fresh, past it is missing", () => {
  assert.equal(
    classifyFecDrop(healthy({ probed_at: hoursBefore(PROBE_STALE_HOURS) }), daysBefore(1), NOW)
      .state,
    "collected",
    "exactly at the threshold is still fresh",
  );
  const stale = classifyFecDrop(
    healthy({ probed_at: hoursBefore(PROBE_STALE_HOURS + 1) }),
    daysBefore(1),
    NOW,
  );
  assert.equal(stale.state, "probe-missing");
  assert.equal(stale.tier, "report");
});

test("FIX-1166 a stale row's pending is not read — missing wins over uncollected", () => {
  // The nightly stopped running three days ago. That is a statement about the
  // nightly, not about FEC, and must not be reported as uncollected money.
  const s = classifyFecDrop(
    healthy({ pending: true, probed_at: hoursBefore(72) }),
    daysBefore(30),
    NOW,
  );
  assert.equal(s.state, "probe-missing");
  assert.equal(s.tier, "report", "never escalate on a signal we did not actually take");
});

// ---------------------------------------------------------------------------
// The ring helpers
// ---------------------------------------------------------------------------

test("FIX-1166 pushRing prepends, trims to depth, and tolerates a missing prior", () => {
  const e = (n: number) => ({ probed_at: `t${n}`, remote_last_modified: null });
  assert.deepEqual(pushRing(undefined, e(1)), [e(1)]);
  assert.deepEqual(pushRing([e(1)], e(2)), [e(2), e(1)]);
  const full = pushRing(pushRing(pushRing(undefined, e(1)), e(2)), e(3));
  assert.equal(full.length, RING_DEPTH);
  const rolled = pushRing(full, e(4));
  assert.equal(rolled.length, RING_DEPTH);
  assert.deepEqual(rolled, [e(4), e(3), e(2)]);
  // A non-array in the stored value must not throw.
  assert.deepEqual(pushRing(undefined as never, e(1)), [e(1)]);
});

test("FIX-1166 probeRing falls back to the single current probe when there is no ring", () => {
  const probe = healthy();
  assert.deepEqual(probeRing(probe), [
    { probed_at: probe.probed_at, remote_last_modified: probe.remote_last_modified },
  ]);
  assert.deepEqual(probeRing({}), []);
});

test("FIX-1166 blindStreak counts only the leading nulls", () => {
  const n = (t: string) => ({ probed_at: t, remote_last_modified: null });
  const v = (t: string) => ({ probed_at: t, remote_last_modified: "x" });
  assert.equal(blindStreak([]), 0);
  assert.equal(blindStreak([v("a")]), 0);
  assert.equal(blindStreak([n("a"), v("b"), n("c")]), 1, "a gap ends the streak");
  assert.equal(blindStreak([n("a"), n("b"), n("c")]), 3);
});
