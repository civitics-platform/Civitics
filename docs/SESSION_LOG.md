# Session Log

---

## 2026-04-23 (FIX-101 closed — all 6 deferred pipelines landed + AI queue seeded)

**Done — FIX-101 bundle, 10 commits:**

- **FEC bulk** (`3274609d`) — writer.ts batched, dropped partial unique on `canonical_name`/`entity_type`, added full unique on `(relationship_type, from_id, to_id, cycle_year)`. Pro: **1,960 PACs + 22,659 donations** in 1m5s (was estimated ~55 min pre-batching).
- **Quick wins** (`06a049a8`) — `congress/bills.ts` proactive sync batched via new `upsertBillProposalsBatch()`; `tags/rules.ts` `upsertTags()` chunked.
- **USASpending** (`e3a02108`) — `writer.ts` with batched recipient resolution via `external_source_refs` (source='usaspending_recipient'). Converted `financial_relationships_usaspending_unique` from partial to full. Deleted `spending-shadow/` (two-pass migration obsolete). Pro: **679 corps + 1,480 contracts** in 16s.
- **Followups filed** (`ebcc3c88`) — FIX-107 through FIX-115 (missing agencies, RPC chamber/state inference, industry tagging, contract-flow RPCs, shadow-pipeline cleanup, tags/rules stale refs, FEC bulk officials pagination, USASpending grants, reactive bills batching).
- **Regulations.gov** (`3d49dd49`) — dropped writes to the removed `regulations_gov_id` / `comment_period_{start,end}` / `source_ids` columns; all regulations-specific fields ride in `proposals.metadata` + dedup via `external_source_refs`. Added `UNIQUE(acronym)` on agencies. Added 5 missing agency names (RHS, ONCD, FSOC, FAS, OFAC) + backfilled names on Pro. Pro: **+1,000 regulation proposals** in 16.6s.
- **OpenStates** (`8043c29a`) — writer.ts with batched `resolveGoverningBodies()` + `upsertLegislatorsBatch()` + `upsertStateBillsBatch()`. Backfill migration for officials with `source_ids->>'openstates_id'`. Pro: **1,161 legislators + 440 state bills** across 11 states; daily quota paused at GA. Idempotent re-run picks up remaining 39 states.
- **Legistar × 3 metros** (`2004ae97`) — writer.ts with six batched helpers. 67,155 matters + 1,620 persons + 255 bodies landed on Pro in under 4 minutes (was ~7h as per-row SELECT+INSERT; **~100x speedup**). SF events phase hits the same HTTP 400 documented 2026-04-20 — bodies/persons/matters land, meetings skipped.
- **CourtListener** (`4eb90ec6`) — writer.ts with `resolveJudicialGovBodies()` + `upsertJudgesBatch()` + `upsertOpinionsBatch()`. Backfill migration for courtlistener judges' source_refs. Pro: **365 judges updated + 280 opinions + 280 case_details** in 46s.
- **AI enrichment queue seed** (`645c51ae`) — `data:enrich-seed` ran against Pro, **125,480 items staged** (60k proposal tags + 60k summaries + 3k official tags + 3k official summaries). Zero Anthropic calls — worker drains out-of-band via `claim_enrichment_batch()` in a separate session. Tuned `UPSERT_CHUNK` 500 → 100 and `PAGE` 1000 → 500 after hitting Pro's ~8s statement timeout on bigger batches. **Closes FIX-101 via trailer.**
- **fixes:sync status** (`72db20c7`) — flipped FIX-101 to `[x]`, appended to `docs/done.log`.

**Final Pro state:**

| Table | Count |
|---|---|
| `officials` | 3,684 (903 federal + 1,161 state + 1,620 city) |
| `proposals` | 69,557 (congress + regulations + state + city + opinions) |
| `bill_details` | 68,276 |
| `case_details` | 280 |
| `meetings` | 130 (SF events blocked by sfgov HTTP 400) |
| `financial_entities` | 2,639 |
| `financial_relationships` | 24,139 (22,659 donation + 1,480 contract) |
| `external_source_refs` | ~71,000 |
| `enrichment_queue` | 125,480 pending |

**Architectural pattern established across all 6 writers:**

1. Collect records into an array
2. Batch-lookup existing via `external_source_refs.in("external_id", chunk)` with chunk ≤ 200
3. Partition into `toUpdate` (known id) and `toInsert` (new)
4. Batched `upsert(records, { onConflict: "id" })` for updates — always pass **full-row records**, not partial, because `ON CONFLICT DO UPDATE` still validates the INSERT clause against NOT NULL
5. Batched `insert(records).select("id")` for new — Postgres preserves input order so zip back to the source array
6. Batched insert of `external_source_refs` and child tables (bill_details / case_details) after IDs are known
7. `onConflict` column lists must target a **full unique index**, not partial — PostgREST's column-list inference doesn't reliably match partials; converted 3 partials to full during the session

**Followups filed this session (FIX-107 through FIX-117):**

