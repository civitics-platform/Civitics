# apps/civitics/CLAUDE.md

## Purpose
The Civitics civic governance app. "Wikipedia meets Bloomberg Terminal for democracy."
Structured civic data, legislative tracking, public comment submission, connection graph,
maps, and AI-powered accountability tools.

---

## Tone and Design Philosophy

**Serious civic infrastructure — not social media.**

- Closer to a court of record than Twitter
- Dense information display is a feature, not a bug — users came here to learn
- Bloomberg Terminal feel: data-rich, fast, trustworthy
- Never feel like a "politics tab" — no engagement bait, no outrage optimization
- Must never be conflated with the social app in UX or tone

---

## Active App Directory — CRITICAL

```
apps/civitics/app/       ← ACTIVE (Next.js builds this)
apps/civitics/src/app/   ← INACTIVE (silently ignored — stale duplicate)
```

**ALWAYS edit files in `apps/civitics/app/`**
Changes to `src/app/` are silently ignored at build time and will never appear on the live site.

---

## Data Rules

- **Never ship placeholder data** — real data or empty state, never fake
- **Always show empty state** — blank page is acceptable; fake data is not
- **Never add "Coming Soon" placeholders** without real content to back them up
- Loading skeletons always — sudden graph appearance is jarring
- Error boundaries always — graceful degradation on data failure

---

## Page Conventions

- Server Components for data fetching (default in Next.js App Router)
- Client Components for interactivity (`"use client"`)
- Every route/page that calls `createAdminClient()` must have: `export const dynamic = "force-dynamic";`
- `generateStaticParams`: use `createClient()` with publishable key only — never `createAdminClient()`
  (secret key unavailable at Vercel build time)

---

## Build Rule

**`pnpm build` must pass locally before every push.**
Vercel uses strict TypeScript. A passing build locally = no Vercel deploy failure.
Never push without running the build first.

---

## User Access Tiers

### Free (ad-supported, genuinely powerful — covers 90% of citizen needs)
- Full data access: agencies, officials, courts, proposals, votes, spending, campaign finance
- Cached AI summaries (unlimited)
- 3 personalized AI queries/day, 1 comment draft/day
- Official comment submission (always unlimited — constitutional right)
- Connection graph (up to 3 hops), Vote pattern analyzer, Donor impact calculator
- Bill tracker (20 bills), Timeline builder

### Contributing Member ($5/mo or 500 credits)
- Unlimited AI queries (50/day fair use), unlimited comment drafts
- Ad-free, API access (1k calls/mo), data export, advanced visualization
- Unlimited saved searches, unlimited connection graph depth

### Investigator ($20/mo)
- Multi-hop connection graph, bulk downloads, webhooks, custom feeds
- Collaborative workspaces, full document archives

### Organization ($99/mo)
- 10 team accounts, API (50k calls/mo), white-label reports
- Coalition tools, petition management

---

## Institutional API

The same data that powers the public platform via versioned REST API for institutional customers.
Primary path to financial sustainability.

| Tier | Price | Calls/mo | Target |
|------|-------|----------|--------|
| Researcher | $49/mo | 10k | Academics, independent journalists |
| Nonprofit | $149/mo | 50k | Watchdog orgs, journalism nonprofits |
| Professional | $499/mo | 250k | Law firms, policy organizations |
| Enterprise | Custom | Unlimited | Major media, research institutions |

**API Design Rules:**
- Versioned from day one: `/api/v1/` never breaks
- `updated_after` filter on every collection endpoint
- `GET /v1/connections/path` — the investigation superpower
- Revenue projection: 10 Researcher + 5 Nonprofit + 3 Professional + 1 Enterprise = ~$4,700/mo (covers all infrastructure)

---

## Candidate Empowerment (Phase 5)

The platform lowers the barrier to entry for genuine public service.

**"Should I Run?" 5-step explorer:**
1. Honest Reality Check — not a pep talk; unvarnished statistics
2. Viability Assessment — district data, vulnerability scores, fundraising path
3. Authentic Platform Generation — AI drafts platform from user's actual public contributions
4. Private Support Snapshot — estimated early supporters before any announcement
5. The Decision — three equal paths: Run / Support a candidate / Lead differently

Platform candidate budget: ~$730k vs. traditional ~$10M

**Candidate verification levels:** Identity Verified → Transparency Pledge → Community Verified → Platform Champion

---

## Contribution Portal (Community Development, Phase 2–3)

Community members contribute to platform development using AI assistance:
- **Type A (~20 min):** Data tasks, config files, translations — zero code required
- **Type B (~60–90 min):** Feature tasks — sandboxed Claude session, auto-tested
- **Type C:** Core infrastructure — vetted contributors only

Contributors earn 50 civic credits per completed task.
Type A costs platform ~$0.20 API; worth $200–500 in equivalent development.

---

## Global Deployment Architecture

The `jurisdictions` table hierarchy makes global deployment a configuration change, not a rebuild:
- `jurisdictions` is hierarchical: global → country → state → county → city
- Every entity belongs to a jurisdiction node
- Each country gets a configuration file: data sources, government structure, terminology

**Country priority:** UK/Canada/Australia (Tier 1) → Germany/France/Japan (Tier 2) → Brazil/South Africa/Mexico (Tier 3)

**Censorship resistance for Tier 3:** Tor hidden service, ENS domain, IPFS, offline PWA.

---

## Development Environment

This project runs on **Windows 10 with VS Code and Claude Code extension**.
Use PowerShell or the VS Code integrated terminal.

Note: The root CLAUDE.md mentions WSL2 — that recommendation does not reflect actual usage.
Development happens natively on Windows. Claude Code extension handles the session.
