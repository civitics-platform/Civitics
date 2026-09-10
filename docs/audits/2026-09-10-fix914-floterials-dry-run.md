# FIX-914 dry run — the 39 NH floterial districts on the prod clone

**2026-09-10, local Docker (a `db:clone:prod` of production). Nothing here touched prod.**

The migration `20260910120000_fix914_nh_floterial_districts.sql` derives 39 New
Hampshire floterial House districts as `ST_Union` of the TIGER base districts
each spans. This is the evidence that the polygons it draws are the right ones,
taken against a clone before anything was pushed.

## Verdict

| gate (design §6) | result |
|---|---|
| 1 · exact cover 39/39, 164/164 base rows resolve, seats 58/400 | **pass** |
| 2 · 39 valid geometries | **pass** — 39/39 `ST_IsValid`, centroid inside all 39 |
| 2 · area = Σ base areas within 0.01 % | **pass** — worst Δ is **0**, exactly, on all 39 |
| 2 · IoU vs GRANIT ≥ 0.90 each | **one row below: 738 at 0.7078.** Investigated and cleared — see below. On the land-restricted measure the minimum is 0.9532 and nothing is below 0.90 |
| 2 · part count > 1 reported, not failed | 3 rows: 818 (2), 907 (2), 908 (2) |
| 3 · linker writes exactly 58, NH residual 0 | **pass** — 58 written, second call 0, residual is Maine's 2 tribal seats and nothing else |
| — · idempotency | **pass** — `derive_nh_floterials()` called twice returns 39 then **0** |
| — · `BEGIN … ROLLBACK` proof | **pass** — 39 rows inside the transaction, 0 after rollback |

## The one gate that tripped, and why it is not a membership error

**738 — Rockingham 38 (Greenland, N. Hampton, Rye) — raw IoU 0.7078 against
GRANIT's `RO38`.** The gate's stated inference is "the membership was misread."
It was not, and four independent measurements say so:

1. **GRANIT ∖ ours = 0.31 km².** GRANIT's polygon is 99.79 % contained in ours.
   A missing town would leave tens of km² outside; nothing is missing.
2. **Ours ∖ GRANIT is a single 43.11 km² polygon** whose interior point is
   **42.999 °N, −70.689 °W** — the Atlantic, about 6 km off Rye, extending east
   to −70.606 (past the Isles of Shoals). It is water, not a town.
3. **The excess is already in the base layer, which this FIX did not touch.**
   TIGER's base district 724 (Greenland + Rye) is **111.05 km²** against roughly
   64 km² of land for those two towns. Census SLD tiles the state's coastal water
   and assigns it to the shoreline district; GRANIT's layer is a town/ward
   dissolve and is land only. The two sources disagree by construction here.
4. **Clipping both polygons to land removes the disagreement entirely.** GRANIT's
   40 features (39 floterials + the "outside any floterial" remainder) union to
   New Hampshire as GRANIT draws it. Scored inside that mask:

   | | raw IoU | land-clipped IoU | offshore km² |
   |---|---:|---:|---:|
   | 738 Rockingham 38 | 0.7078 | **0.9969** | 43.10 |
   | 740 Rockingham 40 | 0.9635 | **0.9966** | 2.09 |
   | 737 Rockingham 37 | 0.9887 | **0.9918** | 0.15 |
   | 216 Cheshire 16 | 0.9532 | 0.9532 | 0.00 |

   **Land-clipped across all 39: min 0.9532 · median 0.9995 · max 0.9999.
   Nothing below 0.90.**

The three rows the raw measure penalises are exactly the three coastal
Rockingham floterials, ranked by how much ocean TIGER hands them. Cheshire 16 is
unmoved by the clip (0.00 km² offshore) and is a genuine inland edge difference
between the two sources — comfortably above the floor on both measures.

**Conclusion: the raw-IoU floor is miscalibrated for coastal districts scored
against a land-only comparator, not evidence of a misread membership.** The
land-clipped IoU is the measure that answers the question the gate was asked to
answer.

## Method

- **Source of the membership:** RSA 662:5 (2022 plan), fetched 2026-09-10 and
  checked in at `packages/data/src/data/sources/rsa-662-5-2026-09-10.html`.
  Parsed to `nh-house-districts-2022.json`; the exact-cover proof in
  `nh-house-districts-2022.test.ts` emits `nh-floterials-2022.derived.json`,
  which is what the migration seeds.
