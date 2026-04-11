-- =============================================================================
-- 20260411030000_civic_initiatives_sprint3.sql
-- Civic Initiatives Sprint 3: argument board
-- Two new tables: civic_initiative_arguments + civic_initiative_argument_votes
-- =============================================================================

-- ── Enums ─────────────────────────────────────────────────────────────────────

CREATE TYPE argument_side AS ENUM ('for', 'against');
CREATE TYPE argument_flag  AS ENUM ('off_topic', 'misleading', 'duplicate', 'other');

-- ── Table: civic_initiative_arguments ─────────────────────────────────────────
-- Top-level arguments (side = for | against) and threaded replies.
-- Replies have parent_id set; side is inherited from the parent.

CREATE TABLE IF NOT EXISTS civic_initiative_arguments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id   UUID NOT NULL REFERENCES civic_initiatives(id) ON DELETE CASCADE,
  parent_id       UUID REFERENCES civic_initiative_arguments(id) ON DELETE CASCADE,
  side            argument_side NOT NULL,
  body            TEXT NOT NULL CHECK (char_length(body) BETWEEN 10 AND 1000),
  author_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  is_deleted      BOOLEAN NOT NULL DEFAULT false,  -- soft delete (preserve thread structure)
  flag_count      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS civic_args_initiative ON civic_initiative_arguments(initiative_id);
CREATE INDEX IF NOT EXISTS civic_args_parent     ON civic_initiative_arguments(parent_id);
CREATE INDEX IF NOT EXISTS civic_args_author     ON civic_initiative_arguments(author_id);
CREATE INDEX IF NOT EXISTS civic_args_side       ON civic_initiative_arguments(initiative_id, side);

-- ── Table: civic_initiative_argument_votes ─────────────────────────────────────
-- Upvotes on individual arguments. One per user per argument.

CREATE TABLE IF NOT EXISTS civic_initiative_argument_votes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  argument_id  UUID NOT NULL REFERENCES civic_initiative_arguments(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(argument_id, user_id)
);

CREATE INDEX IF NOT EXISTS civic_arg_votes_arg  ON civic_initiative_argument_votes(argument_id);
CREATE INDEX IF NOT EXISTS civic_arg_votes_user ON civic_initiative_argument_votes(user_id);

-- ── Table: civic_initiative_argument_flags ─────────────────────────────────────
-- User flags on arguments. One per user per argument.

CREATE TABLE IF NOT EXISTS civic_initiative_argument_flags (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  argument_id  UUID NOT NULL REFERENCES civic_initiative_arguments(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  flag_type    argument_flag NOT NULL DEFAULT 'other',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(argument_id, user_id)
);

CREATE INDEX IF NOT EXISTS civic_arg_flags_arg  ON civic_initiative_argument_flags(argument_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE civic_initiative_arguments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE civic_initiative_argument_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE civic_initiative_argument_flags ENABLE ROW LEVEL SECURITY;

-- Arguments: public read
CREATE POLICY "civic_args_select_all"
  ON civic_initiative_arguments FOR SELECT
  USING (true);

-- Arguments: authenticated users can insert their own
CREATE POLICY "civic_args_insert_own"
  ON civic_initiative_arguments FOR INSERT
  TO authenticated
  WITH CHECK (author_id = auth.uid());

-- Arguments: authors can soft-delete their own (UPDATE is_deleted)
CREATE POLICY "civic_args_update_own"
  ON civic_initiative_arguments FOR UPDATE
  TO authenticated
  USING (author_id = auth.uid());

-- Votes: public read
CREATE POLICY "civic_arg_votes_select_all"
  ON civic_initiative_argument_votes FOR SELECT
  USING (true);

-- Votes: authenticated users can insert their own
CREATE POLICY "civic_arg_votes_insert_own"
  ON civic_initiative_argument_votes FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Votes: users can remove their own votes
CREATE POLICY "civic_arg_votes_delete_own"
  ON civic_initiative_argument_votes FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- Flags: public read
CREATE POLICY "civic_arg_flags_select_all"
  ON civic_initiative_argument_flags FOR SELECT
  USING (true);

-- Flags: authenticated users can insert their own
CREATE POLICY "civic_arg_flags_insert_own"
  ON civic_initiative_argument_flags FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ── Trigger: updated_at ───────────────────────────────────────────────────────
-- Reuse the existing set_updated_at() function from 0001_initial_schema.sql

CREATE TRIGGER set_civic_args_updated_at
  BEFORE UPDATE ON civic_initiative_arguments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
