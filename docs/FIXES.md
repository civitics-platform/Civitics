# FIXES — Civitics Platform

Actionable improvement backlog. Every item has a priority, complexity, and enough context to hand to Qwen or Claude Code directly.

**Priority key:**
- 🔴 Critical — Bug that breaks or blocks real functionality
- 🟠 High — Meaningful product/UX gap, address soon
- 🟡 Medium — Worthwhile improvement, schedule when practical
- 🟢 Quick Win — Small effort, high visible impact (batch these)
- ⬜ Future — Phase 2+ or requires significant design/pipeline work

**Complexity key:** S = <2h · M = 2–8h · L = 1–3 days · XL = multi-day + planning

---

## STRATEGIC PILLARS
> Directional goals, not checkable tasks. Concrete sub-tasks are threaded throughout this doc. Phase 2+ strategy, architecture, and the Social App live in `docs/ROADMAP.md`.

---

## BUGS — Fix These First

- [x] 🔴 S — **Civic Initiatives: "Open for deliberation" returns "Initiative not found"** — fixed 2026-04-12: migrations 20260411020000–20260411100000 applied (`supabase migration up --local`); `advance/route.ts` patched to distinguish query errors from genuine 404s.
- [x] 🔴 S — **Civic Initiatives: Edit button expanded box too large** — fixed 2026-04-12 (TASK-14): InlineEditor repositioned to `absolute right-0 top-8 z-20` overlay; container div made `relative`. Reviewed; Qwen truncation repaired by Claude.
- [x] 🔴 M — **Graph: Nodes render UUID labels instead of entity names** — fixed 2026-04-12 (TASK-15): all 8 `.label` → `.name` accesses in `ForceGraph.tsx` updated to match V2 field contract. Clean.
- [x] 🔴 S — **Graph: Orphan nodes remain after connection is removed** — fixed 2026-04-12 (TASK-16): `useGraphData.ts` now computes `survivingEdges` before pruning orphan nodes in `setNodes`. Reviewed; Qwen truncation repaired by Claude.
- [x] 🟠 S — **Graph: Config settings dropdowns (Layout / Node Size / Color) show no active state** — fixed 2026-04-12 (TASK-13): `text-gray-900` added to `LabeledSelect` select className in `GraphConfigPanel.tsx`; native `<select>` was inheriting near-invisible `text-gray-500` from panel ancestors. Clean.
- [x] 🟠 M — **Officials: Elizabeth Warren and some senators missing from search** — confirmed NOT a code bug; Warren is `is_active = true` with correct `role_title` and `full_name` in DB; ILIKE `%warren%` query returns her. PHASE_GOALS entry was stale. Verified 2026-04-12.
- [x] 🟠 S — **DB types stale** — regenerated 2026-04-12 after sprint 9 migrations applied; `database.ts` now reflects all new columns. Note: on Windows PowerShell use `[System.IO.File]::WriteAllLines()` instead of `>` redirect to avoid UTF-16 corruption.

---

## GENERAL / CROSS-CUTTING

- [x] 🟠 M — **Mobile responsiveness audit** — fixed 2026-04-12: hamburger nav (NavBar component, all pages), Proposals filter flex-col on mobile, Graph panels auto-collapse at <768px, Official profile header flex-col on mobile, Initiatives inline navs replaced with shared NavBar
- [x] 🟠 M — **Accessibility (a11y) audit** — completed 2026-04-13: skip-to-content link in NavBar; aria-label on all nav landmarks; focus-visible rings on all interactive elements; aria-label + aria-pressed on filter pills; htmlFor/id on all proposal filter labels; main landmark + id="main-content" on officials/proposals/initiatives/home pages; aria-live search status region; combobox ARIA on GlobalSearch; role="switch" + aria-checked on graph toggles; aria-label on all graph sliders/selects; aria-hidden on decorative SVGs; aria-current on breadcrumb + active filters + pagination; aria-labelledby on featured section; pagination nav landmark
- [x] 🟠 M — **SEO / Open Graph metadata** — OG tags added 2026-04-13 (TASK-19); JSON-LD added 2026-04-16: `schema.org/Person` on Officials, `schema.org/Legislation` on Proposals
- [x] 🟡 M — **Consistent loading/skeleton states** — done 2026-04-17: all 4 main route `loading.tsx` files (officials, proposals, agencies, initiatives) have proper skeleton layouts matching the final page structure
- [x] 🟡 S — **Consistent empty states** — done 2026-04-13 (TASK-20): empty states on Officials, Proposals, Agencies list pages
- [x] 🟡 M — **404 and error pages** — done 2026-04-15 (TASK-24): `not-found.tsx` (branded 404, 4 quick-link cards) + `error.tsx` (error boundary, Try Again + Go Home)
- [x] 🟢 S — **Clickable links audit** — done 2026-04-17: agency chips in ProposalCard and proposal detail page now link to `/proposals?agency=…`; `href="#"` "Submit comment" on agency detail fixed to `/proposals/${rule.id}`; bill number and regulations.gov ID chips on agency detail now linked; agency acronym in search results now linked
- [x] 🟢 S — **Header/footer consistency** — done 2026-04-17: `Footer.tsx` component created and added to root layout (universal); NavBar added to proposals list, proposals detail, officials detail, dashboard, and profile pages; graph/embed and agencies/officials full-screen pages intentionally keep their specialized chrome

