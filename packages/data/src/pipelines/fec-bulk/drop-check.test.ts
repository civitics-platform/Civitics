/**
 * FIX-903 — weekday "new FEC drop" trigger.
 *
 * Runs via:  tsx --test src/pipelines/fec-bulk/drop-check.test.ts
 *
 * FEC publishes indiv{yy}.zip on Sundays ~15:20 UTC, hours after the nightly's
 * Sunday heavy run has already finished, so a weekday nightly needs its own
 * reason to invoke fec_bulk. indivDropIsAhead is that reason; currentFecCycle
 * decides which cycle both the probe and the run it triggers operate on.
 *
 * These are the pure halves only — no network, no DB. indivDropPending (the
 * HEAD + pipeline_state wrapper) is deliberately untested here: exercising it
 * would mean real I/O against fec.gov.
 *
 * Timestamps below are the real measured values from the 2026-07-26
 * investigation that surfaced this bug.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  currentFecCycle,
  indivDropIsAhead,
  resolveProbeCycle,
  probeIndivDrop,
  recordDropProbe,
  FEC_DROP_PROBE_KEY,
} from "./drop-check";
import { shouldRunFecBulk, type FecBulkTriggerInputs } from "../fec-hold";

// Measured 2026-07-26 against prod + a live HEAD of indiv26.zip.
const WATERMARK_JUL_12 = "Sun, 12 Jul 2026 15:23:58 GMT";
const RUNSTATE_JUL_19  = "Sun, 19 Jul 2026 15:25:22 GMT";
const LIVE_JUL_26      = "Sun, 26 Jul 2026 15:18:36 GMT";

// ---------------------------------------------------------------------------
// indivDropIsAhead
// ---------------------------------------------------------------------------

test("probe ahead of the watermark → a drop is pending", () => {
  assert.equal(indivDropIsAhead(WATERMARK_JUL_12, LIVE_JUL_26), true);
  assert.equal(indivDropIsAhead(WATERMARK_JUL_12, RUNSTATE_JUL_19), true);
});

test("probe equal to the watermark → NOT pending (the FIX-193 gate would skip it anyway)", () => {
  assert.equal(indivDropIsAhead(LIVE_JUL_26, LIVE_JUL_26), false);
});

test("probe equal to the watermark in a different but equivalent HTTP date format → NOT pending", () => {
  // Comparison is by parsed timestamp, not string equality, so a header format
  // change on FEC's side must not read as a new drop.
  assert.equal(indivDropIsAhead("Sun, 26 Jul 2026 15:18:36 GMT", "Sun, 26 Jul 2026 15:18:36 UTC"), false);
});

test("probe behind the watermark → NOT pending", () => {
  assert.equal(indivDropIsAhead(LIVE_JUL_26, WATERMARK_JUL_12), false);
});

test("probe null/unparseable (HEAD failed) → fail closed, never launch a ~2.5h ingest", () => {
  for (const probe of [null, undefined, "", "not-a-date"]) {
    assert.equal(
      indivDropIsAhead(WATERMARK_JUL_12, probe),
      false,
      `probe=${JSON.stringify(probe)} must fail closed`,
    );
  }
});

test("stored null/unparseable (cycle never ingested) with a good probe → pending", () => {
  for (const stored of [null, undefined, "", "not-a-date"]) {
    assert.equal(
      indivDropIsAhead(stored, LIVE_JUL_26),
      true,
      `stored=${JSON.stringify(stored)} with a live probe means there IS work to do`,
    );
  }
});

test("both unparseable → NOT pending (the probe side still fails closed)", () => {
  assert.equal(indivDropIsAhead(null, null), false);
  assert.equal(indivDropIsAhead("garbage", "garbage"), false);
});

// ---------------------------------------------------------------------------
// currentFecCycle
// ---------------------------------------------------------------------------

test("currentFecCycle: an even year IS the cycle", () => {
  assert.equal(currentFecCycle(new Date(2026, 6, 26)), "2026");
  assert.equal(currentFecCycle(new Date(2024, 0, 1)),  "2024");
});

test("currentFecCycle: an odd year files into the following even year", () => {
  assert.equal(currentFecCycle(new Date(2027, 6, 26)), "2028");
  assert.equal(currentFecCycle(new Date(2025, 11, 31)), "2026");
});

// ---------------------------------------------------------------------------
// resolveProbeCycle
// ---------------------------------------------------------------------------

test("resolveProbeCycle: no override → the calendar-derived active cycle", () => {
  assert.equal(resolveProbeCycle(new Date(2026, 6, 26), undefined), "2026");
  assert.equal(resolveProbeCycle(new Date(2027, 6, 26), ""), "2028");
});

test("resolveProbeCycle: an explicit FEC_INDIV_CYCLES override wins", () => {
  assert.equal(resolveProbeCycle(new Date(2026, 6, 26), "2024"), "2024");
});

test("resolveProbeCycle: a multi-cycle override probes the highest listed cycle", () => {
  assert.equal(resolveProbeCycle(new Date(2026, 6, 26), "2020,2022,2024"), "2024");
  assert.equal(resolveProbeCycle(new Date(2026, 6, 26), " 2024 , 2020 "),  "2024");
});

test("resolveProbeCycle: a malformed override falls back to the active cycle", () => {
  for (const v of [",", "abc", "24", "2024x"]) {
    assert.equal(
      resolveProbeCycle(new Date(2026, 6, 26), v),
      "2026",
      `override=${JSON.stringify(v)} should fall back`,
    );
  }
});

// ---------------------------------------------------------------------------
// FIX-1163 — probeIndivDrop / recordDropProbe
//
// These DO touch the module's DB wrapper, but only through a stub `db`; the
// HEAD is stubbed out via a network failure (headFecFile against an
// unresolvable host is what the fail-closed path is FOR), so there is still no
// real I/O against fec.gov. What is asserted is the two properties FIX-1163
// actually depends on: the probe records, and it cannot start an ingest.
// ---------------------------------------------------------------------------

/** Minimal pipeline_state stub: one row, recorded upserts. */
function stubDb(watermarkValue: unknown) {
  const upserts: Array<{ key: string; value: Record<string, unknown> }> = [];
  const db = {
    from(table: string) {
      assert.equal(table, "pipeline_state");
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { value: watermarkValue }, error: null }) }),
        }),
        upsert: async (row: { key: string; value: Record<string, unknown> }) => {
          upserts.push(row);
          return { error: null };
        },
      };
    },
  };
  return { db, upserts };
}

