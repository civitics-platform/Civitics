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

- [x] 🟡 M — **Clean up procedural-vote / court-case rows already in `public.proposals`** — FIX-072 fixed the contamination *path* via the shadow→public promotion (vote_question is now first-class on `votes`, `bill_details`/`case_details` separate the row types) but the bad rows that landed before the cutover are still there. Findings: ~169 titles matching `^on ` (procedural vote questions — see CLAUDE.md §votes) leaked from the votes ingester; ~320 titles matching ` v. ` (court case names) leaked from a SCOTUS/courts docket pipeline; both groups have `summary_plain = NULL`, `metadata->>'agency_id' = NULL`; most contamination sits under `type = 'other'`. Do NOT just `DELETE FROM proposals` — these rows may still be referenced by `votes.metadata->>'proposal_id'` or similar FKs. Decide quarantine destination (move to a `proposals_archive`, or set `metadata.contaminated=true` and exclude from queries) before deleting. <!--id:FIX-162-->
  - **Investigation outcome (2026-04-28):** the original premise was wrong. The `' v. '` matches were 408 legitimate CourtListener-sourced rows (correctly stored with `case_details`) plus ~1,170 real ordinances/resolutions that *mention* a case in their title (zoning, settlements, the abortion-rights resolution citing Dobbs) — **not contamination**. The `^on ` matches were 434 federal-bill stubs the votes ingester created with `title = vote question` instead of the bill title. They are load-bearing: each anchors hundreds of `votes.bill_proposal_id` rows (213,582 votes total). Cannot quarantine; must re-title. New script `pnpm --filter @civitics/data data:retitle-stubs --apply --allow-prod` fetches real bill titles from Congress.gov v3 and updates in place, preserving the original procedural string in `metadata.original_procedural_title`. Local: 287 retitled, 147 deferred (Senate-amendment format `S 11-22` — see FIX-164). Prod: 0 stubs found; cutover already cleared them.
- [x] 🟢 S — **Re-title 147 amendment-format Senate vote stubs in local `public.proposals`** — Follow-up to FIX-162. The 147 stubs the FIX-162 retitler skipped have `legacy_bill_number` like `S 11-22`, `S 345-15` — `S {parent_bill_number}-{amendment_number}`, not a regular bill identifier. They anchor 29,698 votes via `votes.bill_proposal_id`, so deletion is off the table. Approaches: (a) call Congress.gov `amendment/{congress}/samdt/{number}` (or `suamdt`) to fetch the amendment description; (b) fetch the parent bill `S {N}` and prefix the title with `Amendment to:`; (c) format placeholder title `Senate Amendment {M} to S {N} (119th Congress)` with no API call. Whichever is chosen, extend `parseBillNumber` in `packages/data/src/scripts/retitle-procedural-bill-stubs.ts` to recognise the amendment shape and dispatch to the right path. Prod has zero rows in this state — local-only fix. <!--id:FIX-164-->
  - **Investigation outcome (2026-04-28):** these aren't bill amendments — they're Presidential Nomination (PN) votes (cabinet, judicial, ambassador confirmations). The Senate XML has `<document_type>=PN`, `<document_number>=11-22`, but `normalizeSenateDocType` in [packages/data/src/pipelines/congress/votes.ts](packages/data/src/pipelines/congress/votes.ts) falls through to `S` for unrecognized types, mangling them into fake `S 11-22` bill numbers with `type=bill`. New script `pnpm --filter @civitics/data data:retitle-pn-stubs --apply` fetches the linked Senate XML, extracts `<document_title>`, sets `title=<document_title>`, `type=appointment`, corrects `legacy_bill_number` to `PN 11-22`, preserves originals in `metadata.original_*`. Local: 147 retitled (144 with the `-` form + 3 single-number cases like `S 19`). Prod: 0 stubs found. Pipeline-side root-cause fix tracked as FIX-165.
- [x] 🟠 M — **Pipeline fix: handle Presidential Nominations (PN) in Senate votes ingester** — `normalizeSenateDocType` in [packages/data/src/pipelines/congress/votes.ts](packages/data/src/pipelines/congress/votes.ts) returns `S` for any unrecognized `<document_type>`, including PN. Result: Senate confirmation votes land in `proposals` with the procedural question as title, `type=bill` instead of `appointment`, and a fake `legacy_bill_number` like `S 11-22`. FIX-162 + FIX-164 cleaned up the historical mess; this item is the upstream fix so the next vote pipeline run doesn't re-introduce it. Approach: detect `document_type='PN'` in [packages/data/src/pipelines/congress/votes.ts](packages/data/src/pipelines/congress/votes.ts) (around line 696), build a separate proposal record with `type='appointment'`, title from the XML's `<document_title>`, `legacy_bill_number = PN N` or `PN P-N`, and a `congress_gov_url` pointing at `https://www.congress.gov/nomination/{congress}-th-congress/{N}` (verify URL format). Bill_details still attaches because votes.bill_proposal_id FKs through it; longer-term that should become a polymorphic ref. Verify by re-running `pnpm data:votes` after the fix and confirming any new PN rolls land as `type=appointment`. <!--id:FIX-165-->
  - **2026-04-28:** done. PN branch added in the Senate parsing block (uses `<document_title>` for `title`, `type=appointment`, `billNumber=PN N`, `congressGovUrl=…/nomination/{c}th-congress/{N}`); `normalizeSenateDocType` now returns `null` instead of falling through to `S`, with a one-line warning when the new code path encounters an unrecognized type so future drift is loud rather than silent. Verified locally on the in-progress 119th run — first new PN since the fix landed as `appointment`: "Robert Cekada, of Florida, to be Director, Bureau of Alcohol, Tobacco, Firearms, and Explosives" (PN 730-14).
