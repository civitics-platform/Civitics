-- =============================================================================
-- Stage 1 · 04 · meetings, agenda_items, votes
--
-- First-class support for legislative meetings (Legistar-shaped local data,
-- committee hearings for federal). Votes are re-keyed to bill_details with a
-- unique key on (roll_call_id, official_id) so multiple roll calls per bill
-- no longer collapse onto one row.
--
-- Fixes from Stage 0:
--   #2  — votes unique key was (official_id, proposal_id); only first roll
--         call per bill was kept, 23505 errors swallowed silently.
--   #1  — findOrCreateProposal was overwriting proposals.title with vote
--         question strings; vote_question is now a first-class column, so
--         there's no reason to smuggle it via title.
--
-- Per L4: votes.agenda_item_id is nullable FK — null for federal votes,
-- populated for Legistar-sourced local votes.
-- =============================================================================

-- ── meetings ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shadow.meetings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  governing_body_id UUID NOT NULL REFERENCES public.governing_bodies(id),
  meeting_type      TEXT NOT NULL,             -- 'regular' | 'special' | 'committee' | 'hearing' | 'executive_session'
  title             TEXT,
  scheduled_at      TIMESTAMPTZ NOT NULL,
  location          TEXT,
  status            TEXT NOT NULL DEFAULT 'scheduled'
                      CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'postponed')),

  -- Artifact URLs (populated by scrapers incrementally)
  agenda_url        TEXT,
  minutes_url       TEXT,
  video_url         TEXT,

  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS meetings_body
  ON shadow.meetings(governing_body_id);
CREATE INDEX IF NOT EXISTS meetings_scheduled_at
  ON shadow.meetings(scheduled_at DESC);
CREATE INDEX IF NOT EXISTS meetings_status
  ON shadow.meetings(status);
CREATE INDEX IF NOT EXISTS meetings_type
  ON shadow.meetings(meeting_type);

COMMENT ON TABLE shadow.meetings IS
  'Legislative meetings (council sessions, committee hearings, etc.). Deduplicated via external_source_refs(source, external_id). Legistar-shaped.';

-- ── agenda_items ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shadow.agenda_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  meeting_id      UUID NOT NULL REFERENCES shadow.meetings(id) ON DELETE CASCADE,
  -- An agenda item usually references a proposal (bill, resolution) but not always.
  -- Public-comment windows, procedural motions, and consent calendars often do not.
  proposal_id     UUID REFERENCES shadow.proposals(id) ON DELETE SET NULL,

  sequence        INTEGER NOT NULL,           -- order on agenda
  title           TEXT NOT NULL,
  item_type       TEXT,                       -- 'discussion' | 'vote' | 'public_comment' | 'consent' | 'reading'
  description     TEXT,
  outcome         TEXT,                       -- 'passed' | 'failed' | 'tabled' | 'continued' | 'withdrawn'

  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(meeting_id, sequence)
);

CREATE INDEX IF NOT EXISTS agenda_items_meeting
  ON shadow.agenda_items(meeting_id);
CREATE INDEX IF NOT EXISTS agenda_items_proposal
  ON shadow.agenda_items(proposal_id)
  WHERE proposal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agenda_items_item_type
  ON shadow.agenda_items(item_type);

-- ── votes (rekeyed) ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shadow.votes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Votes belong to bills specifically; court cases + ballot measures have
  -- their own outcome shapes. FK enforces this at the schema level.
  bill_proposal_id UUID NOT NULL REFERENCES shadow.bill_details(proposal_id) ON DELETE CASCADE,
  official_id      UUID NOT NULL REFERENCES public.officials(id) ON DELETE CASCADE,

  -- The vote itself. Enum values match existing public.votes CHECK
  -- (critical: 'not_voting' has an underscore — see FIX-073).
  vote             TEXT NOT NULL CHECK (vote IN (
                     'yes', 'no', 'abstain', 'present', 'not_voting',
                     'paired_yes', 'paired_no'
                   )),
  voted_at         TIMESTAMPTZ NOT NULL,

  -- Roll call context — first-class, not smuggled in metadata
  roll_call_id     TEXT NOT NULL,
  vote_question    TEXT,                       -- 'On Passage' | 'On the Cloture Motion' | 'On the Amendment' | ...
  chamber          TEXT NOT NULL,              -- 'house' | 'senate' | 'council' | 'committee'
  session          TEXT,

  -- Optional link to the agenda item this vote occurred under (per L4).
  -- Null for federal votes, populated for Legistar locals.
  agenda_item_id   UUID REFERENCES shadow.agenda_items(id) ON DELETE SET NULL,

  source_url       TEXT,
  metadata         JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One vote per official per roll call. Previous schema keyed on
  -- (official_id, proposal_id) which silently dropped everything after
  -- the first roll call for a bill.
  UNIQUE(roll_call_id, official_id)
);

CREATE INDEX IF NOT EXISTS votes_bill
  ON shadow.votes(bill_proposal_id);
CREATE INDEX IF NOT EXISTS votes_official
  ON shadow.votes(official_id);
CREATE INDEX IF NOT EXISTS votes_voted_at
  ON shadow.votes(voted_at DESC);
CREATE INDEX IF NOT EXISTS votes_roll_call
  ON shadow.votes(roll_call_id);
CREATE INDEX IF NOT EXISTS votes_vote
  ON shadow.votes(vote);
CREATE INDEX IF NOT EXISTS votes_agenda_item
  ON shadow.votes(agenda_item_id)
  WHERE agenda_item_id IS NOT NULL;

COMMENT ON TABLE shadow.votes IS
  'Individual official votes on bills. Unique on (roll_call_id, official_id) — supports multiple roll calls per bill. agenda_item_id optional (populated for Legistar local votes, null for federal).';

-- DOWN:
--   DROP TABLE IF EXISTS shadow.votes CASCADE;
--   DROP TABLE IF EXISTS shadow.agenda_items CASCADE;
--   DROP TABLE IF EXISTS shadow.meetings CASCADE;
