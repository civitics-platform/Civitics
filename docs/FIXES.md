# FIXES — Civitics Platform

Actionable improvement backlog. Every item has a priority, complexity, and enough context to hand to Qwen or Claude Code directly.

**Priority key:**
- 🔴 Critical — Bug that breaks or blocks real functionality
- 🟠 High — Meaningful product/UX gap, address soon
- 🟡 Medium — Worthwhile improvement, schedule when practical
- 🟢 Quick Win — Small effort, high visible impact (batch these)
- ⬜ Future — Phase 2+ or requires significant design/pipeline work

**Complexity key:** S = <2h · M = 2–8h · L = 1–3 days · XL = multi-day + planning

**Workflow:** Every bullet has a stable ID (`<!--id:FIX-NNN-->`). Don't remove or renumber IDs — they're the handle commits reference via `Fixes: FIX-NNN` trailers. Completion state is sourced from `docs/done.log`; regenerate this file's checkboxes with `pnpm fixes:sync`. See [CLAUDE.md](../CLAUDE.md#fixes-workflow) for details.

**Section rules:**
- Active sections — `[x]` items are fine (checked by `fixes:sync`). Periodically move completed clusters to `## COMPLETED` for readability.
- `## COMPLETED` — **`[x]` only**. A `[ ]` item here means it was moved before it shipped — move it back to the active section.
- Deferred / blocked items always stay in active sections as `[ ]`, never in COMPLETED. If a deferred item was closed by a broad "closeout" commit, add a `reopen` line to `done.log` and uncheck it.

---

## STRATEGIC PILLARS
> Directional goals, not checkable tasks. Concrete sub-tasks are threaded throughout this doc. Phase 2+ strategy, architecture, and the Social App live in `docs/ROADMAP.md`.

---

## BUGS — Fix These First




---

## GENERAL / CROSS-CUTTING


---

## HOMEPAGE

- [x] 🟢 M — **State legislative district overlay on homepage map** — DistrictMap exposes SLD-U and SLD-L layer toggles backed by Census TIGER boundaries (`pnpm data:districts`). Click any district polygon to navigate to `/districts/[id]`. Layers debounced-refetch on map move via `/api/districts?bbox=…&chamber=…`. <!--id:FIX-163-->

---

## OFFICIALS


---

## PROPOSALS

- [ ] ⬜ S — **Add "Trending", "Most Commented", "New" tabs** — add to FeaturedSection; requires trending-score pipeline and comments data <!--id:FIX-029-->

---

## PROPOSALS [ID]


---

## CIVIC INITIATIVES


---

## AGENCIES


---

## GRAPH


### New connection types


### New visualization types


### Documentation


### Prerequisites


### Pipelines

- [ ] 🟢 S — **Add R2 cache layer for FEC bulk files** — Follow-up to FIX-181. The indiv pipeline currently downloads `indiv{yy}.zip` (~2 GB) from `fec.gov/files/bulk-downloads` on every run. R2 plumbing exists in [packages/db/src/storage.ts](packages/db/src/storage.ts) but is unused by the FEC pipeline. Add a HEAD-based freshness check: on each run, HEAD `civitics-cache/fec/indiv{yy}.zip` in R2 + HEAD the FEC URL; if R2 is fresh (Last-Modified ≥ FEC's), download from R2 instead. After successful FEC download, upload to R2 in the background. Saves ~10 minutes per repeat run + insulates against FEC bulk-download outages. Requires `@aws-sdk/lib-storage` for multipart upload. Same pattern can be retrofitted to pas2/cm/weball. Defer until cadence justifies it (pipeline runs more than once a quarter). <!--id:FIX-192-->
- [ ] 🟡 M — **Verify weekly FEC cron handles indiv stage cleanly + add a `closed-cycles skip` knob** — FIX-181 lands `FEC_INCLUDE_INDIV=true` as the pipeline default, so the weekly nightly orchestrator at [packages/data/src/pipelines/index.ts:464-468](packages/data/src/pipelines/index.ts#L464-L468) (which runs `FEC_CYCLES={prev},{current}`, currently 2024,2026) now downloads two indiv zips totalling ~5.5 GB and streams ~80M rows per Sunday run. Local + Pro test runs land cleanly in 60-90 min, well under GitHub Actions' 6h job cap, but it's wasteful: 2024 is closed (last FEC quarterly drop was Jan 31 2026) so re-fetching it weekly burns bandwidth + Pro write IO for ~zero new data. Plan: (1) confirm one full Sunday run of `data:nightly:ci` completes green with the indiv stage on (no GitHub Actions timeout, no OOM, no Pro pooler exhaustion); (2) add `FEC_INDIV_CYCLES` env knob — defaults to active-cycle-only ({current}) for the cron, while the manual `pnpm data:fec-bulk` keeps the broader `FEC_CYCLES` default for backfills; (3) optional: skip indiv when FEC's Last-Modified header matches a recorded watermark in `pipeline_state` (avoids reprocessing identical files). <!--id:FIX-193-->


---

## DASHBOARD

- [ ] 🟠 L — **Add sparklines to stat cards** — build `/api/stats/trends` returning last 30 days of daily counts per metric <!--id:FIX-090-->
- [ ] 🟡 M — **Parse FIXES.md into per-phase task lists with real done state** — reads `docs/done.log`; replaces hard-coded PHASE1_TASKS <!--id:FIX-095-->

---

## INFRASTRUCTURE & PERFORMANCE



---

## COMMUNITY & AUTH


---

## DOCUMENTATION (Open Source Readiness)


---

## COMPLETED (archive, don't delete — useful reference)

_Completed items moved here by `pnpm fixes:clean`. `pnpm fixes:archive` moves them to `docs/archive/fixes-archive.md`._