- [x] 🟠 S — **Move `vercel.json` into `apps/civitics/`** — The Vercel project's Root Directory is set to `apps/civitics`, so per [Vercel docs](https://vercel.com/docs/projects/project-configuration#vercel.json) `vercel.json` must live inside that directory to be discovered. With it at the repo root, the cron schedules in the file are never registered with the scheduler — which is why the 02:00 UTC nightly-sync hadn't fired (preceding FIX-168 fixed the route's correctness but not the registration). Move was a `git mv` so history follows. <!--id:FIX-169-->
- [x] 🟠 M — **Nightly cron correctness: data_sync_log column + Congress key name** — Two bugs that together explain why the dashboard "Last nightly" card has been showing stale data and Congress votes/officials have been silently skipped on every run. (1) [apps/civitics/app/api/cron/nightly-sync/route.ts](apps/civitics/app/api/cron/nightly-sync/route.ts) inserts `data_sync_log` with column `pipeline_name`, but the actual schema column (per [supabase/migrations/0022_data_sync_log_and_graph_snapshots.sql](supabase/migrations/0022_data_sync_log_and_graph_snapshots.sql)) is `pipeline`. The error is swallowed by the route's try/catch, so the trigger row never lands and the dashboard can't show that the cron fired. (2) Every Congress pipeline file uses env var `CONGRESS_API_KEY` (also what's in `.env.local`, `.env.example`, `turbo.json`), but the nightly orchestrator [packages/data/src/pipelines/index.ts](packages/data/src/pipelines/index.ts) checked `CONGRESS_GOV_API_KEY` — so the key was always "missing" and both `congress_officials` and `congress_votes` got status `skipped` regardless of whether the key was set. **Vercel env-var note:** if `CONGRESS_GOV_API_KEY` (and not `CONGRESS_API_KEY`) is what's currently set in Vercel, it needs to be renamed there for tonight's prod run to actually call Congress.gov. <!--id:FIX-168-->
- [x] 🟠 M — **"PAC Money by Sector" treemap shows PAC name variations instead of sectors** — The treemap in [apps/civitics/app/api/graph/treemap-pac/route.ts](apps/civitics/app/api/graph/treemap-pac/route.ts) groups by `financial_entities.industry`, but that column is populated by [packages/data/src/pipelines/fec-bulk/writer.ts](packages/data/src/pipelines/fec-bulk/writer.ts) with the FEC committee master file's `CONNECTED_ORG_NM` — a parent-org/candidate/committee name, not an industry code. Verified on prod: 896 distinct values across 1,000 rows (`'NONE'`, `'WELLS FARGO AND COMPANY'`, `'OMAR'`, `'BYRON DONALDS VICTORY FUND'` …). Clean industry tags already exist in `entity_tags` (`tag_category='industry'`, 13-value taxonomy) — that's where the AI/rule taggers write. Fix: drop `financial_entities.industry` entirely, route every reader (treemap, search subtitles, group filters, official donors, sankey fallback, snapshot/entities/search APIs, several SQL RPCs) through `entity_tags`, stop the FEC writer poisoning the column, drop the `industry_hint` from the enrichment AI prompt. Sankey already uses the right pattern as a reference. <!--id:FIX-167-->

---

## POST-CUTOVER (Supabase Pro, shadow→public promoted 2026-04-22)

- [x] ⬜ M — **USASpending grants fetch** — FIX-101 USASpending rewrite queries `award_type_codes: ["A", "B", "C", "D"]` (procurement contracts only). Grants use codes 02/03/04/05/11 and land in a slightly different response schema. Post-FIX-101 Pro has 1,480 contracts and 0 grants. Add a second fetch pass against the grants codes if grant-level reporting becomes a product need — same batched writer, `relationship_type='grant'`. <!--id:FIX-114-->
- [x] 🟢 S — **USASpending bulk state per-environment** — `packages/data/.usaspending-bulk-state.json` tracks `lastArchiveDate` per category but not per env. After a local run records `20260406`, a prod run reads the same file, sees the date as already-processed, and exits without writing — current workaround is `--force` on every cross-env run. Key state under `envs.{supabase-url-host}.{category}` so `127.0.0.1:54321` and `xsazcoxinpgttgquwvuf.supabase.co` track independently. Migration: legacy per-category root state migrates into whichever env is active at first read; the other env starts fresh and needs one Full run. <!--id:FIX-166-->

---

## GENERAL / CROSS-CUTTING


---

## HOMEPAGE

- [ ] 🟢 M — **State legislative district overlay on homepage map** — DistrictMap exposes SLD-U and SLD-L layer toggles backed by Census TIGER boundaries (`pnpm data:districts`). Click any district polygon to navigate to `/districts/[id]`. Layers debounced-refetch on map move via `/api/districts?bbox=…&chamber=…`. <!--id:FIX-163-->

---

## OFFICIALS

- [x] ⬜ L — **Current term duration + upcoming election status** — requires Ballotpedia/OpenStates elections data pipeline; Phase 2 <!--id:FIX-022-->

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


> Refinement plan: see [`docs/GRAPH_PLAN.md`](GRAPH_PLAN.md). FIX-120 → FIX-150 each map to a section there.

### Direction 1 — Tighten what's there


### Direction 3 — Reactive panels


### Direction 2 — Browse like a file system


### New connection types


### New visualization types


### Compare mode upgrade


### Documentation


### Prerequisites (discovered in audit)


### Post-launch bug fixes

- [x] 🟡 M — **Rewrite OpenStates pipeline to use bulk data dumps** — current pipeline (`packages/data/src/pipelines/openstates/index.ts`) hits the OpenStates API per-state, per-endpoint with pagination — ~50 states × 2 endpoints × N pages. OpenStates publishes daily bulk dumps at `data.openstates.org` (CSV / JSON, free, no rate limits). Same playbook as FEC API → FEC bulk and FIX-118 USASpending API → bulk: download, stream-parse, upsert. Should be ~5–10× faster end-to-end and eliminates the rate-limit ceiling on full state-legislator refreshes. <!--id:FIX-160-->

---

## DASHBOARD

- [ ] 🟡 M — **Reduce stat cards from 6 to 4** — Officials / Open Proposals / Votes / Donation Flow; bundle into `<StatsRow>` <!--id:FIX-089-->
- [ ] 🟠 L — **Add sparklines to stat cards** — build `/api/stats/trends` returning last 30 days of daily counts per metric <!--id:FIX-090-->
- [ ] 🟡 M — **Parse FIXES.md into per-phase task lists with real done state** — reads `docs/done.log`; replaces hard-coded PHASE1_TASKS <!--id:FIX-095-->

---

## INFRASTRUCTURE & PERFORMANCE

- [x] 🟡 M — **Vote backfill completion** — 51k/227k vote connections live; full backfill pending IO recovery; complete this before Phase 1 closes <!--id:FIX-051-->
  - **2026-04-28:** the previous attempts stalled because `votes.ts` had a hard-coded session→year mapping (`{1: 2025, 2: 2026}`) — running with `CONGRESS_OVERRIDE=117` looked for 2025 House XML and 404'd every roll. Fixed in [packages/data/src/pipelines/congress/votes.ts](packages/data/src/pipelines/congress/votes.ts): `year = 2021 + (CURRENT_CONGRESS - 117) * 2 + (session - 1)`. Coupled with FIX-165 (PN handling) so the backfill doesn't seed thousands of new procedural-titled stubs. Local + prod backfills run end-to-end; vote count climbs from 245k to ~600k+.

---

## COMMUNITY & AUTH


---

## DOCUMENTATION (Open Source Readiness)


---

## COMPLETED (archive, don't delete — useful reference)

_Completed items moved here by `pnpm fixes:clean`. `pnpm fixes:archive` moves them to `docs/archive/fixes-archive.md`._

### BUGS — Fix These First

- [x] 🔴 S — **Civic Initiatives: "Open for deliberation" returns "Initiative not found"** — fixed 2026-04-12: migrations 20260411020000–20260411100000 applied (`supabase migration up --local`); `advance/route.ts` patched to distinguish query errors from genuine 404s. <!--id:FIX-001-->
- [x] 🔴 S — **Civic Initiatives: Edit button expanded box too large** — fixed 2026-04-12 (TASK-14): InlineEditor repositioned to `absolute right-0 top-8 z-20` overlay; container div made `relative`. Reviewed; Qwen truncation repaired by Claude. <!--id:FIX-002-->
- [x] 🔴 M — **Graph: Nodes render UUID labels instead of entity names** — fixed 2026-04-12 (TASK-15): all 8 `.label` → `.name` accesses in `ForceGraph.tsx` updated to match V2 field contract. Clean. <!--id:FIX-003-->
- [x] 🔴 S — **Graph: Orphan nodes remain after connection is removed** — fixed 2026-04-12 (TASK-16): `useGraphData.ts` now computes `survivingEdges` before pruning orphan nodes in `setNodes`. Reviewed; Qwen truncation repaired by Claude. <!--id:FIX-004-->
- [x] 🟠 S — **Graph: Config settings dropdowns (Layout / Node Size / Color) show no active state** — fixed 2026-04-12 (TASK-13): `text-gray-900` added to `LabeledSelect` select className in `GraphConfigPanel.tsx`; native `<select>` was inheriting near-invisible `text-gray-500` from panel ancestors. Clean. <!--id:FIX-005-->
- [x] 🟠 M — **Officials: Elizabeth Warren and some senators missing from search** — confirmed NOT a code bug; Warren is `is_active = true` with correct `role_title` and `full_name` in DB; ILIKE `%warren%` query returns her. PHASE_GOALS entry was stale. Verified 2026-04-12. <!--id:FIX-006-->
- [x] 🟠 S — **DB types stale** — regenerated 2026-04-12 after sprint 9 migrations applied; `database.ts` now reflects all new columns. Note: on Windows PowerShell use `[System.IO.File]::WriteAllLines()` instead of `>` redirect to avoid UTF-16 corruption. <!--id:FIX-007-->
- [x] 🔴 S — **Dashboard crashes with "Event handlers cannot be passed to Client Component props"** — `BrowsingFlowsSection` is a Server Component but attached an `onClick` to an `<a>` for template paths; template rows now render as `<span aria-disabled>` instead <!--id:FIX-062-->
- [x] 🔴 S — **NavBar missing on most pages** — was added per-page in FIX-015 but not to proposals, agencies, graph, search, or officials list; moved to root layout (hidden on `/graph/*` and `/auth/*`) so it can't silently drop again <!--id:FIX-063-->
- [x] 🔴 S — **Filter procedural votes and case names out of enrichment queue** — ~489 contaminated `proposals` rows (169 procedural vote questions matching `^on `, 320 court case names matching ` v. `) got staged by `seed-backlog.ts`; enriching them would write garbage into `entity_tags` and `ai_summary_cache`. Delete contaminated queue rows + add `not.ilike` guards to the seeder so a re-seed can't reintroduce them. Root cause (contamination of `proposals` itself) is FIX-066. <!--id:FIX-065-->
- [x] 🟠 M — **Investigate: procedural votes and court case names are landing in `proposals` table** — identify source pipeline, decide quarantine vs delete <!--id:FIX-066-->
- [x] 🟠 L — **Data integrity audit — scaffolding + first run against prod** <!--id:FIX-067-->
- [x] 🟠 M — **Sitting U.S. President not in `officials` table** — audit 2026-04-19 found 0 active officials with `role_title ILIKE '%president%' AND role_title NOT ILIKE '%vice%'`. EOP agency exists (migration 20260417) but no person row. <!--id:FIX-068-->
- [x] 🟠 M — **Sitting U.S. Vice President not in `officials` table** — audit 2026-04-19 found 0 active officials with `role_title ILIKE '%vice president%'`. <!--id:FIX-069-->
- [x] 🟠 S — **Federal House count is 438 (expected 441)** — 3 representatives missing among federal officials with `source_ids ? 'congress_gov'`. Check ingester completeness vs. current vacancies. See docs/audits/2026-04-19.md. <!--id:FIX-070-->
- [x] 🟠 M — **All 100 federal senators have NULL `metadata->>'state'`** — per-state breakdown collapses to a single null bucket of 100. Senators are correctly counted but state attribution is missing, breaking any state-scoped query. Fix the congress.gov ingester to populate `metadata.state` (or `state_abbr`). <!--id:FIX-071-->
- [x] 🟠 L — **Procedural-vote / court-case contamination in `proposals` grew to 827** — was ~489 at FIX-065/066 baseline. FIX-066 root-cause work has not landed; meanwhile new ingester runs continue to add procedural rows. See docs/audits/2026-04-19.md. **Shadow schema (20260421) eliminates the new-data contamination path; remaining work is clean-up of existing bad rows in `public.proposals`** — may be low-priority once shadow schema is the live read path. <!--id:FIX-072-->
- [x] 🟠 S — **7053 votes have `vote = 'not_voting'` instead of `'not voting'`** — invalid enum value (snake_case vs space-separated form documented in CLAUDE.md §votes table). One UPDATE replaces the underscored form with the canonical one. <!--id:FIX-073-->

### POST-CUTOVER (Supabase Pro, shadow→public promoted 2026-04-22)

- [x] 🟠 L — **Rewrite graph chord + treemap RPCs against polymorphic financial_relationships** — restore `chord_industry_flows()`, `treemap_officials_by_donations(integer, text, text, text)`, `get_group_sector_totals(uuid[])`, `get_crossgroup_sector_totals(uuid[], uuid[])`, `get_group_connections(uuid[], integer)`, `get_connection_counts(uuid[])`. All read donor flows; replace `donor_name`/`official_id` joins with `financial_entities` + polymorphic FK joins. Called from `/api/graph/chord`, `/api/graph/snapshot`, and several dashboard panels. <!--id:FIX-097-->
- [x] 🟠 M — **Rewrite officials-breakdown + donor RPCs against polymorphic schema** — restore `get_officials_breakdown()`, `get_official_donors(uuid)`, `get_pac_donations_by_party()`, `get_officials_by_filter(text, text, text)`. Dashboard Transparency + Operations panels rely on these; the officials-detail donor tab is broken. <!--id:FIX-098-->
- [x] 🟠 M — **Rewrite search_graph_entities against post-promotion schema** — search currently fails (FIX-097 self-test "entity_search_finds_warren"). New shape should query officials + agencies + financial_entities in one pass, trimmed to the columns the graph actually needs. <!--id:FIX-099-->
- [x] 🟠 L — **Implement rebuild_entity_connections derivation rules** — Stage 1B function still a stub returning empty set. Derive: donation (from financial_relationships), vote_yes/vote_no (from votes), co_sponsorship, appointment (career_history), oversight, holds_position, gift_received, contract_award, lobbying. Called by nightly-sync after source pipelines; the 0 entity_connections count in `/api/claude/status` is this. <!--id:FIX-100-->
- [x] 🟠 L — **Re-run deferred pipelines against Pro** — Option C shipped only congress bills+votes. Still to run against Pro: FEC bulk (donor flows), USASpending, Regulations.gov, OpenStates (state legislators + state bills), CourtListener, Legistar (4 metros), tag-rules, ai-summaries, tag-ai. Each needs its shadow→public writer rewrite similar to the one done for congress. <!--id:FIX-101-->
- [x] 🟡 M — **Clean up 307 orphan proposals from early broken Pro ingest runs** — duplicates of real bills, created before the trigger-body fix (migration 20260422000001). Their sibling proposals have the bill_details row and hold the votes; these orphans clutter counts. Safe to `DELETE FROM proposals WHERE id IN (…)` after confirming zero vote FKs. <!--id:FIX-102-->
- [x] 🟡 S — **Fix `a.rpc(...).catch is not a function` in officials_breakdown handler** — `/api/claude/status` reports `officials_breakdown: {error, partial: true}`. The handler is chaining `.catch()` onto a supabase-js `rpc()` call, which returns a thenable-with-error-shape, not a Promise. Replace with a try/await. <!--id:FIX-103-->
- [x] 🟡 S — **Recreate proposal_trending_24h materialized view + refresh_proposal_trending()** — both were dropped in the promotion migration; recreate against public.proposals. Currently nothing on the homepage "trending" path. <!--id:FIX-104-->
- [x] 🟡 S — **Default /proposals landing filter to "all"** — "open" requires status='open_comment' AND metadata->>comment_period_end > now(). Post-cutover, 989 congress-bill proposals have status='introduced' with no comment period, so the "open" default landed users on an empty page. Users can still pick "Open for comment" explicitly. <!--id:FIX-105-->
- [x] 🟠 M — **Add 6-digit OTP option alongside magic link in SignInForm** — today SignInForm only offers magic link (`signInWithOtp` with `emailRedirectTo`) + OAuth. Users on mobile / cross-device flows often can't click the link in the email they receive. Add a second path: call `signInWithOtp` without `emailRedirectTo` (Supabase sends the 6-digit code instead of a link), then show a 6-input form that calls `supabase.auth.verifyOtp({ email, token, type: 'email' })`. Both paths use the same Supabase template — one "Email OTP" template produces either a magicLink variable or a Token variable depending on how it was requested. UX: primary button "Email me a sign-in link", secondary link "Prefer a 6-digit code?" that swaps the form. <!--id:FIX-106-->
- [x] 🟠 M — **Seed the 6 missing top-20 federal agencies** — DOD, TREAS, DOS, DOL, GSA, SSA aren't in `public.agencies` on Pro, so USASpending awards from these agencies are silently skipped (acronym lookup miss during FIX-101 USASpending run). Regulations.gov insert-on-miss only catches agencies that post proposals. Either seed these six directly or add a top-agencies seed to `agencies-hierarchy`. Blocks ~30% of USASpending coverage. <!--id:FIX-107-->
- [x] 🟡 M — **Fix chamber/state inference in `treemap_officials_by_donations`** — the restored RPC parses `source_ids->>'fec_id'` position 0 for chamber and 2–3 for state. False positives when an official holds an old FEC filing ID whose first char is 'S' but they're actually a House rep (Shontel Brown shows as Senate/TX in post-FIX-101 Pro data; she's an Ohio Representative). Prefer `jurisdictions.short_name` via `jurisdiction_id` + `role_title ILIKE` as the primary derivation, fall back to FEC ID parsing only when those are null. <!--id:FIX-108-->
- [x] 🟠 L — **Tag financial_entities with industry** — `chord_industry_flows()` joins to `entity_tags` with `tag_category='industry'`. Post-FIX-101 (FEC + USASpending) Pro has 2,639 financial_entities but zero industry tags, so every chord flow collapses to one "Untagged" bucket (~$60M+ Rep House etc). Need a rule-based or AI industry tagger pass — `financial_entities.industry` text column is already populated (CONNECTED_ORG_NM for FEC, empty for USASpending corps; NAICS code is in `financial_relationships.metadata->>'naics_code'` for contracts). Without this the chord visualization stays unusable. <!--id:FIX-109-->
- [x] 🟡 L — **Surface contract/grant flows in graph RPCs** — FIX-101 FEC + USASpending land `type='contract'` rows in `financial_relationships` (1,480 on Pro, more once grants land) and `contract_award` edges in `entity_connections`. All existing chord/treemap/donor-breakdown RPCs filter strictly to `relationship_type = 'donation'`, so government spending is invisible in any viz. Add `chord_contract_flows()` (agency → recipient sector / NAICS) and `treemap_recipients_by_contracts()` + wire them into a dashboard "Spending" panel. <!--id:FIX-110-->
- [x] 🟡 M — **Delete obsolete shadow-era pipelines after FIX-101 completes** — the following paths become dead code once the remaining FIX-101 rewrites land: `packages/data/src/pipelines/fec/index.ts` (legacy FEC API — CLAUDE.md already says "do not use"), `pac-classify/index.ts` (reads dropped `donor_name`), `financial-entities/index.ts` (reads dropped `donor_name`/`name`), `connections/shadow.ts` + `connections/delta.ts` (superseded by `rebuild_entity_connections()` SQL), `initiatives/shadow-backfill.ts` (one-time migration artifact), and the `shadowClient` helper in `packages/data/src/pipelines/utils.ts`. Remove in a dedicated cleanup commit — check `data:shadow-connections` / `data:shadow-initiatives` scripts in `package.json` too. <!--id:FIX-111-->
- [x] 🟡 S — **Fix `tags/rules.ts` broken column references** — rule runs during FIX-101 quick-wins verification logged two errors: `proposals.comment_period_end does not exist` and `financial_relationships.official_id does not exist`. Proposal tags and financial-entity tags paths both crash; only the officials path currently works (503 tags upserted clean). Update the queries to the post-cutover schema — comment_period_end lives on the proposal's metadata or a different column post-cutover; financial_relationships uses polymorphic `to_id`/`to_type`. <!--id:FIX-112-->
- [x] 🟢 S — **Explicitly paginate officials load in FEC bulk** — PostgREST default `max_rows=1000` silently truncates `loadOfficials()` in `packages/data/src/pipelines/fec-bulk/index.ts`. Pro is fine (~903 active federal officials, all fit), but local dev has 9,158 active officials (Legistar + OpenStates seed lots), so 8,158 get dropped during fuzzy-match builds — a latent correctness bug that would bite us any time the federal roster grows or we process state-level races. Use a pagination loop (range + offset) or a higher explicit limit. <!--id:FIX-113-->
- [x] ⬜ L — **Switch USASpending pipeline to award data archive (bulk download)** — current pipeline hits the paginated search API: hardcoded top-20 agencies, top 100 awards ≥ $1M, FY2024 only. USASpending publishes pre-built annual archives at `https://files.usaspending.gov/award_data_archive/` with predictable filenames (`FY2026_All_Contracts_Full_YYYYMMDD.zip`, `FY2026_All_Contracts_Delta_YYYYMMDD.zip`). Static files — no rate limits, no async polling, all agencies, all award sizes. Pattern is identical to the FEC `pas224.zip` streaming approach already in `packages/data/src/pipelines/fec-bulk/`. Implementation: (1) detect latest Full/Delta URL from the archive index page, (2) stream-unzip and parse CSV line-by-line filtering to agencies in our `agencies` table, (3) reuse `upsertSpendingRelationshipsBatch` writer. First run: Full file (~300MB–1GB compressed for partial FY). Subsequent runs: Delta file (much smaller). Supersedes current `data:usaspending` pipeline for contracts; FIX-114 grants fetch would also switch to `FY2026_All_Assistance_*.zip`. <!--id:FIX-118-->
- [x] ⬜ M — **Fix USASpending sub-agency attribution** — bulk pipeline only matched `awarding_agency_name`, so all Forest Service contracts landed on USDA and ICE/TSA/FEMA contracts were dropped entirely (not in agencies table). Fix: (1) seed ICE, TSA, FEMA as DHS sub-agencies via migration; (2) check `awarding_sub_agency_name` before `awarding_agency_name` in pipeline; (3) add stripped "U.S." alias keys to agency map so CSV names like "Department of Agriculture" match DB entries like "U.S. Department of Agriculture". Re-ran `--force` after fix: 841,264 matched (vs 837,417 before), 3,847 additional contracts correctly attributed. <!--id:FIX-119-->
- [x] 🟢 S — **Batch the reactive `findOrCreateBillProposal` path in congress bills** — the proactive sync is now batched (FIX-101 quick win) but the reactive path in `congress/votes.ts` still calls `findOrCreateBillProposal` per novel bill (3–4 RTs each — SELECT ref + INSERT proposal + INSERT bill_details + INSERT ref). Fires only for bills first seen during vote ingestion (typically a handful per run), so impact is low. If vote pipeline runtime grows, buffer novel bills during XML parse and flush in one batched pass at the end. <!--id:FIX-115-->
- [x] 🟡 S — **Tighten OpenStates people-endpoint rate limiting** — current `100ms` sleep between `/people` calls triggers 429s regularly (first call of each state, mid-chamber page turns). Each 429 costs a 30s retry stall; full 50-state run burns ~2–3 min of retry time even before the daily quota hits. Raise the inter-call sleep on the people endpoint to ~1000ms or add adaptive backoff that widens after each 429. Surfaced during the FIX-101 OpenStates Pro run (quota exhausted after 11 states partly due to cumulative retry waste). <!--id:FIX-116-->
- [x] 🟡 S — **Add index on enrichment_queue(entity_type, task_type) for snapshot reads** — the seed script's `fetchQueueSnapshot()` filters by (entity_type, task_type) without a covering index; at >50k queued rows each page scan becomes O(N) and hits Pro's ~8s statement timeout partway through. Seeded the Pro queue to 125,480 / 141,772 items; the ~17k gap is items whose classification fell inside a timed-out SELECT page. Adding `CREATE INDEX enrichment_queue_type_task ON enrichment_queue(entity_type, task_type)` makes the snapshot paginate cleanly; subsequent `data:enrich-seed` runs will then close the gap idempotently. <!--id:FIX-117-->

### GENERAL / CROSS-CUTTING

- [x] 🟠 M — **Mobile responsiveness audit** — fixed 2026-04-12: hamburger nav (NavBar component, all pages), Proposals filter flex-col on mobile, Graph panels auto-collapse at <768px, Official profile header flex-col on mobile, Initiatives inline navs replaced with shared NavBar <!--id:FIX-008-->
- [x] 🟠 M — **Accessibility (a11y) audit** — completed 2026-04-13: skip-to-content link in NavBar; aria-label on all nav landmarks; focus-visible rings on all interactive elements; aria-label + aria-pressed on filter pills; htmlFor/id on all proposal filter labels; main landmark + id="main-content" on officials/proposals/initiatives/home pages; aria-live search status region; combobox ARIA on GlobalSearch; role="switch" + aria-checked on graph toggles; aria-label on all graph sliders/selects; aria-hidden on decorative SVGs; aria-current on breadcrumb + active filters + pagination; aria-labelledby on featured section; pagination nav landmark <!--id:FIX-009-->
- [x] 🟠 M — **SEO / Open Graph metadata** — OG tags added 2026-04-13 (TASK-19); JSON-LD added 2026-04-16: `schema.org/Person` on Officials, `schema.org/Legislation` on Proposals <!--id:FIX-010-->
- [x] 🟡 M — **Consistent loading/skeleton states** — done 2026-04-17: all 4 main route `loading.tsx` files (officials, proposals, agencies, initiatives) have proper skeleton layouts matching the final page structure <!--id:FIX-011-->
- [x] 🟡 S — **Consistent empty states** — done 2026-04-13 (TASK-20): empty states on Officials, Proposals, Agencies list pages <!--id:FIX-012-->
- [x] 🟡 M — **404 and error pages** — done 2026-04-15 (TASK-24): `not-found.tsx` (branded 404, 4 quick-link cards) + `error.tsx` (error boundary, Try Again + Go Home) <!--id:FIX-013-->
- [x] 🟢 S — **Clickable links audit** — done 2026-04-17: agency chips in ProposalCard and proposal detail page now link to `/proposals?agency=…`; `href="#"` "Submit comment" on agency detail fixed to `/proposals/${rule.id}`; bill number and regulations.gov ID chips on agency detail now linked; agency acronym in search results now linked <!--id:FIX-014-->
- [x] 🟢 S — **Header/footer consistency** — done 2026-04-17: `Footer.tsx` component created and added to root layout (universal); NavBar added to proposals list, proposals detail, officials detail, dashboard, and profile pages; graph/embed and agencies/officials full-screen pages intentionally keep their specialized chrome <!--id:FIX-015-->

### HOMEPAGE

- [x] 🟢 S — **Add Initiatives link to main header nav** — done 2026-04-13 (TASK-17): Initiatives in NavBar NAV_ITEMS, routes to `/initiatives` <!--id:FIX-016-->
- [x] 🟡 M — **Civic Initiatives featured section** — verified 2026-04-18: `InitiativesSection` on homepage shows top-4 by upvote count with fallback to newest-4; renders `InitiativeCard` components alongside Officials/Proposals/Agencies <!--id:FIX-017-->

### OFFICIALS

- [x] 🟢 S — **Show federal vs. state indicator on cards and profile** — done 2026-04-18: badge in OfficialsList rows, OfficialCard, and detail page header; driven by `source_ids->>'congress_gov'` <!--id:FIX-018-->
- [x] 🟡 M — **Votes / Donors / Raised as tabs on profile page** — already done (ProfileTabs with Overview/Votes/Donations/Connections) <!--id:FIX-019-->
- [x] 🟡 M — **Individual votes: add description and expand on click** — done 2026-04-18: vote rows in VotesTab expand on click; shows `vote_question` from metadata and "View proposal →" link; `metadata` added to votes select in profile page <!--id:FIX-020-->
- [x] 🟢 S — **"View full profile" button prominence** — done 2026-04-18: `bg-indigo-600 text-white` primary button in OfficialCard <!--id:FIX-021-->
- [x] 🟡 S — **Improve filtering options** — already done (chamber/party/state/issue-area/donor-pattern filters in OfficialsList) <!--id:FIX-023-->
- [x] 🟢 S — **Share button on official profile** — already done (ShareButton on profile detail page) <!--id:FIX-024-->

### PROPOSALS

- [x] 🟡 M — **Improve "6 closing soonest" header section** — replaced 2026-04-16 with 3-tab `FeaturedSection.tsx` client component: "Closing Soon" / "Congressional Bills" / "Most Viewed"; tab state client-side, data server-fetched in parallel <!--id:FIX-025-->
- [x] 🟡 M — **Make congressional bills more prominent** — addressed 2026-04-16: "Congressional Bills" is now a dedicated tab in FeaturedSection on the proposals list page <!--id:FIX-026-->
- [x] 🟡 M — **Better filtering** — done 2026-04-18: status (open/all/closed), type (6 types), agency (20 top agencies), topic pills (8 pills via entity_tags), sort-by dropdown (closing soon / newest / A–Z), text search. Date range filter deferred — URL params already persist, easy to add if a user asks <!--id:FIX-027-->
- [x] 🟢 S — **Share button on proposal cards and detail page** — done 2026-04-15 (TASK-22): `ProposalShareButton` on detail page header and each `ProposalCard` <!--id:FIX-028-->

### PROPOSALS [ID]

- [x] 🟡 M — **Reduce Official Comments section friction** — resolved 2026-04-18: layout already separates cleanly. Main column shows `PositionWidget` + `CivicComments` (community), sidebar holds `CommentDraftSection` for official submission to regulations.gov. No "Official Comments" block competes with community discussion — the concern was stale. <!--id:FIX-030-->

### CIVIC INITIATIVES

- [x] 🟠 S — **Add Initiatives to header nav** — done 2026-04-13 (TASK-17): duplicate of HOMEPAGE item; Initiatives link is in NavBar NAV_ITEMS <!--id:FIX-031-->
- [x] 🟡 M — **Filters on initiatives list** — verified 2026-04-18: `initiatives/page.tsx` has stage tabs (All / Problems / Deliberating / Mobilising / Resolved), scope pills (federal / state / local), topic pills (15 issue areas), sort (newest / most active), + "My initiatives" tab for signed-in users <!--id:FIX-032-->
- [x] 🟡 M — **Argument board — Sprint 3** — verified 2026-04-18: `ArgumentBoard.tsx` has 12-type comment system (support/oppose/concern/amendment/question/evidence/precedent/tradeoff/stakeholder_impact/experience/cause/solution), deep reply threading, vote buttons, flag with reason codes, filter pills by type, draft lockout banner <!--id:FIX-033-->
- [x] 🟡 M — **"Post a problem" pathway** — done 2026-04-17 (migration `20260417100000_initiative_stage_problem.sql`): `/initiatives/problem` route with dedicated `PostProblemForm` (title / optional context / scope / issue tags), inserts with `is_problem: true`, renders with orange "Problem" stage styling, `TurnIntoInitiativeButton` lets author promote to full initiative <!--id:FIX-034-->
- [x] 🟢 S — **Draft → argument creation decision** — resolved 2026-04-18: decision was "no — arguments require deliberation stage"; `ArgumentBoard.tsx` enforces this with a draft lockout banner ("Comments open once this initiative is in deliberation.") and `canSubmit` gate on stage <!--id:FIX-035-->

### AGENCIES

- [x] 🟡 M — **Improve agency card design** — completed 2026-04-16/17: sector tags inferred from name/acronym (15-rule regex table), graph CTA link, website link in footer strip, flex-column layout, sector filter dropdown added. Employee count/budget/year requires USASpending pipeline (⬜ future). <!--id:FIX-036-->
- [x] 🟡 M — **Agency visual / hierarchy view** — implemented 2026-04-17: `AgencyActivityChart.tsx` CSS bar chart showing top 12 agencies by proposal count, rendered above the grid on `/agencies`. Full hierarchy graph (⬜ XL) deferred — `parent_agency_id` data not yet populated. <!--id:FIX-037-->
- [x] 🟡 M — **Agency Officials search** — implemented 2026-04-17: officials section on agency detail page; only ~10 official→agency connections in entity_connections currently; revisit when data is richer <!--id:FIX-038-->
- [x] 🟡 M — **Inline preview on card click** — implemented 2026-04-17: `AgencySlideOver` panel in `AgenciesList.tsx`; card click opens a right-side drawer with stats, description, quick links, and "View full agency profile" CTA; Escape + backdrop to close; `aria-modal` + focus management <!--id:FIX-039-->
- [x] 🟡 M — **White House featured card** — implemented 2026-04-17: migration `20260417000000_insert_whitehouse_eop.sql` inserts EOP as a featured agency; `WhiteHouseFeaturedCard` component pinned above the grid with gradient border styling; hidden when filters are active <!--id:FIX-040-->
- [x] ⬜ XL — **Agency hierarchy graph** — implemented 2026-04-25: agencies-hierarchy pipeline run (13 parent links); AgencyHierarchyTree CSS org-chart on detail page shows parent → current → children; hidden when no hierarchy data. <!--id:FIX-041-->

### GRAPH

- [x] 🟠 M — **Node right-click / options menu** — implemented 2026-04-16: `NodeContextMenu.tsx` with expand, pin/unpin (D3 fx/fy), hide (local hiddenIds), view profile/proposal, copy link; positional with container-bound flip logic <!--id:FIX-043-->
- [x] 🟢 S — **Graph: share button / copy link** — implemented 2026-04-16: "Link" button added to `GraphConfigPanel.tsx` footer; copies `window.location.href` to clipboard with 2s "Copied ✓" flash state <!--id:FIX-045-->
- [x] 🟠 L — **USER node** — show the signed-in user as a node; connect to their district's representatives; visually indicate alignment score (votes/priorities match). **Blocked by data pipeline:** federal officials (US Senators / US Reps) have empty `metadata` and blank `district_name`; state is only encoded inside `source_ids->>'fec_candidate_id'` (positions 2–3). Also requires the Phase 2 `user_preferences` table (CLAUDE.md: "not yet created") for `home_state` / `home_district` / `district_jurisdiction_id`. Prereqs: (a) populate `officials.metadata.state_abbr` for federal reps via FEC ID parsing or a dedicated column; (b) create `user_preferences`; (c) profile editor UI; (d) graph injection hook; (e) alignment-score computation against `civic_comments.position` × `votes.vote`. <!--id:FIX-042-->
- [x] 🟡 M — **Procedural vote filter in graph panel** — toggle to hide/show procedural votes in the connection graph (the toggle exists in FocusTree; verify it's also surfaced in the main graph filter UI and working end-to-end) <!--id:FIX-044-->
- [x] 🟠 L — **USER node visible & toggleable** — surface USER node in FocusTree; add `alignment` to DEFAULT_CONNECTION_STATE; per GRAPH_PLAN §1.1 <!--id:FIX-120-->
- [x] 🟢 S — **`addGroup`/`removeGroup` markDirty** — mirror addEntity/removeEntity behavior so Save Changes button appears; per GRAPH_PLAN §1.2 <!--id:FIX-121-->
- [x] 🟡 M — **AI Explain gated by AI_SUMMARIES_ENABLED** — `/api/graph/narrative` checks flag; header button hides/disables when off; per GRAPH_PLAN §1.3 <!--id:FIX-122-->
- [x] 🟡 M — **Bills show titles, not IDs** — connections API joins proposals.title; force-graph node label uses title; per GRAPH_PLAN §1.4 <!--id:FIX-123-->
- [x] 🟠 L — **State data on officials** — populate `officials.metadata.state_abbr` for federal reps; verify treemap by-state works; HIT_LIST flag; per GRAPH_PLAN §1.5 <!--id:FIX-124-->
- [x] 🟡 M — **Procedural votes filtered by default** — DEFAULT_VIEW.includeProcedural=false; verify per-roll-call filter end-to-end; HIT_LIST flag; per GRAPH_PLAN §1.6 <!--id:FIX-125-->
- [x] 🟠 L — **`user_custom_groups` DB table** — schema + RLS + `/api/graph/custom-groups`; per GRAPH_PLAN §1.7 <!--id:FIX-126-->
- [x] 🟠 L — **Custom group builder UI** — inline form in GroupBrowser + sidebar widget on `/agencies`; per GRAPH_PLAN §1.8 <!--id:FIX-127-->
- [x] 🟠 L — **Connections tree gates by focus type** — `applicableConnectionTypes(focus)` helper; non-applicable rows fall under collapsed sub-tree; per GRAPH_PLAN §3.1 <!--id:FIX-128-->
- [x] 🟠 L — **Viz dropdown self-populates** — each VIZ_REGISTRY entry gains `isApplicable()`; header dropdown groups Available vs Not-yet-applicable; per GRAPH_PLAN §3.2 <!--id:FIX-129-->
- [x] 🟡 M — **Settings panel disables non-applicable controls** — disabledReason prop on form primitives; tooltip explains why; per GRAPH_PLAN §3.3 <!--id:FIX-130-->
- [x] 🟡 M — **Empty-state preset buttons** — keep search prompt; add 3 visual cards (Force / Treemap / Chord) with thumbnails; per GRAPH_PLAN §3.4 <!--id:FIX-131-->
- [x] 🟢 S — **PathFinder surfaced** — header chip opens floating overlay; per GRAPH_PLAN §3.5 <!--id:FIX-132-->
- [x] 🟢 S — **Header consolidation** — visual clusters with separators (left/center/right); per GRAPH_PLAN §3.6 <!--id:FIX-133-->
- [x] 🟢 S — **Right-panel collapsed icons jump to sections** — also left panel; per GRAPH_PLAN §3.7 <!--id:FIX-134-->
- [x] 🟠 L — **Five-category browse hierarchy** — People/Money/Government/Legislation/Saved; recursive TreeNode; per GRAPH_PLAN §2.1 <!--id:FIX-135-->
- [x] 🟡 M — **By-state drill-down** — 50-state expansion under State legislatures and Officials by state; depends on FIX-124; per GRAPH_PLAN §2.2 <!--id:FIX-136-->
- [x] 🟡 M — **By-topic-tag groups** — `/api/graph/tag-groups` + clickable top-30 tags under Legislation; per GRAPH_PLAN §2.3 <!--id:FIX-137-->
- [x] 🟡 M — **By-location** — "My state's reps" row when home_state set; depends on user_preferences; per GRAPH_PLAN §2.4 <!--id:FIX-138-->
- [x] 🟠 L — **By-committee** — investigate `committees` table; file prereq FIXES if missing; per GRAPH_PLAN §2.5 <!--id:FIX-139-->
- [x] 🟢 S — **Recently viewed** — localStorage list of last 20 entities; per GRAPH_PLAN §2.6 <!--id:FIX-140-->
- [x] 🟡 M — **`appointment` connection type** — registry + DEFAULT_CONNECTION_STATE + pipeline derivation; per GRAPH_PLAN §4.1 <!--id:FIX-141-->
- [x] 🟡 M — **`revolving_door` connection type** — registry + DEFAULT_CONNECTION_STATE + career_history derivation; per GRAPH_PLAN §4.2 <!--id:FIX-142-->
- [x] 🟠 L — **`contract` connection type** — registry + USASpending derivation into entity_connections; per GRAPH_PLAN §4.3 <!--id:FIX-143-->
- [x] 🟠 L — **Hierarchy viz (D3 tree/dendrogram)** — agency org chart, budget-weighted; embed compact variant on `/agencies`; per GRAPH_PLAN §5.1 <!--id:FIX-144-->
- [x] 🟠 L — **Matrix viz (N×N heatmap)** — vote agreement matrix; sortable, clusterable; per GRAPH_PLAN §5.2 <!--id:FIX-145-->
- [x] 🟠 L — **Alignment viz (USER-centric radial)** — bespoke for USER node; depends on FIX-120; per GRAPH_PLAN §5.3 <!--id:FIX-146-->
- [x] 🟠 L — **Sankey budget flow** — d3-sankey for Treasury→agency→vendor; depends on FIX-143; per GRAPH_PLAN §5.4 <!--id:FIX-147-->
- [x] 🟡 M — **SpendingGraph wire-up + USASpending column drift investigation** — finish orphaned viz; verify schema post-cutover; per GRAPH_PLAN §5.5 <!--id:FIX-148-->
- [x] 🟡 M — **Shared connections pill list** — floating pill bar above canvas when ≥2 entities focused; per GRAPH_PLAN §6.1 <!--id:FIX-149-->
- [x] 🟢 S — **Update packages/graph/CLAUDE.md** — reflect new vision; reference GRAPH_PLAN.md; per GRAPH_PLAN §7.1 <!--id:FIX-150-->
- [x] 🟡 M — **Cleanup stale `spending_records` references** — table was dropped at cutover; `pipelines/index.ts:45` still queries it; `apps/civitics/CLAUDE.md` + `docs/PHASE_GOALS.md:202` + root `CLAUDE.md` all reference it as the data store. Replace with `financial_relationships WHERE relationship_type IN ('contract','grant')`. Unblocks FIX-148. <!--id:FIX-151-->
- [x] 🟠 L — **Committees schema** — no `committees` table; `governing_body_type` enum lacks 'committee' value; `officials.governing_body_id` is single FK so an official can't belong to multiple committees. Add `'committee'` to enum + `official_committee_memberships` join table (official_id, committee_id, role, started_at, ended_at). Prereq for FIX-139. <!--id:FIX-152-->
- [x] 🟠 L — **Committees ingestion pipeline** — Congress.gov committees endpoint → backfill `governing_bodies` rows of type='committee' + `official_committee_memberships`. Prereq for FIX-139. Depends on FIX-152. <!--id:FIX-153-->
- [x] 🔴 S — **Donations don't render as PAC donor nodes** — `entity_connections.from_type` for donor rows is `"financial_entity"`, but `apps/civitics/app/api/graph/connections/route.ts` (`mapNodeType` switch + `financialIds` filter) and `apps/civitics/app/api/graph/snapshot/route.ts` (`financialIds` filter, also selecting `name` instead of `display_name`) both matched `"financial"`. Result: donor entities never got fetched from `financial_entities`, ended up labeled "Unknown financial_entity" and typed `corporation` instead of `pac`/`individual`. Affects donations and contract_award (agency↔financial_entity) endpoints. <!--id:FIX-154-->
- [x] 🔴 S — **Orphan nodes remain after a connection type is toggled off** — `ForceGraph.tsx` Category A effect only set `display: none` on disabled-type edges; nodes that existed solely because of those edges floated alone on the canvas. Add a node-visibility pass that hides nodes with no visible incident edge unless they're focused, the USER node, or a FocusGroup. <!--id:FIX-155-->
- [x] 🔴 S — **TS connections pipeline writes legacy `from_type='financial'` for donations** — `packages/data/src/pipelines/connections/index.ts:355` still emits `from_type: "financial"` for donor rows; the SQL `rebuild_entity_connections()` and the post-FIX-154 graph API both expect `"financial_entity"`. Bypassed in production by the SQL rebuild path, but `pnpm data:connections` will still inject mismatched rows that the API filter then drops. One-line edit. <!--id:FIX-156-->
- [x] 🟡 M — **`/api/claude/status` should detect derived-edge drift** — add a self-test that compares source row counts (`financial_relationships` by relationship_type, `votes`, `career_history`, `proposal_cosponsors`, `agencies` with `governing_body_id`) against `entity_connections` row counts per type. Flag any zero-derived-with-nonzero-source case. The bug behind FIX-156 (prod had 22,715 donations in source but 0 derived edges from 2026-04-22 → 2026-04-27) would have been visible immediately. <!--id:FIX-157-->
- [x] 🟡 S — **Pipelines should announce target DB on startup** — every `pnpm data:*` script reads `.env.local` silently. Add a one-line banner in the shared admin-client setup (`packages/data/src/pipelines/utils.ts` or equivalent) that logs `Target: ${NEXT_PUBLIC_SUPABASE_URL}` and refuses to run against the production URL unless `--allow-prod` is passed. Prevents accidental cross-env writes when `.env.local` was last copied from `.env.local.prod`. <!--id:FIX-158-->
- [x] 🟡 S — **`fixes:sync` should track per-environment verification** — add a `Verified: local + prod` (or `local-only`, `prod-only`) trailer convention alongside `Fixes:`; surface it in `done.log`. FIX-101 was marked complete after pipelines re-ran on Pro, but the implicit `rebuild_entity_connections()` follow-up never happened — and nothing in the workflow surfaced that. Per-environment trailers make incomplete prod state greppable. <!--id:FIX-159-->
- [x] 🟠 S — **`ai-summaries` pipeline still references dropped `proposals.comment_period_end` column** — `packages/data/src/pipelines/ai-summaries/index.ts` `fetchOpenProposals` query throws `column proposals.comment_period_end does not exist` post-cutover. Same drift pattern as FIX-112 (which fixed `tags/rules.ts`) but in a different file. Result: queue-mode staging skipped all open proposals — only officials got enqueued (0 proposals vs ~1k expected). Update the query to use the post-cutover column (likely `metadata->>'comment_period_end'` or similar). <!--id:FIX-161-->

### DASHBOARD

- [x] 🟡 M — **Browsable sitemap section** — done 2026-04-18: `SitemapSection.tsx` renders a 3-column grid of major routes (Home, Officials, Proposals, Agencies, Initiatives, Graph, Search, Dashboard, Profile, Post a Problem) with icon, title, `href` chip, and one-line description; grouped with BrowsingFlowsSection on dashboard <!--id:FIX-046-->
- [x] ⬜ L — **Browsing path visualization** — done 2026-04-18: migration `20260418100000_pv_path_transitions.sql` adds `normalize_pv_path()`, `get_pv_top_transitions()`, `get_pv_entry_pages()` (aggregate-only, min-session threshold to prevent re-identification). Made public on the transparency dashboard via `BrowsingFlowsSection.tsx` — shows entry pages and top "next step" transitions with horizontal bar weights. Privacy model documented inline. Requires `supabase migration up --local` <!--id:FIX-047-->
#### Dashboard Redesign — Phase A: Cleanup
- [x] 🟢 S — **Delete dead dashboard files** — `PipelineOpsSection.tsx`, `BudgetControlForm.tsx`, `DashboardStatsSection.tsx`, `DashboardAutoRefresh.tsx` (~970 lines of zombie code; confirmed zero importers) <!--id:FIX-074-->
- [x] 🟢 S — **Fix "AI Summaries X" label** — remove trailing X from stat card label in `StatsSection` <!--id:FIX-075-->
- [x] 🟢 S — **Fix "Closes in 0h" countdown** — `formatCountdown` shows 0h when <1h remains; add minutes fallback <!--id:FIX-076-->
- [x] 🟢 S — **Replace hard-coded "$1.75B" in PlatformCostsSection footer** — read from `chord.total_flow_usd` passed as prop <!--id:FIX-077-->
- [x] 🟢 S — **Delete CommunityComputeSection** — Phase 4 placeholder that always renders $0/$0; misleads visitors <!--id:FIX-078-->
#### Dashboard Redesign — Phase B: Efficiency
- [x] 🟡 M — **Fix triple-fire in useDashboardData** — visibility handler + interval dedupe; on mount fetchData fires once then interval takes over; visibility change only fires on actual tab switch <!--id:FIX-079-->
- [x] 🟡 M — **Drop server-side duplicate queries in page.tsx** — remove `getActivity`, `getBrowsingFlows`, `getOfficialsBreakdown`; client reads all from `/api/claude/status` <!--id:FIX-080-->
- [x] 🟡 M — **Gate ModerationSection behind admin check** — `useSession()` check client-side; skip the fetch for non-admins <!--id:FIX-081-->
#### Dashboard Redesign — Phase C: IA + Tabs
- [x] 🟠 M — **Add TabBar to dashboard** — URL-synced `?tab=transparency|operations`; default transparency; browser back/forward works <!--id:FIX-083-->
- [x] 🟠 M — **Extract TransparencyTab + OperationsTab from DashboardClient** — reorganize sections per IA spec <!--id:FIX-084-->
- [x] 🟠 M — **Move ops content into Operations tab** — browsing flows, moderation, self-tests, pipelines, quality, costs, dev progress move to Operations <!--id:FIX-085-->
- [x] 🟢 S — **Delete amber receipt banner; append to PageHeader description** — "This page is our receipt." appended to description prop <!--id:FIX-086-->
#### Dashboard Redesign — Phase D: Visual Polish
- [x] 🟢 S — **Add Lucide icon support to SectionHeader** — accept `icon: React.ReactNode`; keep string emoji as fallback <!--id:FIX-087-->
- [x] 🟢 S — **Replace dashboard emoji with Lucide icons** — per mapping in spec §3.2 <!--id:FIX-088-->
- [x] 🟢 S — **Swap shadow for border-only on SectionCard; swap red→rose, yellow→amber across dashboard** <!--id:FIX-091-->
- [x] 🟢 S — **Move admin refresh button into page header; delete floating bottom-right variant** <!--id:FIX-092-->
#### Dashboard Redesign — Phase E: Data-Drive Dev Progress
- [x] 🟡 M — **Add /api/phases route** — reads `docs/PHASE_GOALS.md` at runtime; returns `{ phase, label, pct, done }[]`; replaces hard-coded PHASES array <!--id:FIX-094-->
- [x] 🟢 S — **Drop non-engineering tasks from tracker** — delete "500 beta users" and "Grant applications submitted" items <!--id:FIX-096-->

### INFRASTRUCTURE & PERFORMANCE

- [x] 🟠 M — **Rate limiting on public API routes** — implemented 2026-04-16 in `middleware.ts`: sliding-window in-memory limiter (30/min search, 5/min graph/narrative, 60/min graph); 429 + Retry-After; Upstash upgrade path documented <!--id:FIX-048-->
- [x] 🟡 M — **Core Web Vitals / performance budget** — set up Vercel Analytics alerts for LCP > 2.5s and CLS > 0.1; identify and fix the worst offenders (likely graph page initial load and Officials list) <!--id:FIX-049-->
- [x] 🟡 M — **API response caching headers** — add `Cache-Control` headers to read-only API routes (officials list, proposals list, agencies); edge-cacheable routes can dramatically reduce DB load <!--id:FIX-050-->
- [x] ⬜ L — **Connection pooling audit** — Supabase uses PgBouncer; verify all server-side Supabase clients are using the pooled connection string for non-transaction workloads <!--id:FIX-052-->
- [x] 🟠 L — **Enrichment queue + admin endpoints** — shifts AI tag/summary work off API, routine-ready <!--id:FIX-064-->
- [x] 🟠 L — **Split /api/claude/status into core + quality** — `/core` (meta, db, pipelines, ai_costs, activity) at 60s; `/quality` (quality, self_tests, chord) at 15min; reduces Warren search + chord RPC from every 60s to every 15min <!--id:FIX-082-->

### COMMUNITY & AUTH

- [x] 🟠 L — **Community commenting UI** — done: `CivicComments.tsx` wired into `proposals/[id]/page.tsx` (post + list with relative-time formatting, 2000-char limit, requires-auth prompt); `OfficialComments.tsx` wired into officials detail page (migration `20260415223406_official_community_comments.sql`); `ArgumentBoard.tsx` on initiative pages. Phase 1 commenting complete. <!--id:FIX-053-->
- [x] 🟡 M — **Position tracking on proposals** — done: `PositionWidget.tsx` on `proposals/[id]/page.tsx` with Support / Oppose / Neutral / Question buttons + aggregate counts via `/api/proposals/[id]/position`; positions persist per-user (requires auth) <!--id:FIX-054-->
- [x] 🟡 M — **Follow officials and agencies** — done 2026-04-18: migration `20260418200000_community_auth.sql` adds `user_follows`; `FollowButton` on officials & agencies detail pages; `/api/follows` GET/POST/DELETE; in-app `NotificationsBell` in NavBar; `/api/cron/notify-followers` fans out notifications every 6h <!--id:FIX-055-->
- [x] 🟡 M — **Email notifications** — done 2026-04-18: Resend REST helper at `src/lib/email.ts` (no SDK dep); `notifyFollowers()` fan-out emails when `email_enabled`; `/dashboard/notifications` UI toggles per-follow; triggers wired for followed official votes and new proposals in followed agencies. Requires `RESEND_API_KEY` + `RESEND_FROM` env vars <!--id:FIX-056-->
- [x] ⬜ M — **Content moderation tools** — done 2026-04-18: `content_flags` table; `FlagButton` component on civic + official community comments; `/api/moderation/flag`; admin review queue (`ModerationSection`) on dashboard with dismiss/delete actions backed by `/api/admin/moderation` <!--id:FIX-057-->

### DOCUMENTATION (Open Source Readiness)

- [x] 🟡 M — **Visual architecture overview** — a single diagram (Mermaid or Figma export) showing the monorepo packages, data flow, pages, and key tables; embed in root README <!--id:FIX-058-->
- [x] 🟡 M — **API documentation** — document all public `/api/*` routes with request/response shapes; required for institutional API partners; could use a simple `API.md` or OpenAPI spec <!--id:FIX-059-->
- [x] 🟡 S — **Contributing guide** — `CONTRIBUTING.md` with setup steps, branch conventions, PR process, and the `[skip vercel]` commit convention <!--id:FIX-060-->
- [x] 🟢 S — **Public roadmap** — a simplified, public-facing version of PHASE_GOALS.md for the homepage or GitHub; builds trust with early users and grant reviewers <!--id:FIX-061-->

### Legacy (pre-FIX-NNN)

- [x] Viz type active state indicator (ForceGraph, Sunburst, Chord, Treemap) — fixed 2026-04-06
- [x] Procedural vote toggle in FocusTree — added 2026-04-06, gated by graphMeta.hasVotes
- [x] Self-configuring settings (count labels, auto-switch dataMode) — completed 2026-04-06
- [x] Efficiency audit — all Supabase calls wrapped in withDbTimeout — completed 2026-04-06
- [x] Civic Initiatives Sprint 2 (versions, upvotes, list page, detail page, create form) — completed 2026-04-11