---

## HOMEPAGE

- [x] 🟢 S — **Add Initiatives link to main header nav** — done 2026-04-13 (TASK-17): Initiatives in NavBar NAV_ITEMS, routes to `/initiatives`
- [ ] 🟡 M — **Civic Initiatives featured section** — add a section to the homepage (alongside Officials / Proposals) showing 3–4 trending or recently active initiatives

---

## OFFICIALS

- [ ] 🟢 S — **Show federal vs. state indicator on cards and profile** — source field (`congress_gov` vs `openstates`) can drive this; add a subtle badge ("Federal" / "State") to the official card and detail header
- [ ] 🟡 M — **Votes / Donors / Raised as tabs on profile page** — currently stacked sections; tabbing would reduce scroll and make the page feel less overwhelming
- [ ] 🟡 M — **Individual votes: add description and expand on click** — each vote row should show the bill title/summary and expand to show more context (vote question, bill summary, related proposals link); pull from `metadata->>'vote_question'` and linked proposal AI summary
- [ ] 🟢 S — **"View full profile" button prominence** — make it a more visible primary CTA (larger, colored button vs. current subdued link)
- [ ] 🟡 L — **Current term duration + upcoming election status** — show when the official's current term ends, and if there's a known next election, show the date and any known opponents; requires data pipeline addition (Ballotpedia or OpenStates elections data)
- [ ] 🟡 S — **Improve filtering options** — add chamber filter (House / Senate), state filter, and issue area filter (already tagged via entity_tags) to the officials list page
- [ ] 🟢 S — **Share button on official profile** — copy-to-clipboard link or native share API

---

## PROPOSALS

- [x] 🟡 M — **Improve "6 closing soonest" header section** — replaced 2026-04-16 with 3-tab `FeaturedSection.tsx` client component: "Closing Soon" (open_comment ordered by deadline) / "Congressional Bills" (type=bill, newest first) / "Most Viewed" (page_views count join); tab state is client-side, data all server-fetched
- [x] 🟡 M — **Make congressional bills more prominent** — addressed 2026-04-16: "Congressional Bills" is now a dedicated tab in the featured section on the proposals list page
- [ ] 🟡 M — **Better filtering** — add source filter (congressional bill vs. regulation), status filter, topic/issue area tag filter (entity_tags), date range filter, sort by dropdown
- [ ] 🟢 S — **Share button on proposal cards and detail page**
- [ ] 🟢 S - **Add  "Trending", "Most Commented", "New" tabs** - add to FeaturedSection, pending data pipelines and comments

---

## PROPOSALS [ID]

- [ ] 🟡 M — **Reduce Official Comments section friction** — "Community Comments" vs "Official Comments" is confusing; consider collapsing Official Comments into a prominent button that opens a modal/drawer on click - making it clear the comment is being submitted to the government; keeps focus on community discussion without losing the official record

---

## CIVIC INITIATIVES

- [ ] 🟠 S — **Add Initiatives to header nav** — currently the only path is via user profile; add `/initiatives` link to main nav (ties to Homepage bug above)
- [ ] 🟡 M — **Filters on initiatives list** — stage tabs (Draft / Deliberation / Voting / Implemented), scope filter (local / state / federal), tag/topic filter, sort by options; necessary once more initiatives exist
- [ ] 🟡 M — **Argument board — Sprint 3** — structured For/Against arguments, argument voting, AI debate summary (already scoped in pending work)
- [ ] 🟡 M — **"Post a problem" pathway** — allow a user to submit just a problem statement (no solution yet) to begin community collaboration; different form from full initiative; could be a separate `problems` table or an initiative with `stage = 'problem'`
- [ ] 🟢 S — **Draft → argument creation decision** — decide: should a draft initiative allow For/Against arguments before it moves to deliberation? Recommendation: no (arguments should require deliberation stage to prevent premature polarization); add a tooltip or lock indicator explaining why

---

## AGENCIES

- [x] 🟡 M — **Improve agency card design** — completed 2026-04-16/17: sector tags inferred from name/acronym (15-rule regex table), graph CTA link, website link in footer strip, flex-column layout, sector filter dropdown added. Employee count/budget/year requires USASpending pipeline (⬜ future).
- [x] 🟡 M — **Agency visual / hierarchy view** — implemented 2026-04-17: `AgencyActivityChart.tsx` CSS bar chart showing top 12 agencies by proposal count, rendered above the grid on `/agencies`. Full hierarchy graph (⬜ XL) deferred — `parent_agency_id` data not yet populated.
- [x] 🟡 M — **Agency Officials search** — ability to search/filter officials within an agency context; only ~10 official→agency connections in entity_connections currently; revisit when data is richer
- [x] 🟡 M — **Inline preview on card click** — implemented 2026-04-17: `AgencySlideOver` panel in `AgenciesList.tsx`; card click opens a right-side drawer with stats, description, quick links, and "View full agency profile" CTA; Escape key + backdrop click to close; focus-managed.
- [x] 🟡 M — **White House featured card** — implemented 2026-04-17: migration `20260417000000_insert_whitehouse_eop.sql` inserts EOP as a featured agency; `WhiteHouseFeaturedCard` component pinned above the grid with gradient border styling; hidden when filters are active.
- [ ] ⬜ XL — **Agency hierarchy graph** — visualize parent/sub-agency relationships as a graph or org-chart; requires hierarchy data pipeline