- FIX-107 — 6 missing top-20 federal agencies (DOD, TREAS, DOS, DOL, GSA, SSA); USASpending silently skips these
- FIX-108 — `treemap_officials_by_donations` chamber/state inference mis-classifies House reps whose FEC id starts with 'S'
- FIX-109 — tag `financial_entities` with industry (chord viz is stuck at "Untagged" without it)
- FIX-110 — new RPCs to surface contract/grant flows (`chord_contract_flows()`, `treemap_recipients_by_contracts()`)
- FIX-111 — delete obsolete shadow-era pipelines (`fec/index.ts`, `pac-classify/`, `financial-entities/`, `connections/shadow.ts`, `connections/delta.ts`, `initiatives/shadow-backfill.ts`, `shadowClient` helper)
- FIX-112 — `tags/rules.ts` references dropped columns (`proposals.comment_period_end`, `financial_relationships.official_id`)
- FIX-113 — FEC bulk `loadOfficials()` silently truncated at PostgREST max_rows=1000
- FIX-114 — USASpending grants fetch (contracts-only today)
- FIX-115 — batch reactive `findOrCreateBillProposal` path in `congress/votes.ts`
- FIX-116 — tighten OpenStates people-endpoint rate limiting (100ms → 1000ms to avoid 429 retry stalls)
- FIX-117 — index `enrichment_queue(entity_type, task_type)` so seed snapshot reads don't hit statement timeout; closes the remaining ~17k gap on next seed run

**⚠️ Action needed — none** (all migrations applied on both local + Pro; all commits pushed to `main`; prod deploys triggered).

**Up next — everything post-FIX-101:**

1. **FIX-109 (🟠 L)** — industry tagger for `financial_entities`. Single highest-signal unlock: the chord viz has all the financial data it needs, it's just one JOIN away from visible. Could be rules-based (CONNECTED_ORG_NM / NAICS keyword match) or a one-shot AI classify pass.
2. **Drain the enrichment queue** — run a worker session to call `claim_enrichment_batch()` + process tags/summaries. 125k items, can run over multiple sessions.
3. **FIX-110 (🟡 L)** — surface contract/grant flows in graph.
4. **FIX-108 (🟡 M)** — fix treemap chamber/state inference.
5. **FIX-111 (🟡 M)** — delete dead shadow-era pipeline code. Cleanup commit.
6. Smaller items: FIX-107 agency seed, FIX-112 rules.ts fixes, FIX-113/114/115/116/117.

---

## 2026-04-22 (FIX-101 pt 1 — FEC bulk rewritten, batched, landed on Pro)

**Done:**

- **FEC bulk pipeline — shadow → public rewrite.** New `packages/data/src/pipelines/fec-bulk/writer.ts` replaces the deleted `shadow-writer.ts`. Writes directly to `public.financial_entities` + `public.financial_relationships` (post-promotion schema). Old per-row `SELECT → INSERT/UPDATE` pattern replaced with chunked `upsert({ onConflict })`. Entities chunk on `fec_committee_id`; donations chunk on the new `(relationship_type, from_id, to_id, cycle_year)` tuple.
- **Migration `20260423000000`** — adds `financial_relationships_relcycle_unique` (full unique, not partial — PostgREST's upsert can't target a partial unique index via column-list `ON CONFLICT`), drops legacy `UNIQUE(canonical_name, entity_type)` on `financial_entities` that forced false merges between distinct FEC committees whose normalised names collide. Replaces with a non-unique lookup index of the same shape. Applied to local + Pro (`supabase db push --linked`).
- **`supabase/config.toml`** — dropped `shadow` from PostgREST exposed schemas (was causing schema-cache failures on local since the shadow schema no longer exists).
- **Client-side relationship dedup** — officials with multiple FEC IDs (e.g. old House `fec_candidate_id` + newer Senate `fec_id`) cause the same PAC → same-official aggregate to appear twice under different committee-candidate keys. Batched upsert rejects internal conflict-target collisions; the writer now merges these client-side before the upsert (sum amounts, sum tx_count, keep latest `occurred_at`).
- **`spending-shadow/index.ts`** — stopgap import redirect from deleted `../fec-bulk/shadow-writer` to `../fec-bulk/writer` (spending-shadow is scheduled for deletion as part of the broader FIX-101 backlog).

**Pro counts (post-run):**
- `financial_entities`: **1,960** (was 0 pre-cutover)
- `financial_relationships`: **22,656** donation rows for cycle 2024 (was 0)
- FEC match rate: 479 by direct `fec_id` + 383 by name fallback = 862 of 903 officials
- Top donors: AIPAC $3.2M, American Crystal Sugar $2.3M, Realtors $2.1M, Machinists $2.0M

**Perf:**
- Local: **8.5s** end-to-end (was ~90s with per-row round-trips)
- Pro: **1m 5s** (estimated ~55 min pre-batching — first attempt was killed at 40% after 30 min of silent per-row progress)

**RPCs verified against Pro:**
- `chord_industry_flows()` → returns rows ($61.7M Rep House, $57.9M Dem House, etc.). All `industry='untagged'` for now — `entity_tags` industry tagging still pending as a separate enrichment task.
- `treemap_officials_by_donations(3)` → returns top-raising officials with real `total_donated_cents`.

**⚠️ Action needed — none** (migration applied, data loaded, RPCs green).

**FIX-101 progress** — 1 of 8 pipelines done:
- ✅ **FEC bulk** (this session)
- ⬜ USASpending
- ⬜ Regulations.gov
- ⬜ OpenStates
- ⬜ CourtListener
- ⬜ Legistar × 4 metros
- ⬜ tag-rules / ai-summaries / tag-ai (via `CIVITICS_ENRICHMENT_MODE=queue` when run)

