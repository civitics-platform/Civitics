/**
 * FIX-1154 — the classifier's role-ineligible branch and the containment override.
 *
 * Runs via:  tsx --test src/scripts/fec-orphan-branch.test.ts
 *
 * TWO CHANGES, PINNED SEPARATELY BECAUSE THEY FAIL DIFFERENTLY.
 *
 * 1. ROLE-INELIGIBLE HOLDER, evaluated BEFORE the overlap thresholds. The role
 *    predicate is a FACT about the official; the overlap thresholds are a
 *    STATISTIC about its twin. The old ordering let the statistic decide first,
 *    so an Article III judge or a city council member holding House money landed
 *    in UNIQUE HOLDER — whose published remedy is "write the missing id, do NOT
 *    remove rows". For this population there is no id to write.
 *
 * 2. Complete containment overrides `sharedFloor`. The floor stops
 *    common-surname coincidence on a large population; it was never meant to
 *    protect a 28-for-28 containment. Alan Armstrong is the surfacing case.
 *
 * Boundary numbers are the 2026-08-18 prod derivation, the same one
 * fec-orphan-delete-evidence.test.ts pins.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BRANCHES,
  type Boundary,
  branchOf,
  CONTAINMENT_MIN_ROWS,
  type EnrichedRow,
} from "./fec-orphan-classify";

/** The boundary the 2026-08-18 audit derived, padded to the full Boundary shape. */
const BOUNDARY: Boundary = {
  fracCut: 0.1667,
  gapLo: 0.0743,
  gapHi: 0.2591,
  gapWidth: 0.1848,
  sharedFloor: 146,
  floorGapLo: 28,
  floorGapHi: 146,
  bimodal: true,
};

/** A suspect row with every field the classifier reads, overridable per test. */
function row(over: Partial<EnrichedRow>): EnrichedRow {
  return {
    official_id: "00000000-0000-0000-0000-000000000001",
    full_name: "Test Person",
    first_name: "Test",
    last_name: "Person",
    tier: "elected",
    is_active: true,
    role_title: "Senator",
    jurisdiction: "OK",
    stored_fec_id: null,
    totals_table_cents: "0",
    donation_cents: "0",
    donation_rows: "0",
    first_at: null,
    last_at: null,
    twin_id: "00000000-0000-0000-0000-0000000000ff",
    twin_name: "Other Person",
    twin_first_name: "Other",
    twin_tier: "candidate",
    twin_fec_id: "H8ND00096",
    twin_total_cents: "0",
    shared_pairs: "0",
    rows: 0,
    shared: 0,
    frac: 0,
    ...over,
  } as EnrichedRow;
}

// ---------------------------------------------------------------------------
// 1. ROLE-INELIGIBLE HOLDER
// ---------------------------------------------------------------------------

test("a council member holding fec_bulk money is ROLE-INELIGIBLE, not UNIQUE HOLDER", () => {
  // Scott Wiener / Connie Chan shape: municipal seat, same-surname twin, an
  // overlap that does not clear the floor. Old behaviour: UNIQUE HOLDER.
  const e = row({ role_title: "Council Member", jurisdiction: "SF", rows: 40, shared: 12, frac: 0.3 });
  const v = branchOf(e, BOUNDARY);
  assert.equal(v.branch, "ROLE-INELIGIBLE HOLDER");
  assert.equal(v.decidedBy, "role");
});

test("a federal judge with NO stored id and NO twin still lands in the branch", () => {
  // The 18 Federal Judge rows: no fec_id to retire, no twin to merge with. They
  // were previously indistinguishable from a genuine unique holder.
  const e = row({
    role_title: "Federal Judge",
    jurisdiction: "US",
    stored_fec_id: null,
    twin_id: null,
    twin_fec_id: null,
    twin_first_name: null,
    twin_name: null,
    rows: 6133,
    shared: 0,
    frac: 0,
  });
  const v = branchOf(e, BOUNDARY);
  assert.equal(v.branch, "ROLE-INELIGIBLE HOLDER");
  assert.equal(v.decidedBy, "role");
});

test("role beats a name+seat agreement that would otherwise say SAME-PERSON", () => {
  // The ordering test. Without role-first, this row's name agrees and its
  // overlap clears both thresholds, so it would be filed SAME-PERSON DUPLICATE
  // and sent to the merge script — merging a council member into a Congressman.
  const e = row({
    role_title: "Council Member",
    first_name: "Alan",
    full_name: "Alan Green",
    twin_first_name: "Alan",
    twin_name: "Alan Green",
    twin_fec_id: "H4TX09095",
    jurisdiction: "TX",
    rows: 1000,
    shared: 900,
    frac: 0.9,
  });
  assert.equal(branchOf(e, BOUNDARY).branch, "ROLE-INELIGIBLE HOLDER");
});

test("a role-ineligible official holding NO money is left alone", () => {
  // `rows > 0` is the guard: the branch is about money that must not be there.
  const e = row({ role_title: "Council Member", rows: 0, shared: 0, frac: 0 });
  assert.equal(branchOf(e, BOUNDARY).branch, "UNIQUE HOLDER");
});

test("every electable role is unaffected by the new branch", () => {
  for (const role of [
    "Senator",
    "Representative",
    "President",
    "Vice President",
    "Candidate for Senator",
    "Candidate for Representative",
    "Candidate for President",
  ]) {
    const e = row({ role_title: role, rows: 100, shared: 0, frac: 0 });
    assert.notEqual(
      branchOf(e, BOUNDARY).branch,
      "ROLE-INELIGIBLE HOLDER",
      `${role} must stay federally electable`,
    );
  }
});

