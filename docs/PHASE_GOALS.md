# Civitics Platform — Phase Goals

> This file tracks progress against the phased development plan defined in `CLAUDE.md`.
> Update checkboxes as tasks complete. Phases are sequential; each unlocks the next.
> Last audited: 2026-03-21 (verified against actual files, tables, and code — not guessed).
> Last updated: 2026-03-21 — Phase 1 ~88% complete; 51k vote connections live (227k pending IO recovery).

---

## Phase 0 — Scaffold ✓ `Weeks 1–2` `100% complete`

### Infrastructure
- [x] Turborepo monorepo scaffolded
- [x] Next.js apps: `civitics` + `social`
- [x] pnpm workspace configured
- [x] Shared packages structure (`ui`, `db`, `blockchain`, `maps`, `graph`, `ai`, `auth`, `config`)
- [x] Tailwind CSS configured

### Accounts & Services
- [x] civitics.com domain registered
- [x] GitHub repo live (`civitics-platform/civitics`)
- [x] Supabase project created
- [x] Anthropic, Vercel, Resend, Sentry accounts
- [x] New Supabase API keys (not legacy)
- [x] `.env.local` and `.env.example` created

### Database
- [x] Phase 1 schema migrated (9 tables)
- [x] PostGIS, uuid-ossp, pgcrypto, pg_trgm enabled
- [x] RLS enabled on all tables
- [x] Supabase client connected (3 clients)

### First Visual
- [x] Homepage running at `localhost:3000`
- [x] Connection graph at `/graph` with D3
- [x] `CLAUDE.md` written and committed

---

## Phase 1 — MVP `Weeks 3–10` `~88% complete` ← **current**

> **Done when:** Vote backfill complete, search ranking fixed, auth tested end-to-end, grant applications submitted, first 500 users.

### Data Ingestion Pipelines
- [x] Congress.gov API → officials + votes (`packages/data/src/pipelines/congress/`)
- [x] FEC bulk pipeline → `weball24.zip` + `pas224.zip` → financial_relationships + entity_connections (`packages/data/src/pipelines/fec-bulk/`)
  - Note: FEC API-based pipeline (`fec/`) retained for reference only — do not use (hits rate limits)
  - Note: Full 2GB individual-level FEC file (`indiv24.zip`) pending Cloudflare R2 account
- [x] Financial entities pipeline — `financial_entities` rows from FEC donor categories (`packages/data/src/pipelines/financial-entities/`)
  - 19,647 donation connections live
- [x] USASpending.gov → spending_records (`packages/data/src/pipelines/usaspending/`)
- [x] Regulations.gov → proposals + comment periods (`packages/data/src/pipelines/regulations/`)
- [x] OpenStates → state legislators (`packages/data/src/pipelines/openstates/`) — 6,268 inserted, 1,031 updated (2026-03-17)
- [x] CourtListener → judges + rulings (`packages/data/src/pipelines/courtlistener/`)
- [x] Entity connections pipeline — derives donation/vote/oversight/appointment from ingested data (`packages/data/src/pipelines/connections/`)
  - Note: 51k vote connections live; full 227k pending IO recovery
- [x] Delta connections runner — only re-derives changed officials since last run (`packages/data/src/pipelines/connections/delta.ts`)
- [x] Master orchestrator + scheduler (`packages/data/src/pipelines/index.ts`)
- [x] Nightly sync pipeline — `runNightlySync()` export, full sequence: data → connections delta → rule tags → AI tags
- [x] Sync log tracking — `data_sync_log` table, per-pipeline run records

### Core Pages
- [x] Homepage wired to real data — officials, proposals, agencies, spending counts pulled live from Supabase
  - Proposals nav and all CTA links wired to `/proposals` and `/proposals?status=open`
  - Hero search bar (GlobalSearch variant="hero") + nav search bar (Cmd/Ctrl+K)
  - Officials section shows federal-only (congress_gov source), ordered by vote count desc
- [x] Officials list page (`/officials`) — full list, party filter, real data
- [x] Official detail page (`/officials/[id]`) — votes, donor data, real data
- [x] Agency list page (`/agencies`) — real data
- [x] Agency detail page (`/agencies/[slug]`) — real data
- [x] Proposals list page (`/proposals`) — status/type/agency/search filters, open-now featured section, clickable cards, full agency names, pagination with filter preservation
- [x] Proposal detail page (`/proposals/[id]`) — "What This Means" AI summary section, comment period banner, 3-step comment draft tool, vote record, related proposals, generateStaticParams for top 50
  - Note: `vote_category` filter UI pending full migration completion
