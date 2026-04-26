# Supabase Pro Cutover — Migration Runbook (ARCHIVED 2026-04-26)

> **Archived:** historical record of the 2026-04-22 cutover. Every item in
> §7 "What's still broken after the cutover" has since been resolved
> (FIX-097, 098, 099, 100, 101, 102, 104 all in `docs/done.log`).
> Lessons captured in §"Lessons / gotchas" remain useful for any future
> schema-promotion work.

**Executed:** 2026-04-22
**Plan file:** `C:\Users\Craig\.claude\plans\i-believe-most-everything-drifting-patterson.md`
**Duration:** ~1 day of calendar work spread across a few sessions; ~4 hours of hands-on execution.
**Scope decision:** Option C — rewrite only `congress/bills.ts` + `congress/votes.ts` for post-promotion public schema; defer all other pipelines to Phase 2.

---

## Final state

| Item | Value |
|---|---|
| Supabase project | `xsazcoxinpgttgquwvuf` (Pro, $25/mo) |
| Production URL | `https://civitics-civitics.vercel.app` |
| Production branch | `main` (was `master`, renamed during cutover) |
| Vercel plan | Hobby — crons limited to once/day |
| Latest migration | `20260422000001_fix_promoted_function_bodies.sql` |
| Latest commit on main | `d8174f86` |
| Post-cutover Pro counts | 903 officials · 989 proposals · 682 bill_details · 217,548 votes |
| Integrity audit | 4 errors (POTUS/VP not ingested, 3 House vacancies, 1 senator NULL state) — all pre-existing data-scope issues, zero pipeline errors |

---

## What actually happened (in order)

### 1. Stage 1 shadow work (pre-cutover)

- Migrations `20260417000000` through `20260421000007` built the `shadow.*` schema: 17 tables mirroring the intended post-rebuild shape (proposals, bill_details, votes with correct FKs, polymorphic financial_relationships, etc.).
- Dual-write writers for congress bills, FEC bulk, CourtListener, Legistar, spending_records were all pointing into `shadow.*` and running green locally.
- Stage 1B pipelines: OpenStates shadow rewrite was left WIP (`66b5032d`), and cosponsorship / federal register / lobbying remained as stub migrations without implementations.

### 2. Promotion migration (`20260422000000`)

The canonical "cutover" — a single SQL migration that:

1. Dropped 11 RPCs that referenced the legacy `financial_relationships.donor_name/.official_id/.donor_id` shape (see FIX-097 through FIX-099 for rewrites).
2. Dropped + recreated `proposal_trending_24h` materialized view + `refresh_proposal_trending()` function (against the new `public.proposals` columns). See §3 for the post-cutover refresh gotcha.
3. Truncated public child tables that referenced pre-shadow proposal UUIDs (civic_comments, official_comment_submissions, proposal_cosponsors, promises).
4. Dropped the old public-schema `proposals`, `votes`, `financial_entities`, `financial_relationships`, `entity_connections` tables.
5. `ALTER TABLE shadow.<name> SET SCHEMA public` for every shadow table, preserving FKs + constraints + indexes.
6. `ALTER FUNCTION shadow.<name> SET SCHEMA public` for shadow helper functions.
7. Rebuilt RLS policies against the new public tables.
8. `DROP SCHEMA shadow CASCADE` (empty at this point — all contents moved).

### 3. Latent bug discovered + fixed (`20260422000001`)

`ALTER FUNCTION … SET SCHEMA` changes the function's schema membership but **does not rewrite the body text**. The `shadow.bill_details_sync_denorm()` trigger had `FROM shadow.proposals` hard-coded in its body; after step 6 moved the function, the body still read the (now dropped) `shadow.proposals`, so the trigger fired on every `bill_details` INSERT and 500ed.

Fixed by `CREATE OR REPLACE FUNCTION public.bill_details_sync_denorm()` with `FROM public.proposals`. Registered in `supabase_migrations.schema_migrations` after applying via direct psql.

**Carry-forward lesson:** When any future migration uses `ALTER FUNCTION … SET SCHEMA`, also emit `CREATE OR REPLACE FUNCTION` with the corrected body in the same file. The SQL rewrite is not automatic.

### 3b. proposal_trending_24h required a manual refresh (FIX-104)

The promotion migration recreates the mat view via `CREATE MATERIALIZED VIEW … AS SELECT …` against `public.proposals`. That populates the view at create time — but on Pro, the public.proposals table was effectively empty at that instant (the shadow data had been promoted but no fresh ingest had run yet). So the mat view existed with **0 rows** until the first nightly cron, and the homepage `/proposals` "Featured" / trending sections showed nothing.

Fixed operationally on 2026-04-22 by calling `SELECT public.refresh_proposal_trending();` directly against Pro — went from 0 → 894 rows. The nightly-sync cron (`packages/data/src/pipelines/index.ts:490`) already invokes this RPC, so future state self-heals daily at 02:00 UTC.

**Carry-forward lesson:** any cutover that drops + recreates a materialized view must either (a) include an explicit `REFRESH MATERIALIZED VIEW` after the source table is repopulated, or (b) ensure a refresh job runs before user-visible traffic resumes. `CREATE MATERIALIZED VIEW … AS SELECT` is not enough on its own when the underlying tables are themselves being repopulated by post-migration pipelines.

### 4. Pipeline rewrites (Option C)

