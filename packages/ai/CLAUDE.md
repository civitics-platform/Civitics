# packages/ai/CLAUDE.md

## Purpose
Shared Claude API service layer. All AI features across both apps route through this package.

---

## API Key

```
ANTHROPIC_API_KEY
```

---

## Model Routing

| Model | Use case | Cost |
|-------|----------|------|
| claude-haiku-4-5 | Simple tasks, cached lookups, classification | ~$0.25/M tokens (12x cheaper than Sonnet) |
| claude-sonnet-4-6 | Standard features, summaries, drafting | Standard |
| claude-opus-4-6 | Premium complex tasks only | Highest cost |

**Default to Sonnet.** Use Haiku for any task that doesn't require reasoning. Use Opus only for premium-tier features with explicit credit cost.

---

## Caching Strategy

- **Plain language summaries** — generated once on document ingestion, stored in Supabase, served free to unlimited users
- Cache key: `{entity_type}:{entity_id}:{version}` — version bumps when prompt changes
- Cache hit rate target: **80%+**
- Cached content is a public good — no credit cost to read it
- Store cache in Supabase (Phase 1) or R2 (Phase 2+)

---

## Credit Gating

Every per-user AI call costs civic credits. There is no open-ended free AI access.

| Feature | Credits | Model |
|---------|---------|-------|
| Personalized impact analysis | 2 | Sonnet |
| Comment draft | 1 | Sonnet |
| Connection mapping query | 3 | Sonnet |
| Legislation draft (basic) | 5 | Sonnet |
| Legislation draft (with citations) | 15 | Opus |
| Multi-hop connection analysis | 10 | Opus |
| "Explain this graph" | 1 (cached per state hash) | Sonnet |

Free tier: 3 personalized queries/day, 1 comment draft/day. These are hard limits enforced server-side.

---

## The Critical Cost Rule

**Never turn on an AI feature until the credit/revenue mechanism that pays for it is also live.**

Costs must be: transparent, predictable, and always less than revenue.

---

## Cost Control Rules

1. Cache hit rate target: 80%+
2. Model routing: use Haiku whenever reasoning isn't needed (12x cost reduction)
3. Hard rate limits per user per day (enforced server-side, not client-side)
4. Never open-ended free API access — every personalized call has a credit cost
5. Seek Anthropic nonprofit/partnership rate — apply for startup credits early
6. All AI costs are transparent to users before they spend credits

---

## Free AI Features (no credits)

These are cached and shared across all users:
- Plain language bill/regulation summaries (generated once on ingestion)
- Basic "What does this mean?" Q&A on cached data

These never cost the user anything. Platform absorbs cost from the one-time generation.

---

## Credit-Gated Features

- Personalized impact analysis ("what does this mean for me as a small business owner")
  - Answers are shareable (reduces repeat queries)
- Comment drafting assistant (3 questions → structured official comment)
- Direct submission to regulations.gov
- Connection mapping queries
- Legislation drafting studio
- FOIA request builder

## Premium Features (Opus, higher credit cost)

- Full legislation drafting with legal citations
- Complex multi-hop connection analysis
- Comparative analysis across jurisdictions

---

## Official Comment Submission Exception

Direct submission of official comments to regulations.gov is **always free** — no credits required.
This is a constitutional right. The AI drafting assistance costs credits; the submission itself never does.