- [x] Public accountability dashboard (`/dashboard`) — platform stats, pipeline health, data counts
- [x] Search — universal search across officials, proposals, agencies
  - `GET /api/search?q=&type=` — parallel queries, special cases (state abbr, party, role), trigram+ILIKE
  - `GlobalSearch` component — nav (Cmd/Ctrl+K, dropdown) + hero (full-width) variants
  - `/search` full results page — tabs (All/Officials/Proposals/Agencies), grouped results
  - GIN trigram indexes — migration `0008_search_indexes.sql` applied

### Graph Features
- [x] Connection graph with D3 force simulation (`packages/graph/src/ForceGraph.tsx`)
- [x] Graph page at `/graph` — dark theme, wired to `entity_connections` table via `/api/graph/connections`
- [x] Share code system — `CIV-XXXX-XXXX` codes, `/graph/[code]` URLs, `graph_snapshots` table, `/api/graph/snapshot` route
- [x] Screenshot export — PNG 1×/2×/4× with non-removable watermark (URL + data sources + date)
- [x] 5 preset views built — Follow the Money, Votes & Bills, Revolving Door, Full Picture, Clean View
  - Nominations preset ("Who did this senator confirm?") + Full Record preset (all including procedural) also added
  - Not yet built: Committee Power, Industry Capture, Co-Sponsor Network
- [x] Proposal vote categorization — `vote_category` column on `proposals` (substantive/procedural/nomination/regulation)
  - Migration `0019_proposal_vote_category.sql` applied; all existing proposals categorized
  - Procedural votes (cloture, passage motions) hidden from graph by default; archived, not deleted
- [x] Nomination votes as separate connection type — `nomination_vote_yes` / `nomination_vote_no` edges
  - Connections pipeline derives these from proposals with `vote_category = 'nomination'`
  - Shown as distinct visual element (violet/pink) vs. legislation votes (blue/red)
- [x] Graph API supports `?include_procedural=true` for researchers and journalists
- [x] Ghost node empty state animation — shown when `entity_connections` table is empty
- [x] Entity selector — search-as-you-type for officials, agencies, proposals; centers graph on selection
- [x] Depth control — 1–5 hop selector; client-side BFS filter
- [x] Filter pills — per-connection-type toggles with live counts; syncs with presets; "Custom" badge
- [x] Customize panel — node size/color encoding, edge thickness/opacity, layout, theme
- [x] Strength slider — filter weak connections by minimum strength threshold
- [x] Smart expansion — click node to expand neighbors; keyboard shortcut support
- [x] Node types rendered: official (circle), proposal (document rect), corporation/financial (diamond, green), pac (triangle, orange), individual (dashed circle, blue), governing_body (rounded rect, purple)
  - Note: `entity_connections` schema uses `from_id`/`from_type`/`to_id`/`to_type` — different from original CLAUDE.md spec which showed `entity_a_id`/`entity_b_id`
- [x] Embed code export — shareable iframe snippet from graph state
- [x] Visualization registry pattern — pluggable viz registry, all views registered uniformly

### Graph Visualizations (Phase 1+)
- [x] Treemap visualization — hierarchical breakdown of connection types / donor industries
- [x] Chord diagram — 13 industry groups, $1.75B flow visualized as arc ribbons
- [x] Sunburst / radial visualization — radial hierarchy drill-down from selected node
- [x] Comparison mode — split-screen two entities side by side
- [x] Path finder — shortest path between two entities (PostgreSQL recursive CTE, `packages/db/src/queries/entity-connections.ts`)
- [x] AI narrative — "Explain this graph" (cached per state hash)
- [x] Graph snapshot API — `/api/graph/snapshot` (save + retrieve named snapshots)
- [x] Entity search API — `/api/graph/entities` (search-as-you-type for graph entity selector)

### Maps
- [x] Mapbox account + API key — `NEXT_PUBLIC_MAPBOX_TOKEN` configured
- [x] District finder from address — `DistrictMap` component geocodes via Mapbox, calls `/api/representatives`
- [x] "Find your representatives" map — live on homepage
- [x] Lazy loading + geolocation — user-activated map (4-state machine), browser geolocation with privacy coarsening, fade transition

### AI Features
- [x] `ai_summary_cache` table — entity-based cache, UNIQUE on (entity_type, entity_id, summary_type)
- [x] `generateSummary()` function — `packages/ai/src/client.ts`, Haiku model, $4.00/month cost guard, logs to `api_usage_logs`
- [x] Anthropic API connected
- [x] Plain language bill summaries (cached) — pipeline + on-demand generation wired to UI
  - `packages/data/src/pipelines/ai-summaries/index.ts` — batch: 100 open proposals + 50 officials, ~$0.035/run (180 cached, ~$0.035 total spend)
  - `pnpm --filter @civitics/data data:ai-summaries` (full) / `data:ai-summaries-new` (incremental)
  - Route handlers: `GET /api/proposals/[id]/summary` + `GET /api/officials/[id]/summary` (on-demand, cached)
  - Proposal detail page: "What This Means" section — cached AI summary → on-demand (open only) → official summary
  - Official profile page: "About" section — cached AI profile → on-demand (if votes/donor data)
