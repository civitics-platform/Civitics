-- =============================================================================
-- Stage 1 · 03 · Proposals (core + 4 detail tables + actions)
--
-- Per Decision #2 (C + (i)): thin core `proposals` table + 1:1 detail tables
-- per type. Kills the "proposals as dumping ground" contamination where vote
-- questions become proposal titles (Stage 0 finding #1).
--
-- Detail tables:
--   bill_details       — federal/state/local legislation
--   case_details       — court cases (from CourtListener)
--   measure_details    — ballot measures (Ballotpedia, etc.)
--   initiative_details — citizen-driven initiatives (migrated from civic_initiatives per L1)
--
-- Plus proposal_actions: authoritative timeline replacing vote-question-as-title.
-- =============================================================================

-- ── Core proposals ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shadow.proposals (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type                  proposal_type NOT NULL,
  status                proposal_status NOT NULL DEFAULT 'introduced',
  jurisdiction_id       UUID NOT NULL REFERENCES jurisdictions(id),
  governing_body_id     UUID REFERENCES governing_bodies(id),

  -- Shared display fields (every civic artifact has these)
  title                 TEXT NOT NULL,
  short_title           TEXT,
  summary_plain         TEXT,
  summary_generated_at  TIMESTAMPTZ,
  summary_model         TEXT,

  -- Lifecycle dates
  introduced_at         DATE,
  last_action_at        DATE,
  resolved_at           DATE,              -- enacted | failed | withdrawn

  -- Display affordances
  external_url          TEXT,              -- canonical primary source
  full_text_url         TEXT,
  full_text_r2_key      TEXT,

  -- Search
  search_vector         TSVECTOR,

  metadata              JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS shadow_proposals_type             ON shadow.proposals(type);
CREATE INDEX IF NOT EXISTS shadow_proposals_status           ON shadow.proposals(status);
CREATE INDEX IF NOT EXISTS shadow_proposals_jurisdiction_id  ON shadow.proposals(jurisdiction_id);
CREATE INDEX IF NOT EXISTS shadow_proposals_governing_body_id ON shadow.proposals(governing_body_id);
CREATE INDEX IF NOT EXISTS shadow_proposals_last_action_at   ON shadow.proposals(last_action_at DESC);
CREATE INDEX IF NOT EXISTS shadow_proposals_updated_at       ON shadow.proposals(updated_at);
CREATE INDEX IF NOT EXISTS shadow_proposals_search_vector    ON shadow.proposals USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS shadow_proposals_title_trgm       ON shadow.proposals USING GIN(title gin_trgm_ops);

-- Reuse the existing public trigger function for search-vector maintenance
CREATE OR REPLACE FUNCTION shadow.proposals_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')),         'A') ||
    setweight(to_tsvector('english', coalesce(NEW.short_title, '')),   'B') ||
    setweight(to_tsvector('english', coalesce(NEW.summary_plain, '')), 'C');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER shadow_proposals_search_vector_trigger
  BEFORE INSERT OR UPDATE ON shadow.proposals
  FOR EACH ROW EXECUTE FUNCTION shadow.proposals_search_vector_update();

CREATE TRIGGER shadow_proposals_updated_at
  BEFORE UPDATE ON shadow.proposals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── bill_details ─────────────────────────────────────────────────────────────
--
-- Per L3: `jurisdiction_id` and `session` are denormalized from proposals core
-- to enable a compound unique index. Trigger keeps them in sync.

CREATE TABLE IF NOT EXISTS shadow.bill_details (
  proposal_id          UUID PRIMARY KEY REFERENCES shadow.proposals(id) ON DELETE CASCADE,
  bill_number          TEXT NOT NULL,       -- "HR 1234" | "SB 567" | "CF 24-1234"
  chamber              TEXT,                -- 'house' | 'senate' | 'unicameral' | 'council' | 'committee'
  session              TEXT,                -- "118th Congress" | "2024 Regular Session"
  congress_number      INTEGER,             -- federal-only; null for state/local
  primary_sponsor_id   UUID REFERENCES officials(id),
  fiscal_impact_cents  BIGINT,
  congress_gov_url     TEXT,                -- federal-specific
  legistar_matter_id   TEXT,                -- local-specific (4 of 5 pilot metros)

  -- Denormalized from shadow.proposals for compound uniqueness (per L3)
  jurisdiction_id      UUID NOT NULL,       -- kept in sync by trigger

  -- Compound uniqueness: same bill number can't appear twice in the same
  -- jurisdiction + session. External_source_refs still handles cross-source dedup.
  UNIQUE(jurisdiction_id, session, bill_number)
);

CREATE INDEX IF NOT EXISTS shadow_bill_details_bill_number     ON shadow.bill_details(bill_number);
CREATE INDEX IF NOT EXISTS shadow_bill_details_primary_sponsor ON shadow.bill_details(primary_sponsor_id);
CREATE INDEX IF NOT EXISTS shadow_bill_details_chamber         ON shadow.bill_details(chamber);
CREATE INDEX IF NOT EXISTS shadow_bill_details_legistar        ON shadow.bill_details(legistar_matter_id)
  WHERE legistar_matter_id IS NOT NULL;

-- Trigger: keep jurisdiction_id in sync with the parent proposal
CREATE OR REPLACE FUNCTION shadow.bill_details_sync_denorm() RETURNS trigger AS $$
BEGIN
  SELECT jurisdiction_id INTO NEW.jurisdiction_id
  FROM shadow.proposals WHERE id = NEW.proposal_id;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER shadow_bill_details_sync_denorm_trigger
  BEFORE INSERT OR UPDATE OF proposal_id ON shadow.bill_details
  FOR EACH ROW EXECUTE FUNCTION shadow.bill_details_sync_denorm();

-- ── case_details ─────────────────────────────────────────────────────────────
--
-- Removes the Stage 0 finding #6 hack where all federal judges had
-- governing_body_id = senateId. Court cases reference courts via court_name;
-- judges are normal officials with governing_body_type='judicial'.

CREATE TABLE IF NOT EXISTS shadow.case_details (
  proposal_id        UUID PRIMARY KEY REFERENCES shadow.proposals(id) ON DELETE CASCADE,
  docket_number      TEXT NOT NULL,
  court_name         TEXT NOT NULL,
  case_name          TEXT,
  filed_at           DATE,
  parties            JSONB NOT NULL DEFAULT '[]',  -- [{name, role, type}]
  outcome            TEXT,              -- 'pending' | 'settled' | 'judgment_for_plaintiff' | ...
  outcome_at         DATE,
  courtlistener_id   TEXT,
  pacer_id           TEXT
);

CREATE INDEX IF NOT EXISTS shadow_case_details_court          ON shadow.case_details(court_name);
CREATE INDEX IF NOT EXISTS shadow_case_details_docket         ON shadow.case_details(docket_number);
CREATE INDEX IF NOT EXISTS shadow_case_details_outcome        ON shadow.case_details(outcome);
CREATE INDEX IF NOT EXISTS shadow_case_details_courtlistener  ON shadow.case_details(courtlistener_id)
  WHERE courtlistener_id IS NOT NULL;

-- ── measure_details ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shadow.measure_details (
  proposal_id               UUID PRIMARY KEY REFERENCES shadow.proposals(id) ON DELETE CASCADE,
  ballot_id                 TEXT NOT NULL,
  election_date             DATE NOT NULL,
  election_type             TEXT,              -- 'general' | 'primary' | 'special' | 'runoff'
  measure_type              TEXT,              -- 'initiative' | 'referendum' | 'bond' | 'constitutional_amendment' | 'recall'
  yes_votes                 INTEGER,
  no_votes                  INTEGER,
  percent_yes               NUMERIC(5,2),
  passed                    BOOLEAN,
  text_summary              TEXT,              -- official ballot text
  ballotpedia_url           TEXT,

  -- Back-link to the citizen initiative that promoted to this measure, if any
  -- (forward link is on initiative_details.promoted_to_proposal_id)
  originating_initiative_id UUID REFERENCES shadow.proposals(id)
);

CREATE INDEX IF NOT EXISTS shadow_measure_details_election_date ON shadow.measure_details(election_date DESC);
CREATE INDEX IF NOT EXISTS shadow_measure_details_passed        ON shadow.measure_details(passed);
CREATE INDEX IF NOT EXISTS shadow_measure_details_measure_type  ON shadow.measure_details(measure_type);

-- ── initiative_details (per L1 decision I-B) ─────────────────────────────────
--
-- Existing civic_initiatives in public schema will be migrated at Stage 1B
-- backfill. Uses the existing initiative_* enums (defined in 20260411010026).

CREATE TABLE IF NOT EXISTS shadow.initiative_details (
  proposal_id             UUID PRIMARY KEY REFERENCES shadow.proposals(id) ON DELETE CASCADE,

  -- Lifecycle (parallel to proposal_status; kept separate because the stages
  -- don't map cleanly onto bill statuses — an initiative is never 'in_committee')
  stage                   initiative_stage NOT NULL DEFAULT 'draft',
  authorship_type         initiative_authorship NOT NULL DEFAULT 'individual',
  primary_author_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  scope                   initiative_scope NOT NULL DEFAULT 'federal',
  target_district         TEXT,

  body_md                 TEXT NOT NULL,
  issue_area_tags         TEXT[] NOT NULL DEFAULT '{}',
  quality_gate_score      JSONB NOT NULL DEFAULT '{}',

  mobilise_started_at     TIMESTAMPTZ,
  signature_threshold     INTEGER,            -- configurable per scope/jurisdiction

  resolution_type         initiative_resolution,

  -- If the initiative graduates into a downstream ballot measure or bill,
  -- point to the new proposal. (Back-link from measure_details.originating_initiative_id.)
  promoted_to_proposal_id UUID REFERENCES shadow.proposals(id)
);

CREATE INDEX IF NOT EXISTS shadow_initiative_details_stage    ON shadow.initiative_details(stage);
CREATE INDEX IF NOT EXISTS shadow_initiative_details_author   ON shadow.initiative_details(primary_author_id);
CREATE INDEX IF NOT EXISTS shadow_initiative_details_scope    ON shadow.initiative_details(scope);
CREATE INDEX IF NOT EXISTS shadow_initiative_details_tags     ON shadow.initiative_details USING GIN(issue_area_tags);
CREATE INDEX IF NOT EXISTS shadow_initiative_details_promoted ON shadow.initiative_details(promoted_to_proposal_id);

-- ── proposal_actions ─────────────────────────────────────────────────────────
--
-- Authoritative lifecycle timeline. Replaces the Stage 0 finding #1 pattern
-- of writing vote questions ("On Passage", "On Cloture Motion") as the
-- proposal's title. Vote questions now live in votes.vote_question and
-- action descriptions in proposal_actions.description.

CREATE TABLE IF NOT EXISTS shadow.proposal_actions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id     UUID NOT NULL REFERENCES shadow.proposals(id) ON DELETE CASCADE,
  action_type     TEXT NOT NULL,            -- 'introduced' | 'committee_referral' | 'committee_vote' | 'floor_vote' | 'passed_chamber' | 'enacted' | 'vetoed' | ...
  action_at       TIMESTAMPTZ NOT NULL,
  description     TEXT,                     -- free text (e.g. "On Passage", "On the Cloture Motion")
  performed_by_id UUID REFERENCES officials(id),
  source          TEXT,                     -- pipeline name that reported this
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(proposal_id, action_type, action_at)
);

CREATE INDEX IF NOT EXISTS shadow_proposal_actions_proposal_id ON shadow.proposal_actions(proposal_id);
CREATE INDEX IF NOT EXISTS shadow_proposal_actions_action_at   ON shadow.proposal_actions(action_at DESC);
CREATE INDEX IF NOT EXISTS shadow_proposal_actions_performed_by ON shadow.proposal_actions(performed_by_id)
  WHERE performed_by_id IS NOT NULL;

-- DOWN:
--   DROP TABLE IF EXISTS shadow.proposal_actions CASCADE;
--   DROP TABLE IF EXISTS shadow.initiative_details CASCADE;
--   DROP TABLE IF EXISTS shadow.measure_details CASCADE;
--   DROP TABLE IF EXISTS shadow.case_details CASCADE;
--   DROP TRIGGER IF EXISTS shadow_bill_details_sync_denorm_trigger ON shadow.bill_details;
--   DROP FUNCTION IF EXISTS shadow.bill_details_sync_denorm();
--   DROP TABLE IF EXISTS shadow.bill_details CASCADE;
--   DROP TRIGGER IF EXISTS shadow_proposals_updated_at ON shadow.proposals;
--   DROP TRIGGER IF EXISTS shadow_proposals_search_vector_trigger ON shadow.proposals;
--   DROP FUNCTION IF EXISTS shadow.proposals_search_vector_update();
--   DROP TABLE IF EXISTS shadow.proposals CASCADE;
