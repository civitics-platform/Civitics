/**
 * FIX-914 — the proof that the RSA 662:5 transcription is safe to draw polygons
 * from.
 *
 * The 39 floterial `jurisdictions` rows this FIX seeds are unions of TIGER base
 * districts. Nothing about that union is checked at seed time beyond "the base
 * rows resolved" — so a transcription error here would not fail, it would draw a
 * WRONG POLYGON and link real representatives to it. These tests are the gate
 * that stands in for that missing runtime check, and the `base_district_ids`
 * that the migration seeds come OUT of them (`nh-floterials-2022.derived.json`)
 * rather than being typed by hand.
 *
 * The four independent totals below are what makes the transcription
 * trustworthy: 203 districts, 400 seats, 58 floterial seats, and per-county
 * base counts equal to the 164 TIGER rows we already hold. A parse error
 * essentially cannot satisfy all four at once.
 *
 * The DB-backed cases SKIP when 127.0.0.1:54322 is unreachable, so
 * `pnpm test` stays green on a machine with no local Docker.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { Client, type QueryResult } from "pg";
import {
  NH_COUNTIES, deriveFloterials, exactCover, parseRsa662_5,
  tigerDistrictId, districtName,
  type NhCounty, type NhDistrict, type NhHouseDistricts,
} from "./nh-house-districts";
import { buildTranscription, serialise, JSON_PATH } from "../scripts/parse-rsa-662-5";

const LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const DERIVED_PATH = path.join(__dirname, "nh-floterials-2022.derived.json");

const transcription = JSON.parse(fs.readFileSync(JSON_PATH, "utf8")) as NhHouseDistricts;
const districts = transcription.districts;
const bases = districts.filter((d) => !d.floterial);
const floterials = districts.filter((d) => d.floterial);

/**
 * Base district counts per county, read off the live TIGER rows (see the
 * integration test below, which re-checks them against the DB). Their sum is
 * the 164 `HD` rows New Hampshire has today; the floterial column is the hole.
 */
const EXPECTED: Record<NhCounty, { total: number; base: number; floterial: number }> = {
  Belknap:      { total: 8,  base: 7,  floterial: 1  },
  Carroll:      { total: 8,  base: 6,  floterial: 2  },
  Cheshire:     { total: 18, base: 14, floterial: 4  },
  Coos:         { total: 7,  base: 6,  floterial: 1  },
  Grafton:      { total: 18, base: 16, floterial: 2  },
  Hillsborough: { total: 45, base: 38, floterial: 7  },
  Merrimack:    { total: 30, base: 24, floterial: 6  },
  Rockingham:   { total: 40, base: 30, floterial: 10 },
  Strafford:    { total: 21, base: 17, floterial: 4  },
  Sullivan:     { total: 8,  base: 6,  floterial: 2  },
};

/**
 * The 39 floterial districts, named independently of the transcription: this
 * is the set of `officials.district_name` values that FIX-859's backfill left
 * unlinked on both environments. If the parse produces a different set, either
 * the transcription is wrong or the residual is — and either way nothing gets
 * seeded until a human has looked.
 */
const UNLINKED_DISTRICT_NAMES = [
  "Belknap 8", "Carroll 7", "Carroll 8",
  "Cheshire 15", "Cheshire 16", "Cheshire 17", "Cheshire 18", "Coos 7",
  "Grafton 17", "Grafton 18",
  "Hillsborough 37", "Hillsborough 38", "Hillsborough 39", "Hillsborough 40",
  "Hillsborough 41", "Hillsborough 44", "Hillsborough 45",
  "Merrimack 25", "Merrimack 26", "Merrimack 27", "Merrimack 28",
  "Merrimack 29", "Merrimack 30",
  "Rockingham 31", "Rockingham 32", "Rockingham 33", "Rockingham 34",
  "Rockingham 35", "Rockingham 36", "Rockingham 37", "Rockingham 38",
  "Rockingham 39", "Rockingham 40",
  "Strafford 18", "Strafford 19", "Strafford 20", "Strafford 21",
  "Sullivan 7", "Sullivan 8",
];

interface CoreRow { from_official: string; from_jurisdiction: string }

const label = (d: NhDistrict): string => `${d.county} ${d.number}`;

async function connectOrNull(): Promise<Client | null> {
  const client = new Client({
    connectionString: LOCAL_DB_URL,
    application_name: "civitics_nh_floterial_test",
    connectionTimeoutMillis: 3000,
  });
  try {
    await client.connect();
    return client;
  } catch {
    await client.end().catch(() => {});
    return null;
  }
}

// ── The transcription is what the statute says ───────────────────────────────

test("the checked-in JSON is exactly what the parser makes of the checked-in statute", () => {
  // Closes the loop: the JSON is data, but it is not hand-editable data. Any
  // divergence means someone edited the transcription instead of the source.
  assert.equal(fs.readFileSync(JSON_PATH, "utf8"), serialise(buildTranscription()));
});

