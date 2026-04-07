# QWEN_PROMPTS.md — Civitics Task Queue for Qwen Code

Living document. Claude adds tasks here when Claude usage is limited.
Qwen picks up tasks from the Active Queue and works on branch `qwen/<cycle>`.
Claude reviews diffs before merging.

**Last updated: 2026-04-07**

---

## How This Works

1. **Before starting any task**, Qwen should:
   - Read `QWEN.md` (project root) — critical gotchas and conventions
   - Read any file paths listed in the task
   - Check current branch: `git branch` (should be on `qwen/<cycle>`, not master)

2. **After completing each task**:
   - Commit with `[skip vercel]` prefix: `git commit -m "[skip vercel] fix: <description>"`
   - Keep commits atomic — one task per commit if possible

3. **When uncertain about intent**, leave a `// TODO(review): ...` comment rather than guessing.

4. **Output format Claude expects**: clean TypeScript, no stray console.logs, no placeholder text.

---

## Active Queue

---

### TASK-01 — Fix sunburst ring2: all sort modes produce identical output

**Status:** `COMPLETE — merged 2026-04-07`
**Risk:** Low — isolated to one function in one route
**Files to read first:**
- `apps/civitics/app/api/graph/sunburst/route.ts` (full file)

**Problem:**
The sunburst API accepts a `ring2` param with three values: `'top_entities'`, `'by_amount'`, `'by_count'`. The param is read and routed through a switch statement, but all three cases do identical sorting:

```ts
// All three cases currently do this — identical behavior:
return [...items].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
```

Changing ring2 in the UI has no visible effect.

**Fix:**
Implement distinct behavior for each mode. The `value` field on each child item is set to `amount_cents ?? Math.round(strength * 1_000_000)` in `buildChildren()`.

- `'by_amount'`: sort by `value` descending (amount_cents based) — this is the current behavior, keep it
- `'top_entities'`: sort by `strength` descending. You'll need to pass `strength` through `buildChildren()` so it's available in the sort. Currently `strength` is used to compute `value` but not stored separately.
- `'by_count'`: sort by count of connections per ring1 group (i.e. `children.length` within each group, not individual item sorting). Actually implement this as: within each group, sort children by how many entity_connections they appear in. Since that data isn't in the current payload, implement as: sort by `value` but add a `// TODO: needs connection count field from DB` comment. Don't fake it.

**Acceptance criteria:**
- Changing ring2 from `'top_entities'` to `'by_amount'` produces a visually different ordering for an entity with mixed connection types
- TypeScript compiles clean (`pnpm build` passes)
- No new console.log statements

---

### TASK-02 — Fix search ranking: connection count query hits .in() large array bug

**Status:** `COMPLETE — merged 2026-04-07`
**Risk:** Medium — touches the search API route, test manually after
**Files to read first:**
- `apps/civitics/app/api/search/route.ts` (full file)
- `QWEN.md` section "CRITICAL — Supabase Query Gotchas"

**Problem:**
In the officials search function, connection counts are fetched to help rank results:

```ts
const ids = officials.map((o) => o.id);
const [fromRes, toRes] = await Promise.all([
  db.from("entity_connections").select("from_id").in("from_id", ids),
  db.from("entity_connections").select("to_id").in("to_id", ids),
]);
```

**Per the project's known gotcha**: `.in('column', largeArray)` with 100+ IDs silently returns an empty result set. When the search returns many officials, `ids` easily exceeds 100. This means `countMap` is always empty, `connCount` is always 0 for everyone, and the ranking degrades to just `isFederal` priority. High-profile senators with many connections rank no higher than obscure local officials.

**Fix:**
Replace both `.in()` calls with an RPC that accepts an array of IDs and returns connection counts. Create a new Supabase RPC migration (local only — use `supabase migration new search_connection_counts --local`).

The RPC should:
```sql
-- Returns one row per id with total connection count (from OR to)
create or replace function get_connection_counts(entity_ids uuid[])
returns table(entity_id uuid, connection_count bigint)
language sql stable as $$
  select id as entity_id, count(*) as connection_count
  from (
    select from_id as id from entity_connections where from_id = any(entity_ids)
    union all
    select to_id   as id from entity_connections where to_id   = any(entity_ids)
  ) sub
  group by id;
$$;
```

Call it as:
```ts
const { data: countData } = await db.rpc('get_connection_counts', { entity_ids: ids });
const countMap = new Map<string, number>();
for (const r of countData ?? []) {
  countMap.set(r.entity_id, Number(r.connection_count));
}
```