test("'State Senator' is role-ineligible — the exact-string rule, not includes()", () => {
  // FIX-1025's trap: `"State Senator".includes("Senator")` is true, and two
  // earlier hand-written spellings got this wrong. 2,012 such rows on prod.
  const e = row({ role_title: "State Senator", rows: 50, shared: 0, frac: 0 });
  assert.equal(branchOf(e, BOUNDARY).branch, "ROLE-INELIGIBLE HOLDER");
});

// ---------------------------------------------------------------------------
// 2. The containment override
// ---------------------------------------------------------------------------

test("Alan Armstrong: 28 of 28 shared clears the floor by containment → CROSS-PERSON", () => {
  // Senator (OK) against Kelly Armstrong H8ND00096. Names disagree (ALA vs
  // KEL), seat disagrees (OK vs ND), so the residual branch is CROSS-PERSON.
  // 28 shared is under the 146 floor — containment is what admits it.
  const e = row({
    role_title: "Senator",
    first_name: "Alan",
    full_name: "Alan Armstrong",
    last_name: "Armstrong",
    jurisdiction: "OK",
    twin_first_name: "Kelly",
    twin_name: "Kelly Armstrong",
    twin_fec_id: "H8ND00096",
    rows: 28,
    shared: 28,
    frac: 1,
  });
  const v = branchOf(e, BOUNDARY);
  assert.equal(v.branch, "CROSS-PERSON MISATTRIBUTION");
  assert.equal(v.decidedBy, "neither");
});

test(`containment applies at exactly ${CONTAINMENT_MIN_ROWS} rows and not at ${CONTAINMENT_MIN_ROWS - 1}`, () => {
  const base = {
    role_title: "Senator",
    first_name: "Alan",
    full_name: "Alan Armstrong",
    last_name: "Armstrong",
    jurisdiction: "OK",
    twin_first_name: "Kelly",
    twin_name: "Kelly Armstrong",
    twin_fec_id: "H8ND00096",
    frac: 1,
  };
  const at = row({ ...base, rows: CONTAINMENT_MIN_ROWS, shared: CONTAINMENT_MIN_ROWS });
  const below = row({ ...base, rows: CONTAINMENT_MIN_ROWS - 1, shared: CONTAINMENT_MIN_ROWS - 1 });
  assert.equal(branchOf(at, BOUNDARY).branch, "CROSS-PERSON MISATTRIBUTION");
  assert.equal(branchOf(below, BOUNDARY).branch, "UNIQUE HOLDER");
});

test("PARTIAL overlap under the floor is still UNIQUE HOLDER — the floor survives", () => {
  // The override is for COMPLETE containment only. 27 of 28 must not qualify,
  // or the floor has been silently removed rather than qualified.
  const e = row({
    role_title: "Senator",
    jurisdiction: "OK",
    twin_first_name: "Kelly",
    twin_name: "Kelly Armstrong",
    first_name: "Alan",
    full_name: "Alan Armstrong",
    rows: 28,
    shared: 27,
    frac: 27 / 28,
  });
  assert.equal(branchOf(e, BOUNDARY).branch, "UNIQUE HOLDER");
});

test("containment with NO twin cannot fire", () => {
  const e = row({ role_title: "Senator", twin_id: null, rows: 0, shared: 0, frac: 0 });
  assert.equal(branchOf(e, BOUNDARY).branch, "UNIQUE HOLDER");
});

test("containment does not override the name/seat test, only the floor", () => {
  // Jon Ossoff shape: contained, name undecidable, seat AGREES → SAME-PERSON.
  // Containment decides admission, not which side of the branch a row lands on.
  const e = row({
    role_title: "Senator",
    jurisdiction: "GA",
    first_name: "Jon",
    full_name: "Jon Ossoff",
    twin_first_name: "Jon",
    twin_name: "Jon Ossoff",
    twin_fec_id: "S8GA00180",
    rows: 20,
    shared: 20,
    frac: 1,
  });
  const v = branchOf(e, BOUNDARY);
  assert.equal(v.branch, "SAME-PERSON DUPLICATE");
  assert.equal(v.decidedBy, "name+seat");
});

// ---------------------------------------------------------------------------
// 3. The EXCLUDED_FEC_IDS path
// ---------------------------------------------------------------------------

test("EXCLUDED_FEC_IDS is a DOWNSTREAM filter — branchOf still says CROSS-PERSON", () => {
  // S6GA00390 is excluded by name in both cross-person consumers because that
  // CAND_ID is genuinely its holder's. The classifier does not know that and
  // must not: the exclusion is a reviewed, by-name judgement applied to the
  // branch, and folding it into branchOf would hide it from the audit's census.
  const EXCLUDED_FEC_IDS = new Set(["S6GA00390"]);
  const e = row({
    role_title: "Senator",
    jurisdiction: "OK",
    first_name: "Alan",
    full_name: "Alan Armstrong",
    twin_first_name: "Kelly",
    twin_name: "Kelly Armstrong",
    twin_fec_id: "S6GA00390",
    rows: 28,
    shared: 28,
    frac: 1,
  });
  assert.equal(branchOf(e, BOUNDARY).branch, "CROSS-PERSON MISATTRIBUTION");
  // …and the consumers drop it afterwards, which is where it belongs.
  assert.equal(EXCLUDED_FEC_IDS.has(e.twin_fec_id!), true);
});

// ---------------------------------------------------------------------------
// 4. The shared BRANCHES constant
// ---------------------------------------------------------------------------

test("BRANCHES carries every branch branchOf can return", () => {
  assert.equal(BRANCHES.length, 4);
  assert.ok(BRANCHES.includes("ROLE-INELIGIBLE HOLDER"));
  assert.equal(new Set(BRANCHES).size, BRANCHES.length);
});
