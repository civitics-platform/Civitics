# packages/data/CLAUDE.md

## Purpose
Data ingestion pipelines. Downloads, parses, and upserts civic data from government sources
into Supabase. Runs as Node.js scripts, not as part of the Next.js build.

---

## Pipeline Conventions

- **Always upsert, never bare insert** — pipelines run repeatedly; duplicates must not accumulate
- **Always log to `data_sync_log`** — every pipeline run records: source, rows_processed, rows_upserted, errors, duration, storage_bytes_added
- **Always log storage estimates** before writing — check budget before large downloads
- **Delete after processing** — downloaded files land in OS temp dir and are deleted after each run
- **Smart update detection** — use ETag/Last-Modified headers and hash comparison to skip unchanged records; target 60–80% reduction in redundant API calls

---

## Storage Budget

**Phase 1 target: 270MB total**

| Source | Budget | Strategy |
|--------|--------|----------|
| Congress.gov | 80MB | Full resolution — bills + votes + legislators |
| FEC bulk | 50MB | Candidate totals (weball24.zip) + PAC contributions (pas224.zip, streamed) |
| USASpending | 250MB | Full FY bulk archive, all agencies in our DB, all award sizes |
| Regulations.gov | 40MB | Active proposals only, no archived |
| CourtListener | 20MB | Metadata only — no opinion text |
| OpenStates | 20MB | Current legislative term only |

---

## Per-Source Strategy

### Congress.gov
- Full resolution: bills, votes, vote records, legislator data
- API key required: `CONGRESS_API_KEY`
- Update schedule: daily at 2am
- Script: `pnpm --filter @civitics/data data:congress`

### FEC Campaign Finance
**Use bulk downloads — NEVER the FEC API.**

| File | URL | Contents |
|------|-----|----------|
| `weball24.zip` | `fec.gov/files/bulk-downloads/2024/weball24.zip` | All-candidates summary: total raised, individual/PAC/party/self contributions per candidate |
| `cm24.zip` | `fec.gov/files/bulk-downloads/2024/cm24.zip` | Committee master — maps committee IDs to names, types, and parent organizations |
| `pas224.zip` | `fec.gov/files/bulk-downloads/2024/pas224.zip` | PAC to candidate contributions (~200 MB compressed) — **streamed line-by-line, never fully loaded** |

Step 2b (PAC contributions):
- Parses cm24 into a committee ID → name/type/connected-org lookup map
- Streams pas224, filtering to: 24K/24Z transaction types, $5 000+, and known FEC candidate IDs
- Aggregates total contributions per committee × candidate pair
- Upserts `financial_entities` rows for named PAC donors (keyed on `source_ids->>'fec_committee_id'`)
- Upserts `financial_relationships` rows per PAC × candidate pair (keyed on `official_id + fec_committee_id + cycle_year`)

- No API key required, no rate limits
- FEC updates bulk files weekly — run on weekly cron
- Script: `pnpm --filter @civitics/data data:fec-bulk`
- The API-based pipeline (`data:fec`) is retained for reference only — **do not use it** (hits rate limits)

### USASpending.gov
- Full FY bulk archive — all agencies in `public.agencies`, all award sizes, no rate limits
- Two categories, run independently:
  - **Contracts** (procurement) — `data:usaspending-bulk`
  - **Assistance** (grants 02/03/04/05/11) — `data:usaspending-bulk-assistance` (FIX-114). Loans/insurance/direct payments are skipped because the `financial_relationships` enum has no row for them.
- First run per category: Full file (`FY{year}_All_{Contracts|Assistance}_Full_{YYYYMMDD}.zip`, 300 MB–1 GB compressed)
- Subsequent runs: Delta files since last processed date (much smaller)
- State tracked in `packages/data/.usaspending-bulk-state.json` per-category (gitignored, not committed). Pre-FIX-114 single-shape state migrates into the `contracts` slot on first read.
- No API key required
- Update schedule: weekly cron (Full file refreshes weekly; Deltas daily)
- Force full re-run: append `-- --force` (e.g. `pnpm … data:usaspending-bulk -- --force`)
- Underlying script accepts `--category=contracts|assistance --force` directly: `pnpm --filter @civitics/data data:usaspending-bulk -- --category=assistance --force`
- Legacy API script (`data:usaspending`) retained for reference — superseded by bulk approach (FIX-118)

