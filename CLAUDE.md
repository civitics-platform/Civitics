# CLAUDE.md — Civitics Platform

Authoritative reference for the Civitics platform. Read before writing any code.
Update when architecture decisions change. Last updated: April 2026.

---

## Session Continuity — Read These First

Starting a new session? Read these files before touching any code:

| File | What it tells you |
|---|---|
| `docs/SESSION_LOG.md` | What happened last session, what's unblocked, what's next |
| `docs/FIXES.md` | Bug and improvement backlog, each bullet has a stable `FIX-NNN` ID |
| `docs/done.log` | Source of truth for what's actually shipped (append-only) |
| `docs/PHASE_GOALS.md` | Phase 1 completion picture |

These are the fastest path to current project state. Git log and code exploration
are for verification, not orientation.

**First step of every session:** run `pnpm fixes:sync` to pick up any new
commit-trailer completions since last session, then read `docs/FIXES.md` for the
current queue.

> **Workflow note (as of 2026-04-15):** Qwen Code is no longer part of the workflow.
> Claude handles all implementation directly. `docs/QWEN_PROMPTS.md` is preserved as
> historical task archive only — do not queue new tasks there or write Qwen prompts.
> Work through `docs/FIXES.md` items directly.

---

## FIXES Workflow

Craig keeps `docs/FIXES.md` open in VSCode as a live backlog. Claude keeps a
separate source of truth in `docs/done.log` to avoid editor collisions, revert
drift, and duplicate-commit shuffles.

**The contract:**

| File | Owner | Direction |
|---|---|---|
| `docs/FIXES.md` | Craig (adds, edits, reprioritises) | Claude **only appends new items** or lets `fixes:sync` flip `[ ]` → `[x]` |
| `docs/done.log` | Claude / `fixes:sync` | **Append-only**, never rewritten |
| Git commit trailer `Fixes: FIX-NNN` | Claude (when code lands a fix) | Feeds done.log via `fixes:sync` |

**When you (Claude) complete a FIX item:**

1. Find the item's ID in FIXES.md — the `<!--id:FIX-NNN-->` marker at the end of
   the bullet.
2. Include a trailer in the commit message. Multiple IDs allowed, comma-separated:
   ```
   feat(proposals): add sort-by dropdown
   
   Longer body if needed.
   
   Fixes: FIX-027
   ```
   ```
   Fixes: FIX-020, FIX-021, FIX-024
   ```
3. After committing, run `pnpm fixes:sync`. The script:
   - Scans all `Fixes:` trailers across git history
   - Appends new `(FIX-ID, sha)` pairs to `docs/done.log` (deduplicated)
   - Flips matching `[ ]` bullets in FIXES.md to `[x]` (only ever one direction)
4. Commit the resulting FIXES.md + done.log diff as its own status commit, e.g.
   `chore(fixes): sync status after FIX-027`. Keep status commits separate from
   code commits so reverts don't drag status with them.

**Do NOT:**

- Rewrite FIXES.md bullet text mid-session (causes the N-insertion / N-1 deletion
  churn pattern from editor collisions). Only the checkbox character changes.
- Remove, renumber, or reassign `FIX-NNN` IDs — they're permanent handles.
- Rewrite existing lines in `done.log`. If an item was reopened, **append** a new
  line with `sha: reopen` and hand-uncheck FIXES.md. The sync script treats
  `reopen` as "remove from completed set".
- Use `git filter-branch`, `git reset --hard`, or force-pushes on branches that
  touch FIXES.md — these caused the status-duplicate commits visible in the April
  reflog.

**Scripts:**

- `pnpm fixes:sync` — scan trailers, append to done.log, update FIXES.md checkboxes
- `pnpm fixes:sync:dry` — show what would change, write nothing
- `pnpm fixes:check` — CI-friendly; exits 1 if FIXES.md is out of sync with trailers

**Adding a new FIX item (Craig, typically):**

Append a bullet to the appropriate section of FIXES.md with the next free
sequential ID. Easy way to find the highest in-use ID:
```bash
grep -oE 'FIX-[0-9]+' docs/FIXES.md | sort -u | tail -5
```
If Craig adds a bullet without an ID, Claude should assign the next free one
before referencing it in a commit.

---

## Mission

Restore democratic power to its rightful owners — the people. Facilitate collaboration across all political, religious, language, and geographic barriers. Bring together data on all public institutions and officials, make it easy for anyone to explore, and provide powerful tools for citizens, researchers, journalists, and investigators. Make government promises permanent public record. Give average people a genuine seat at the table.

---

## The North Star