- **Instrument:** GRANIT's floterial layer (NH Office of Strategic Initiatives,
  2023-02-02) via the ArcGIS REST endpoint,
  `nhgeodata.unh.edu/…/ElectoralDistricts/MapServer/9`, `outSR=4326`. 40
  features returned: 39 coded (`FloatHse22` = `BE8`, `CA7`, … `SU8`) and one
  with a blank code, the remainder. All 39 matched a derived row by code; none
  unmatched either way. SRID confirmed 4326 on load. Fetched once, into the
  scratch directory — **not** checked in, and not a geometry source (design D1).
- **Δ %** is the derived polygon's geodesic area against the sum of its base
  districts' geodesic areas. It is **exactly 0 on all 39**, which also proves the
  164 base districts do not overlap one another.

## The 39

| id | district | base district ids | seats | linked | valid | parts | area km² | Σ base km² | Δ % | IoU raw | IoU land | offshore km² |
|---|---|---|---:|---:|:-:|---:|---:|---:|---:|---:|---:|---:|
| 008 | Belknap 08 | 003,004 | 2 | 2 | ✓ | 1 | 242.09 | 242.09 | 0 | 0.9993 | 0.9993 | — |
| 107 | Carroll 07 | 105,106 | 1 | 1 | ✓ | 1 | 474.38 | 474.38 | 0 | 0.9998 | 0.9998 | — |
| 108 | Carroll 08 | 103,104 | 2 | 2 | ✓ | 1 | 901.69 | 901.69 | 0 | 0.9998 | 0.9998 | — |
| 215 | Cheshire 15 | 201,202,203,204,205,206 | 2 | 2 | ✓ | 1 | 481.20 | 481.20 | 0 | 0.9995 | 0.9995 | 0.01 |
| 216 | Cheshire 16 | 207,208,209 | 1 | 1 | ✓ | 1 | 626.56 | 626.56 | 0 | 0.9532 | 0.9532 | — |
| 217 | Cheshire 17 | 210,211,212 | 1 | 1 | ✓ | 1 | 497.98 | 497.98 | 0 | 0.9999 | 0.9999 | 0.03 |
| 218 | Cheshire 18 | 213,214 | 2 | 2 | ✓ | 1 | 282.21 | 282.21 | 0 | 0.9998 | 0.9999 | 0.02 |
| 307 | Coos 07 | 304,305 | 1 | 1 | ✓ | 1 | 578.24 | 578.24 | 0 | 0.9998 | 0.9998 | — |
| 417 | Grafton 17 | 413,414,415 | 1 | 1 | ✓ | 1 | 106.90 | 106.90 | 0 | 0.9996 | 0.9996 | — |
| 418 | Grafton 18 | 409,410,411,416 | 1 | 1 | ✓ | 1 | 922.08 | 922.08 | 0 | 0.9997 | 0.9997 | — |
| 537 | Hillsborough 37 | 534,543 | 1 | 1 | ✓ | 1 | 155.10 | 155.10 | 0 | 0.9998 | 0.9998 | — |
| 538 | Hillsborough 38 | 513,514 | 2 | 2 | ✓ | 1 | 115.43 | 115.43 | 0 | 0.9975 | 0.9975 | — |
| 539 | Hillsborough 39 | 515,516,520 | 2 | 2 | ✓ | 1 | 42.45 | 42.45 | 0 | 0.9979 | 0.9979 | — |
| 540 | Hillsborough 40 | 518,519,521,522,523 | 4 | 4 | ✓ | 1 | 33.08 | 33.08 | 0 | 0.9977 | 0.9977 | — |
| 541 | Hillsborough 41 | 517,524,525,526 | 3 | 3 | ✓ | 1 | 14.95 | 14.95 | 0 | 0.9969 | 0.9969 | — |
| 544 | Hillsborough 44 | 528,529 | 2 | 2 | ✓ | 1 | 253.05 | 253.05 | 0 | 0.9997 | 0.9997 | — |
| 545 | Hillsborough 45 | 535,536 | 1 | 1 | ✓ | 1 | 215.90 | 215.90 | 0 | 0.9998 | 0.9999 | 0.02 |
| 625 | Merrimack 25 | 602,603 | 1 | 1 | ✓ | 1 | 150.33 | 150.33 | 0 | 0.9996 | 0.9996 | — |
| 626 | Merrimack 26 | 601,604,605 | 1 | 1 | ✓ | 1 | 754.63 | 754.63 | 0 | 0.9998 | 0.9998 | — |
| 627 | Merrimack 27 | 610,611,614 | 2 | 2 | ✓ | 1 | 320.23 | 320.23 | 0 | 0.9997 | 0.9997 | — |
| 628 | Merrimack 28 | 615,616,617 | 1 | 1 | ✓ | 1 | 42.58 | 42.58 | 0 | 0.9948 | 0.9948 | — |
| 629 | Merrimack 29 | 618,623,624 | 1 | 1 | ✓ | 1 | 55.00 | 55.00 | 0 | 0.9968 | 0.9968 | — |
| 630 | Merrimack 30 | 619,620,621,622 | 1 | 1 | ✓ | 1 | 76.44 | 76.44 | 0 | 0.9978 | 0.9978 | — |
| 731 | Rockingham 31 | 702,703 | 2 | 2 | ✓ | 1 | 356.37 | 356.37 | 0 | 0.9997 | 0.9997 | — |
| 732 | Rockingham 32 | 706,707,708 | 1 | 1 | ✓ | 1 | 119.67 | 119.67 | 0 | 0.9995 | 0.9995 | — |
| 733 | Rockingham 33 | 710,711,712 | 1 | 1 | ✓ | 1 | 147.41 | 147.41 | 0 | 0.9993 | 0.9993 | — |
| 734 | Rockingham 34 | 714,715 | 1 | 1 | ✓ | 1 | 116.79 | 116.79 | 0 | 0.9990 | 0.9990 | — |
| 735 | Rockingham 35 | 716,717 | 1 | 1 | ✓ | 1 | 181.05 | 181.05 | 0 | 0.9996 | 0.9996 | — |
| 736 | Rockingham 36 | 719,720 | 1 | 1 | ✓ | 1 | 137.95 | 137.95 | 0 | 0.9977 | 0.9982 | 0.07 |
| 737 | Rockingham 37 | 721,722 | 1 | 1 | ✓ | 1 | 49.05 | 49.05 | 0 | 0.9887 | 0.9918 | 0.15 |
| 738 | Rockingham 38 | 723,724 | 1 | 1 | ✓ | 1 | 148.31 | 148.31 | 0 | 0.7078 | 0.9969 | 43.10 |
| 739 | Rockingham 39 | 726,727,728 | 1 | 1 | ✓ | 1 | 32.45 | 32.45 | 0 | 0.9976 | 0.9976 | — |
| 740 | Rockingham 40 | 729,730 | 1 | 1 | ✓ | 1 | 62.95 | 62.95 | 0 | 0.9635 | 0.9966 | 2.09 |
| 818 | Strafford 18 | 803,804 | 1 | 1 | ✓ | 2 | 420.04 | 420.04 | 0 | 0.9998 | 0.9998 | — |
| 819 | Strafford 19 | 805,806,807,808,809 | 3 | 3 | ✓ | 1 | 76.66 | 76.66 | 0 | 0.9980 | 0.9980 | — |
| 820 | Strafford 20 | 810,811 | 1 | 1 | ✓ | 1 | 160.91 | 160.91 | 0 | 0.9981 | 0.9981 | — |
| 821 | Strafford 21 | 813,814,815,816,817 | 3 | 3 | ✓ | 1 | 62.34 | 62.34 | 0 | 0.9948 | 0.9948 | — |
| 907 | Sullivan 07 | 902,903 | 1 | 1 | ✓ | 2 | 555.51 | 555.51 | 0 | 0.9998 | 0.9998 | — |
| 908 | Sullivan 08 | 904,905,906 | 2 | 2 | ✓ | 2 | 801.87 | 801.87 | 0 | 0.9998 | 0.9998 | — |

## What this changes for readers

New Hampshire's `HD` rows no longer partition the state — 39 polygons overlap
164, correctly: a Belmont resident really is represented by both Belknap 4 and
Belknap 8. `query_districts()` now separates the three questions that used to
share one filter (`20260910130000_fix914_query_districts_floterial.sql`):

| path | overlay included? | why |
|---|---|---|
| bbox / state fill | **no** | a choropleth of a state must stay a partition of it — and `/api/graph/voting-divergence` pages this RPC at `p_limit` **200**, so 203 rows would have silently truncated three NH districts off the map |
| point containment | **yes** | "which districts contain this address" is the question floterials exist to answer differently (design D6) |
| exact `p_id` | **yes** | otherwise every floterial's `/districts/[id]` page renders with no map |

`jurisdictions_containing_point()` needed no change: it returns a table and
`/api/auth/verify-constituent` iterates every match, so an NH address now earns
a constituent grant on its floterial too — which is right.
