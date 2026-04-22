# App Query Audit — Pre-Cutover

Audit covers every `.from(<table>)` call in `apps/civitics/app/` against the 22 tables the shadow rebuild reshapes. Purpose: decide per-hit whether the reader survives the `shadow.* → public.*` promotion or needs a rewrite before Vercel flips to Pro.

- **Audit date:** 2026-04-21
- **Scope:** `apps/civitics/app/**/*.{ts,tsx}` — 212 call sites across 47 files
- **Method:** ripgrep for `from\((<table>)\)` + column-level spot check against Stage 1 migrations `20260421000002`–`20260421000005`
- **Plan reference:** `C:\Users\Craig\.claude\plans\i-believe-most-everything-drifting-patterson.md` §3.1 line 1

---

## Risk legend

| Tag | Meaning | Action |
|---|---|---|
| 🟢 COMPATIBLE | Reader works post-promotion without edits | None |
| 🟡 STALE-COLS | Columns selected don't exist in shadow; 400/500 at request time | Rewrite select list (or join detail table) |
| 🔴 TABLE-GONE | Table itself is absorbed into another table | Rewrite onto new table |
| 🟠 SEMANTICS | Columns exist but meaning changed; returns wrong rows | Rewrite filter/predicate |
| ⚫ NO-SHADOW | Table is unchanged by shadow rebuild | None |

---

## Summary by table

| Table | Hits | Status | Notes |
|---|---|---|---|
| `proposals` | 42 | 🟡 STALE-COLS | Core table survives; `regulations_gov_id`, `congress_gov_url`, `comment_period_end`, `vote_category`, `bill_number` all moved out |
| `votes` | 13 | 🟡 STALE-COLS | Column `proposal_id` renamed → `bill_proposal_id`; `roll_call_number` → `roll_call_id`; `vote_question` now first-class |
| `financial_relationships` | 21 | 🟠 SEMANTICS | Schema change is total: polymorphic `from_*/to_*`, no more `official_id`/`donor_name`/`donor_type`/`industry` columns |
| `spending_records` | 3 | 🔴 TABLE-GONE | Absorbed into `financial_relationships WHERE relationship_type IN ('contract','grant')` |
| `civic_initiatives` | 19 | 🔴 TABLE-GONE | Merged into `proposals` with `type='initiative'` + `initiative_details` join |
| `entity_connections` | 24 | 🟢 COMPATIBLE | Same column shape (`from_type/from_id/to_type/to_id/connection_type/amount_cents/occurred_at`). Depends on derivation job populating same connection_type values |
| `financial_entities` | 8 | 🟢 COMPATIBLE | Same `id/name/entity_type`; new canonical_name/display_name cols available but optional |
| `officials` | 20 | ⚫ NO-SHADOW | Columns selected (`id/full_name/role_title/party/...`) untouched |
| `agencies` | 9 | ⚫ NO-SHADOW | Untouched |
| `ai_summary_cache` | 14 | ⚫ NO-SHADOW | Untouched |
| `entity_tags` | 7 | ⚫ NO-SHADOW | Untouched |
| `pipeline_state` | 8 | ⚫ NO-SHADOW | Untouched |
| `data_sync_log` | 3 | ⚫ NO-SHADOW | Untouched |
| `enrichment_queue` | 2 | ⚫ NO-SHADOW | Untouched |
| `jurisdictions` | 1 | ⚫ NO-SHADOW | Untouched |
| `career_history` | 1 | ⚫ NO-SHADOW | Untouched |
| `promises` | 1 | ⚫ NO-SHADOW | Untouched |
| `civic_initiative_responses` | 1 | 🟠 SEMANTICS | Inner `civic_initiatives!initiative_id(...)` join needs rewrite (initiative = proposals row now) |
| `civic_initiative_upvotes` | 1 | 🟠 SEMANTICS | Table likely survives but `initiative_id` FK now points at `proposals.id` — no app change, but verify FK after promotion migration |

---

## BLOCKING — must fix before go-live

These cause runtime failures (400/404/500) the first time the page loads.

### `votes` — FK column rename

**Every** reader uses `proposal_id`; shadow renamed to `bill_proposal_id`. Also `roll_call_number` → `roll_call_id`. Also `vote_question` is now a real column instead of `metadata->>'vote_question'`.

