/**
 * FIX-914 — RSA 662:5 (the 2022 New Hampshire House redistricting plan) as data.
 *
 * WHY THIS EXISTS. New Hampshire elects 400 representatives from 203 districts.
 * 164 of those are ordinary "base" districts and are published by the Census as
 * TIGER SLDL features, which is what `pipelines/districts-tiger` ingests. The
 * other 39 are FLOTERIAL districts — an overlay district spanning several whole
 * base districts and electing its own representatives on top of theirs. A
 * floterial is not a Census geography, so TIGER carries none of them, and the 58
 * representatives elected from them had no `jurisdictions` row to link to.
 *
 * The fix is derivation, not download: a floterial's boundary is exactly the
 * union of the base districts it spans, and we already hold every base district
 * as an audited TIGER row. What we need from outside is the MEMBERSHIP — which
 * base districts each floterial spans — and that is statutory. RSA 662:5 lists
 * every district, base and floterial, by the towns and wards it contains.
 *
 * This module turns the statute's HTML into that membership, and proves it:
 *   parseRsa662_5()    — statute HTML -> 203 districts with town lists
 *   deriveFloterials() — which of the 203 are floterials (derived, never typed)
 *   exactCover()       — a floterial's towns as whole base districts, or null
 *
 * The source HTML is checked in beside this file at
 * `sources/rsa-662-5-2026-09-10.html` (fetched 2026-09-10 from
 * https://gc.nh.gov/rsa/html/LXIII/662/662-5.htm) so the transcription is
 * reproducible and reviewable without a network call.
 */

/** The ten NH counties, in the order RSA 662:5 lists them (I..X). */
export const NH_COUNTIES = [
  "Belknap", "Carroll", "Cheshire", "Coos", "Grafton",
  "Hillsborough", "Merrimack", "Rockingham", "Strafford", "Sullivan",
] as const;

export type NhCounty = (typeof NH_COUNTIES)[number];

export interface NhDistrict {
  /** County the district belongs to. */
  county: NhCounty;
  /** District number WITHIN the county, as the statute numbers it (1..45). */
  number: number;
  /** Representatives the district elects. */
  seats: number;
  /** True iff this district's towns are wholly covered by other districts. */
  floterial: boolean;
  /** Towns and wards, statute spelling, normalised per the rules below. */
  towns: string[];
}

export interface NhHouseDistricts {
  source: string;
  url: string;
  fetched_at: string;
  districts: NhDistrict[];
}

/**
 * TIGER encodes NH's county-scoped district numbers as a single 3-digit
 * SLDLST: a county index (Belknap 0 .. Sullivan 9) followed by the
 * zero-padded district number. Belknap 3 -> "003", Hillsborough 42 -> "542".
 * Verified against all 164 base rows on the clone (see the test).
 */
export function tigerDistrictId(county: NhCounty, number: number): string {
  const idx = NH_COUNTIES.indexOf(county);
  if (idx < 0) throw new Error(`unknown NH county: ${county}`);
  return `${idx}${String(number).padStart(2, "0")}`;
}

/**
 * The name TIGER gives the base rows, which is also the name the derived
 * floterial rows take: "New Hampshire " + NAMELSAD, where NAMELSAD is
 * "State House District <County> <NN>" with NN zero-padded to two digits.
 * Read off the live rows: "New Hampshire State House District Belknap 03",
 * "New Hampshire State House District Hillsborough 43".
 */
export function districtName(county: NhCounty, number: number): string {
  return `New Hampshire State House District ${county} ${String(number).padStart(2, "0")}`;
}

