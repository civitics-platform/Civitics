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

**Section rules:**
- Active sections — `[x]` items are fine (checked by `fixes:sync`). Periodically move completed clusters to `## COMPLETED` for readability.
- `## COMPLETED` — **`[x]` only**. A `[ ]` item here means it was moved before it shipped — move it back to the active section.
- Deferred / blocked items always stay in active sections as `[ ]`, never in COMPLETED. If a deferred item was closed by a broad "closeout" commit, add a `reopen` line to `done.log` and uncheck it.

---

## STRATEGIC PILLARS
> Directional goals, not checkable tasks. Concrete sub-tasks are threaded throughout this doc. Phase 2+ strategy, architecture, and the Social App live in `docs/ROADMAP.md`.

---

## BUGS — Fix These First

- [x] 🔴 S — **Dashboard crashes with "Event handlers cannot be passed to Client Component props"** — `BrowsingFlowsSection` is a Server Component but attached an `onClick` to an `<a>` for template paths; template rows now render as `<span aria-disabled>` instead <!--id:FIX-062-->
- [x] 🔴 S — **NavBar missing on most pages** — was added per-page in FIX-015 but not to proposals, agencies, graph, search, or officials list; moved to root layout (hidden on `/graph/*` and `/auth/*`) so it can't silently drop again <!--id:FIX-063-->
- [x] 🔴 S — **Filter procedural votes and case names out of enrichment queue** — ~489 contaminated `proposals` rows (169 procedural vote questions matching `^on `, 320 court case names matching ` v. `) got staged by `seed-backlog.ts`; enriching them would write garbage into `entity_tags` and `ai_summary_cache`. Delete contaminated queue rows + add `not.ilike` guards to the seeder so a re-seed can't reintroduce them. Root cause (contamination of `proposals` itself) is FIX-066. <!--id:FIX-065-->
- [x] 🟠 M — **Investigate: procedural votes and court case names are landing in `proposals` table** — identify source pipeline, decide quarantine vs delete <!--id:FIX-066-->
  - ~169 titles matching `^on ` (procedural vote questions — see CLAUDE.md §votes) — likely leaking from the votes ingester into `proposals`
  - ~320 titles matching ` v. ` (court case names) — likely a SCOTUS/courts docket pipeline dumping into `proposals`
  - Both groups have `summary_plain = NULL`, `metadata->>'agency_id' = NULL`
  - By `type`: most of the contamination sits in `type = 'other'`
  - **Shadow schema note (20260421):** new `shadow.proposals` + `bill_details` / `case_details` architecture prevents future contamination; `vote_question` is now a first-class column on `votes`. Action here is limited to cleaning up / quarantining bad rows already in `public.proposals`.
  - Do NOT delete from `proposals` without agreeing the destination — these may be referenced by `votes.metadata->>'proposal_id'` or similar FKs
- [x] 🟠 L — **Data integrity audit — scaffolding + first run against prod** <!--id:FIX-067-->
- [x] 🟠 M — **Sitting U.S. President not in `officials` table** — audit 2026-04-19 found 0 active officials with `role_title ILIKE '%president%' AND role_title NOT ILIKE '%vice%'`. EOP agency exists (migration 20260417) but no person row. <!--id:FIX-068-->
- [x] 🟠 M — **Sitting U.S. Vice President not in `officials` table** — audit 2026-04-19 found 0 active officials with `role_title ILIKE '%vice president%'`. <!--id:FIX-069-->
- [x] 🟠 S — **Federal House count is 438 (expected 441)** — 3 representatives missing among federal officials with `source_ids ? 'congress_gov'`. Check ingester completeness vs. current vacancies. See docs/audits/2026-04-19.md. <!--id:FIX-070-->
- [x] 🟠 M — **All 100 federal senators have NULL `metadata->>'state'`** — per-state breakdown collapses to a single null bucket of 100. Senators are correctly counted but state attribution is missing, breaking any state-scoped query. Fix the congress.gov ingester to populate `metadata.state` (or `state_abbr`). <!--id:FIX-071-->
- [x] 🟠 L — **Procedural-vote / court-case contamination in `proposals` grew to 827** — was ~489 at FIX-065/066 baseline. FIX-066 root-cause work has not landed; meanwhile new ingester runs continue to add procedural rows. See docs/audits/2026-04-19.md. **Shadow schema (20260421) eliminates the new-data contamination path; remaining work is clean-up of existing bad rows in `public.proposals`** — may be low-priority once shadow schema is the live read path. <!--id:FIX-072-->
- [x] 🟠 S — **7053 votes have `vote = 'not_voting'` instead of `'not voting'`** — invalid enum value (snake_case vs space-separated form documented in CLAUDE.md §votes table). One UPDATE replaces the underscored form with the canonical one. <!--id:FIX-073-->

---

## POST-CUTOVER (Supabase Pro, shadow→public promoted 2026-04-22)

The shadow→public promotion migration (`20260422000000_promote_shadow_to_public.sql`) intentionally dropped 11 RPCs and a materialized view that referenced the legacy `financial_relationships.donor_name` / `.official_id` / `.donor_id` columns (replaced by the polymorphic `from_entity_id` / `to_entity_id` shape). App paths that call these will 500 until the RPCs are reimplemented.