**Up next (FIX-101 continuation):**

1. **USASpending** (264 lines, writes `financial_relationships` with `relationship_type='contract'/'grant'`) — expands chord/treemap with government spending flows.
2. **Regulations.gov** (300 lines, writes `proposals` for active rulemakings).
3. **Legistar × 4** (1,106 lines, writes metro officials + proposals).
4. **OpenStates** → **CourtListener** → deletion pass for `spending-shadow/`, `connections/shadow.ts`, `initiatives/shadow-backfill.ts`, `shadowClient` helper.

---

## 2026-04-22 (Supabase Pro cutover + smoke-test fixes)

**Done — Supabase Pro provisioning + shadow→public promotion:**

- Provisioned Pro project `xsazcoxinpgttgquwvuf` ($25/mo). Linked CLI via `supabase link --project-ref xsazcoxinpgttgquwvuf`.
- Wrote + applied `20260422000000_promote_shadow_to_public.sql`: dropped 11 legacy RPCs + `proposal_trending_24h` materialized view, truncated stale public child tables, `ALTER … SET SCHEMA` moved 17 shadow tables + helper functions to `public`, dropped the empty `shadow` schema, rebuilt RLS.
- **Latent bug fix** (`20260422000001`): `ALTER FUNCTION … SET SCHEMA` moves function membership but **does not rewrite body text**. `bill_details_sync_denorm()` trigger body still read `FROM shadow.proposals` after the move, so every `bill_details` INSERT 500ed. Fixed via `CREATE OR REPLACE FUNCTION` with `public.proposals` in body. Documented in runbook as carry-forward lesson.

**Done — Option C pipeline rewrites (scoped to minimum viable):**

- `packages/data/src/pipelines/congress/bills.ts` — single-write to `public.proposals` + `public.bill_details` + `public.external_source_refs`. Dedup via `external_source_refs` (unique on source+external_id). Shadow mirror deleted.
- `packages/data/src/pipelines/congress/votes.ts` — references `bill_details.proposal_id` via `bill_proposal_id`; synthesizes `roll_call_id` (House `${year}-house-${paddedRoll}`, Senate `senate-${congress}-${session}-${paddedRoll}`); populates `voted_at`, `vote_question`, `source_url`. Reactive-create fallback now uses bill number as title (prevents "On Passage" garbage).
- All other pipelines (FEC, regulations, USASpending, OpenStates, CourtListener, Legistar, connections, tags, AI) left untouched — tracked for reimplementation as FIX-101.

**Done — data backfill:**

- Backfilled 243 of 550 orphan proposals (missing bill_details from early broken runs) via INSERT from `proposals.metadata`. Remaining 307 duplicates blocked by `(jurisdiction_id, session, bill_number)` unique — tracked as FIX-102.
- Rewrote 786 procedural-title proposals (e.g. "On Passage", "On Cloture Motion") to use `metadata->>'legacy_bill_number'` as title.
- Post-cutover Pro counts: **903 officials · 989 proposals · 682 bill_details · 217,548 votes**. Integrity audit shows 4 pre-existing data-scope errors (POTUS/VP not ingested, 3 House vacancies, 1 senator NULL state) — zero pipeline errors.

**Done — branch + Vercel ops:**

- Pushed cutover commit to `qwen/phase1`, user renamed `master` → `main` on GitHub, local `git branch -m master main && git branch -u origin/main main`, fast-forwarded, deleted `qwen/phase1` local + remote.
- Fixed Vercel Hobby cron limit failure: changed `notify-followers` from `0 */6 * * *` to `0 3 * * *` (once/day max on Hobby). Commit `d8174f86`.
- Locked git identity: `user.email = civitics.platform@gmail.com`, `user.name = Civitics Platform`. Machine's default `craig.a.denny@gmail.com` attributes to a separate personal GitHub account (`midnighttoker420`). Saved as persistent memory.
- Deployed green. Prod URL: `https://civitics.com` (custom domain; Vercel default `civitics-civitics.vercel.app` still active).

**Done — docs + post-cutover backlog:**

- New: `docs/MIGRATION_RUNBOOK.md` (archives plan §4 as actuals + lessons).
- Updated: `CLAUDE.md`, `docs/OPERATIONS.md`, `docs/REBUILD_STATUS.md` to reflect two-tier env (local Docker + Pro), `main` as prod, schema now `public.*`.
- Filed POST-CUTOVER section in `docs/FIXES.md`: FIX-097 (chord/treemap RPCs), FIX-098 (officials-breakdown RPCs), FIX-099 (search_graph_entities), FIX-100 (rebuild_entity_connections derivation), FIX-101 (deferred pipeline re-runs), FIX-102 (307 orphan proposals cleanup), FIX-103 (officials_breakdown `.catch is not a function`), FIX-104 (recreate proposal_trending_24h + refresh fn).

**Done — smoke-test fixes (same session):**

