# QWEN_PROMPTS.md — Civitics Task Queue for Qwen Code

Living document. Claude adds tasks here when Claude usage is limited.
Qwen picks up tasks from the Active Queue and works on branch `qwen/<cycle>`.
Claude reviews diffs before merging.

**Last updated: 2026-04-07**

---

## How This Works

1. **Before starting any task**, Qwen should:
   - Read `QWEN.md` (project root) in full — critical gotchas, field name contracts, file integrity rules
   - Read every file path listed in the task before writing any code
   - Confirm current branch: `git branch` — must be on `qwen/<cycle>`, never `master`

2. **Mandatory pre-commit self-check** (do this before every `git commit`):
   - Run `tail -5 <every file you edited>` — confirm each ends with a complete `}`
   - Run `file <every file you edited>` — output must say "Unicode text", never "data"
   - If either check fails, re-read the file from disk and fix the ending before committing
   - This has caught real truncation bugs on every task so far

3. **After completing each task**:
   - Commit with `[skip vercel]` prefix: `git commit -m "[skip vercel] <type>: <description>"`
   - One task per commit — keep them atomic and reviewable

4. **When uncertain about intent**, leave a `// TODO(review): ...` comment and move on. Do not guess.

5. **Output format Claude expects**: clean TypeScript, no stray `console.log` in production paths, no placeholder text, no hardcoded fake data.

6. **New components and functions**: add a one-line `// QWEN-ADDED: <purpose>` comment directly above them so Claude can spot additions quickly during review.

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

**Status:** `COMPLETE — merged 2026-04-07`
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

---

### TASK-04 — TypeScript audit: add generic types to all remaining bare `withDbTimeout` calls

**Status:** `READY`
**Risk:** Very low — TypeScript types only, zero logic changes
**Files to edit:**
- `apps/civitics/app/api/graph/chord/route.ts`
- `apps/civitics/app/api/graph/connections/route.ts`
- `apps/civitics/app/api/graph/entities/route.ts`
- `apps/civitics/app/api/graph/group/route.ts`
- `apps/civitics/app/api/graph/search/route.ts`
- `apps/civitics/app/api/graph/sunburst/route.ts`
- `apps/civitics/app/api/graph/treemap/route.ts`
- `apps/civitics/app/api/graph/treemap-pac/route.ts`

**Problem:**
`withDbTimeout` without a generic type parameter returns `unknown`, causing TypeScript to fail on destructuring `{ data, error }`. All other routes already have the fix applied — these are the remaining ones.

