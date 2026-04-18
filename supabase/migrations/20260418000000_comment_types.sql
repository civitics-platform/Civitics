-- =============================================================================
-- 20260418000000_comment_types.sql
-- Structured comment system for civic_initiative_arguments.
--
-- Changes:
--   1. Add `comment_type text` column (+ index) to civic_initiative_arguments
--   2. Drop NOT NULL on `side` — the column becomes vestigial; new inserts set null
--   3. Backfill: map legacy side='for'/'against' to support/oppose on top-level rows
--   4. Add `parent_problem_id` + `from_comment_id` columns on civic_initiatives,
--      providing the schema hook for future "turn a solution comment into an
--      initiative" promotion flow (no UI yet).
--
-- Valid comment_type values are enforced at the application layer, not via a
-- DB enum — we want to add new types without ALTER TYPE rituals.
-- =============================================================================

-- ── 1. comment_type on civic_initiative_arguments ────────────────────────────

ALTER TABLE public.civic_initiative_arguments
  ADD COLUMN IF NOT EXISTS comment_type text;

CREATE INDEX IF NOT EXISTS idx_civic_args_comment_type
  ON public.civic_initiative_arguments(initiative_id, comment_type);

-- ── 2. side becomes optional ─────────────────────────────────────────────────
-- Keep the column so legacy rows survive; new inserts won't set it.

ALTER TABLE public.civic_initiative_arguments
  ALTER COLUMN side DROP NOT NULL;

-- ── 3. Backfill comment_type from legacy side values ─────────────────────────
-- Only for top-level arguments — replies remain untyped by default.
-- Null comment_type is treated as "discussion" at read time.

UPDATE public.civic_initiative_arguments
   SET comment_type = 'support'
 WHERE comment_type IS NULL
   AND side = 'for'
   AND parent_id IS NULL;

UPDATE public.civic_initiative_arguments
   SET comment_type = 'oppose'
 WHERE comment_type IS NULL
   AND side = 'against'
   AND parent_id IS NULL;

-- ── 4. Solution-promotion schema hooks on civic_initiatives ──────────────────
-- parent_problem_id: points to the problem-stage initiative this initiative
--   was promoted from (if any). Nullable for normal initiatives.
-- from_comment_id:   points to the specific solution-type comment that was
--   promoted. Nullable; set only when promotion flow creates the initiative.

ALTER TABLE public.civic_initiatives
  ADD COLUMN IF NOT EXISTS parent_problem_id UUID
    REFERENCES public.civic_initiatives(id) ON DELETE SET NULL;

ALTER TABLE public.civic_initiatives
  ADD COLUMN IF NOT EXISTS from_comment_id UUID
    REFERENCES public.civic_initiative_arguments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS civic_initiatives_parent_problem
  ON public.civic_initiatives(parent_problem_id);

CREATE INDEX IF NOT EXISTS civic_initiatives_from_comment
  ON public.civic_initiatives(from_comment_id);