A world map, dark at first. District by district, it gets brighter as democratic accountability increases — as officials engage with constituents, as promises are kept, as donors and votes are connected in plain sight.

**Every feature we build should make that map brighter. If it doesn't, we don't build it.**

---

## What This Is

Two distinct products sharing one infrastructure:

1. **Civitics App** — The mission vehicle. "Wikipedia meets Bloomberg Terminal for democracy." Structured civic data, legislative tracking, public comment submission, connection graph, maps, AI accountability tools. Serious civic infrastructure — never social media.

2. **Social App** — The distribution vehicle. Censorship-resistant platform with COMMONS token economy. General civic discourse, bipartisan feed mechanics, creator economy, algorithm marketplace. Cat memes are welcome.

Social app reaches mainstream users → introduces them to civic tools. They share identity, wallet, and content infrastructure but are kept visually and tonally separate.

---

## Core Principles (Non-Negotiable)

- **Official comment submission is always free** — No fees, tokens, or credits required. Constitutional right.
- **No paywalling civic participation** — Reading and submitting positions on government proposals is free forever.
- **Blockchain is invisible** — No seed phrases, wallet addresses, gas fees, or network names in UI.
- **No gas fees for users** — All costs sponsored via Biconomy, ERC-4337.
- **Geography is never stored precisely** — Coarsen to district/zip level before any INSERT.
- **Warrant canary on-chain weekly** — Signed attestation of non-compromise written to Optimism.
- **Platform earns are never extractive** — Revenue model aligned with civic mission.
- **Free tier is genuinely powerful** — Covers 90% of citizen needs.

---

## Monorepo Structure

**Tooling:** Turborepo / pnpm

```
/apps
  /civitics    # Next.js civic governance app  → see apps/civitics/CLAUDE.md
  /social      # Next.js social/COMMONS app
/packages
  /ui          # Shared Tailwind component library
  /db          # Supabase client, schema, migrations  → see packages/db/CLAUDE.md
  /blockchain  # Wallet, ABIs, chain config, ERC-4337 → see packages/blockchain/CLAUDE.md
  /maps        # Mapbox GL + Deck.gl utilities        → see packages/maps/CLAUDE.md
  /graph       # D3 force simulation (connection graph)→ see packages/graph/CLAUDE.md
  /ai          # Shared Claude API service layer      → see packages/ai/CLAUDE.md
  /auth        # Privy integration, session management
  /config      # Shared ESLint, TypeScript, Tailwind configs
```

---

## Package Documentation

| Package | Topics |
|---------|--------|
| `packages/db/CLAUDE.md` | Supabase clients, schema conventions, entity_connections correction, RLS, storage, migrations |
| `packages/data/CLAUDE.md` | Pipelines, FEC bulk strategy, storage budget, per-source rules, update schedules |
| `packages/graph/CLAUDE.md` | D3 graph, node types, smart expansion, strength filter, share codes, presets |
| `packages/ai/CLAUDE.md` | Claude API, model routing, credit gating, caching, cost rules |
| `packages/maps/CLAUDE.md` | Mapbox, Deck.gl, PostGIS patterns, privacy rules, geographic data |
| `packages/blockchain/CLAUDE.md` | Chains, wallets, audit requirement, Two Economies, compute pool |
| `apps/civitics/CLAUDE.md` | Tone, data rules, user tiers, institutional API, candidate tools, build rules |

---

## Claude Code Permissions

Auto-approved: pnpm commands, file creation/editing, directory creation, git read ops, git commits and pushes

Always requires approval: any deletion (rm/rmdir), destructive git, .env changes, global installs, external network calls

Never without explicit confirmation: DROP/TRUNCATE/DELETE SQL, modifying existing migrations, changes to .gitignore, exposing credentials

---

## Package Manager

**pnpm — not npm, not yarn**

```
pnpm install    pnpm add X    pnpm dev    pnpm dlx X
```

Never commit `node_modules`. Never use npm or yarn.

---

## Environment Variables

Local development: .env.local
  Gitignored, never committed
  
Production: Vercel Dashboard
  Settings → Environment Variables
  Encrypted at rest
  Never in code files

These are equivalent but separate:
  .env.local = local secrets
  Vercel env vars = production secrets

Both must be kept in sync manually
When adding a new API key:
  1. Add to .env.local
  2. Add to Vercel immediately
  3. Add key name (no value)
     to .env.example
  4. Update CLAUDE.md if relevant

## Supabase API Keys

Use NEW format keys only:
```
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY   (sb_publishable_xxx)  — client-side
SUPABASE_SECRET_KEY                    (sb_secret_xxx)       — server-only
```
Never use legacy `anon` / `service_role` keys. Never use `NEXT_PUBLIC_` on the secret key.

