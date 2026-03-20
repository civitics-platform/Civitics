# Civitics Platform — Phase Goals

> This file tracks progress against the phased development plan defined in `CLAUDE.md`.
> Update checkboxes as tasks complete. Phases are sequential; each unlocks the next.
> Last audited: 2026-03-18 (verified against actual files, tables, and code — not guessed).
> Last updated: 2026-03-19 — entity tagging system, connections auto-scheduler, nightly sync pipeline live.

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

## Phase 1 — MVP `Weeks 3–10` `~97% complete` ← **current**

> **Done when:** Search works, one complete user journey end to end (search → official → vote record → donor → connection graph), auth working, 500 beta users, grant applications submitted.

### Data Ingestion Pipelines
- [x] Congress.gov API → officials + votes (`packages/data/src/pipelines/congress/`)
- [x] FEC bulk pipeline → `weball24.zip` + `pas224.zip` → financial_relationships + entity_connections (`packages/data/src/pipelines/fec-bulk/`)
  - Note: FEC API-based pipeline (`fec/`) retained for reference only — do not use (hits rate limits)
  - Note: Full 2GB individual-level FEC file (`indiv24.zip`) pending Cloudflare R2 account
- [x] Financial entities pipeline — `financial_entities` rows from FEC donor categories (`packages/data/src/pipelines/financial-entities/`)
- [x] USASpending.gov → spending_records (`packages/data/src/pipelines/usaspending/`)
- [x] Regulations.gov → proposals + comment periods (`packages/data/src/pipelines/regulations/`)
- [x] OpenStates → state legislators (`packages/data/src/pipelines/openstates/`) — 6,268 inserted, 1,031 updated (2026-03-17)
- [x] CourtListener → judges + rulings (`packages/data/src/pipelines/courtlistener/`)
- [x] Entity connections pipeline — derives donation/vote/oversight/appointment from ingested data (`packages/data/src/pipelines/connections/`)
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
- [x] 5 of 8 preset views built — Follow the Money, Votes & Bills, Revolving Door, Full Picture, Clean View
  - Not yet built: Committee Power, Industry Capture, Co-Sponsor Network
- [x] Ghost node empty state animation — shown when `entity_connections` table is empty
- [x] Entity selector — search-as-you-type for officials, agencies, proposals; centers graph on selection
- [x] Depth control — 1–5 hop selector; client-side BFS filter
- [x] Filter pills — per-connection-type toggles with live counts; syncs with presets; "Custom" badge
- [x] Customize panel — node size/color encoding, edge thickness/opacity, layout, theme
- [x] Strength slider — filter weak connections by minimum strength threshold
- [x] Smart expansion — click node to expand neighbors; keyboard shortcut support
- [x] Node types rendered: official (circle), proposal (document rect), corporation/financial (diamond, green), pac (triangle, orange), individual (dashed circle, blue), governing_body (rounded rect, purple)
  - Note: `entity_connections` schema uses `from_id`/`from_type`/`to_id`/`to_type` — different from original CLAUDE.md spec which showed `entity_a_id`/`entity_b_id`
- [ ] AI narrative ("Explain this graph") — not yet built
- [ ] Path finder (shortest path between two entities) — Phase 2
- [ ] Timeline scrubber — Phase 2
- [ ] Comparison mode (split screen) — Phase 2

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
  - `packages/data/src/pipelines/ai-summaries/index.ts` — batch: 100 open proposals + 50 officials, ~$0.035/run
  - `pnpm --filter @civitics/data data:ai-summaries` (full) / `data:ai-summaries-new` (incremental)
  - Route handlers: `GET /api/proposals/[id]/summary` + `GET /api/officials/[id]/summary` (on-demand, cached)
  - Proposal detail page: "What This Means" section — cached AI summary → on-demand (open only) → official summary
  - Official profile page: "About" section — cached AI profile → on-demand (if votes/donor data)
- [ ] Basic credit system in Supabase
- [ ] "What does this mean for me" personalized query

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
- [ ] Custom storage domain

### Database (as of 2026-03-18)
- [x] `officials` — 1,983 rows
- [x] `proposals` — 1,917 rows
- [x] `votes` — 226,873 rows
- [x] `spending_records` — 1,980 rows
- [x] `entity_connections` — 2,212 rows
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
- [ ] AI narrative — "Explain this graph" button (1 civic credit, cached per state hash)
- [ ] Path finder — shortest path between two entities (PostgreSQL recursive CTE already stubbed in `packages/db/src/queries/entity-connections.ts`)
- [ ] Timeline scrubber — animate graph through time with play button
- [ ] Comparison mode — split screen two entities
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