- `packages/data/src/pipelines/congress/bills.ts` — single-write to `public.proposals` + `public.bill_details` + `public.external_source_refs`. Dedup via `external_source_refs` (unique on source+external_id). Shadow mirror deleted.
- `packages/data/src/pipelines/congress/votes.ts` —
  - Removed `shadowDb` / `findShadowBillId` / `insertShadowVotesBatch` helpers.
  - Votes now reference `bill_details.proposal_id` via `bill_proposal_id` column.
  - Synthesized `roll_call_id`: House = `${year}-house-${paddedRoll}`, Senate = `senate-${congress}-${session}-${paddedRoll}`.
  - Populates `voted_at` (NOT NULL), `vote_question` (top-level column), `source_url`.
  - Reactive-create fallback uses bill number as title, NOT the vote question (prevents "On Passage" titles from polluting proposals).
- Other pipelines (FEC, regulations, USASpending, OpenStates, CourtListener, Legistar, connections, tags, AI) retain their pre-promotion shadow writers and are **broken** post-cutover. Tracked as FIX-101.

### 5. Data backfill

Three data cleanup steps after the first pipeline run revealed issues:

1. **550 proposals with no bill_details** — created by earlier broken runs (trigger bug) before the function fix. Backfilled 243 of them via INSERT from `proposals.metadata`. The remaining 307 are duplicates whose real-bill siblings already claim the `(jurisdiction_id, session, bill_number)` uniqueness slot — tracked as FIX-102.
2. **786 procedural-title proposals** — titles like "On Passage", "On Cloture Motion" from the reactive-create fallback. Backfilled with `title = metadata->>'legacy_bill_number'` and fixed votes.ts to stop using vote_question as fallback title.
3. **Integrity audit re-run** — 4 remaining errors are all pre-existing data-scope issues (POTUS/VP ingest, House vacancies, one senator with NULL state). Zero pipeline errors.

### 6. Branch + Vercel ops

1. Pushed the cutover commit (`89e7e7e8`) to `qwen/phase1`.
2. User renamed `master` → `main` on GitHub (Settings → Branches → Rename).
3. Locally: `git fetch --prune && git branch -m master main && git branch -u origin/main main && git remote set-head origin -a`.
4. Fast-forwarded `main` to `qwen/phase1` and pushed.
5. Deleted `qwen/phase1` (local + remote).
6. Hit a Vercel build failure: `vercel.json` had `0 */6 * * *` for notify-followers, which the Hobby plan rejects (once/day max). Fixed to `0 3 * * *`. Commit `d8174f86`.
7. Deploy went green. Smoke tests on `/` and `/api/claude/status` passed — real Pro data returned.

### 7. What's still broken after the cutover

- Dashboard Transparency/Operations tabs partially blank — dropped RPCs (FIX-097/098).
- Graph chord + treemap panels error — dropped RPCs (FIX-097).
- Search broken — `search_graph_entities` dropped (FIX-099).
- `entity_connections` is empty — rebuild_entity_connections is still a stub (FIX-100).
- Financial data is empty — FEC / spending pipelines haven't been re-run against Pro (FIX-101).
- Trending feed gone — materialized view dropped (FIX-104).

All of these are tracked in `docs/FIXES.md` §POST-CUTOVER.

---

## Rollback plan (unused)

The plan §4.1 contained:
- If audit fails and can't be repaired in ≤30 min: `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` then re-apply migrations. Safe because no users depended on Pro yet.
- If smoke test fails post-Vercel-flip: flip env vars back to local.
- Worst case: restore the pre-cutover local `pg_dump` into a fresh Pro project.

None were exercised.

---

## Lessons / gotchas for future migrations

1. **`ALTER FUNCTION … SET SCHEMA` does not rewrite body text.** Always pair with `CREATE OR REPLACE FUNCTION` when the body references schema-qualified names. This bit us for ~1 hour.
2. **`supabase-js` reactive-create paths can pollute with fallback titles.** Any code that upserts "entity X" using "whatever string we had" risks seeding garbage. Gate on real data or explicit placeholder patterns.
3. **Idempotent migrations are worth the overhead.** The promotion migration wraps everything in `DROP … IF EXISTS` and `ALTER … IF EXISTS`, which let us re-run chunks during diagnosis without fear.
4. **Post-promotion audit should include FK checks.** 550 orphan proposals (no bill_details) would have been flagged earlier had the audit included a referential check for `proposals → bill_details` — now worth adding.
5. **Vercel Hobby plan cron limits are a deploy-time failure, not a runtime one.** Always run `pnpm build` + check `vercel.json` crons before pushing; the "Hobby plan only allows once/day" error surfaces at deploy time but is easy to catch earlier.
6. **GitHub branch rename is the user's step, not Claude's.** Dashboard-only. After the rename, `git fetch --prune` + `git branch -m` + `git branch -u` is the local dance.
7. **User's `git config user.email` routes GitHub attribution.** On this machine, `craig.a.denny@gmail.com` attributes to a different personal account; project commits must use `civitics.platform@gmail.com` for `civitics-platform` attribution. Saved as memory.

---

## Reference files

| File | What it is |
|---|---|
| `supabase/migrations/20260422000000_promote_shadow_to_public.sql` | The cutover migration |
| `supabase/migrations/20260422000001_fix_promoted_function_bodies.sql` | Trigger body fix |
| `packages/data/src/pipelines/congress/bills.ts` | Post-promotion single-write writer |
| `packages/data/src/pipelines/congress/votes.ts` | Post-promotion vote writer |
| `packages/data/docs/audits/post-cutover/2026-04-22.md` | Post-cutover integrity audit (green on pipeline checks) |
| `docs/archive/REBUILD_STATUS.md` | Stage status (archived 2026-04-26 after rebuild closed) |
| `docs/FIXES.md` §POST-CUTOVER | Reimplementation backlog |