See `packages/db/CLAUDE.md` for full client documentation.

---

## Supabase Clients (Summary)

```
createBrowserClient()          → 'use client' components
createServerClient(cookies())  → Server Components, Route Handlers (respects RLS)
createAdminClient()            → Server only, pipelines only (bypasses RLS)
```

**Every route/page using `createAdminClient()` must have:**
```ts
export const dynamic = "force-dynamic";
```
Without this, Next.js calls it at build time → fails on Vercel (secret key unavailable).

**`generateStaticParams`:** use `createClient()` from `@supabase/supabase-js` with publishable key — never `createAdminClient()`.

Import from `@civitics/db`, not directly from `@supabase/supabase-js`.

---

## Active App Directory — CRITICAL

```
apps/civitics/app/       ← ACTIVE — always edit here
apps/civitics/src/app/   ← INACTIVE — silently ignored by Next.js
```

---

## Deployment

Run `pnpm build` locally before every push. Vercel uses strict TypeScript. Build must pass clean.

---

## Current Phase: Phase 1 (~90% complete)

See `docs/PHASE_GOALS.md` for detailed task tracking.

---

## votes Table — Actual Column Names

```
vote      (not vote_cast)
  values: 'yes' | 'no' | 'present' | 'not voting'
voted_at  (not vote_date)
metadata->>'vote_question'   procedural type string (e.g. "On Passage", "On the Cloture Motion")
metadata->>'legis_num'       bill number
```

Do NOT use vote_cast or vote_date — those columns do not exist.

---

## generateStaticParams Rules

```
ALWAYS use try/catch — return [] on any error
ALWAYS wrap the query in Promise.race with a 5s timeout
ALWAYS limit to 50 rows max
ALWAYS use NEXT_PUBLIC keys only (never createAdminClient)
NEVER let a build fail due to DB unavailability

Timeout pattern:
  const { data } = await Promise.race([
    supabase.from("table").select("col").limit(50),
    new Promise<{ data: null; error: Error }>((resolve) =>
      setTimeout(() => resolve({ data: null, error: new Error("timeout") }), 5000)
    ),
  ]);

If DB is unavailable: build succeeds with [] → pages render on-demand (ISR)
```

---

## Claude ↔ Database Access

**Claude's sandbox cannot reach the local Docker Supabase instance directly.**
The sandbox runs in an isolated Linux environment; `127.0.0.1` is the sandbox's
localhost, not Craig's Windows machine. Network access to local Docker ports is
blocked by the sandbox allowlist.

**What this means in practice:**
- Claude writes migration files to `supabase/migrations/` — Craig runs them
- The command is always: `supabase migration up --local` (run from repo root)
- Local Studio is at: http://127.0.0.1:54323

**To give Claude direct DB access (optional, one-time setup):**
Install `@modelcontextprotocol/server-postgres` as a Cowork local MCP:
```
Connection string: postgresql://postgres:postgres@127.0.0.1:54322/postgres
```
Once configured, Claude can run migrations, query tables, and inspect schema
directly without Craig needing to run commands manually. Ask Claude to help
set this up when ready.

**Until then:** Every session that creates a migration will flag the required
`supabase migration up --local` command in the SESSION_LOG under ⚠️ Action needed.

---

## Database Safety Rules

NEVER run database commands against production:

- Always use --local flag:
  `supabase migration up --local`

- Local Studio URL:
  http://127.0.0.1:54323

- Prod Studio URL (NEVER touch during development):
  https://supabase.com/dashboard

- Local DB connection:
  postgresql://postgres:postgres@127.0.0.1:54322/postgres

- If asked to run SQL, always use local Studio at 127.0.0.1:54323

- If asked to run migrations, always add --local flag

- Never unpause the Supabase project during development

---

## What Not To Do

- Do not store precise user coordinates — always coarsen to district level
- Do not show blockchain addresses, tx hashes, or network names in UI
- Do not require credits for official comment submission
- Do not use client-side Supabase calls that bypass RLS
- Do not build AI features before the credit/revenue mechanism is live
- Do not use React Flow for the connection graph — D3 force simulation only
- Do not use AWS S3 — use Cloudflare R2 (no egress fees)
- Do not launch a speculative token — COMMONS is utility, earned not bought
- Do not make the governance app feel like social media
- Do not skip the smart contract audit before mainnet deployment
- Do not open-end AI API access without rate limits and credit gating
- Do not add gas fee prompts — Biconomy handles this silently