test("203 districts, and the statute's own county sections are intact", () => {
  assert.equal(districts.length, 203);
  for (const county of NH_COUNTIES) {
    const inCounty = districts.filter((d) => d.county === county);
    const exp = EXPECTED[county];
    assert.equal(inCounty.length, exp.total, `${county} district count`);
    assert.equal(inCounty.filter((d) => !d.floterial).length, exp.base, `${county} base count`);
    assert.equal(inCounty.filter((d) => d.floterial).length, exp.floterial, `${county} floterial count`);
    // Numbering runs 1..N with no gap and no repeat.
    const nums = inCounty.map((d) => d.number).sort((a, b) => a - b);
    assert.deepEqual(nums, Array.from({ length: exp.total }, (_, i) => i + 1), `${county} numbering`);
  }
});

test("400 seats total, of which 58 are floterial", () => {
  const total = districts.reduce((n, d) => n + d.seats, 0);
  const flot = floterials.reduce((n, d) => n + d.seats, 0);
  const base = bases.reduce((n, d) => n + d.seats, 0);
  assert.equal(total, 400, "New Hampshire elects 400 representatives");
  assert.equal(flot, 58, "58 representatives sit for floterial districts");
  assert.equal(base + flot, total);
});

test("the derived floterial set is exactly the 39 district names FIX-859 left unlinked", () => {
  assert.deepEqual(floterials.map(label).sort(), [...UNLINKED_DISTRICT_NAMES].sort());
});

test("floterial classification is derived, not carried in from the JSON", () => {
  // Re-derive from the raw parse and confirm the JSON's flags agree, so the
  // classification cannot drift from the rule in deriveFloterials().
  const html = fs.readFileSync(
    path.join(__dirname, "sources", "rsa-662-5-2026-09-10.html"), "utf8");
  const fresh = deriveFloterials(parseRsa662_5(html));
  assert.deepEqual(
    fresh.filter((d) => d.floterial).map(label).sort(),
    floterials.map(label).sort(),
  );
});

// ── The base layer is a partition, and the floterials cover it exactly ───────

test("base districts partition each county's towns", () => {
  for (const county of NH_COUNTIES) {
    const owner = new Map<string, string>();
    for (const b of bases.filter((d) => d.county === county)) {
      for (const t of b.towns) {
        const prior = owner.get(t);
        assert.equal(prior, undefined,
          `${county}: "${t}" is in both base district ${prior} and ${b.number}`);
        owner.set(t, String(b.number));
      }
    }
    // Every town named anywhere in the county — including inside a floterial —
    // belongs to exactly one base district. A floterial town with no base owner
    // would mean the overlay covers ground the base layer does not.
    for (const d of districts.filter((x) => x.county === county)) {
      for (const t of d.towns) {
        assert.ok(owner.has(t), `${county}: "${t}" (district ${d.number}) is in no base district`);
      }
    }
  }
});

test("EXACT COVER — every floterial is a union of WHOLE base districts", () => {
  const failures: string[] = [];
  for (const f of floterials) {
    const cover = exactCover(f, bases.filter((b) => b.county === f.county));
    if (!cover) { failures.push(`${label(f)}: towns ${JSON.stringify(f.towns)}`); continue; }
    assert.ok(cover.length >= 2, `${label(f)}: a floterial must span at least two base districts`);
  }
  assert.deepEqual(failures, [],
    "a floterial that is not a whole-base-district union cannot be derived — " +
    "report the district and its towns, and seed nothing");
});

test("the derived base_district_ids fixture is current", () => {
  const rows = floterials.map((f) => {
    const cover = exactCover(f, bases.filter((b) => b.county === f.county));
    assert.ok(cover, `${label(f)} has no exact cover`);
    return {
      district_id: tigerDistrictId(f.county, f.number),
      county: f.county,
      number: f.number,
      seats: f.seats,
      name: districtName(f.county, f.number),
      base_district_ids: cover.map((n) => tigerDistrictId(f.county, n)),
    };
  }).sort((a, b) => a.district_id.localeCompare(b.district_id));

  const next = `${JSON.stringify({
    source: transcription.source,
    url: transcription.url,
    note: "Generated by nh-house-districts-2022.test.ts from the exact-cover proof. " +
      "Do not hand-edit — re-run the test with WRITE_FIXTURE=1.",
    floterials: rows,
  }, null, 2)}\n`;

  const cur = fs.existsSync(DERIVED_PATH) ? fs.readFileSync(DERIVED_PATH, "utf8") : "";
  if (cur !== next) {
    if (process.env.WRITE_FIXTURE === "1") {
      fs.writeFileSync(DERIVED_PATH, next);
      return;
    }
    assert.fail(
      "nh-floterials-2022.derived.json is stale — re-run with WRITE_FIXTURE=1 " +
      "and review the diff before committing (it is what the migration seeds).",
    );
  }
});

test("TIGER district ids encode county + number as the live rows do", () => {
  assert.equal(tigerDistrictId("Belknap", 3), "003");
  assert.equal(tigerDistrictId("Belknap", 8), "008");
  assert.equal(tigerDistrictId("Hillsborough", 42), "542");
  assert.equal(tigerDistrictId("Hillsborough", 37), "537");
  assert.equal(tigerDistrictId("Strafford", 18), "818");
  assert.equal(districtName("Belknap", 8), "New Hampshire State House District Belknap 08");
  assert.equal(districtName("Hillsborough", 43), "New Hampshire State House District Hillsborough 43");
});

