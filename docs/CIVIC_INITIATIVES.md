# Civic Initiatives — Feature Tracker

Living status doc for the Civic Initiatives feature. Update as sprints complete.
Full design spec: see `Civic_Initiatives_Design.docx` in the civitics outputs folder.

**Last updated:** 2026-04-11
**Current sprint:** Sprint 4 — Quality gate v1 (not started)

---

## What This Feature Is

A lifecycle-based community platform: citizens draft proposals (Stage 1 — Deliberate),
gather signatures with geographic weighting (Stage 2 — Mobilise), and hold officials
publicly accountable with a mandatory response window (Stage 3 — Hold Accountable).

The core object is a `civic_initiative`. It passes through three stages. Officials
who don't respond within 30 days of hitting constituent thresholds get a permanent
"No Response" on their profile. Silence is data.

---

## Sprint Status

| Sprint | Scope | Status |
|--------|-------|--------|
| 1 | DB migration + core API routes | ✅ Done (2026-04-11) |
| 2 | Create & deliberate UI | ✅ Done (2026-04-11) |
| 3 | Argument board | ✅ Done (2026-04-11) |
| 4 | Quality gate v1 | 🔲 Not started |
| 5 | Mobilise & signatures UI | 🔲 Not started |
| 6 | Official notifications + response window | 🔲 Not started |
| 7 | Responsiveness score on official profiles | 🔲 Not started |
| 8 | Platform integration (graph, follow, proposals) | 🔲 Not started |
| 9 | Quality gate v2 (population-normalised) | 🔲 Not started |
| 10 | Comment submission (regulations.gov integration) | 🔲 Not started |

---

## Tables

Three new tables, created in `supabase/migrations/0033_civic_initiatives.sql`:

- **`civic_initiatives`** — the initiative object (title, body_md, stage, authorship_type, scope, etc.)
- **`civic_initiative_signatures`** — one row per user per initiative; verification_tier: unverified/email/district
- **`civic_initiative_responses`** — one row per official per initiative; response_type: support/oppose/pledge/refer/no_response

Full column definitions: see TASK-11 in `docs/QWEN_PROMPTS.md`.

---

## API Routes (Sprint 1)

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/initiatives` | Paginated list, filterable by stage/scope/tag |
| POST | `/api/initiatives` | Create new initiative (auth required) |
| GET | `/api/initiatives/[id]` | Full detail + signature counts + official responses |
| POST | `/api/initiatives/[id]/sign` | Toggle signature (auth required, mobilise stage only) |
| GET | `/api/initiatives/[id]/signature-count` | Lightweight count for client polling |

---

## Open Design Questions

| Question | Status |
|----------|--------|
| Quality gate normalisation formula (rural vs. urban threshold) | 🟡 Unresolved — start with simple ratio, calibrate with data |
| Moderation: who reviews flagged proposals/arguments? | 🟡 Unresolved — defer to Sprint 4 |
| Official verification (how to confirm staff identity) | 🟡 Unresolved — .gov email domain matching is v1 approach |
| Engagement incentives for responsive officials | 🟡 Unresolved |
| Duplicate initiative detection | 🟡 Unresolved — AI-assist in Sprint 4+ |
| COMMONS token rewards for successful initiatives | 🟡 Deferred to Phase 3 |

---

## Key Design Decisions (Locked)

- **Proposal text is frozen at Stage 2** — once mobilising, only cosmetic/clarifying edits allowed; version history always visible
- **No Response is automatic** — after 30-day window expires, `no_response` is written automatically; not waiting for official acknowledgement
- **Geography coarsened** — `target_district` and `district` on signatures are always district/zip level, never precise coordinates (consistent with platform privacy rule)
- **Signing requires mobilise stage** — can't sign a draft; advances to deliberate then mobilise via quality gate
- **Authorship: individual + community both supported** — community proposals carry higher credibility signal in UI

---

## Qwen Task References

- **TASK-11** — DB migration → `docs/QWEN_PROMPTS.md` ✅
- **TASK-12** — Core API routes → `docs/QWEN_PROMPTS.md` ✅

## Sprint 3 — Delivered (2026-04-11)

New migration: `supabase/migrations/20260411030000_civic_initiatives_sprint3.sql`
- `civic_initiative_arguments` — top-level For/Against args + threaded replies (parent_id)
- `civic_initiative_argument_votes` — one vote per user per argument (toggle pattern)
- `civic_initiative_argument_flags` — one flag per user per argument, with flag_type enum

New API routes:
- `GET /api/initiatives/[id]/arguments` — all args structured as { for: [], against: [] }, with vote_count and replies nested. Top-level sorted by vote_count desc.
- `POST /api/initiatives/[id]/arguments` — create top-level arg or reply; only on deliberate/mobilise initiatives; replies max 1 level deep
- `GET/POST /api/initiatives/[id]/arguments/[argId]/vote` — check/toggle vote on argument
- `POST /api/initiatives/[id]/arguments/[argId]/flag` — flag argument (idempotent)

New component:
- `ArgumentBoard.tsx` — two-column For/Against layout, per-argument vote buttons, reply forms, flag dropdown, SubmitArgumentForm with side toggle. Wired into `/initiatives/[id]` detail page.

## Sprint 2 — Delivered (2026-04-11)

New migration: `supabase/migrations/20260411020000_civic_initiatives_sprint2.sql`
- `civic_initiative_versions` — snapshot of body_md + title before each edit
- `civic_initiative_upvotes` — one row per user per initiative (toggle pattern)

New API routes:
- `PATCH /api/initiatives/[id]` — update title/body/etc (draft/deliberate only; auto-snapshots version)
- `GET/POST /api/initiatives/[id]/upvote` — check/toggle upvote
- `GET /api/initiatives/[id]/versions` — version history list

New pages:
- `/initiatives` — list with stage tabs, scope filter, pagination
- `/initiatives/new` — create form (title, summary, body_md editor, scope, tags)
- `/initiatives/[id]` — detail page: proposal body, upvote, official responses, version history
  - Author inline editor (shown when stage = draft or deliberate)
  - Signature stats sidebar (shown when stage = mobilise)