test("probeIndivDrop fails closed and still reports both timestamps", async () => {
  const { db } = stubDb({ "2026": { last_modified: WATERMARK_JUL_12 } });
  const probe = await probeIndivDrop(db, "2026");

  assert.equal(probe.cycle, "2026");
  assert.equal(typeof probe.pending, "boolean");
  assert.equal(typeof probe.probed_at, "string");
  // The shape is always complete, whatever the HEAD did.
  assert.ok("remote_last_modified" in probe);
  assert.ok("watermark_last_modified" in probe);
});

test("recordDropProbe writes exactly one fec_drop_probe row, tagged with its phase", async () => {
  const { db, upserts } = stubDb(null);
  const probe = {
    cycle: "2026",
    pending: true,
    remote_last_modified: LIVE_JUL_26,
    watermark_last_modified: WATERMARK_JUL_12,
    probed_at: "2026-09-08T02:17:00.000Z",
  };

  assert.equal(await recordDropProbe(db, probe, "enrichment-light"), true);
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0]!.key, FEC_DROP_PROBE_KEY);
  assert.equal(upserts[0]!.value["phase"], "enrichment-light");
  assert.equal(upserts[0]!.value["pending"], true);
  assert.equal(upserts[0]!.value["remote_last_modified"], LIVE_JUL_26);
  assert.equal(upserts[0]!.value["watermark_last_modified"], WATERMARK_JUL_12);
});

test("recordDropProbe never throws when the write fails", async () => {
  const db = {
    from: () => ({ upsert: async () => ({ error: { message: "permission denied" } }) }),
  };
  const probe = {
    cycle: "2026",
    pending: false,
    remote_last_modified: null,
    watermark_last_modified: null,
    probed_at: "2026-09-08T02:17:00.000Z",
  };
  assert.equal(await recordDropProbe(db, probe, "enrichment-light"), false);
});

test("the recording path cannot widen the fec_bulk trigger (FIX-1163)", () => {
  // shouldRunFecBulk's inputs are runFec / isWeekly / held plus the two
  // booleans the fec phase computes. The light phase has runFec === false, so
  // no matter what the probe records, the trigger stays false. This is the
  // property that makes a second, record-only call site safe.
  const light: FecBulkTriggerInputs = { runFec: false, isWeekly: false, held: false };
  for (const resume of [true, false])
    for (const drop of [true, false])
      assert.equal(
        shouldRunFecBulk(light, resume, drop),
        false,
        `light phase must never invoke fec_bulk (resume=${resume} drop=${drop})`,
      );
});
