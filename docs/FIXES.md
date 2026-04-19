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

---

## STRATEGIC PILLARS
> Directional goals, not checkable tasks. Concrete sub-tasks are threaded throughout this doc. Phase 2+ strategy, architecture, and the Social App live in `docs/ROADMAP.md`.

---

## BUGS — Fix These First

- [x] 🔴 S — **Dashboard crashes with "Event handlers cannot be passed to Client Component props"** — `BrowsingFlowsSection` is a Server Component but attached an `onClick` to an `<a>` for template paths; template rows now render as `<span aria-disabled>` instead <!--id:FIX-062-->
- [x] 🔴 S — **NavBar missing on most pages** — was added per-page in FIX-015 but not to proposals, agencies, graph, search, or officials list; moved to root layout (hidden on `/graph/*` and `/auth/*`) so it can't silently drop again <!--id:FIX-063-->

---

## GENERAL / CROSS-CUTTING


---

## HOMEPAGE


---

## OFFICIALS

- [ ] 🟡 L — **Current term duration + upcoming election status** — requires Ballotpedia/OpenStates elections data pipeline; deferred to Phase 2 <!--id:FIX-022-->

---

## PROPOSALS

- [ ] 🟢 S — **Add "Trending", "Most Commented", "New" tabs** — add to FeaturedSection, pending data pipelines and comments <!--id:FIX-029-->

---

## PROPOSALS [ID]


---

## CIVIC INITIATIVES


---

## AGENCIES

- [ ] ⬜ XL — **Agency hierarchy graph** — visualize parent/sub-agency relationships as a graph or org-chart; requires hierarchy data pipeline <!--id:FIX-041-->

---

## GRAPH

- [ ] 🟠 L — **USER node** — show the signed-in user as a node; connect to their district's representatives; visually indicate alignment score (votes/priorities match). **Blocked by data pipeline:** federal officials (US Senators / US Reps) have empty `metadata` and blank `district_name`; state is only encoded inside `source_ids->>'fec_candidate_id'` (positions 2–3). Also requires the Phase 2 `user_preferences` table (CLAUDE.md: "not yet created") for `home_state` / `home_district` / `district_jurisdiction_id`. Prereqs: (a) populate `officials.metadata.state_abbr` for federal reps via FEC ID parsing or a dedicated column; (b) create `user_preferences`; (c) profile editor UI; (d) graph injection hook; (e) alignment-score computation against `civic_comments.position` × `votes.vote`. <!--id:FIX-042-->
- [x] 🟡 M — **Procedural vote filter in graph panel** — toggle to hide/show procedural votes in the connection graph (the toggle exists in FocusTree; verify it's also surfaced in the main graph filter UI and working end-to-end) <!--id:FIX-044-->

---

## DASHBOARD


---

## INFRASTRUCTURE & PERFORMANCE

- [ ] 🟡 M — **Core Web Vitals / performance budget** — set up Vercel Analytics alerts for LCP > 2.5s and CLS > 0.1; identify and fix the worst offenders (likely graph page initial load and Officials list) <!--id:FIX-049-->
- [ ] 🟡 M — **API response caching headers** — add `Cache-Control` headers to read-only API routes (officials list, proposals list, agencies); edge-cacheable routes can dramatically reduce DB load <!--id:FIX-050-->
- [ ] 🟡 M — **Vote backfill completion** — 51k/227k vote connections live; full backfill pending IO recovery; complete this before Phase 1 closes <!--id:FIX-051-->
- [ ] ⬜ L — **Connection pooling audit** — Supabase uses PgBouncer; verify all server-side Supabase clients are using the pooled connection string for non-transaction workloads <!--id:FIX-052-->

---

## COMMUNITY & AUTH

- [x] 🟡 M — **Follow officials and agencies** — done 2026-04-18: migration `20260418200000_community_auth.sql` adds `user_follows`; `FollowButton` on officials & agencies detail pages; `/api/follows` GET/POST/DELETE; in-app `NotificationsBell` in NavBar; `/api/cron/notify-followers` fans out notifications every 6h <!--id:FIX-055-->
- [x] 🟡 M — **Email notifications** — done 2026-04-18: Resend REST helper at `src/lib/email.ts` (no SDK dep); `notifyFollowers()` fan-out emails when `email_enabled`; `/dashboard/notifications` UI toggles per-follow; triggers wired for followed official votes and new proposals in followed agencies. Requires `RESEND_API_KEY` + `RESEND_FROM` env vars <!--id:FIX-056-->
- [x] ⬜ M — **Content moderation tools** — done 2026-04-18: `content_flags` table; `FlagButton` component on civic + official community comments; `/api/moderation/flag`; admin review queue (`ModerationSection`) on dashboard with dismiss/delete actions backed by `/api/admin/moderation` <!--id:FIX-057-->

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

### GRAPH

- [x] 🟠 M — **Node right-click / options menu** — implemented 2026-04-16: `NodeContextMenu.tsx` with expand, pin/unpin (D3 fx/fy), hide (local hiddenIds), view profile/proposal, copy link; positional with container-bound flip logic <!--id:FIX-043-->
- [x] 🟢 S — **Graph: share button / copy link** — implemented 2026-04-16: "Link" button added to `GraphConfigPanel.tsx` footer; copies `window.location.href` to clipboard with 2s "Copied ✓" flash state <!--id:FIX-045-->

### DASHBOARD

- [x] 🟡 M — **Browsable sitemap section** — done 2026-04-18: `SitemapSection.tsx` renders a 3-column grid of major routes (Home, Officials, Proposals, Agencies, Initiatives, Graph, Search, Dashboard, Profile, Post a Problem) with icon, title, `href` chip, and one-line description; grouped with BrowsingFlowsSection on dashboard <!--id:FIX-046-->
- [x] ⬜ L — **Browsing path visualization** — done 2026-04-18: migration `20260418100000_pv_path_transitions.sql` adds `normalize_pv_path()`, `get_pv_top_transitions()`, `get_pv_entry_pages()` (aggregate-only, min-session threshold to prevent re-identification). Made public on the transparency dashboard via `BrowsingFlowsSection.tsx` — shows entry pages and top "next step" transitions with horizontal bar weights. Privacy model documented inline. Requires `supabase migration up --local` <!--id:FIX-047-->

### INFRASTRUCTURE & PERFORMANCE

- [x] 🟠 M — **Rate limiting on public API routes** — implemented 2026-04-16 in `middleware.ts`: sliding-window in-memory limiter (30/min search, 5/min graph/narrative, 60/min graph); 429 + Retry-After; Upstash upgrade path documented <!--id:FIX-048-->

### COMMUNITY & AUTH

- [x] 🟠 L — **Community commenting UI** — done: `CivicComments.tsx` wired into `proposals/[id]/page.tsx` (post + list with relative-time formatting, 2000-char limit, requires-auth prompt); `OfficialComments.tsx` wired into officials detail page (migration `20260415223406_official_community_comments.sql`); `ArgumentBoard.tsx` on initiative pages. Phase 1 commenting complete. <!--id:FIX-053-->
- [x] 🟡 M — **Position tracking on proposals** — done: `PositionWidget.tsx` on `proposals/[id]/page.tsx` with Support / Oppose / Neutral / Question buttons + aggregate counts via `/api/proposals/[id]/position`; positions persist per-user (requires auth) <!--id:FIX-054-->

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