// ── Against the live district rows ───────────────────────────────────────────

test("all 164 base districts resolve to a TIGER row, and no floterial id collides", async (t) => {
  const client = await connectOrNull();
  if (!client) {
    t.skip("local Postgres (127.0.0.1:54322) unreachable — skipping live district check");
    return;
  }
  try {
    const { rows } = await client.query<{ district_id: string; name: string }>(
      `SELECT metadata->>'district_id' AS district_id, name
         FROM public.jurisdictions
        WHERE type = 'district'
          AND metadata->>'state_abbr' = 'NH'
          AND metadata->>'chamber' = 'lower'
          AND metadata->>'source' = 'tiger'`,
    );
    const live = new Map(rows.map((r) => [r.district_id, r.name]));
    assert.equal(live.size, 164, "NH has 164 TIGER lower-house rows");

    for (const b of bases) {
      const id = tigerDistrictId(b.county, b.number);
      assert.ok(live.has(id), `base ${label(b)} -> ${id} has no TIGER row`);
      assert.equal(live.get(id), districtName(b.county, b.number),
        `base ${label(b)} -> ${id} name mismatch`);
    }
    assert.equal(bases.length, 164);

    // The floterials take ids in the same space; none may already be taken.
    for (const f of floterials) {
      const id = tigerDistrictId(f.county, f.number);
      assert.equal(live.has(id), false, `floterial ${label(f)} -> ${id} collides with a TIGER row`);
    }
  } finally {
    await client.end().catch(() => {});
  }
});

test("link_officials_to_districts() normalises both sides of a floterial name alike", async (t) => {
  const client = await connectOrNull();
  if (!client) {
    t.skip("local Postgres (127.0.0.1:54322) unreachable — skipping normalisation check");
    return;
  }
  try {
    // The tier-3 "exact core" normalisation, lifted verbatim from the body of
    // link_officials_to_districts() (FIX-913), with the input expression left
    // as a parameter. Asserting it here is what lets FIX-914 ship WITHOUT
    // touching that function: a derived row named in the TIGER pattern reduces
    // to the same core as the official's district_name.
    const core = (arg: string): string => String.raw`
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(lower(${arg}::text), '^' || lower('New Hampshire') || '\s+', ''),
                '\m(state house district|state senate district|senatorial district|house district|senate district|district)\M', ' ', 'g'),
              '\s+and\s+', '-', 'g'),
            '[^a-z0-9]+', '-', 'g'),
          '^-+|-+$', '', 'g'),
        '-([0-9])$', '-0\1')`;

    const sql = `SELECT ${core("$1")} AS from_official, ${core("$2")} AS from_jurisdiction`;
    for (const f of floterials) {
      const args: string[] = [label(f), districtName(f.county, f.number)];
      const res: QueryResult<CoreRow> = await client.query(sql, args);
      assert.equal(res.rows[0]!.from_official, res.rows[0]!.from_jurisdiction,
        `${label(f)} does not normalise to the same core as its derived row name`);
    }

    // Spot the canonical case explicitly so a regression names itself.
    const spot = await client.query<{ c: string }>(
      `SELECT ${core("$1")} AS c`, ["Belknap 8"]);
    assert.equal(spot.rows[0]!.c, "belknap-08");
  } finally {
    await client.end().catch(() => {});
  }
});

test("no floterial seats fewer representatives than are sitting for it", async (t) => {
  const client = await connectOrNull();
  if (!client) {
    t.skip("local Postgres (127.0.0.1:54322) unreachable — skipping seat-count check");
    return;
  }
  try {
    // An independent tie between the statute and our own officials data: a
    // district cannot seat more representatives than it elects. `<=` rather
    // than `=` because a vacancy is normal and must not turn this red — but a
    // transcription that UNDERCOUNTS seats (the failure that would mis-size a
    // district) still fails here.
    const { rows } = await client.query<{ district_name: string; seated: string }>(
      `SELECT o.district_name, count(*)::text AS seated
         FROM public.officials o
         JOIN public.governing_bodies gb ON gb.id = o.governing_body_id
         JOIN public.jurisdictions p ON p.id = gb.jurisdiction_id AND p.type = 'state'
        WHERE p.fips_code = '33'
          AND gb.type = 'legislature_lower'
          AND o.is_active
          AND NOT COALESCE(o.is_synthetic, false)
          AND o.district_name IS NOT NULL
        GROUP BY 1`,
    );
    const seated = new Map(rows.map((r) => [r.district_name, Number(r.seated)]));
    for (const d of districts) {
      const n = seated.get(label(d)) ?? 0;
      assert.ok(n <= d.seats,
        `${label(d)}: ${n} representatives seated but the statute gives it ${d.seats}`);
    }
    const flotSeated = floterials.reduce((n, f) => n + (seated.get(label(f)) ?? 0), 0);
    assert.equal(flotSeated, 58, "the 58 unlinked representatives are exactly the floterial seats");
  } finally {
    await client.end().catch(() => {});
  }
});