- [x] 🟠 L — **Rewrite graph chord + treemap RPCs against polymorphic financial_relationships** — restore `chord_industry_flows()`, `treemap_officials_by_donations(integer, text, text, text)`, `get_group_sector_totals(uuid[])`, `get_crossgroup_sector_totals(uuid[], uuid[])`, `get_group_connections(uuid[], integer)`, `get_connection_counts(uuid[])`. All read donor flows; replace `donor_name`/`official_id` joins with `financial_entities` + polymorphic FK joins. Called from `/api/graph/chord`, `/api/graph/snapshot`, and several dashboard panels. <!--id:FIX-097-->
- [x] 🟠 M — **Rewrite officials-breakdown + donor RPCs against polymorphic schema** — restore `get_officials_breakdown()`, `get_official_donors(uuid)`, `get_pac_donations_by_party()`, `get_officials_by_filter(text, text, text)`. Dashboard Transparency + Operations panels rely on these; the officials-detail donor tab is broken. <!--id:FIX-098-->
- [x] 🟠 M — **Rewrite search_graph_entities against post-promotion schema** — search currently fails (FIX-097 self-test "entity_search_finds_warren"). New shape should query officials + agencies + financial_entities in one pass, trimmed to the columns the graph actually needs. <!--id:FIX-099-->
- [x] 🟠 L — **Implement rebuild_entity_connections derivation rules** — Stage 1B function still a stub returning empty set. Derive: donation (from financial_relationships), vote_yes/vote_no (from votes), co_sponsorship, appointment (career_history), oversight, holds_position, gift_received, contract_award, lobbying. Called by nightly-sync after source pipelines; the 0 entity_connections count in `/api/claude/status` is this. <!--id:FIX-100-->
- [ ] 🟠 L — **Re-run deferred pipelines against Pro** — Option C shipped only congress bills+votes. Still to run against Pro: FEC bulk (donor flows), USASpending, Regulations.gov, OpenStates (state legislators + state bills), CourtListener, Legistar (4 metros), tag-rules, ai-summaries, tag-ai. Each needs its shadow→public writer rewrite similar to the one done for congress. <!--id:FIX-101-->
- [ ] 🟡 M — **Clean up 307 orphan proposals from early broken Pro ingest runs** — duplicates of real bills, created before the trigger-body fix (migration 20260422000001). Their sibling proposals have the bill_details row and hold the votes; these orphans clutter counts. Safe to `DELETE FROM proposals WHERE id IN (…)` after confirming zero vote FKs. <!--id:FIX-102-->
- [x] 🟡 S — **Fix `a.rpc(...).catch is not a function` in officials_breakdown handler** — `/api/claude/status` reports `officials_breakdown: {error, partial: true}`. The handler is chaining `.catch()` onto a supabase-js `rpc()` call, which returns a thenable-with-error-shape, not a Promise. Replace with a try/await. <!--id:FIX-103-->
- [x] 🟡 S — **Recreate proposal_trending_24h materialized view + refresh_proposal_trending()** — both were dropped in the promotion migration; recreate against public.proposals. Currently nothing on the homepage "trending" path. <!--id:FIX-104-->
- [x] 🟡 S — **Default /proposals landing filter to "all"** — "open" requires status='open_comment' AND metadata->>comment_period_end > now(). Post-cutover, 989 congress-bill proposals have status='introduced' with no comment period, so the "open" default landed users on an empty page. Users can still pick "Open for comment" explicitly. <!--id:FIX-105-->
- [ ] 🟠 M — **Add 6-digit OTP option alongside magic link in SignInForm** — today SignInForm only offers magic link (`signInWithOtp` with `emailRedirectTo`) + OAuth. Users on mobile / cross-device flows often can't click the link in the email they receive. Add a second path: call `signInWithOtp` without `emailRedirectTo` (Supabase sends the 6-digit code instead of a link), then show a 6-input form that calls `supabase.auth.verifyOtp({ email, token, type: 'email' })`. Both paths use the same Supabase template — one "Email OTP" template produces either a magicLink variable or a Token variable depending on how it was requested. UX: primary button "Email me a sign-in link", secondary link "Prefer a 6-digit code?" that swaps the form. <!--id:FIX-106-->

---

## GENERAL / CROSS-CUTTING


---

## HOMEPAGE


---

## OFFICIALS

- [ ] ⬜ L — **Current term duration + upcoming election status** — requires Ballotpedia/OpenStates elections data pipeline; Phase 2 <!--id:FIX-022-->

---

## PROPOSALS

- [ ] ⬜ S — **Add "Trending", "Most Commented", "New" tabs** — add to FeaturedSection; requires trending-score pipeline and comments data <!--id:FIX-029-->

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

- [ ] 🟡 M — **Reduce stat cards from 6 to 4** — Officials / Open Proposals / Votes / Donation Flow; bundle into `<StatsRow>` <!--id:FIX-089-->
- [ ] 🟠 L — **Add sparklines to stat cards** — build `/api/stats/trends` returning last 30 days of daily counts per metric <!--id:FIX-090-->
- [ ] 🟡 M — **Parse FIXES.md into per-phase task lists with real done state** — reads `docs/done.log`; replaces hard-coded PHASE1_TASKS <!--id:FIX-095-->

