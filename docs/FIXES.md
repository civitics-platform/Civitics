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

- [ ] 🟠 M — **Mobile responsiveness audit** — do a full pass across all pages on 375px and 768px viewports; Officials cards, Graph panel, and Proposals filters are likely pain points
- [ ] 🟠 M — **Accessibility (a11y) audit** — keyboard navigation, ARIA labels, color contrast on dark graph theme; required for grant applications (Knight, Mozilla expect this)
- [ ] 🟠 M — **SEO / Open Graph metadata** — add `<meta og:*>` and Twitter card tags to Officials, Proposals, and Initiatives detail pages; add JSON-LD structured data for officials and proposals
- [ ] 🟡 M — **Consistent loading/skeleton states** — audit all data-fetching pages; replace any raw spinners with skeleton cards that match the final layout
- [ ] 🟡 S — **Consistent empty states** — every list page needs a clear, helpful "no results" message with suggested actions (clear filters, try search)
- [ ] 🟡 M — **404 and error pages** — design a helpful 404 with search + quick links to Officials/Proposals/Agencies; custom 500 page with status link
- [ ] 🟢 S — **Clickable links audit** — do a pass across all pages: every official name, proposal title, agency name, and tag should be clickable and route correctly; flag any dead text links
- [ ] 🟢 S — **Header/footer consistency** — audit nav links and footer across all pages; Initiatives link is missing from header (see Homepage section); ensure footer links are consistent

---

## HOMEPAGE

- [ ] 🟢 S — **Add Initiatives link to main header nav** — route to `/initiatives`
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

- [ ] 🟡 M — **Improve "6 closing soonest" header section** — replace or augment with tabs: "Closing Soon" / "Trending" (by comment count) / "Most Commented"; this section is prime real estate
- [ ] 🟡 M — **Make congressional bills more prominent** — separate or visually elevate `congress.gov`-sourced proposals (bills) from regulatory proposals; these are likely the biggest user draw; consider a dedicated "Active Bills" tab or featured section
- [ ] 🟡 M — **Better filtering** — add source filter (congressional bill vs. regulation), status filter, topic/issue area tag filter (entity_tags), date range filter
- [ ] 🟢 S — **Share button on proposal cards and detail page**

---

## PROPOSALS [ID]

- [ ] 🟡 M — **Reduce Official Comments section friction** — "Community Comments" vs "Official Comments" is confusing; consider collapsing Official Comments into a prominent button that opens a modal/drawer on click; keeps focus on community discussion without losing the official record

---

## CIVIC INITIATIVES

- [ ] 🟠 S — **Add Initiatives to header nav** — currently the only path is via user profile; add `/initiatives` link to main nav (ties to Homepage bug above)
- [ ] 🟡 M — **Filters on initiatives list** — stage tabs (Draft / Deliberation / Voting / Implemented), scope filter (local / state / federal), tag/topic filter; necessary once more initiatives exist
- [ ] 🟡 M — **Argument board — Sprint 3** — structured For/Against arguments, argument voting, AI debate summary (already scoped in pending work)
- [ ] 🟡 M — **"Post a problem" pathway** — allow a user to submit just a problem statement (no solution yet) to begin community collaboration; different form from full initiative; could be a separate `problems` table or an initiative with `stage = 'problem'`
- [ ] 🟢 S — **Draft → argument creation decision** — decide: should a draft initiative allow For/Against arguments before it moves to deliberation? Recommendation: no (arguments should require deliberation stage to prevent premature polarization); add a tooltip or lock indicator explaining why

---

## AGENCIES

- [ ] 🟡 M — **Improve agency card design** — add employee count, annual budget, year created, and sector tags to each card; data may need to come from a new pipeline or manual seed (USASpending has some of this)
- [ ] 🟡 M — **Agency visual / hierarchy view** — a simple tree or budget bar chart showing relative size and parent/sub-agency relationships would make the page far more useful; could use D3 or a simple horizontal bar chart
- [ ] 🟡 M — **Agency Officials search** — ability to search/filter officials within an agency context; relevant for regulatory agency heads and appointed officials
- [ ] 🟡 M — **Inline preview on card click** — clicking an agency card should expand it inline (like an officials side panel) without full page redirect, for faster browsing
- [ ] 🟡 M — **White House featured card** — pin the White House / Executive Office of the President as a prominent featured card at the top of `/agencies` (visually distinct from the grid); give it a rich detail page; it's the most-recognizable entity on the platform
- [ ] ⬜ XL — **Agency hierarchy graph** — visualize parent/sub-agency relationships as a graph or org-chart; requires hierarchy data pipeline

---

## GRAPH

- [ ] 🟠 L — **USER node** — show the signed-in user as a node; connect to their district's representatives; visually indicate alignment score (votes/priorities match); requires auth integration + per-user graph state
- [ ] 🟠 M — **Node right-click / options menu** — nodes currently have no context menu; connections do; add equivalent options to nodes (expand, pin, hide, view profile, copy link)
- [ ] 🟡 M — **Procedural vote filter in graph panel** — toggle to hide/show procedural votes in the connection graph (the toggle exists in FocusTree; verify it's also surfaced in the main graph filter UI and working end-to-end)
- [ ] 🟢 S — **Graph: share button / copy link** — quick copy of current graph URL/share code to clipboard from within the graph panel

---

## DASHBOARD

- [ ] 🟡 M — **Browsable sitemap section** — a visual grid of all major routes with descriptions; doubles as a discovery tool for new users and documents the platform for open-source contributors
- [ ] ⬜ L — **Browsing path visualization** — aggregate `page_views` data into a Sankey or flow chart showing common user journeys; admin-only; useful for UX decisions

---

## INFRASTRUCTURE & PERFORMANCE

- [ ] 🟠 M — **Rate limiting on public API routes** — `/api/search`, `/api/graph/*`, and AI summary routes need per-IP rate limits; use Vercel Edge middleware or an upstash-redis rate limiter
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
- [ ] 🟡 S — **Contributing guide** — `CONTRIBUTING.md` with setup steps, branch conventions, PR process, and the `[skip vercel]` commit convention
- [ ] 🟢 S — **Public roadmap** — a simplified, public-facing version of PHASE_GOALS.md for the homepage or GitHub; builds trust with early users and grant reviewers

---

## COMPLETED (archive, don't delete — useful reference)

- [x] Viz type active state indicator (ForceGraph, Sunburst, Chord, Treemap) — fixed 2026-04-06
- [x] Procedural vote toggle in FocusTree — added 2026-04-06, gated by graphMeta.hasVotes
- [x] Self-configuring settings (count labels, auto-switch dataMode) — completed 2026-04-06
- [x] Efficiency audit — all Supabase calls wrapped in withDbTimeout — completed 2026-04-06
- [x] Civic Initiatives Sprint 2 (versions, upvotes, list page, detail page, create form) — completed 2026-04-11