| File | Line | Current | Post-promotion |
|---|---|---|---|
| [officials/[id]/page.tsx:274](apps/civitics/app/officials/[id]/page.tsx#L274) | 274 | `proposals!proposal_id(id, title, bill_number, short_title)` | `bill_details!bill_proposal_id(bill_number, proposals!proposal_id(id, title, short_title))` |
| [officials/[id]/page.tsx:296](apps/civitics/app/officials/[id]/page.tsx#L296) | 296 | `proposals!proposal_id(id, title, bill_number)` | same pattern |
| [proposals/[id]/page.tsx:179](apps/civitics/app/proposals/[id]/page.tsx#L179) | 179 | `.eq("proposal_id", p.id)` | `.eq("bill_proposal_id", p.id)` |
| [officials/components/OfficialCard.tsx:80](apps/civitics/app/officials/components/OfficialCard.tsx#L80) | 80, 86 | `votes` counts by `official_id` | unchanged (official_id survives) |
| [officials/components/OfficialGraph.tsx:259](apps/civitics/app/officials/components/OfficialGraph.tsx#L259) | 259 | check column select | verify after reading file |
| [api/cron/notify-followers/route.ts:63](apps/civitics/app/api/cron/notify-followers/route.ts#L63) | 63 | check column select | verify |
| [api/officials/[id]/summary/route.ts:80](apps/civitics/app/api/officials/[id]/summary/route.ts#L80) | 80 | check column select | verify |
| [api/claude/status/route.ts:137](apps/civitics/app/api/claude/status/route.ts#L137) | 137 | count(*) only | 🟢 safe (no column select) |
| [page.tsx:430](apps/civitics/app/page.tsx#L430) | 430 | count(*) by official_id | 🟢 safe |

### `proposals` — columns moved into detail tables

Shadow `proposals` core only has: `id, type, status, jurisdiction_id, governing_body_id, title, short_title, summary_plain, summary_generated_at, summary_model, introduced_at, last_action_at, resolved_at, external_url, full_text_url, full_text_r2_key, search_vector, metadata`.

**Anything else is gone or moved.** Specifically:

| Legacy column | Post-promotion location |
|---|---|
| `bill_number` | `bill_details.bill_number` |
| `congress_gov_url` | `bill_details.congress_gov_url` |
| `regulations_gov_id` | `external_source_refs(source='regulations_gov')` |
| `comment_period_end` | still in `metadata` (no detail table for regulations yet) — **verify** |
| `vote_category` | removed entirely — concept moved to `votes.vote_question` + `proposal_actions.action_type` |
| `docket_number`, `case_name` | `case_details.*` |
| `ballot_id`, `election_date` | `measure_details.*` |

Concrete hits:

| File | Line | Issue |
|---|---|---|
| [page.tsx:309](apps/civitics/app/page.tsx#L309) | 309, 335 | selects `regulations_gov_id,congress_gov_url,comment_period_end` — first two are GONE; `comment_period_end` stays in metadata |
| [proposals/[id]/page.tsx:158](apps/civitics/app/proposals/[id]/page.tsx#L158) | 158 | same columns — same fix |
| [proposals/page.tsx:114](apps/civitics/app/proposals/page.tsx#L114) | 114, 122, 149, 174, 182, 189, 196 | spot-check each select |
| [api/graph/connections/route.ts:86-88](apps/civitics/app/api/graph/connections/route.ts#L86-L88) | 86 | `.select("id, vote_category")` — column GONE; procedural-vote filtering must be rewritten against `votes.vote_question` or `proposal_actions` |
| [officials/[id]/page.tsx:274](apps/civitics/app/officials/[id]/page.tsx#L274) | 274, 296 | joined `proposals!proposal_id(...bill_number...)` — `bill_number` not on proposals anymore |
| [api/cron/notify-followers/route.ts:135](apps/civitics/app/api/cron/notify-followers/route.ts#L135) | 135 | verify select |
| [api/proposals/[id]/summary/route.ts:68](apps/civitics/app/api/proposals/[id]/summary/route.ts#L68) | 68 | verify select |
| [api/graph/snapshot/route.ts:205](apps/civitics/app/api/graph/snapshot/route.ts#L205) | 205, 333, 400 | selects `id, title` only — 🟢 safe |
| [api/graph/connections/route.ts:319](apps/civitics/app/api/graph/connections/route.ts#L319) | 319 | selects `id, title` — 🟢 safe |

### `financial_relationships` — total schema change

This is the most invasive rewrite. Old shape had donation-centric columns (`official_id`, `donor_name`, `donor_type`, `industry`). Post-promotion:

- No `official_id` column — use `.eq("to_type","official").eq("to_id", id)` (or `from_*` for outflows)
- No `donor_name/donor_type/industry` — join `financial_entities!from_id(display_name, entity_type, industry)`
- `amount` → `amount_cents` (may already be the name — verify against current public schema)
- New required filter `relationship_type` — old callers implicitly assumed "donations"; now must filter `.eq("relationship_type","donation")`
- `recipient_id`/`donor_id` (if any existed) replaced by `from_id`/`to_id` with type discriminator

Concrete hits:

| File | Line | Issue |
|---|---|---|
| [officials/[id]/page.tsx:280](apps/civitics/app/officials/[id]/page.tsx#L280) | 280, 284 | `.eq("official_id", ...)` — column gone; switch to `to_type='official' AND to_id=?` + `relationship_type='donation'` |
| [officials/[id]/page.tsx:285](apps/civitics/app/officials/[id]/page.tsx#L285) | 285 | `.select("donor_name, donor_type, industry, amount_cents, metadata")` — three columns gone; join `financial_entities!from_id(...)` |
| [officials/components/OfficialCard.tsx:90](apps/civitics/app/officials/components/OfficialCard.tsx#L90) | 90, 94 | same `official_id` pattern |
| [page.tsx:301](apps/civitics/app/page.tsx#L301) | 301 | count(*) only — 🟢 safe |
| [page.tsx:434](apps/civitics/app/page.tsx#L434) | 434, 438 | `.eq("official_id", id)` + amount_cents sum — same fix |
| [api/officials/[id]/summary/route.ts:87](apps/civitics/app/api/officials/[id]/summary/route.ts#L87) | 87 | verify — likely same fix |
| [api/claude/status/route.ts:142](apps/civitics/app/api/claude/status/route.ts#L142) | 142 | count(*) — 🟢 safe |
| [api/graph/chord/route.ts:259](apps/civitics/app/api/graph/chord/route.ts#L259) | 259 | verify select |
| [api/graph/treemap-pac/route.ts:41](apps/civitics/app/api/graph/treemap-pac/route.ts#L41) | 41 | verify — probably needs rewrite |
| [api/graph/group/route.ts:73](apps/civitics/app/api/graph/group/route.ts#L73) | 73, 176 | verify |
| [api/graph/sunburst/route.ts:322](apps/civitics/app/api/graph/sunburst/route.ts#L322) | 322 | verify |

### `spending_records` — table absorbed

Three readers; all need rewrite to `financial_relationships WHERE relationship_type IN ('contract','grant')`. NAICS/CFDA/subagency metadata is preserved in `metadata` JSONB.

| File | Line | Rewrite target |
|---|---|---|
| [page.tsx:304](apps/civitics/app/page.tsx#L304) | 304 | `financial_relationships` count `WHERE relationship_type IN ('contract','grant')` |
| [agencies/[slug]/page.tsx:191](apps/civitics/app/agencies/[slug]/page.tsx#L191) | 191 | same — filter by `from_type='agency' AND from_id=<agency_id>` |
| [officials/[id]/page.tsx:498](apps/civitics/app/officials/[id]/page.tsx#L498) | 498 | same — filter by official link |

### `civic_initiatives` — table absorbed

19 readers across public pages and 10+ API routes. All become `proposals WHERE type='initiative'` + left-join `initiative_details` for scope/stage/authorship/tags.

| File | Line | Notes |
|---|---|---|
| [page.tsx:361](apps/civitics/app/page.tsx#L361) | 361, 368 | selects `stage, scope, authorship_type, issue_area_tags, target_district, mobilise_started_at, resolved_at` — all live in `initiative_details` now except `resolved_at` (on proposals) and `summary` (→ `summary_plain` on proposals) |
| [initiatives/page.tsx:59](apps/civitics/app/initiatives/page.tsx#L59) | 59 | list page — rewrite to `proposals + initiative_details` |
| [initiatives/[id]/page.tsx:31](apps/civitics/app/initiatives/[id]/page.tsx#L31) | 31, 130 | detail page |
| [api/initiatives/route.ts:33](apps/civitics/app/api/initiatives/route.ts#L33) | 33, 131 | GET list + POST create |
| [api/initiatives/[id]/route.ts:27](apps/civitics/app/api/initiatives/[id]/route.ts#L27) | 27, 101, 171 | GET/PATCH/DELETE |
| [api/initiatives/[id]/advance/route.ts:33](apps/civitics/app/api/initiatives/[id]/advance/route.ts#L33) | 33, 51, 79, 96 | stage transitions — all update `initiative_details.stage` now |
| [api/initiatives/[id]/follow/route.ts:66](apps/civitics/app/api/initiatives/[id]/follow/route.ts#L66) | 66 | |
| [api/initiatives/[id]/gate/route.ts:24](apps/civitics/app/api/initiatives/[id]/gate/route.ts#L24) | 24 | `initiative_details.quality_gate_score` |
| [api/initiatives/[id]/upvote/route.ts:28](apps/civitics/app/api/initiatives/[id]/upvote/route.ts#L28) | 28 | |
| [api/initiatives/[id]/link-proposal/route.ts:49](apps/civitics/app/api/initiatives/[id]/link-proposal/route.ts#L49) | 49 | now cross-proposal linking (both rows are in `proposals`) |
| [api/initiatives/[id]/sign/route.ts:65](apps/civitics/app/api/initiatives/[id]/sign/route.ts#L65) | 65 | |
| [api/initiatives/[id]/arguments/route.ts:36](apps/civitics/app/api/initiatives/[id]/arguments/route.ts#L36) | 36, 121 | |
| [api/initiatives/[id]/versions/route.ts:21](apps/civitics/app/api/initiatives/[id]/versions/route.ts#L21) | 21 | |
| [api/initiatives/[id]/respond/route.ts:82](apps/civitics/app/api/initiatives/[id]/respond/route.ts#L82) | 82 | |
| [api/initiatives/_lib/milestones.ts:94](apps/civitics/app/api/initiatives/_lib/milestones.ts#L94) | 94 | shared lib |
| [api/initiatives/_lib/gate.ts:114](apps/civitics/app/api/initiatives/_lib/gate.ts#L114) | 114 | shared lib |
| [officials/[id]/page.tsx:313](apps/civitics/app/officials/[id]/page.tsx#L313) | 313 | `civic_initiative_responses` join with `civic_initiatives!initiative_id(id, title, scope)` — rewrite to `proposals!initiative_id + initiative_details!proposal_id(scope)` |

---

## Non-blocking but should verify

| Area | Concern |
|---|---|
| `entity_connections` derivation job | Current `rebuild_entity_connections()` migration body is `TODO(phase1)`. Before flipping Vercel, confirm the application-layer derivation (`packages/data`) populates the same `connection_type` values the UI filters on: `'donation'`, `'vote_yes'`, `'vote_no'`, `'vote_abstain'`, `'nomination_vote_yes'`, `'nomination_vote_no'`, `'oversight'`, `'appointment'`, `'co_sponsorship'`. |
| `ai_summary_cache.entity_id` | Semantics for `entity_type='initiative'` or `entity_type='proposal'` should stay stable — initiative rows just move to `proposals`. But cached entries keyed by old proposal ID are the same ID after `SET SCHEMA` (identity preserved), so no data invalidation is needed. |
| `civic_initiative_upvotes.initiative_id` | FK points at `proposals.id` after promotion. No app code change, but the migration must ALTER the FK target or leave it pointing at the same row (since initiative rows keep their UUID through the move). |
| `metadata->>'agency_id'` pattern | `proposals.metadata.agency_id` is still a JSONB key on shadow — readers using `.filter("metadata->>agency_id", "eq", ...)` still work. Long-term, this should become a proper FK, but that's Phase 2. |

---

## Suggested order of operations

1. **Write the promotion migration** (`20260422000000_promote_shadow_to_public.sql`) — use `ALTER TABLE shadow.X SET SCHEMA public`, which preserves table identity, all indexes, all FKs, and all row UUIDs. Old `public.proposals`/`votes`/`financial_relationships` get dropped first.
2. **App-query rewrite in the same commit** — all 🟡/🟠/🔴 hits above. Keep this PR tightly scoped to "adapt app to new schema"; don't mix in feature work.
3. **Local dry run** — apply migration to local Docker Supabase, `pnpm build`, manually smoke-test homepage / officials / proposals / initiatives / graph pages against the migrated local DB. Anything that 500s on local will 500 on Pro.
4. **Then** provision Pro and run the runbook (§4 of the plan).

## Scope estimate

- **1 new migration file** (~100 lines of SQL with DROP/ALTER SCHEMA/RLS rewrites)
- **~15 files rewritten** in `apps/civitics/app/` — heaviest lifts: `officials/[id]/page.tsx`, `page.tsx` (homepage), all of `api/initiatives/**`, `api/graph/connections/route.ts`, `proposals/[id]/page.tsx`, `proposals/page.tsx`
- Total code churn: probably 400–600 lines across app code + 100 lines of migration SQL

The initiative rewrites and financial_relationships rewrite are the largest chunks. The votes column-rename fix is mostly mechanical. The `proposals` column audit needs a careful pass through `proposals/page.tsx` and `proposals/[id]/page.tsx` — those select lists are copy-pasted across multiple queries in the same file.

---

## Out of scope for this audit

- `/packages/data/` writer call sites — those are Stage 1B's problem; the dual-write pipelines already write to shadow and will keep writing after the table gets renamed to public.
- `/packages/graph/` + other package internals — the audit is app-layer only.
- Social app (`apps/social/`) — does not read these tables.
