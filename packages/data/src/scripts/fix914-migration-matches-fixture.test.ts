/**
 * FIX-914 — the committed migration is exactly what the generator emits.
 *
 * The chain that decides where 39 polygons get drawn is:
 *
 *   rsa-662-5-2026-09-10.html          (the statute, checked in)
 *     -> nh-house-districts-2022.json  (parsed; a test re-parses and compares)
 *     -> nh-floterials-2022.derived.json  (the exact-cover proof emits it)
 *     -> 20260910120000_…sql           (this generator writes it)
 *
 * Every link but the last is already pinned by a test. This is the last one. It
 * exists because the SQL is the only artifact in that chain a reviewer is
 * plausibly tempted to hand-edit — it is the one that looks like source — and a
 * hand-edited VALUES list would seed a district the statute does not describe
 * while every other test in the set stayed green.
 *
 * No DB, no network.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import { buildMigration, readSpec, MIGRATION_PATH } from "./gen-fix914-migration";

test("the committed FIX-914 migration is byte-identical to the generated one", () => {
  assert.ok(fs.existsSync(MIGRATION_PATH), `${MIGRATION_PATH} is missing`);
  assert.equal(
    fs.readFileSync(MIGRATION_PATH, "utf8"),
    buildMigration(readSpec()),
    "the migration and the proven fixture have drifted — re-run " +
    "`pnpm --filter @civitics/data data:nh:migration` and review the diff",
  );
});

test("the spec the migration carries is the 39 proven floterials, 58 seats", () => {
  const spec = readSpec();
  assert.equal(spec.length, 39);
  assert.equal(spec.reduce((n, r) => n + r.seats, 0), 58);

  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
  for (const r of spec) {
    // Each district must appear in the emitted JSONB literal with its own
    // base list — a spot check that the generator did not, say, repeat one row.
    assert.ok(
      sql.includes(`"district_id":"${r.district_id}"`),
      `${r.district_id} is not in the migration`,
    );
    assert.ok(
      sql.includes(`"base_district_ids":${JSON.stringify(r.base_district_ids)}`),
      `${r.district_id}'s base list is not in the migration`,
    );
    assert.ok(r.base_district_ids.length >= 2,
      `${r.district_id} spans fewer than two base districts`);
  }
  // No district id may appear twice: the unique index would catch it at run
  // time, but ON CONFLICT DO UPDATE inside one statement would raise
  // "cannot affect row a second time" instead, which is a worse error to read.
  const ids = spec.map((r) => r.district_id);
  assert.equal(new Set(ids).size, ids.length, "duplicate district_id in the spec");
});

test("the migration keeps its safety properties in the emitted text", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
  // These are the four things that make the migration safe to replay and safe
  // to run unattended from the TIGER pipeline. Losing any of them silently is
  // the failure this pins.
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS jurisdictions_derived_district_unique/);
  assert.match(sql, /SET statement_timeout = '5min'/);
  assert.match(sql, /RAISE EXCEPTION 'derive_nh_floterials: base districts missing/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.derive_nh_floterials\(\) FROM PUBLIC, anon, authenticated;/);
  // census_geoid stays NULL: a fabricated GEOID would be a lie the OTHER
  // partial unique index would happily enforce.
  assert.match(sql, /NULL,\s*-- census_geoid: a floterial has no GEOID/);
});
