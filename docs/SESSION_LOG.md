# Session Log

---

## 2026-04-16 (session 2)

**Done:**
- Graph node right-click context menu (`NodeContextMenu.tsx` + `ForceGraph.tsx`):
  - Right-click any node → positional menu near cursor with: Expand, Pin/Unpin, View profile/proposal, Copy link, Hide
  - Pin: toggles `fx`/`fy` on D3 simulation node to fix position; `📍` icon when pinned
  - Hide: adds node to local `hiddenIds` Set; filtered before simulation builds; resets when graph data changes
  - Copy link: copies `/officials/{id}`, `/proposals/{id}`, or `/graph?entity={id}` to clipboard
  - Menu flips to stay inside container bounds; closes on Escape or backdrop click
  - Container ref wired for precise flip calculations
- Agency card improvements (`AgenciesList.tsx`):
  - Smart sector tags inferred from agency name/acronym via 15-rule regex table (Environment, Defense, Health, Finance, Transportation, Energy, Education, Labor, Agriculture, Justice, Housing, Immigration, Space, Commerce, Communications); max 2 tags per card
  - Footer action strip: "Graph" link → `/graph?entity={id}`; "Website" link → external if `website_url` present
  - Cards are now flex-column so footer always aligns at bottom
  - `toLocaleString()` formatting on proposal counts

**Up next:**
- Quick wins: Header/footer consistency audit (🟢 S)
- Graph: share button / copy link in graph panel (🟢 S)
- Proposals: "6 closing soonest" header improvements (🟡 M)

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
