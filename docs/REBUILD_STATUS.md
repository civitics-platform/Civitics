# Platform Rebuild — Living Status

_Reference point for current state, decisions, and critical path._
_Update this file at the end of every session that touches rebuild work._

---

## Stage Progress

| Stage | Status | Notes |
|---|---|---|
| Stage 0 — Investigation + writer catalog | ✅ Complete | `STAGE_0_WRITER_CATALOG.md` |
| Stage 1A — Shadow schema + migrations | ✅ Complete | Migrations `20260421000000–20260421000007` applied locally |
| Stage 1B — Pipeline shadow rewrites | 🔄 ~65% | See table below |
| Stage 2 — Cutover | ⬜ Not started | Requires Stage 1B complete + audit green |
| Stage 3 — Local data rollout | ⬜ Not started | 5 metros locked in (SEA, SF, AUS, DC + NYC pending token) |

---

## Stage 1B Pipeline Status

| Pipeline | Status | Notes |
|---|---|---|
| `congress/bills` dual-write to shadow | ✅ Done | `packages/data/src/pipelines/congress/bills.ts` |
| FEC bulk → shadow rewrite | ✅ Done | 1,824 entities · 16,263 relationships · 0 audit violations |
| Legistar — Seattle, Austin, SF | ✅ Done | 67,148 proposals · 1,619 officials · 127 meetings |
| shadow-initiatives backfill | ✅ Done | civic_initiatives → shadow.proposals type='initiative' |
| shadow-connections (vote + donation edges) | ✅ Done | |
| **Congress votes → shadow (bill re-anchoring)** | ✅ Done | `b039e0ca` — bills-first ordering, lookup-only shadow inserts, title self-healing |
| **`shadow.rebuild_entity_connections()` L5 job** | ✅ Done | `shadow/connections/shadow.ts` upgraded to read shadow.votes; full 4-type derivation |
| CourtListener → shadow.case_details | ⬜ Not started | Priority 4 |
| OpenStates → shadow | ⬜ Not started | Priority 5 |
| spending_records → financial_relationships | ✅ Done | `ccfa5ff7` — agency→entity, contract/grant type, dedup on usaspending_award_id |
| FEC bulk 2022/2020 cycles | ⬜ Not started | Low priority until shadow is complete |
| NYC Legistar | 🔴 Blocked | 403 — needs API token. Skipped for Stage 2; document for grant applications |
| Cosponsorship pipeline | ⬜ Stub | Migration `20260420000000` exists |
| Federal Register pipeline | ⬜ Stub | Migration `20260420010000` exists |
| Lobbying pipeline | ⬜ Stub | Migration `20260420020000` exists |

---

## Decisions Locked

| # | Question | Decision | Date |
|---|---|---|---|
| L1 | Initiatives structure | I-B: migrate civic_initiatives → proposals.type='initiative' + initiative_details | 2026-04-19 |
| L2 | external_source_refs FK | App-level enforcement + orphan cleanup job (no DB-level polymorphic FK) | 2026-04-19 |
| L3 | bill_details uniqueness | Denormalize jurisdiction_id + session onto bill_details for compound unique index | 2026-04-19 |
| L4 | votes.agenda_item_id | Nullable FK, yes | 2026-04-19 |
| L5 | entity_connections | Derivation-only for Phase 1 (no manual edges) | 2026-04-19 |
| L6 | Cutover deadline | 30-day dual-write window | 2026-04-19 |
| L7 | financial_relationships | Keep name, make polymorphic with relationship_type enum | 2026-04-19 |
| E.4 | spending_records | Migrate into financial_relationships (type='contract'/'grant'); ingest from ~2010+ only | 2026-04-19 |
| A | Local pilot scope | Current 5 metros only (SEA, SF, AUS, DC + NYC when unblocked) | 2026-04-20 |
| B | Senate votes | Accept looser bill linkage at Stage 2 launch; full resolution filed as Phase 2 item | 2026-04-20 |
| C | Spending records timeline | Merge into financial_relationships as part of Stage 1 shadow build | 2026-04-20 |
| D | NYC Legistar | Skip Stage 2; document data gap for grant applications (Knight, Mozilla, Democracy Fund) | 2026-04-20 |

---

## Architecture Fixes Required Before Cutover

These are correctness and integrity issues — do not cut over to shadow until all are done.

### Critical (wrong data if skipped)
1. **Votes anchor to bills, not vote-questions** — 216k public.votes currently point at synthetic "On Passage" proposals. Shadow rewrite fixes this; don't cut over until shadow vote count is sane.
2. **One FEC aggregation path** — retire `connections/delta.ts` and `financial-entities/index.ts` donor paths; shadow FEC writer is now canonical.
3. **Federal judges governing_body** — CourtListener currently writes `governing_body_id = senateId` for all judges. Shadow rewrite seeds proper judicial bodies.
4. **`data_sync_log` column name** — `pipeline` vs `pipeline_name` split; one path silently fails. Fix in shadow.

### Important (UX / query correctness)
5. **Officials state from FK, not JSON** — `officials.metadata->>'state'` is null for all 100 senators. In shadow, state derives from `jurisdiction_id → jurisdictions.short_name`. Fixes AI tagger "Unknown" state for all federal officials.
6. **`pipeline_state` formalization** — split into pipeline_cursors, pipeline_runs, pipeline_locks.

### Workflow
7. **Shadow audit gate** — run integrity audit against `shadow.*` tables before any cutover. Same audit code, different schema prefix. Green = safe to cut over.
8. **New Supabase Pro project** — shadow currently lives in local Docker. Needs to move to a cloud Pro project before Stage 2 cutover.

---

## Critical Path to Stage 2

```
1. Congress votes shadow rewrite                    ✅ done (b039e0ca)
2. shadow.rebuild_entity_connections() L5 job       ✅ done (shadow.ts upgraded)
3. spending_records → financial_relationships merge  ✅ done (ccfa5ff7)
4. CourtListener → shadow.case_details              ← next
5. OpenStates → shadow
6. App query audit (grep every from("proposals")/from("votes") in apps/civitics/app/)
7. Provision new Supabase Pro project
8. Run integrity audit against shadow — must be green
9. Write Stage 2 cutover runbook
10. Craig signs off → swap Vercel env vars
```

Items 1–6 are engineering. Items 7–10 are ops/sign-off. Nothing is currently blocked except NYC.

---

## Reference Files

| File | Purpose |
|---|---|
| `docs/PLATFORM_REBUILD_SPEC.md` | Why we're doing this, original decision questions |
| `docs/STAGE_0_WRITER_CATALOG.md` | Full pipeline writer audit, 17 architectural findings |
| `docs/STAGE_1_SCHEMA_DESIGN.md` | Schema decisions L1–L7, table-by-table design rationale |
| `supabase/migrations/20260421*` | Shadow migrations (applied locally) |
| `docs/audits/2026-04-19.md` | Last audit run — 6 errors against old public schema |
| `docs/SESSION_LOG.md` | Session-by-session work log |