### Regulations.gov
- Active proposals only (open for comment + recently closed)
- No archived/historical rulemaking
- API key: `REGULATIONS_GOV_API_KEY`
- Update schedule: hourly for active periods
- Script: `pnpm --filter @civitics/data data:regulations`

### CourtListener
- Federal judges and case metadata — **not opinion text** (too large)
- Free registration required
- Update schedule: daily at 2am
- Script: `pnpm --filter @civitics/data data:courtlistener`

### OpenStates
**Bulk-first, API as fallback** (FIX-160).

| Source | Access | Cadence | Coverage |
|---|---|---|---|
| `data.openstates.org/people/current/{abbr}.csv` | Public, no auth | Continuous | All 50 states + DC + territories. Basic legislator fields (id, name, party, district, chamber, contact). **No term dates.** |
| OpenStates v3 API (`/people`, `/bills`) | `OPENSTATES_API_KEY`, 250 calls/day | Weekly | Term dates + state bills. People bulk eliminates the per-state `/people` paginated calls, leaving the full quota for `/bills`. |
| `open.pluralpolicy.com/data/session-csv/` | Plural Policy login required | Monthly | Bill CSVs per state per session. Not currently used — gated behind a Django session that the API key doesn't satisfy. |

Scripts:
- `pnpm --filter @civitics/data data:states` — bulk people pipeline (default; runs daily via nightly orchestrator). Calls `link_officials_to_districts()` at the end so the district cross-link survives the wholesale metadata-jsonb rewrite.
- `pnpm --filter @civitics/data data:states-api` — full API pipeline (people + bills, weekly). Use when term dates need refreshing or the bulk CSV is stale.

### Census TIGER districts (FIX-160 maps integration)
- State legislative district boundaries (SLD-U + SLD-L) for all 50 states.
- Source: `https://www2.census.gov/geo/tiger/TIGER2024/SLD{U,L}/tl_2024_{ss}_{sldu,sldl}.zip` — public, no auth.
- ~197 MB downloaded per run (50 states × 2 chambers × 1–6 MB each); persisted as ~30–50 MB of MULTIPOLYGON geometry in `jurisdictions.boundary_geometry`.
- Skipped: DC (no SLDs), Nebraska SLDL (unicameral — only SLDU published).
- Cadence: annual (Census TIGER refresh). Not in the nightly orchestrator.
- Script: `pnpm --filter @civitics/data data:districts`

---

## Update Schedules

- **Hourly:** Active proposal status, comment period deadlines
- **Daily (2am):** Spending data, voting records, new bills, court metadata
- **Weekly:** FEC bulk download, full reconciliation, AI summary regeneration, search index rebuild

---

## Entity Connections Pipeline

After all source pipelines run, the connections pipeline derives `entity_connections` rows from the ingested data:
- `donation` connections: from financial_relationships
- `vote_yes` / `vote_no` connections: from votes + proposals
- `oversight` connections: from agency–proposal relationships
- `appointment` connections: from career_history

Script: `pnpm --filter @civitics/data data:connections`

This must run AFTER all source pipelines. The master orchestrator handles ordering.

---

## Two Pending Data Sources

These require a privacy.com virtual card to set up accounts:
- **Cloudflare R2** — storage migration from Supabase Storage
- **Mapbox** — map tiles and geocoding API key

Pipeline code is ready; waiting on account/payment method.

---

## Full 2GB FEC Individual File

The individual-level FEC donor file (`indiv24.zip`, ~2GB) is pending Cloudflare R2 setup.
Too large to process through Supabase Storage. Once R2 is available:
- Download to temp dir
- Process in streaming chunks
- Match individuals to `financial_entities`
- Delete immediately after processing