---

## GRAPH

- [ ] 🟠 L — **USER node** — show the signed-in user as a node; connect to their district's representatives; visually indicate alignment score (votes/priorities match); requires auth integration + per-user graph state
- [x] 🟠 M — **Node right-click / options menu** — implemented 2026-04-16: `NodeContextMenu.tsx` with expand, pin/unpin (D3 fx/fy), hide (local hiddenIds), view profile/proposal, copy link; positional with container-bound flip logic
- [ ] 🟡 M — **Procedural vote filter in graph panel** — toggle to hide/show procedural votes in the connection graph (the toggle exists in FocusTree; verify it's also surfaced in the main graph filter UI and working end-to-end)
- [x] 🟢 S — **Graph: share button / copy link** — implemented 2026-04-16: "Link" button added to `GraphConfigPanel.tsx` footer alongside "Save preset"; copies `window.location.href` to clipboard with 2s "Copied ✓" flash state

---

## DASHBOARD

- [ ] 🟡 M — **Browsable sitemap section** — a visual grid of all major routes with descriptions; doubles as a discovery tool for new users and documents the platform for open-source contributors
- [ ] ⬜ L — **Browsing path visualization** — aggregate `page_views` data into a Sankey or flow chart showing common user journeys; admin-only; useful for UX decisions

---

## INFRASTRUCTURE & PERFORMANCE

- [x] 🟠 M — **Rate limiting on public API routes** — implemented 2026-04-16 in `middleware.ts`: sliding-window in-memory limiter (30/min search, 5/min graph/narrative, 60/min graph); 429 + Retry-After; Upstash upgrade path documented
- [ ] 🟡 M — **Core Web Vitals / performance budget** — set up Vercel Analytics alerts for LCP > 2.5s and CLS > 0.1; identify and fix the worst offenders (likely graph page initial load and Officials list)
- [ ] 🟡 M — **API response caching headers** — add `Cache-Control` headers to read-only API routes (officials list, proposals list, agencies); edge-cacheable routes can dramatically reduce DB load
- [ ] 🟡 M — **Vote backfill completion** — 51k/227k vote connections live; full backfill pending IO recovery; complete this before Phase 1 closes
- [ ] ⬜ L — **Connection pooling audit** — Supabase uses PgBouncer; verify all server-side Supabase clients are using the pooled connection string for non-transaction workloads

---

## COMMUNITY & AUTH

- [ ] 🟠 L — **Community commenting UI** — `civic_comments` table exists; build the comment thread component for Officials and Proposals detail pages; Phase 1 remaining task
- [ ] 🟡 M — **Position tracking on proposals** — allow users to mark Support / Oppose / Neutral on proposals; store in `civic_comments` or a new `positions` table; show aggregate position bar on proposal cards
- [ ] 🟡 M — **Follow officials and agencies** — "Follow" button → user receives updates when official votes, when agency publishes new proposals; requires notification system
- [ ] 🟡 M — **Email notifications** — trigger on: new proposal in followed agency, followed official votes, initiative status change; use Resend (already in stack)
- [ ] ⬜ M — **Content moderation tools** — before comments go live, need a basic flagging system and admin review queue; can be simple (flag button → admin dashboard queue)

---

## DOCUMENTATION (Open Source Readiness)

- [ ] 🟡 M — **Visual architecture overview** — a single diagram (Mermaid or Figma export) showing the monorepo packages, data flow, and key tables; embed in root README
- [ ] 🟡 M — **API documentation** — document all public `/api/*` routes with request/response shapes; required for institutional API partners; could use a simple `API.md` or OpenAPI spec
- [ ] 🟡 S — **Contributing guide** — `CONTRIBUTING.md` with setup steps, branch conventions, PR process
- [ ] 🟢 S — **Public roadmap** — a simplified, public-facing version of PHASE_GOALS.md for the homepage or GitHub; builds trust with early users and grant reviewers

---

## COMPLETED (archive, don't delete — useful reference)

- [x] Viz type active state indicator (ForceGraph, Sunburst, Chord, Treemap) — fixed 2026-04-06
- [x] Procedural vote toggle in FocusTree — added 2026-04-06, gated by graphMeta.hasVotes
- [x] Self-configuring settings (count labels, auto-switch dataMode) — completed 2026-04-06
- [x] Efficiency audit — all Supabase calls wrapped in withDbTimeout — completed 2026-04-06
- [x] Civic Initiatives Sprint 2 (versions, upvotes, list page, detail page, create form) — completed 2026-04-11