Remove the old `fromRes`/`toRes` parallel fetch.

**Important**: Use `supabase migration new <name> --local` to create the migration. NEVER run against production (`--local` flag is mandatory).

**Acceptance criteria:**
- Searching "warren" returns Elizabeth Warren near the top (she has many connections)
- `pnpm build` passes
- Migration file created in `supabase/migrations/` with correct timestamp

---

### TASK-03 — Community commenting UI on proposal detail pages

**Status:** `READY`
**Risk:** Low — new component, no existing code to break
**Files to read first:**
- `apps/civitics/app/proposals/[id]/page.tsx` (understand page structure)
- `packages/db/CLAUDE.md` (schema conventions)

**Background:**
The `civic_comments` table exists in the database (confirmed in PHASE_GOALS.md). There is currently no UI for it. Community commenting is a Phase 1 remaining feature.

**What to build:**

1. A `CivicComments` client component at:
   `apps/civitics/app/proposals/[id]/components/CivicComments.tsx`

2. An API route for fetching and posting comments at:
   `apps/civitics/app/api/proposals/[id]/comments/route.ts`

**Component requirements:**
- `'use client'` — needs interactivity
- Shows existing comments (fetch from API on mount)
- Shows a text area + "Add comment" button for posting
- Empty state: "Be the first to comment on this proposal."
- Loading state: skeleton rows (consistent with rest of app)
- Error state: "Unable to load comments." with retry button
- Display format per comment: display_name (or "Anonymous"), timestamp (relative: "2 days ago"), comment text
- No upvoting, no nested replies — keep it simple for Phase 1
- Max comment length: 2000 characters (show counter when within 200 chars)

**API route requirements:**
- `GET /api/proposals/[id]/comments` — returns comments for a proposal, ordered by `created_at DESC`, limit 50
- `POST /api/proposals/[id]/comments` — creates a comment. Body: `{ text: string }`. For Phase 1, does not require auth (anonymous posting is fine — auth can be added later).
- Use `createServerClient(cookies())` for GET (respects RLS), `createAdminClient()` for POST (needs to insert)
- Remember: `export const dynamic = "force-dynamic";` on any route using `createAdminClient()`

**civic_comments table schema (from DB):**
```
id            UUID DEFAULT gen_random_uuid()
entity_type   TEXT  (use 'proposal')
entity_id     UUID  (the proposal id)
user_id       UUID  (nullable — anonymous if null)
display_name  TEXT  (nullable)
text          TEXT
created_at    TIMESTAMPTZ DEFAULT now()
```

**Integration:**
Add `<CivicComments proposalId={proposal.id} />` near the bottom of the proposal detail page (`apps/civitics/app/proposals/[id]/page.tsx`), above the related proposals section if one exists.

**Acceptance criteria:**
- Component renders without errors on `/proposals/[any-id]`
- Can post a comment and see it appear without page refresh
- Handles network errors gracefully
- `pnpm build` passes clean

---

## Completed

*(Move tasks here after Claude reviews and merges)*

---

## Template — Adding New Tasks

```markdown
### TASK-XX — [Short descriptive title]

**Status:** `READY` | `BLOCKED: <reason>` | `IN PROGRESS` | `NEEDS REVIEW`
**Risk:** Low | Medium | High
**Files to read first:**
- path/to/file.tsx

**Problem:**
[What is broken or missing]

**Fix:**
[Exact instructions. Include code snippets. Be explicit about file paths.]

**Acceptance criteria:**
- [ ] Specific testable outcome
- [ ] pnpm build passes
```

---

## Notes on Workflow

**Claude review checklist (before merging):**
- [ ] Field names match contract (fromId/toId, not source/target, etc.)
- [ ] No `.in()` with large arrays
- [ ] No `createAdminClient()` without `export const dynamic = "force-dynamic";`
- [ ] No edits to `apps/civitics/src/app/`
- [ ] `pnpm build` passes
- [ ] No hardcoded fake data
- [ ] No stray `console.log` in production paths
- [ ] **File endings intact** — check ALL edited files end with closing `}` and no truncation (Qwen has truncated endings in every task so far — sunburst, pathfinder, snapshot, search all had issues)
- [ ] **No null byte corruption** — `file path/to/file.ts` should say "Unicode text", not "data". Binary = corrupted.