- [x] Entity tagging system — 5,978 tags applied across officials, proposals, financial entities
- [x] Topic / issue classification — AI-based proposal topic + official issue area tags via Haiku
- [x] Donor industry tagging — rule-based industry name-matching on financial entities
- [x] AI cost gate system — hard monthly budget cap enforced before any API call
- [x] Pre-run cost estimation — real API sampling before batch runs, dry-run mode
- [x] Post-run verification — actual vs. estimated cost logged and surfaced in dashboard
- [x] Autonomous cron mode — budget-gated auto-approval for nightly AI runs
- [ ] Basic credit system in Supabase
- [ ] "What does this mean for me" personalized query

### Cost Management System
- [x] Pre-run cost estimation with real API sampling
- [x] Autonomous cron approval — budget-gated auto-approval for scheduled runs
- [x] Post-run verification — actual vs. estimated cost diff logged
- [x] Pipeline cost history table — per-run cost records in `data_sync_log`
- [x] Budget alerts system — threshold alerts surfaced in admin dashboard
- [x] Configurable thresholds — admin-adjustable budget limits via dashboard UI
- [x] Admin dashboard controls — manual pipeline triggers, alert history, limit config

### Diagnostic Tools
- [x] Graph snapshot API — `/api/graph/snapshot`
- [x] Platform status API — `/api/claude/status`
- [x] Claude diagnostic snapshot — `/api/claude/snapshot`
- [x] Entity search API — `/api/graph/entities`

### Data Quality
- [x] Entity tagging — 5,978 tags applied (rule-based + AI)
- [x] Industry classification — FEC donor industries mapped to 13 standard groups
- [x] Voting pattern analysis — partisan/bipartisan tags, pre-vote timing flags
- [x] Donor pattern tags — donation timing relative to votes flagged on financial entities
- [x] Proposal vote categorization — substantive/procedural/nomination/regulation (migration applied)

### Infrastructure
- [x] Supabase storage buckets created
- [x] Storage utility (`packages/db/src/storage.ts`) — `uploadFile()` / `getFile()` / `getStorageUrl()`, path-based (migration-ready for R2)
- [x] Cloudflare R2 configured — buckets (`civitics-documents`, `civitics-cache`), `@aws-sdk/client-s3`, `STORAGE_PROVIDER=r2` active
- [x] `data_sync_log` table tracking all pipeline runs
- [x] `api_usage_logs` table
- [x] `ai_summary_cache` table — migration 0005
- [x] `service_usage` table — tracks Mapbox loads, R2 ops, Vercel deploys — migration 0006
- [x] `financial_entities` table (types not yet regenerated — `any` casts in place)
- [x] `graph_snapshots` table (types not yet regenerated)
  - TODO: run `pnpm --filter @civitics/db gen:types` to regenerate `database.ts` and remove `any` casts
- [x] Vercel Analytics + Speed Insights — installed, wired into root layout
- [x] Self-hosted page view analytics — `page_views` table, `/api/track-view` route, `PageViewTracker` component, bot detection, country tracking, no cookies, 90-day retention
- [x] All services monitored — dashboard at `/dashboard` shows live pipeline health + data counts
- [x] Entity tagging system — `entity_tags` table (migration 0012), three-tier display (primary/secondary/internal), rule-based + AI taggers
  - Rule-based: urgency (closing_soon/urgent/new), agency→sector, proposal scope, tenure, bipartisan/partisan, donor patterns, industry name-matching — zero cost, confidence 1.0
  - AI-based: proposal topic classification + official issue area classification via Haiku (~$0.60 full batch), dry-run cost estimate before running
  - Pre-vote timing flags: donation + vote within 90 days → internal tag on financial entity
- [x] Tag UI — `EntityTags` component with 3-tier expand: primary always shown, +N more, ⚙ research tags with warning blurb, localStorage dismiss
- [x] Tag filtering — topic filter pills on `/proposals`, issue area + donor pattern pills on `/officials`, industry donor filter on `/graph`
- [x] Vercel cron — `vercel.json` schedule (2am UTC), `/api/cron/nightly-sync` secured with CRON_SECRET
- [x] `pipeline_state` table — tracks last connections run timestamp for delta detection
- [x] Nightly auto-sync pipeline — full sequence scheduled and running
- [x] Connections auto-scheduler — delta runner triggered nightly
- [x] Pipeline operations dashboard — manual triggers, run history, status per pipeline
- [x] Cron run status tracking — per-run records with duration, rows affected, cost
- [x] AI cost trend chart — historical cost per run visualized in admin dashboard
- [x] Alert history — past threshold breaches logged and viewable
- [x] Admin-only dashboard controls — gated by `ADMIN_EMAIL` env var
- [ ] Custom storage domain