// ── The parser ───────────────────────────────────────────────────────────────
//
// The statute's HTML is a three-column table per county:
//   [ district label | town | seats ]
// A district's first row carries "District No. N" in column 1; its continuation
// rows leave column 1 empty; its LAST row carries the seat count in column 3.
//
// Four things in the published markup break that shape. Each is handled by a
// named rule below and each is asserted, so a future re-fetch that changes the
// markup fails loudly instead of transcribing something wrong.
//
//   R1 SPLIT WARD — a town cell ending in the bare word "Ward" means the ward
//      NUMBER was put in column 3 instead of the seat count:
//        <td>Laconia Ward</td><td>3</td>   ->  town "Laconia Ward 3", no seats
//      Distinguishable from a seat count because the town cell ends in "Ward"
//      with no number of its own. Occurs in Belknap 5, Grafton 17,
//      Strafford 19, Strafford 20.
//
//   R2 COLLAPSED SEATS — a district's last row with an EMPTY column 3 and a
//      trailing number inside the town cell:
//        <td>Westmoreland 2</td><td></td>  ->  town "Westmoreland", seats 2
//      Safe because no New Hampshire town's name ends in a digit; only ward
//      names do, and those are excluded by the "Ward" test. Occurs in
//      Carroll 5 ("Ossipee 1"), Cheshire 15 ("Westmoreland 2"),
//      Merrimack 2 ("Northfield 1").
//
//   R3 DANGLING CONJUNCTION — one place name split across two rows:
//        <td>Thompson and</td> ... <td>Meserve's Purchase</td>
//      is the single Coos place "Thompson and Meserve's Purchase", not two.
//      A town cell ending in " and" joins the next row's town. (Coos also has
//      "Low and Burbank's Grant", which arrives whole in one cell and is
//      therefore untouched by this rule.)
//
//   R4 TWO-CELL ROW — Coos District 2's first row is emitted as
//      <td>District No. 2</td><td colspan=1 >Atkinson &amp; Gilmanton Academy
//      Grant</td> with no third cell at all. Handled by treating a missing
//      third cell as empty and by matching <td> with attributes.
//
// NORMALISATION, stated once and applied everywhere: town strings are the
// statute's own spelling, whitespace-collapsed, with wards rendered in the
// single form "<Town> Ward <N>". The statute's abbreviated town names
// ("E. Kingston", "N. Hampton", "S. Hampton") are kept verbatim — it uses the
// same abbreviation in base and floterial districts alike, so the cover proof
// is unaffected, and inventing an expansion would be a second spelling of a
// place the statute spells one way. Ward lists are already enumerated
// individually in the source (Somersworth Wards 1-5 appear as five rows), so
// no range expansion is needed.

