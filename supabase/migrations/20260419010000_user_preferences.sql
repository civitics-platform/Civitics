-- =============================================================================
-- user_preferences — FIX-042 USER node in graph + Follow feature
-- =============================================================================
-- Per-user follow lists and graph anchor hints. The graph builder reads this
-- to render a synthetic USER node with followed entities at hop-1.
-- =============================================================================

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id             UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  followed_officials  UUID[] NOT NULL DEFAULT '{}',
  followed_proposals  UUID[] NOT NULL DEFAULT '{}',
  followed_agencies   UUID[] NOT NULL DEFAULT '{}',
  home_jurisdiction_id UUID REFERENCES jurisdictions(id),
  graph_root_hint     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_preferences_home_jurisdiction ON user_preferences(home_jurisdiction_id);

CREATE TRIGGER user_preferences_updated_at
  BEFORE UPDATE ON user_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_preferences_select_own"
  ON user_preferences FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "user_preferences_insert_own"
  ON user_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_preferences_update_own"
  ON user_preferences FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_preferences_delete_own"
  ON user_preferences FOR DELETE
  USING (auth.uid() = user_id);
