/**
 * FIX-1165 — anchors for the manifest seam and the tail cost table.
 *
 * Runs via:  tsx --test src/scripts/remediation-manifest.test.ts
 *
 * Everything pinned here has already cost prod something once. On 2026-09-07 a
 * 28-row remediation produced 202 statement cancellations at the front door
 * against a baseline of 1, and the two causes were (a) a full audit-scan
 * derivation running on prod for a population that was already known, and (b) a
 * tail that ran platform-scoped rebuilds for a manifest-scoped change. The tests
 * below are the parts of that which can be checked without a database.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  declareRemediationTail,
  deferredUnder,
  diffActionable,
  diffVerdict,
  manifestColumn,
  readManifest,
  tailStep,
  type DiffInput,
} from "./remediation-manifest";

// ---------------------------------------------------------------------------
// Tail classes
// ---------------------------------------------------------------------------

test("--defer-tails defers both platform classes and never the manifest class", () => {
  assert.equal(deferredUnder("manifest", true), false);
  assert.equal(deferredUnder("platform-owned", true), true);
  assert.equal(deferredUnder("platform-orphan", true), true);

  // Without the flag nothing defers — the local run keeps its full tail, which
  // is FIX-943's standing bulk-rewrite convention and still right there.
  assert.equal(deferredUnder("manifest", false), false);
  assert.equal(deferredUnder("platform-owned", false), false);
  assert.equal(deferredUnder("platform-orphan", false), false);
});

test("a step that is not manifest-scoped must name an owner or declare itself an orphan", () => {
  // The failure this prevents: rebuild_financial_entity_ie_totals() sat in two
  // tails for months with no owner recorded anywhere, so nothing could tell that
  // its 28 minutes on prod were unowned rather than necessary.
  assert.throws(() => tailStep("x()", "platform-owned", null, false), /must name an owner/);
  assert.throws(() => tailStep("x()", "manifest", "", false), /must name an owner/);
  assert.throws(
    () => tailStep("x()", "platform-orphan", "someone", false),
    /carries no owner/,
  );
  assert.equal(tailStep("x()", "platform-orphan", null, false).owner, null);
});

test("deferred is derived from the class, never hand-set", () => {
  assert.equal(tailStep("a", "manifest", "this run", true).deferred, false);
  assert.equal(tailStep("b", "platform-owned", "some-job", true).deferred, true);
});

// ---------------------------------------------------------------------------
// The declared tail vs what the scripts actually execute
// ---------------------------------------------------------------------------

/**
 * The table is only worth printing if it is COMPLETE. A step that runs without
 * appearing in it is exactly how a platform-scoped rebuild stayed invisible
 * through two prompts, so this reads the three remediation scripts' source and
 * asserts every step label they execute is declared.
 *
 * Source-reading rather than mocking is deliberate: the thing being guarded is
 * that someone adds a step to runRollups and forgets the declaration, and a mock
 * of runRollups would not notice that.
 */
const SCRIPTS = [
  "remediate-role-ineligible-holders.ts",
  "remediate-cross-person-misattribution.ts",
  "merge-same-person-official-dupes.ts",
];

test("every executed tail step appears in the declared tail table", () => {
  const declared = new Set(declareRemediationTail(true).map((s) => s.label));

  for (const file of SCRIPTS) {
    const src = fs.readFileSync(path.join(__dirname, file), "utf8");

    // The SQL these scripts hand to budgeted()/step() for platform-scoped work
    // is always a bare SELECT/CALL of a zero-argument function. That shape is
    // what makes a step platform-scoped in the first place — no argument means
    // no way to know what this run touched — so it is also the right thing to
    // scan for.
    const called = new Set<string>();
    for (const m of src.matchAll(/`(?:SELECT|CALL) (\w+)\(\)`/g)) {
      called.add(`${m[1]}()`);
    }
    for (const m of src.matchAll(/`VACUUM \(ANALYZE\) public\.\$\{(\w+)\}`/g)) {
      // The vacuum loop is table-driven; its labels come from CHURNED_TABLES.
      void m;
      for (const t of ["financial_relationships", "entity_connections", "officials", "financial_entities"]) {
        called.add(`VACUUM ANALYZE ${t}`);
      }
    }

    // The MV loop calls its steps through `SELECT ${fn}()`, so the literal scan
    // above cannot see them. Read MV_REFRESH_FNS itself.
    const mvBlock = src.match(/const MV_REFRESH_FNS = \[([^\]]+)\]/);
    if (mvBlock) {
      for (const m of mvBlock[1]!.matchAll(/"(\w+)"/g)) called.add(`${m[1]}()`);
    }

    assert.ok(
      called.size >= 4,
      `${file}: the source scan found only ${called.size} tail step(s). The scan ` +
        `shape must have drifted — a vacuously-passing completeness test is worse ` +
        `than none.`,
    );

    for (const label of called) {
      assert.ok(
        declared.has(label),
        `${file} executes ${label} but declareRemediationTail() does not declare it. ` +
          `Add it with its cost class and owner — an undeclared step is one nobody can cost.`,
      );
    }
  }
});