const ENTITIES: Array<[RegExp, string]> = [
  [/&nbsp;/g, " "],
  [/&amp;/g, "&"],
  [/&#150;/g, "-"],
];

function decode(s: string): string {
  let out = s;
  for (const [re, to] of ENTITIES) out = out.replace(re, to);
  return out.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

export function parseRsa662_5(html: string): NhDistrict[] {
  const tables = [...html.matchAll(/<table>([\s\S]*?)<\/table>/g)].map((m) => m[1]!);
  if (tables.length !== NH_COUNTIES.length) {
    throw new Error(`expected ${NH_COUNTIES.length} county tables, found ${tables.length}`);
  }

  const out: NhDistrict[] = [];

  for (const [ci, table] of tables.entries()) {
    const county = NH_COUNTIES[ci]!;
    const rows = [...table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => m[1]!);

    let current: { number: number; towns: string[]; seats: number | null } | null = null;
    let pending: string | null = null; // R3 held fragment

    const flush = (): void => {
      if (!current) return;
      if (pending !== null) throw new Error(`${county} ${current.number}: unterminated "… and" fragment`);
      if (current.seats === null) throw new Error(`${county} ${current.number}: no seat count`);
      if (current.towns.length === 0) throw new Error(`${county} ${current.number}: no towns`);
      out.push({
        county, number: current.number, seats: current.seats,
        floterial: false, towns: current.towns,
      });
      current = null;
    };

    for (const row of rows) {
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => decode(m[1]!));
      // R4: a row may carry fewer than three cells.
      const label = cells[0] ?? "";
      let town = cells[1] ?? "";
      const third = cells[2] ?? "";

      const start = /^District No\.\s*(\d+)$/.exec(label);
      if (start) {
        flush();
        current = { number: Number(start[1]), towns: [], seats: null };
      } else if (label !== "") {
        throw new Error(`${county}: unrecognised first cell ${JSON.stringify(label)}`);
      }
      if (!current) throw new Error(`${county}: town row before any district label`);
      if (town === "") continue;

      // R3 — join a place name split across two rows.
      if (pending !== null) {
        town = `${pending} ${town}`;
        pending = null;
      }
      if (/\sand$/.test(town)) {
        if (third !== "") {
          throw new Error(`${county} ${current.number}: "${town}" carries a value in column 3`);
        }
        pending = town;
        continue;
      }

      // R1 — a bare "… Ward" cell takes its number from column 3.
      if (/\bWard$/.test(town)) {
        if (!/^\d+$/.test(third)) {
          throw new Error(`${county} ${current.number}: "${town}" has no ward number (col3 ${JSON.stringify(third)})`);
        }
        current.towns.push(`${town} ${third}`);
        continue;
      }

      // R2 — a trailing number on a non-ward town with an empty column 3 is
      // the district's seat count, collapsed into the town cell.
      const collapsed = /^(.*\S)\s+(\d+)$/.exec(town);
      if (third === "" && collapsed && !/\bWard\b/.test(town)) {
        current.towns.push(collapsed[1]!);
        current.seats = Number(collapsed[2]);
        continue;
      }

      current.towns.push(town);
      if (third !== "") {
        if (!/^\d+$/.test(third)) {
          throw new Error(`${county} ${current.number}: non-numeric column 3 ${JSON.stringify(third)}`);
        }
        if (current.seats !== null) {
          throw new Error(`${county} ${current.number}: a second seat count (${third})`);
        }
        current.seats = Number(third);
      }
    }
    flush();
  }

  return out;
}

// ── Floterial derivation ─────────────────────────────────────────────────────

const key = (d: { county: string; number: number }): string => `${d.county} ${d.number}`;

/**
 * A district is a floterial iff ANOTHER district in the same county has a town
 * set that is a STRICT SUBSET of its own.
 *
 * This is sound because the base districts partition their county's towns: no
 * base district can strictly contain another without breaking the partition, so
 * strict containment is unique to the overlay. The naive alternative — "every
 * town of D appears in some other district" — is NOT sound: every base district
 * that happens to sit under a floterial satisfies it too (Belknap 4's only town,
 * Belmont, also appears in the floterial Belknap 8), which would classify much
 * of the base layer as overlay.
 *
 * Returns a new array with `floterial` set; the input is not mutated.
 */
export function deriveFloterials(districts: NhDistrict[]): NhDistrict[] {
  const sets = new Map(districts.map((d) => [key(d), new Set(d.towns)] as const));
  return districts.map((d) => {
    const mine = sets.get(key(d))!;
    const floterial = districts.some((o) => {
      if (o.county !== d.county || o.number === d.number) return false;
      const theirs = sets.get(key(o))!;
      if (theirs.size >= mine.size) return false;
      for (const t of theirs) if (!mine.has(t)) return false;
      return true;
    });
    return { ...d, floterial };
  });
}

/**
 * The base districts whose town sets union to EXACTLY this floterial's town
 * set — no town missing, none extra, no base district split. Returns the base
 * district numbers ascending, or null if no such cover exists.
 *
 * Greedy is exact here, not an approximation: the base districts partition the
 * county, so each of the floterial's towns lies in exactly one base district
 * and the candidate set is forced. The remaining question is only whether every
 * forced base district is wholly contained — never partly in, partly out.
 */
export function exactCover(floterial: NhDistrict, bases: NhDistrict[]): number[] | null {
  const want = new Set(floterial.towns);
  const owner = new Map<string, NhDistrict>();
  for (const b of bases) {
    for (const t of b.towns) {
      if (owner.has(t)) return null; // bases do not partition — caller reports
      owner.set(t, b);
    }
  }
  const chosen = new Map<number, NhDistrict>();
  for (const t of want) {
    const b = owner.get(t);
    if (!b) return null; // town in no base district
    chosen.set(b.number, b);
  }
  // Every chosen base district must be WHOLLY inside the floterial.
  for (const b of chosen.values()) {
    for (const t of b.towns) if (!want.has(t)) return null;
  }
  // And together they must cover it exactly — asserted, not assumed.
  const covered = new Set<string>();
  for (const b of chosen.values()) for (const t of b.towns) covered.add(t);
  if (covered.size !== want.size) return null;
  return [...chosen.keys()].sort((a, b) => a - b);
}
