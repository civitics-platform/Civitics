-- =============================================================================
-- OFFICIAL COMMUNITY COMMENTS
-- Separate table for community discussion on official profile pages.
-- Mirrors civic_comments but references officials instead of proposals.
-- civic_comments is proposal-specific (proposal_id NOT NULL FK); this table
-- provides the same feature for official pages without schema changes.
-- =============================================================================

CREATE TABLE IF NOT EXISTS official_community_comments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  official_id     UUID NOT NULL REFERENCES officials(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body            TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  upvotes         INTEGER NOT NULL DEFAULT 0,
  is_deleted      BOOLEAN NOT NULL DEFAULT false,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS official_community_comments_official_id
  ON official_community_comments(official_id);

CREATE INDEX IF NOT EXISTS official_community_comments_user_id
  ON official_community_comments(user_id);

-- Auto-update updated_at on row modification
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at'
  ) THEN
    EXECUTE 'CREATE TRIGGER official_community_comments_updated_at
      BEFORE UPDATE ON official_community_comments
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()';
  END IF;
END $$;

-- RLS
ALTER TABLE official_community_comments ENABLE ROW LEVEL SECURITY;

-- Anyone can read non-deleted comments
CREATE POLICY "official_community_comments_select"
  ON official_community_comments FOR SELECT
  USING (is_deleted = false);

-- Authenticated users can insert their own comments
CREATE POLICY "official_community_comments_insert"
  ON official_community_comments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can soft-delete their own comments (UPDATE is_deleted = true)
CREATE POLICY "official_community_comments_update_own"
  ON official_community_comments FOR UPDATE
  USING (auth.uid() = user_id);