### Database (as of 2026-03-21)
- [x] `officials` — 8,251 rows (federal Congress + 6,268 state legislators + 651 judges via OpenStates / CourtListener)
- [x] `proposals` — 2,066 rows
- [x] `votes` — 227,153 rows
- [x] `spending_records` — 1,980 rows
- [x] `financial_relationships` — 19,647 rows (FEC bulk)
- [x] `entity_connections` — 51k vote connections live; full 227k pending IO recovery
- [x] `financial_entities` — FEC donor categories seeded
- [x] `graph_snapshots` — table exists, rows created on share
- [x] `civic_comments` — table exists, no commenting UI yet

### Community & Auth
- [x] User auth via Supabase (magic link + Google OAuth + GitHub OAuth)
  - `/auth/sign-in` page — magic link primary, OAuth secondary
  - `/auth/callback` route — PKCE code exchange, user upsert on first sign-in
  - `/auth/confirm` route — token_hash email confirmation (email change etc.)
  - `AuthButton` — smart nav component (Sign in → modal, signed in → avatar + UserMenu)
  - `AuthModal` — in-page modal, no navigation away, contextual trigger text
  - `UserMenu` — signed-in dropdown (Phase 2 items shown as coming soon)
  - `SignInForm` — shared form component (used by page + modal)
  - `middleware.ts` — silent session refresh on all routes, no protected routes yet
  - Migration `0009_users_table.sql` — run `pnpm db:migrate` in packages/db to apply
- [ ] Community commenting on entities (`civic_comments` table exists, no UI)
- [ ] Position tracking on proposals
- [ ] Follow officials and agencies

### Remaining Phase 1
- [ ] Vote backfill complete — 51k/227k done, pending IO recovery
- [ ] Proposal vote_category migration — full data population for all proposals
- [ ] Elizabeth Warren (and other senators) appearing in search results
- [ ] Community commenting
- [ ] Position tracking
- [ ] Follow officials/agencies
- [ ] 500 beta users
- [ ] Grant applications submitted

---

## Phase 2 — Growth `Weeks 11–22` `Planned`

> **Done when:** Platform financially self-sustaining, first institutional API customer, first grant money received.

### Accountability Tools
- [ ] Official comment submission → regulations.gov API
- [ ] Promise tracker live
- [ ] Donor impact calculator
- [ ] Vote pattern analyzer
- [ ] Revolving door tracker

### Graph Enhancements (Phase 2)
- [ ] Timeline scrubber — animate graph through time with play button
- [ ] Remaining 3 preset views — Committee Power, Industry Capture, Co-Sponsor Network
- [ ] Community presets — user-saved named presets (`graph_presets` table)

### AI Power Features
- [ ] Connection mapping queries
- [ ] Comment drafting assistant
- [ ] Legislation drafting studio
- [ ] FOIA request builder

### Candidate Tools
- [ ] Candidate profile verification system
- [ ] "Should I run?" explorer (5-step flow)
- [ ] 72-hour campaign launch system

### Revenue
- [ ] Institutional API v1 live
- [ ] First paying institutional customer
- [ ] Open Collective donations active
- [ ] First grant received

---

## Phase 3 — Social App `Weeks 23–34` `Planned`

- [ ] Social feed + follow system
- [ ] COMMONS token simulation in Supabase
- [ ] Algorithm v1 (open source)
- [ ] Civic bridge score
- [ ] Creator earnings dashboard
- [ ] Algorithm marketplace seeded
- [ ] Bipartisan design mechanics
- [ ] Social app name decided

---

## Phase 4 — Blockchain `Weeks 35–50` `Planned`

- [ ] Privy embedded wallets live
- [ ] ERC-4337 account abstraction
- [ ] Biconomy gas sponsorship
- [ ] Civic credits on-chain (Optimism)
- [ ] Compute pool smart contract deployed
- [ ] Smart contract audit completed ← **never skip**
- [ ] IPFS + Arweave pipelines live
- [ ] Warrant canary on-chain (weekly automated attestation)

---

## Phase 5 — Global `Weeks 51–66` `Planned`

- [ ] Civic crowdfunding with escrow
- [ ] Official account verification system (government email + cross-reference)
- [ ] UK + Canada deployment
- [ ] Spanish + Portuguese language support
- [ ] DAO governance activation
- [ ] Community treasury live