test("the two steps FIX-1165 found unowned are declared, deferred, and owned", () => {
  const tail = declareRemediationTail(true);
  const byLabel = new Map(tail.map((s) => [s.label, s]));

  const ie = byLabel.get("rebuild_financial_entity_ie_totals()");
  assert.ok(ie, "rebuild_financial_entity_ie_totals() must be declared");
  assert.equal(ie.cls, "platform-owned");
  assert.match(ie.owner ?? "", /fec-bulk/);
  assert.equal(ie.deferred, true, "it ran 28 min on a 28-row manifest; it must defer");

  const gdr = byLabel.get("refresh_group_donor_rollup()");
  assert.ok(gdr, "refresh_group_donor_rollup() must be declared");
  assert.equal(gdr.cls, "platform-owned");
  assert.match(
    gdr.owner ?? "",
    /group-donor-rollup-refresh/,
    "FIX-1165 gave it a scheduled owner; the table must name that job",
  );
  assert.equal(gdr.deferred, true);
});

test("under --defer-tails nothing platform-scoped runs", () => {
  const here = declareRemediationTail(true).filter((s) => !s.deferred);
  assert.ok(here.length > 0, "the manifest-scoped rollups always run");
  for (const s of here) {
    assert.equal(
      s.cls,
      "manifest",
      `${s.label} runs under --defer-tails but its cost is not the manifest's`,
    );
  }
});

// ---------------------------------------------------------------------------
// Clone-vs-prod diff
// ---------------------------------------------------------------------------

const d = (expectedRows: number, actualRows: number): DiffInput => ({
  key: "k",
  expectedRows,
  expectedCents: expectedRows * 100,
  actualRows,
  actualCents: actualRows * 100,
});

test("diff verdicts", () => {
  assert.equal(diffVerdict(d(10, 10)), "match");
  assert.equal(diffVerdict(d(10, 4)), "shrunk");
  assert.equal(diffVerdict(d(10, 12)), "grown");
  assert.equal(diffVerdict(d(10, 0)), "gone");
  // A manifest row that recorded zero and still finds zero is 'gone', not
  // 'match' — FIX-1164's id-carriers hold no FR rows by definition and must not
  // be reported as a clean match on a delete that has nothing to delete.
  assert.equal(diffVerdict(d(0, 0)), "gone");
});

test("a key that GREW is not actionable — the manifest never authorised those rows", () => {
  assert.equal(diffActionable("match"), true);
  assert.equal(diffActionable("shrunk"), true, "someone already acted; act on what is here");
  assert.equal(diffActionable("grown"), false);
  assert.equal(diffActionable("gone"), false);
});

// ---------------------------------------------------------------------------
// Manifest parsing
// ---------------------------------------------------------------------------

function withTempManifest(body: string, fn: (p: string) => void): void {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fix1165-")), "m.tsv");
  fs.writeFileSync(p, body, "utf8");
  try {
    fn(p);
  } finally {
    fs.rmSync(path.dirname(p), { recursive: true, force: true });
  }
}

test("readManifest skips comments and blank lines, keeps the comments", () => {
  // The FIX-928 manifest is mostly `#` commentary and it carries the disposition
  // rationale, so comments are retained rather than dropped.
  withTempManifest(
    "# note one\n\nofficial_id\tfec_rows\n" + "a\t3\n" + "# trailing note\n" + "b\t4\n",
    (p) => {
      const m = readManifest(p);
      assert.deepEqual(m.header, ["official_id", "fec_rows"]);
      assert.equal(m.rows.length, 2);
      assert.equal(m.rows[0]!["official_id"], "a");
      assert.equal(m.rows[1]!["fec_rows"], "4");
      assert.deepEqual(m.comments, ["# note one", "# trailing note"]);
    },
  );
});

test("manifestColumn de-duplicates, preserves order, and refuses a missing column", () => {
  withTempManifest("official_id\n" + "a\nb\na\n", (p) => {
    const m = readManifest(p);
    assert.deepEqual(manifestColumn(m, "official_id"), ["a", "b"]);
    assert.throws(() => manifestColumn(m, "nope"), /has no column "nope"/);
  });
});

test("the real FIX-1153 manifest parses to the numbers the prompt was written against", () => {
  // A regression anchor on the artefact itself: 84 officials, 2,736 FR rows,
  // CROSS 2,733 / ONLY-COPY 3, $11,300 of only-copy money. If this file is ever
  // regenerated, these are the numbers the set-1 go-ahead was given against.
  const p = path.join(
    __dirname,
    "../../../../docs/audits/2026-09-07-fix1153-role-ineligible-holders.tsv",
  );
  if (!fs.existsSync(p)) return; // the manifest is an artefact, not a build input
  const m = readManifest(p);
  assert.equal(m.rows.length, 84);
  const sum = (col: string) => m.rows.reduce((a, r) => a + Number(r[col] ?? 0), 0);
  assert.equal(sum("fec_rows"), 2736);
  assert.equal(sum("cross_rows"), 2733);
  assert.equal(sum("only_rows"), 3);
  assert.equal(sum("only_cents"), 1130000);
  assert.equal(manifestColumn(m, "official_id").length, 84);
});