**Pattern to apply** (consistent with what's already fixed elsewhere in the codebase):
```ts
// Before (TypeScript error):
const { data, error } = await withDbTimeout(supabase.from("table").select("..."));

// After:
const { data, error } = await withDbTimeout<{
  data: RowType[] | null;
  error: { message: string } | null;
}>(supabase.from("table").select("..."));
```

For `.rpc()` calls, look at how `data` is immediately cast after the call (e.g. `as FlowRow[]`) — use that cast type as the generic:
```ts
const { data, error } = await withDbTimeout<{
  data: FlowRow[] | null;
  error: { message: string } | null;
}>(supabase.rpc("my_rpc"));
```

For count-only queries (`{ count: "exact", head: true }`), the pattern is:
```ts
const { count, error } = await withDbTimeout<{
  count: number | null;
  error: { message: string } | null;
}>(supabase.from("table").select("*", { count: "exact", head: true }));
```

For calls that also return `data` alongside `count`:
```ts
const { count, data } = await withDbTimeout<{
  count: number | null;
  data: RowType[] | null;
  error: { message: string } | null;
}>(query);
```

**Instructions:**
1. Read each file completely before editing
2. Find every `await withDbTimeout(` that does NOT have `<{` immediately after it
3. Look at how `data` is used in the lines immediately following to infer the correct row type
4. Add the appropriate generic type — if the row type is complex or unclear, use `// eslint-disable-next-line @typescript-eslint/no-explicit-any` and `any` as a fallback rather than guessing
5. Do not change any logic, only add the type parameter

**Acceptance criteria:**
- Zero bare `await withDbTimeout(` calls remain in any of the listed files (every call has `<{`)
- `pnpm build` passes
- No logic changes — diffs should show only type additions

---

### TASK-05 — Career history section on official detail pages

**Status:** `READY`
**Risk:** Low — new component added to existing page, no existing code modified except one import + JSX line
**Files to read first:**
- `apps/civitics/app/officials/[id]/page.tsx` (full file — understand layout and existing data fetching pattern)
- `supabase/migrations/0001_initial_schema.sql` (search for `career_history` — read the table definition)

**Background:**
The `career_history` table tracks an official's employment history with a `revolving_door_flag` for when they worked at an organization they previously regulated (or vice versa). This data exists in the DB but has no UI.

**career_history table schema:**
```sql
id              UUID
official_id     UUID NOT NULL REFERENCES officials(id)
organization    TEXT NOT NULL
role_title      TEXT
started_at      DATE
ended_at        DATE
is_government   BOOLEAN NOT NULL DEFAULT false
governing_body_id UUID REFERENCES governing_bodies(id)
revolving_door_flag BOOLEAN NOT NULL DEFAULT false
revolving_door_explanation TEXT
metadata        JSONB
created_at      TIMESTAMPTZ
```

**What to build:**

1. Fetch career history in `apps/civitics/app/officials/[id]/page.tsx` alongside existing data.
   Add to the existing parallel `Promise.all` data fetch (look at how votes, donors etc. are fetched — follow that pattern exactly):
   ```ts
   supabase
     .from("career_history")
     .select("id, organization, role_title, started_at, ended_at, is_government, revolving_door_flag, revolving_door_explanation")
     .eq("official_id", id)
     .order("started_at", { ascending: false })
     .limit(20)
   ```

2. Create a new component: `apps/civitics/app/officials/[id]/components/CareerHistory.tsx`
   - Server component (no `"use client"`) — data is passed in as props
   - Props: `items: CareerHistoryRow[]`
   - Show nothing (return null) if `items.length === 0`
   - Layout: a timeline list, one row per entry
   - Each row shows: `role_title` (or "Employee" if null) at `organization`, date range (`started_at` — `ended_at` or "Present" if null)
   - If `is_government`, show a small `GOV` badge in gray
   - If `revolving_door_flag`, show a `⚠ Revolving Door` badge in amber and display `revolving_door_explanation` below if it exists
   - Format dates as "Jan 2019" (month + year only), use `—` for missing dates

3. Add `<CareerHistory items={careerHistory} />` to the page in a logical position — after the AI profile section, before or after votes, wherever similar data sections are grouped.

**Type for the component:**
```ts
type CareerHistoryRow = {
  id: string;
  organization: string;
  role_title: string | null;
  started_at: string | null;
  ended_at: string | null;
  is_government: boolean;
  revolving_door_flag: boolean;
  revolving_door_explanation: string | null;
};
```

**Acceptance criteria:**
- Component renders on `/officials/[any-id]` without errors even when no career data exists
- Revolving door flag entries are visually distinct (amber)
- `pnpm build` passes clean

---

### TASK-06 — Promises section on official detail pages

**Status:** `READY`
**Risk:** Low — new component, no existing code modified except one import + JSX line
**Files to read first:**
- `apps/civitics/app/officials/[id]/page.tsx` (understand data fetch pattern — follow it exactly)
- `supabase/migrations/0001_initial_schema.sql` (search for `promise_status` and `promises`)

**Background:**
One of the platform's core features is holding officials accountable for their promises. The `promises` table exists and is populated by the pipeline. This section makes that data visible on official pages for the first time.

**promises table schema:**
```sql
id              UUID
official_id     UUID NOT NULL REFERENCES officials(id)
title           TEXT NOT NULL
description     TEXT
status          promise_status  -- 'made' | 'kept' | 'broken' | 'stalled' | 'partial'
made_at         DATE
deadline        DATE
resolved_at     DATE
source_url      TEXT
source_quote    TEXT
related_proposal_id UUID REFERENCES proposals(id)
metadata        JSONB
```

**What to build:**

1. Fetch promises in `apps/civitics/app/officials/[id]/page.tsx` alongside existing data:
   ```ts
   supabase
     .from("promises")
     .select("id, title, description, status, made_at, deadline, resolved_at, source_url, source_quote")
     .eq("official_id", id)
     .order("made_at", { ascending: false })
     .limit(10)
   ```

2. Create: `apps/civitics/app/officials/[id]/components/PromisesSection.tsx`
   - Server component — data passed as props
   - Props: `promises: PromiseRow[]`
   - Return null if `promises.length === 0`
   - Show a section heading "Promises" with a count badge
   - Each promise shows:
     - Title (bold)
     - Status badge with distinct colors:
       - `made` → gray ("Made")
       - `kept` → green ("Kept ✓")
       - `broken` → red ("Broken")
       - `stalled` → amber ("Stalled")
       - `partial` → orange ("Partial")
     - `made_at` date if present ("Made Jan 2022")
     - `deadline` date if present and status is `made` or `stalled` ("Due Mar 2024")
     - `source_quote` in a blockquote if present (truncate at 200 chars with "…")
     - A link to `source_url` labeled "Source →" if present
   - Summary row at the bottom: "X kept, Y broken, Z stalled" (only show counts > 0)

3. Add `<PromisesSection promises={promises} />` near the top of the main content, just below the basic info section — this is a flagship feature.

**Type:**
```ts
type PromiseRow = {
  id: string;
  title: string;
  description: string | null;
  status: 'made' | 'kept' | 'broken' | 'stalled' | 'partial';
  made_at: string | null;
  deadline: string | null;
  resolved_at: string | null;
  source_url: string | null;
  source_quote: string | null;
};
```

**Acceptance criteria:**
- Renders correctly when no promises exist (returns null, no empty state visible)
- All 5 status badges display correctly
- `pnpm build` passes clean

---

### TASK-07 — Position tracking widget on proposal detail pages

**Status:** `READY`
**Risk:** Low-medium — new component + small API route; existing civic_comments table already has `position` column
**Files to read first:**
- `apps/civitics/app/proposals/[id]/page.tsx` (understand layout)
- `apps/civitics/app/proposals/[id]/components/CivicComments.tsx` (pattern reference for client component + fetch)
- `apps/civitics/app/api/proposals/[id]/comments/route.ts` (pattern reference for API route)
- `supabase/migrations/0001_initial_schema.sql` (search for `civic_comments` — read the full table definition)

**Background:**
`civic_comments` has a `position` column (`TEXT CHECK (position IN ('support', 'oppose', 'neutral', 'question'))`). Position tracking shows citizens' stance on proposals without requiring a full comment. It's separate from the comment text — you can set a position without writing anything.

**What to build:**

1. API route: `apps/civitics/app/api/proposals/[id]/position/route.ts`
   - `GET`: returns aggregated position counts for a proposal:
     ```ts
     // Response shape:
     { support: number; oppose: number; neutral: number; question: number; total: number }
     ```
     Query: `civic_comments` grouped by `position` where `proposal_id = params.id` AND `position IS NOT NULL` AND `is_deleted = false`
     Use `createServerClient(cookies())` for GET.
   - `POST`: `{ position: 'support' | 'oppose' | 'neutral' | 'question' }`
     Requires auth (same pattern as comments/route.ts POST — call `supabase.auth.getUser()`, return 401 if no user).
     If user already has a row with a position for this proposal, UPDATE it. Otherwise INSERT.
     Use `createAdminClient()`. Remember: `export const dynamic = "force-dynamic";` on the file.

2. Component: `apps/civitics/app/proposals/[id]/components/PositionWidget.tsx`
   - `"use client"`
   - Props: `proposalId: string`
   - Fetches counts from GET on mount
   - Shows 4 buttons: Support / Oppose / Neutral / Question
   - Each button shows its count and a visual indicator (color):
     - Support → green (`bg-green-50 border-green-200 text-green-700`)
     - Oppose → red (`bg-red-50 border-red-200 text-red-700`)
     - Neutral → gray
     - Question → amber
   - Clicking a button calls POST with that position, then re-fetches counts
   - If POST returns 401, show "Sign in to record your position" message (same pattern as CivicComments)
   - Loading state: disabled buttons during fetch/post
   - Layout: horizontal row of 4 buttons, compact — this sits above the main comment form

3. Add `<PositionWidget proposalId={p.id} />` to `apps/civitics/app/proposals/[id]/page.tsx` just above `<CivicComments proposalId={p.id} />`.

**Grouping query for GET** (do this in JS after fetching, not a raw SQL GROUP BY — simpler for a Supabase client):
```ts
const { data } = await supabase
  .from("civic_comments")
  .select("position")
  .eq("proposal_id", params.id)
  .eq("is_deleted", false)
  .not("position", "is", null);

const counts = { support: 0, oppose: 0, neutral: 0, question: 0, total: 0 };
for (const row of data ?? []) {
  if (row.position in counts) counts[row.position as keyof typeof counts]++;
  counts.total++;
}
```

**Acceptance criteria:**
- 4 position buttons render on every proposal page
- Clicking one updates counts without page refresh
- 401 case handled gracefully
- `pnpm build` passes

---

### TASK-08 — Fix agency page: proposal counts use placeholder filter, not real agency ID

**Status:** `READY`
**Risk:** Medium — changes existing data query logic; read the file carefully before editing
**Files to read first:**
- `apps/civitics/app/agencies/[slug]/page.tsx` (read the FULL file — especially the data fetch section)
- `supabase/migrations/0001_initial_schema.sql` (search for `agencies` table definition to understand `id`, `slug`, `acronym` columns)

**Problem:**
In `apps/civitics/app/agencies/[slug]/page.tsx`, the proposal queries filter on `metadata->>agency_id` matching the URL slug string. This is labeled `// placeholder` in two places. The correct approach is to use the agency's actual `id` (UUID) for the join.

Looking at the file, the agency row is fetched first (`.eq("slug", slug)`) and stored in `agency`. Its `id` is available. The proposal and count queries should filter using `metadata->>agency_id` matching `agency.id` (the UUID string), not the slug.

**Fix:**
After the agency row is fetched, replace the slug-based proposal queries with `agency.id`-based ones. The `metadata->>agency_id` column stores the agency UUID as a string in JSONB.

Change both placeholder queries:
```ts
// Before:
.filter("metadata->>agency_id", "eq", slug)

// After (use the actual agency UUID):
.filter("metadata->>agency_id", "eq", agency.id)
```

There are 4 occurrences: the active rulemaking query, the recent closed rules query, the total proposal count query, and the open comment count query. Fix all 4.

**Important:** The fetch is currently structured as a `Promise.all` where agency is fetched alongside proposals. You'll need to restructure so the agency fetch happens first, and then the proposal queries use `agency.id`. If `notFound()` is called when agency is missing, the proposal queries should never run with a bad ID.

Look at the existing structure in the file to understand exactly how to refactor the two-step fetch. Don't over-engineer it — a simple sequential fetch (agency first, then proposals) is fine.

**Acceptance criteria:**
- No `// placeholder` comments remain in the file related to agency_id filtering
- The proposal counts on `/agencies/[slug]` reflect real data for that agency's UUID
- If the agency does not exist, `notFound()` is still called correctly
- `pnpm build` passes

---

### TASK-09 — Official detail page: add spending records section

**Status:** `READY`
**Risk:** Low — new component, data already fetched on the page
**Files to read first:**
- `apps/civitics/app/officials/[id]/page.tsx` (check if `spending_records` is already fetched — search for "spending" in the file)
- `supabase/migrations/0001_initial_schema.sql` (search for `spending_records`)

**Background:**
`spending_records` contains USASpending.gov contract/grant data. Showing it on official pages connects officials to the government money they control or award. This is high-value accountability data.

**spending_records schema:**
```sql
id                UUID
jurisdiction_id   UUID NOT NULL REFERENCES jurisdictions(id)
awarding_agency   TEXT NOT NULL
recipient_name    TEXT NOT NULL
award_type        TEXT   -- 'contract' | 'grant' | 'loan' | 'other'
amount_cents      BIGINT NOT NULL
award_date        DATE
description       TEXT
metadata          JSONB
```

**What to build:**

First check: does `apps/civitics/app/officials/[id]/page.tsx` already fetch spending records? Search the file for "spending". If it does, just add the display component. If it doesn't, add the fetch.

Fetch (add to the page's data fetch if not already present):
```ts
supabase
  .from("spending_records")
  .select("id, recipient_name, award_type, amount_cents, award_date, description, awarding_agency")
  .eq("jurisdiction_id", official.jurisdiction_id)  // spending tied to official's jurisdiction
  .order("amount_cents", { ascending: false })
  .limit(10)
```

Note: spending records are jurisdiction-level, not directly tied to an official's ID. Use `official.jurisdiction_id` as the filter. If `official.jurisdiction_id` is null, skip the query and return an empty array.

Create: `apps/civitics/app/officials/[id]/components/SpendingSection.tsx`
- Server component (no `"use client"`)
- Props: `items: SpendingRow[]`
- Return null if `items.length === 0`
- Section heading: "Government Spending" with total amount displayed
- Table with columns: Recipient | Type | Amount | Date
- Format amounts using the existing `formatMoney` helper (import from the parent page, or re-implement it inline if the import is awkward)
- Award type badge: contract = gray, grant = green, loan = amber, other = gray
- Link to `awarding_agency` is not needed — just display the text

**Type:**
```ts
type SpendingRow = {
  id: string;
  recipient_name: string;
  award_type: string | null;
  amount_cents: number;
  award_date: string | null;
  description: string | null;
  awarding_agency: string;
};
```

Add `<SpendingSection items={spendingRecords} />` near the bottom of the official detail page.

**Acceptance criteria:**
- Section is invisible when no spending data exists for the jurisdiction
- Money formatting matches the rest of the page (uses same `formatMoney` logic)
- `pnpm build` passes

---

### TASK-10 — Sunburst re-render bug: shape and showLabels settings don't apply without refetch

**Status:** `READY`
**Risk:** Medium — touches SunburstGraph component logic; read carefully
**Files to read first:**
- `packages/graph/src/SunburstGraph.tsx` (full file — understand data flow and render cycle)
- `packages/graph/src/components/GraphConfigPanel.tsx` (find the shape and showLabels settings)

**Background:**
`shape` (arc vs. pie) and `showLabels` are viz options stored in `vizOptions`. When these are changed in the settings panel, they should cause an immediate visual re-render of the existing data — they do not require a new API fetch. The bug is that changing these settings does NOT re-render the sunburst.

The likely cause: the D3 rendering code inside `SunburstGraph.tsx` runs in a `useEffect` that either (a) doesn't list `shape` and `showLabels` in its dependency array, or (b) lists them correctly but also has data-fetch logic that only runs when entity/group IDs change, and the two concerns are entangled in one effect.

**Fix:**
1. Read the file and identify where `shape` and `showLabels` are read from `vizOptions`.
2. Find the `useEffect` (or effects) responsible for D3 rendering.
3. If `shape` and `showLabels` are not in the render effect's dependency array, add them.
4. If the render effect is entangled with the data fetch (i.e., the same effect both fetches data AND renders D3), split it into two effects:
   - Effect 1: fetches data when `entityId`, `primaryGroup?.id`, `ring1`, `ring2`, etc. change
   - Effect 2: renders/re-renders D3 when `data` OR `shape` OR `showLabels` change
5. Do NOT add object dependencies to useEffect — use primitives (`primaryGroup?.id` not `primaryGroup`).

**Key check before splitting effects:** look at whether the D3 render reads directly from `data` state, or whether it re-fetches data. If it re-fetches, splitting effects is the fix. If it already reads from state and the re-render just doesn't fire, adding `shape` and `showLabels` to deps is the fix.

Leave a `// TODO(review): split confirmed — was one entangled effect` or similar comment so Claude knows which path was taken.

**Acceptance criteria:**
- Changing `shape` setting re-renders the sunburst immediately without a new API call
- Changing `showLabels` toggles labels immediately
- No infinite re-render loops (check browser console)
- `pnpm build` passes

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
