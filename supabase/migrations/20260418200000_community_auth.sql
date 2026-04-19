-- =============================================================================
-- 20260418200000_community_auth.sql
-- Community & Auth — follows, notifications, content moderation
--
-- FIX-055: Follow officials & agencies
-- FIX-056: Email notifications via Resend
-- FIX-057: Content moderation (flag + admin review queue)
-- =============================================================================

-- ── Enums ────────────────────────────────────────────────────────────────────

CREATE TYPE follow_entity_type AS ENUM ('official', 'agency');

CREATE TYPE notification_event_type AS ENUM (
  'official_vote',
  'new_proposal',
  'initiative_status'
);

CREATE TYPE flag_content_type AS ENUM (
  'civic_comment',
  'official_community_comment'
);

CREATE TYPE flag_reason AS ENUM (
  'spam',
  'harassment',
  'off_topic',
  'misinformation',
  'other'
);

-- ── Table: user_follows ──────────────────────────────────────────────────────
-- A user can follow an official or agency; notifications fan out from here.
-- entity_id is a UUID pointing to officials.id or agencies.id (no FK — supports
-- either entity without a join table per type).

CREATE TABLE IF NOT EXISTS user_follows (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type   follow_entity_type NOT NULL,
  entity_id     UUID NOT NULL,
  email_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS user_follows_user        ON user_follows(user_id);
CREATE INDEX IF NOT EXISTS user_follows_entity      ON user_follows(entity_type, entity_id);

ALTER TABLE user_follows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_follows_select_own"
  ON user_follows FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "user_follows_insert_own"
  ON user_follows FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_follows_delete_own"
  ON user_follows FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "user_follows_update_own"
  ON user_follows FOR UPDATE
  USING (auth.uid() = user_id);

-- ── Table: notifications ─────────────────────────────────────────────────────
-- Per-user notification feed. Populated by /api/cron/notify-followers or
-- by direct inserts from existing flows (e.g. official responded to initiative).

CREATE TABLE IF NOT EXISTS notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type    notification_event_type NOT NULL,
  entity_type   follow_entity_type,
  entity_id     UUID,
  title         TEXT NOT NULL,
  body          TEXT,
  link          TEXT,
  is_read       BOOLEAN NOT NULL DEFAULT false,
  email_sent    BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_user_unread
  ON notifications(user_id, created_at DESC) WHERE is_read = false;

CREATE INDEX IF NOT EXISTS notifications_user_all
  ON notifications(user_id, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifications_select_own"
  ON notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "notifications_update_own"
  ON notifications FOR UPDATE
  USING (auth.uid() = user_id);

-- Inserts happen via service role (createAdminClient) from server-side flows.

-- ── Table: content_flags ─────────────────────────────────────────────────────
-- User-submitted flags against community comments. Admins review and resolve.
-- Does not cover civic_initiative_arguments — those have their own flag table
-- (civic_initiative_argument_flags, see 20260411030000).

CREATE TABLE IF NOT EXISTS content_flags (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type   flag_content_type NOT NULL,
  content_id     UUID NOT NULL,
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason         flag_reason NOT NULL DEFAULT 'other',
  note           TEXT CHECK (char_length(note) <= 500),
  resolved       BOOLEAN NOT NULL DEFAULT false,
  resolved_at    TIMESTAMPTZ,
  resolved_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  action_taken   TEXT,  -- 'dismissed' | 'deleted' | null
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(content_type, content_id, user_id)
);

CREATE INDEX IF NOT EXISTS content_flags_unresolved
  ON content_flags(created_at DESC) WHERE resolved = false;

CREATE INDEX IF NOT EXISTS content_flags_content
  ON content_flags(content_type, content_id);

ALTER TABLE content_flags ENABLE ROW LEVEL SECURITY;

-- Users can see only their own flags; admins read via service role.
CREATE POLICY "content_flags_select_own"
  ON content_flags FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "content_flags_insert_own"
  ON content_flags FOR INSERT
  WITH CHECK (auth.uid() = user_id);