- **FIX-105**: `/proposals` default filter changed from `"open"` to `"all"`. Root cause: `"open"` required `status='open_comment'` AND `metadata->>comment_period_end > now()`; all 989 congress-bill proposals have `status='introduced'` with no comment period, so landing was empty.
- **FIX-106 (filed, not implemented)**: Add 6-digit OTP option alongside magic link in `SignInForm`. Not a regression — never actually existed in code; user misremembered.
- **Auth magic link** was failing on Pro because Supabase project Auth → URL Configuration didn't allowlist the prod host. User added `https://civitics.com/**` + `https://civitics-civitics.vercel.app/**` + `http://localhost:3000/**` to Redirect URLs and set Site URL to `https://civitics.com`. `NEXT_PUBLIC_SITE_URL=https://civitics.com` set in `.env.local` and Vercel.

**Smoke test results (user walk-through):**

| # | Surface | Result |
|---|---|---|
| 1 | Homepage | ✅ |
| 2 | Officials list + detail | ✅ |
| 3 | /proposals | ❌ 0 rows → fixed via FIX-105 |
| 4 | Graph page | ✅ |
| 5 | Dashboard | ✅ (Transparency/Operations panels partially blank — FIX-097/098) |
| 6 | Search | ✅ (basic) — graph-search broken (FIX-099) |
| 7 | Auth | ❌ magic link + no OTP → fixed via Supabase URL config + FIX-106 filed |

**⚠️ Action needed — none** (all work pushed to `main`; prod green).

**Up next — POST-CUTOVER queue, in suggested order:**

1. **FIX-103** (🟡 S) — Fix `.catch is not a function` in `/api/claude/status` officials_breakdown handler. 5 min.
2. **FIX-104** (🟡 S) — Recreate `proposal_trending_24h` mat view + `refresh_proposal_trending()`. Restores homepage trending + /proposals Featured section.
3. **FIX-100** (🟠 L) — Implement `rebuild_entity_connections()` derivation rules. Unblocks graph.
4. **FIX-097 / FIX-098 / FIX-099** (🟠 M–L) — Rewrite the 10 dropped RPCs against polymorphic `financial_relationships`.
5. **FIX-101** (🟠 L) — Re-run deferred pipelines against Pro (FEC, Regulations.gov, OpenStates, CourtListener, Legistar × 4, USASpending, tag-rules, ai-summaries, tag-ai).
6. **FIX-102** (🟡 M) — Delete 307 orphan proposals (after confirming zero vote FKs).
7. **FIX-106** (🟠 M) — 6-digit OTP option in SignInForm.

---

## 2026-04-20 (Legistar city council pipeline — 4-metro load)

**Done:**

- **shadow-initiatives backfill** (`data:shadow-initiatives`) and **shadow-connections** (`data:shadow-connections`) pipelines both ran clean from the previous session.

- **Legistar pipeline built and fully validated** across 3 working metros:
  - `packages/data/src/pipelines/legistar/` — types, client, mappers, orchestrator (index.ts)
  - 6-step pipeline per metro: Bodies → governing_bodies, Persons → officials, Matters → shadow.proposals + bill_details, Events → shadow.meetings, EventItems → shadow.agenda_items, Votes → shadow.votes
  - Delta cursor support via `pipeline_state` keyed `legistar_{client}_last_run`
  - `data:pilot-metros` script seeds 5 city jurisdictions (Seattle, SF, NYC, Austin, DC)

- **4 bugs found and fixed during validation:**
  1. `officials` NOT NULL on `governing_body_id`, `jurisdiction_id`, `role_title` — `syncPersons` now resolves primary council body before inserting
  2. `external_source_refs` queries hitting `public` schema instead of `shadow` — all reads/writes switched to `sdb` client
  3. Source key collision — matters and events both used `config.source` ("legistar:seattle"), so EventId=N matched MatterId=N in the UNIQUE(source, external_id) constraint; fixed by scoping keys: `:body`, `:person`, `:matter`, `:event`, `:item`
  4. `bill_details` duplicate key on `(jurisdiction_id, session, bill_number)` — cities (Austin) reuse file numbers; switched to `upsert … ignoreDuplicates: true`

- **Final loaded state:**

  | Metro | Bodies | Officials | Proposals | Meetings |
  |---|---|---|---|---|
  | Seattle | 81 | 605 | 13,411 | 91 |
  | Austin | 23 | 604 | 19,857 | 36 |
  | San Francisco | 151 | 410 | 33,880 | 0 |
  | **Total** | **255** | **1,619** | **67,148** | **127** |

- **Known blockers documented in code:**
  - NYC: Legistar slug is `nyc` (not `newyork`), requires API token (403) — commented out pending auth
  - SF meetings: `sfgov` Events endpoint returns server-side Legistar config error (`Agenda Draft Status not setup`) — no workaround; bodies/officials/proposals fully loaded

**⚠️ Action needed — none** (no migrations this session; all pipeline state in local Supabase)

**Up next:**

- NYC Legistar access — either request API token from NYC Council or find alternative (NYC Open Data)
- Re-run FEC bulk on 2022/2020 cycles (was "up next" from previous session, still pending)
- Open data quality bugs: FIX-068/069 (President/VP missing), FIX-070 (3 House reps missing), FIX-071 (senators NULL state), FIX-066 (proposals contamination root cause)
- `shadow.rebuild_entity_connections()` — L5 derivation job (was on list from 2026-04-19)

---

## 2026-04-19 (Stage 1B vertical slices — congress + FEC bulk)

**Done — Stage 1B congress.bills shadow dual-write:**

