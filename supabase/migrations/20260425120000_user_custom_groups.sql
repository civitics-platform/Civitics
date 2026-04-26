-- =============================================================================
-- FIX-126 — user_custom_groups: per-user FocusGroup persistence
-- =============================================================================
-- Replaces localStorage-only custom groups (the Stage 1 stand-in) with a
-- DB-backed table that supports cross-device sync and the public-share
-- workflow that FIX-127's group builder will surface. Mirrors FocusGroup +
-- GroupFilter (packages/graph/src/types.ts) — `filter` is JSONB so the GraphView
-- shape stays the source of truth and additions to GroupFilter need no
-- migration.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.user_custom_groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  filter      JSONB NOT NULL,
  icon        TEXT,
  color       TEXT,
  is_public   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_custom_groups_user_idx
  ON public.user_custom_groups(user_id);

CREATE INDEX IF NOT EXISTS user_custom_groups_public_idx
  ON public.user_custom_groups(created_at DESC)
  WHERE is_public = true;

CREATE TRIGGER user_custom_groups_updated_at
  BEFORE UPDATE ON public.user_custom_groups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.user_custom_groups ENABLE ROW LEVEL SECURITY;

-- Read: own rows OR any public row.
CREATE POLICY "user_custom_groups_select"
  ON public.user_custom_groups FOR SELECT
  USING (auth.uid() = user_id OR is_public = true);

-- Write: own rows only.
CREATE POLICY "user_custom_groups_insert_own"
  ON public.user_custom_groups FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_custom_groups_update_own"
  ON public.user_custom_groups FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_custom_groups_delete_own"
  ON public.user_custom_groups FOR DELETE
  USING (auth.uid() = user_id);