---

## INFRASTRUCTURE & PERFORMANCE

- [x] 🟡 M — **Core Web Vitals / performance budget** — set up Vercel Analytics alerts for LCP > 2.5s and CLS > 0.1; identify and fix the worst offenders (likely graph page initial load and Officials list) <!--id:FIX-049-->
- [x] 🟡 M — **API response caching headers** — add `Cache-Control` headers to read-only API routes (officials list, proposals list, agencies); edge-cacheable routes can dramatically reduce DB load <!--id:FIX-050-->
- [ ] 🟡 M — **Vote backfill completion** — 51k/227k vote connections live; full backfill pending IO recovery; complete this before Phase 1 closes <!--id:FIX-051-->
- [x] ⬜ L — **Connection pooling audit** — Supabase uses PgBouncer; verify all server-side Supabase clients are using the pooled connection string for non-transaction workloads <!--id:FIX-052-->
- [x] 🟠 L — **Enrichment queue + admin endpoints** — shifts AI tag/summary work off API, routine-ready <!--id:FIX-064-->
- [ ] 🟠 L — **Split /api/claude/status into core + quality** — `/core` (meta, db, pipelines, ai_costs, activity) at 60s; `/quality` (quality, self_tests, chord) at 15min; reduces Warren search + chord RPC from every 60s to every 15min <!--id:FIX-082-->

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

#### Dashboard Redesign — Phase A: Cleanup

- [x] 🟢 S — **Delete dead dashboard files** — `PipelineOpsSection.tsx`, `BudgetControlForm.tsx`, `DashboardStatsSection.tsx`, `DashboardAutoRefresh.tsx` (~970 lines of zombie code; confirmed zero importers) <!--id:FIX-074-->
- [x] 🟢 S — **Fix "AI Summaries X" label** — remove trailing X from stat card label in `StatsSection` <!--id:FIX-075-->
- [x] 🟢 S — **Fix "Closes in 0h" countdown** — `formatCountdown` shows 0h when <1h remains; add minutes fallback <!--id:FIX-076-->
- [x] 🟢 S — **Replace hard-coded "$1.75B" in PlatformCostsSection footer** — read from `chord.total_flow_usd` passed as prop <!--id:FIX-077-->
- [x] 🟢 S — **Delete CommunityComputeSection** — Phase 4 placeholder that always renders $0/$0; misleads visitors <!--id:FIX-078-->

#### Dashboard Redesign — Phase B: Efficiency

- [x] 🟡 M — **Fix triple-fire in useDashboardData** — visibility handler + interval dedupe; on mount fetchData fires once then interval takes over; visibility change only fires on actual tab switch <!--id:FIX-079-->
- [x] 🟡 M — **Drop server-side duplicate queries in page.tsx** — remove `getActivity`, `getBrowsingFlows`, `getOfficialsBreakdown`; client reads all from `/api/claude/status` <!--id:FIX-080-->
- [x] 🟡 M — **Gate ModerationSection behind admin check** — `useSession()` check client-side; skip the fetch for non-admins <!--id:FIX-081-->

#### Dashboard Redesign — Phase C: IA + Tabs

- [x] 🟠 M — **Add TabBar to dashboard** — URL-synced `?tab=transparency|operations`; default transparency; browser back/forward works <!--id:FIX-083-->
- [x] 🟠 M — **Extract TransparencyTab + OperationsTab from DashboardClient** — reorganize sections per IA spec <!--id:FIX-084-->
- [x] 🟠 M — **Move ops content into Operations tab** — browsing flows, moderation, self-tests, pipelines, quality, costs, dev progress move to Operations <!--id:FIX-085-->
- [x] 🟢 S — **Delete amber receipt banner; append to PageHeader description** — "This page is our receipt." appended to description prop <!--id:FIX-086-->

#### Dashboard Redesign — Phase D: Visual Polish

- [x] 🟢 S — **Add Lucide icon support to SectionHeader** — accept `icon: React.ReactNode`; keep string emoji as fallback <!--id:FIX-087-->
- [x] 🟢 S — **Replace dashboard emoji with Lucide icons** — per mapping in spec §3.2 <!--id:FIX-088-->
- [x] 🟢 S — **Swap shadow for border-only on SectionCard; swap red→rose, yellow→amber across dashboard** <!--id:FIX-091-->
- [x] 🟢 S — **Move admin refresh button into page header; delete floating bottom-right variant** <!--id:FIX-092-->

#### Dashboard Redesign — Phase E: Data-Drive Dev Progress

- [x] 🟡 M — **Add /api/phases route** — reads `docs/PHASE_GOALS.md` at runtime; returns `{ phase, label, pct, done }[]`; replaces hard-coded PHASES array <!--id:FIX-094-->
- [x] 🟢 S — **Drop non-engineering tasks from tracker** — delete "500 beta users" and "Grant applications submitted" items <!--id:FIX-096-->

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