- Extracted `bills.ts` from the monolithic congress pipeline into its own module.
- Added shadow dual-write for votes alongside the existing public write (per L7 polymorphic plan; bills themselves stay public for now).
- All shadow inserts hit `shadow.*` via the new `shadowClient(db)` helper in `pipelines/utils.ts`, which hoists the `(db as any).schema("shadow")` cast and exports a `ShadowDb` type — keeps every pipeline's shadow path one-line consistent until the generated `Database` types catch up.

**Done — Stage 1B FEC bulk shadow-native rewrite (Decision #4):**

- Replaced the legacy `pipelines/fec-bulk/index.ts` (~920 lines rewritten) with a shadow-only path. No dual-write — public.financial_* freezes at last legacy state and Stage 1B read-cutover flips queries to shadow.
- New `shadow-writer.ts` (~262 lines) exports `canonicalizeEntityName`, `cmteTypeToShadowEntityType`, `upsertPacEntityShadow`, `upsertDonationRelationshipShadow`. Two-pass pipeline:
  - Pass A — unique committees → `shadow.financial_entities` (dedup on `fec_committee_id` UNIQUE).
  - Pass B — each (cmte × cand × cycle) aggregate → `shadow.financial_relationships` (dedup via SELECT on the `financial_relationships_derivation` compound index).
- 23505 handler has both `fec_committee_id` race recovery **and** `(canonical_name, entity_type)` fallback so canonical-name collisions self-heal on the next run instead of failing.
- Removed the four synthetic weball aggregates ("Individual Contributors", "PAC/Committee", "Party", "Self-Funded") — artifacts of the old narrow schema, no place in the polymorphic model.
- Removed inline `entity_connections` writes per L5 (derivation-only — `runConnectionsDelta` step in master orchestrator handles it).
- New post-check `supabase/scripts/stage1/03_fec_postcheck.sql` with five RAISE-EXCEPTION invariants (counts non-zero, polymorphic shape correct, no orphan from_id/to_id, donation temporal model honored) plus spot-check queries.
- Pipeline run: **1824 entities, 16263 relationships, zero invariant violations.** Top donor AIPAC PAC at $2.46M; top recipient Hakeem Jeffries with 264 distinct PAC donors.

**Done — PostgREST allowlist fix:**

- Initial run failed with "Invalid schema: shadow" (1825 failures). Root cause: `supabase/config.toml [api].schemas` defaulted to `["public", "graphql_public"]` so PostgREST rejected `.schema("shadow")` requests. Added `"shadow"` to the list (with a comment to drop it at Stage 1 cutover) — committed `05b8315d`. Fix requires `supabase stop && supabase start` to reload PostgREST.

**⚠️ Action needed — none** (config.toml already applied; pipeline already verified clean)

**Up next:**

- `shadow.rebuild_entity_connections()` TypeScript implementation (the L5 derivation job that consumes shadow.financial_relationships)
- `civic_initiatives` I-B shadow migration (next vertical slice)
- Legistar adapter scaffold for the 5-metro deep pilot (SEA/SF/NYC/DC/AUS)
- Seed `jurisdictions.coverage_status` for the 5 pilot metros (claim-queue feature)
- Re-run FEC bulk on additional cycles (2022, 2020) once 2024 is fully validated

---

## 2026-04-17 (session 2)

**Done:**
- GENERAL / CROSS-CUTTING FIXES sweep — all 5 remaining items cleared:
  - Marked already-completed items: loading/skeleton states (all 4 `loading.tsx` files), empty states (TASK-20), 404/error pages (TASK-24), Initiatives nav link (TASK-17) — checkboxes updated
  - **Clickable links audit**: agency chips in `ProposalCard` and proposal detail now link to `/proposals?agency=…`; dead `href="#"` "Submit comment" on agency detail page fixed to `/proposals/${rule.id}`; bill number and regulations.gov ID chips on agency detail are now `<a>` tags; agency acronym in search results `ProposalCard` now links to `/proposals?agency=…`
  - **Footer**: `Footer.tsx` created (`app/components/Footer.tsx`) — Civitics wordmark + mission tagline, all 6 nav links, copyright line, Privacy + Terms legal links; added to root `layout.tsx` (universal, appears on all scrollable pages; invisible below fold on full-screen layouts like officials/graph)
  - **Header consistency**: NavBar added to: `proposals/page.tsx`, `proposals/[id]/page.tsx`, `officials/[id]/page.tsx` (replaced custom breadcrumb header), `dashboard/page.tsx`, `profile/page.tsx`; full-screen layouts (`officials/page`, `agencies/page`, `graph/page`) retain specialized chrome; search page retains its custom search-form header

**Up next:**
- Officials: filtering improvements (chamber / state / issue area filter — 🟡 M)
- Community commenting UI on proposals (🟠 L — `civic_comments` table exists)
- Proposals: better filtering (source, status, topic, date range — 🟡 M)

---

## 2026-04-17

**Done:**
- Agency activity bar chart (`AgencyActivityChart.tsx`): CSS bar chart showing top 12 agencies by proposal count, rendered above the agency grid on `/agencies`; no D3 needed — Tailwind width-percentage bars
- White House / EOP featured card: migration `20260417000000_insert_whitehouse_eop.sql` inserts EOP with `is_whitehouse: true` in metadata; `WhiteHouseFeaturedCard` component pinned above the grid with gradient border; hidden when filters are active
- Sector filter: `AgenciesList.tsx` now has a "All sectors" dropdown that filters using the same 15-rule SECTOR_RULES inference already used for tags
- Agency inline slide-over panel: card clicks now open `AgencySlideOver` right-side drawer (stats, description, open-comment callout, graph + website links, "View full profile" CTA); Escape + backdrop to close; `aria-modal` + focus management

**⚠️ Action needed:**
- Run `supabase migration up --local` to apply `20260417000000_insert_whitehouse_eop.sql` (inserts the White House / EOP agency record)

**Up next:**
- Header/footer consistency audit (🟢 S) — Initiatives link still missing from header nav

---

## 2026-04-18 (session 2 — FIXES verification + proposals sort)

**Done:**

- **Proposals list sort-by dropdown** — added "Sort by" to `proposals/page.tsx` filter form with three options (Closing soon / Newest / A–Z), persists via `?sort=` URL param, included in `buildUrl` + Clear button check, default "closing_soon" is omitted from URL to keep canonical URLs clean.
- **FIXES.md stale-open sweep** — verified 9 items were already built and ticked them:
  - Homepage: Civic Initiatives featured section (`InitiativesSection` on `page.tsx`)
  - Proposals: Better filtering (all filters + sort done)
  - Proposals [id]: Reduce Official Comments friction (layout already separates community from official cleanly)
  - Initiatives: Add to header nav (dup of TASK-17)
  - Initiatives: Filters on list (stages, scope, topics, sort, Mine tab)
  - Initiatives: Argument board Sprint 3 (`ArgumentBoard.tsx` has 12-type comment system + reply threading + votes + flags)
  - Initiatives: "Post a problem" pathway (`/initiatives/problem`)
  - Initiatives: Draft → argument creation decision (`ArgumentBoard` enforces via draft lockout banner)
  - Community & Auth: Community commenting UI + Position tracking (`CivicComments` + `PositionWidget` both wired)

**⚠️ Action needed — none** (no migrations)

**Up next:**
- Proposals: Trending / Most Commented / New tabs (🟢 S) — now unblocked since comments exist
- Dashboard: browsable sitemap section (🟡 M)
- API response caching headers (🟡 M)
- Documentation: CONTRIBUTING.md (🟡 S) + public roadmap (🟢 S)

---

## 2026-04-18

**Done — Officials FIXES sweep:**

- **"View full profile" button**: `OfficialCard.tsx` button changed from subdued gray to `bg-indigo-600 text-white` primary style.
- **Federal/State badge**: Added to OfficialsList list item rows (compact "Fed"/"State") and officials detail page header (`[id]/page.tsx` — `source_ids` added to the DB select, badge placed beside the chamber badge). OfficialCard right-panel already had it.
- **Individual votes expand on click** (`VotesTab.tsx`): Vote rows with a `proposalId` or `voteQuestion` now show a ▼ chevron and expand on click. Expanded panel shows the `vote_question` from metadata and a "View proposal →" link. `metadata` added to the votes select in `[id]/page.tsx`; `voteQuestion` threaded through `allVotesForTab` → `ProfileTabs` type → `VotesTab` type.
- **Pre-existing TypeScript fix**: `byParent[a.parent_id]!.push(a)` in `api/initiatives/[id]/arguments/route.ts` (non-null assertion to satisfy `noUncheckedIndexedAccess`).
- **FIXES.md**: Ticked Federal/State badge, tabs (already done), votes expand, "View full profile" button, filtering (already done), share button (already done). Only "Current term + election status" (🟡 L) remains — requires data pipeline.

**⚠️ Action needed — none** (no migrations)

**Up next:**
- `PromoteSolutionButton` + `POST /api/initiatives/from-comment` (solution → initiative UI — 🟠 M)
- Community commenting UI on proposals (🟠 L — `civic_comments` table exists)

---

## 2026-04-16

**Done:**
- Verified migration `20260415223406_official_community_comments.sql` applied ✓
- Rate limiting on public API routes (`middleware.ts`):
  - `/api/search` — 30 req/min per IP
  - `/api/graph/narrative` — 5 req/min per IP (AI/Claude calls, stricter)
  - `/api/graph/*` — 60 req/min per IP
  - Returns 429 + `Retry-After` header; in-memory sliding window with 5-min cleanup
  - No new services; documented Upstash upgrade path in comments
- JSON-LD structured data on detail pages (SEO):
  - Officials: `schema.org/Person` (name, jobTitle, affiliation, party, image, sameAs)
  - Proposals: `schema.org/Legislation` (name, description, legislationType, publisher, datePublished, sameAs)
  - Both use `NEXT_PUBLIC_SITE_URL` env var for canonical URLs (falls back to `https://civitics.com`)

**Up next:**
- Clickable links audit (🟢 S) — pass across all pages, ensure every name/title/tag routes correctly
- Add Initiatives link to main header nav (🟢 S)
- Node right-click / options menu in graph (🟠 M)
- Agencies card improvements (🟡 M)

---

## 2026-04-15

**Done:**
- Paused Qwen workflow — Qwen Code no longer free; Claude now handles all implementation directly (updated CLAUDE.md + QWEN_PROMPTS.md)
- Marked TASK-04 through TASK-11 as COMPLETE (were done in earlier session, statuses not updated)
- TASK-22 complete: `ProposalShareButton.tsx` — share button on proposal detail page header and each `ProposalCard`
- TASK-23 complete: `OfficialComments.tsx` + `/api/officials/[id]/comments/route.ts` + migration `20260415223406_official_community_comments.sql` — community comments on official profile pages (new table, requires `supabase migration up --local`)
- TASK-24 complete: `not-found.tsx` (branded 404, 4 quick-link cards) + `error.tsx` (client-side error boundary, Try Again + Go Home)

**⚠️ Action needed:**
- Run `supabase migration up --local` to apply `20260415223406_official_community_comments.sql` before testing TASK-23

**Up next:**
- Rate limiting on public API routes (🟠 M — `/api/search`, `/api/graph/*`)
- Clickable links audit (🟢 S)
- FIXES.md items: agencies improvements, graph node right-click menu

---

## 2026-04-13 (a11y sprint)

**Done:** Full a11y (accessibility) audit and fix pass across the app.

**Files changed:**
- `app/components/NavBar.tsx` — skip-to-content link (sr-only, visible on focus); `aria-label="Main"` / `"Mobile"` on nav elements; `aria-controls="mobile-nav"` on hamburger; `id="mobile-nav"` on mobile menu; `focus-visible:ring` on all interactive elements
- `app/components/GlobalSearch.tsx` — `role="combobox"`, `aria-expanded`, `aria-haspopup="listbox"`, `aria-autocomplete="list"`, `aria-controls` on input; `role="listbox"` + `aria-label` on dropdown; `role="option"` + `aria-selected` on result links; `role="status" aria-live="polite"` region for search feedback
- `app/components/AuthButton.tsx` — `aria-expanded`, `aria-haspopup="menu"`, `focus-visible:ring` on avatar button; `focus-visible:ring` on sign-in button
- `app/page.tsx` — added `id="main-content"` to `<main>`
- `app/officials/page.tsx` — outer `<div>` → `<main id="main-content">`
- `app/proposals/page.tsx` — outer `<div>` → `<main id="main-content">`; `htmlFor`/`id` pairs on all filter labels/selects; `aria-current` on active topic pills; `aria-hidden` on pulse dot + empty state SVG; `aria-labelledby` on featured section; pagination `<div>` → `<nav aria-label="Pagination">`; `aria-current="page"` on active page link; `aria-label` on prev/next/numbered links
- `app/initiatives/page.tsx` — added `id="main-content"` to existing `<main>`
- `app/officials/components/OfficialsList.tsx` — `aria-label` on search input; `aria-label` on chamber/party/state selects; `role="group" aria-label` on pill groups; `type="button" aria-pressed` on issue/pattern pills; `aria-pressed + aria-label + focus-visible:ring` on official row buttons; `aria-hidden` on empty state SVG
- `packages/ui/src/components/layout/PageHeader.tsx` — `aria-label="Breadcrumb"` on nav; `<ol>/<li>` structure; `aria-hidden` on separators; `aria-current="page"` on last breadcrumb; `focus-visible:ring` on action buttons/links; `type="button"` on action button
- `packages/graph/src/components/GraphConfigPanel.tsx` — `aria-label` on all sliders, selects; `role="switch" aria-checked aria-label focus-visible:ring` on toggles; `aria-label + focus-visible:ring` on collapse and strip buttons; `aria-hidden` on decorative icon spans/SVGs

**Key architectural rule established:**
> Use `focus-visible:ring` (not `focus:ring`) throughout — only shows ring for keyboard navigation, not mouse clicks. Use `role="switch"` (not just `role="button"`) for toggle controls.

**Up next:**
- Queue next Qwen batch from FIXES.md: officials filtering improvements, proposal filtering, share buttons, community commenting UI
- SEO/OG metadata (🟠 M) — next high-priority item in FIXES.md

---

Newest entry first. Each entry covers: what was done, what's now unblocked, and
what should happen next. Read this at the start of any session to get context
without trawling git history or old chat windows.

---

## 2026-04-13 (auth session)

**Done:** Full auth sign-in flow fixed end-to-end (magic link + 6-digit OTP both working).

**Root cause chain that took multiple attempts to unravel:**

1. **`/?error=access_denied&error_code=otp_expired` landing on home page** — Supabase redirects auth errors to the site URL root, which had no handler. Fixed by checking `searchParams.error` in `app/page.tsx` and redirecting to `/auth/sign-in?error=auth`.

2. **`PKCE code verifier not found in storage`** — `signInWithOtp` called from the browser client stores the code verifier via `document.cookie`, but Next.js never reliably delivers it to the `/auth/callback` Route Handler because cookies set by `document.cookie` can be dropped/lost in certain browser/hydration states. Fixed by moving `signInWithOtp` into a Server Action (`app/auth/actions.ts`).

3. **`redirect_to=http://127.0.0.1:3000` in email link** — No `supabase/config.toml` existed, so local Supabase defaulted to `http://127.0.0.1:3000` as site URL. Cookies set by the Server Action were for `localhost`, but the callback landed on `127.0.0.1` — different host, cookies not sent. Fixed by creating `supabase/config.toml` with `site_url = "http://localhost:3000"`.

4. **`@supabase/ssr`'s `createServerClient` hardcodes `flowType: 'pkce'`** — Even in a Server Action, using `createServerClient` embeds a PKCE challenge in the email. The Server Action's `setAll: () => {}` was discarding the verifier. Fixed by switching to a plain `createClient` in the Server Action (auth-js defaults to `flowType: 'implicit'`).

5. **Implicit flow tokens land in URL hash `#access_token=xxx`** — Servers never see hash fragments. Browser-side `setSession()` (via `createBrowserClient`) stores in localStorage, NOT cookies — so SSR middleware still sees no session. **Final fix (by Qwen):** two-step redirect:
   - `AuthHashHandler` (client, in root layout): detects `#access_token=`, extracts tokens, redirects to `/auth/callback-hash?access_token=xxx&refresh_token=xxx`
   - `/auth/callback-hash` (server Route Handler): receives tokens as query params → creates `createServerClient` with cookie adapter → calls `setSession()` → server buffers auth cookies → applies to redirect response → redirects to `/`

**Key architectural rule established:**
> **Never call `setSession()` on the browser Supabase client expecting the server to see the result.** The `@supabase/ssr` browser client writes to `document.cookie` / localStorage. Only a `createServerClient` with a cookie adapter (in a Route Handler, Server Action, or middleware) can write session cookies that the SSR layer will see.

**Files changed this session:**
- `app/page.tsx` — redirect on `?error` param
- `app/auth/actions.ts` — NEW: Server Action using plain `createClient` (implicit flow)
- `app/auth/callback/route.ts` — better error handling, profile upsert on sign-in
- `app/auth/callback-hash/route.ts` — NEW: handles implicit-flow hash redirect
- `app/auth/confirm/route.ts` — added `magiclink` to allowed OTP types
- `app/components/AuthHashHandler.tsx` — NEW: client component in root layout
- `app/components/SignInForm.tsx` — 6-digit OTP code input added; calls Server Action
- `app/layout.tsx` — mounts `<AuthHashHandler />`
- `middleware.ts` — early-return for all `/auth/*` routes (no `getUser()` interference)
- `supabase/config.toml` — NEW: `site_url = "http://localhost:3000"`, localhost in redirect URLs

---

## 2026-04-13

**Done:**
- TASK-17 reviewed — clean. Initiatives nav link added to homepage header.
- TASK-18 reviewed — clean. Federal/State badge on official cards using `source_ids->>'congress_gov'`.
- TASK-19 reviewed — clean. `generateMetadata` with OG tags on Officials, Proposals, Initiatives detail pages.
- TASK-20 reviewed — clean. Consistent empty states on Officials, Proposals, Agencies list pages.
- TASK-21 — Qwen created files correctly but didn't commit (went in circles on preexisting type errors). Claude recovered and committed 4 clean `loading.tsx` files.
- TASK-12 marked COMPLETE — routes already implemented in earlier sprint work (`api/initiatives/` has `route.ts`, `[id]/route.ts`, `[id]/sign/`, `[id]/signature-count/`).
- Qwen's circular working-tree changes (truncated files in ~20 files) discarded via `git checkout HEAD`.
- QWEN_PROMPTS.md and SESSION_LOG.md re-synced after git restore.

**Unblocked:**
- All TASK-17 through TASK-21 complete. Branch is clean.

**Up next:**
- FIXES.md priorities: mobile responsiveness (🟠 M) and a11y audit (🟠 M) — better handled by Claude than Qwen
- Queue next Qwen batch: pull from FIXES.md (officials filtering improvements, proposal filtering, share buttons) or Phase 1 remaining (community commenting UI)

---

## 2026-04-12

**Done:**
- Sprint 9 migrations (20260411020000–20260411100000) applied locally — `jurisdiction_id` now on `civic_initiatives`, plus 5 other schema additions
- `apps/civitics/app/api/initiatives/[id]/advance/route.ts` patched: PGRST116 (no rows) now returns 404; other query errors return 500 with code. Previously all errors silently became 404.
- TASK-13 reviewed — clean. `text-gray-900` added to `LabeledSelect` in `GraphConfigPanel.tsx`
- TASK-14 reviewed — Qwen truncated `InlineEditor.tsx` at line 203 mid-className. Repaired by Claude.
- TASK-15 reviewed — clean. All 8 `.label` → `.name` in `ForceGraph.tsx` correct.
- TASK-16 reviewed — Qwen truncated `useGraphData.ts` at line 261 mid-declaration (`const isPac`). Repaired by Claude.
- DB types regenerated (`packages/db/src/types/database.ts`) after migrations. Note: on Windows PowerShell use `[System.IO.File]::WriteAllLines()` — `>` redirect produces UTF-16.
- FIXES.md and QWEN_PROMPTS.md statuses brought up to date.

**Unblocked:**
- TASK-12 (Civic Initiatives: core API routes) — was BLOCKED on sprint 1 migrations; those are now applied locally. Can queue now.
- "Open for deliberation" button should now work — test on a draft initiative to confirm.

**Up next:**
- Queue next Qwen batch from remaining FIXES.md items and PHASE_GOALS.md gaps
- Remaining BUGS in FIXES.md: all resolved this session — no open bugs
- Next FIXES.md priorities: mobile responsiveness (🟠 M), a11y audit (🟠 M), SEO/OG metadata (🟠 M), skeleton states (🟡 M)
- TASK-12 is unblocked and ready to queue
