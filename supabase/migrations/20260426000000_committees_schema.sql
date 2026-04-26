-- =============================================================================
-- FIX-152 — Committees schema
-- =============================================================================
-- Adds 'committee' to the governing_body_type enum so committees can live in
-- the existing governing_bodies table, and creates official_committee_memberships
-- as a many-to-many join. officials.governing_body_id stays as the primary
-- chamber/agency affiliation; committee membership is additive and supports
-- multiple concurrent committees per official.
--
-- Prereq for FIX-153 (Congress.gov committees ingestion) and FIX-139
-- (graph "by-committee" cluster mode).
-- =============================================================================

-- ── 1. Extend governing_body_type ────────────────────────────────────────────

ALTER TYPE governing_body_type ADD VALUE IF NOT EXISTS 'committee';

-- ── 2. Membership join table ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.official_committee_memberships (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  official_id   UUID NOT NULL REFERENCES public.officials(id) ON DELETE CASCADE,
  committee_id  UUID NOT NULL REFERENCES public.governing_bodies(id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'member',
  started_at    DATE,
  ended_at      DATE,
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT official_committee_memberships_dates_chk
    CHECK (ended_at IS NULL OR started_at IS NULL OR ended_at >= started_at)
);

-- Allow re-joining the same committee at a later date (different started_at).
-- NULL started_at is treated as a single ongoing membership row.
CREATE UNIQUE INDEX IF NOT EXISTS official_committee_memberships_unique
  ON public.official_committee_memberships(official_id, committee_id, COALESCE(started_at, '0001-01-01'::date));

CREATE INDEX IF NOT EXISTS official_committee_memberships_official_idx
  ON public.official_committee_memberships(official_id);

CREATE INDEX IF NOT EXISTS official_committee_memberships_committee_idx
  ON public.official_committee_memberships(committee_id);

-- Current memberships (ended_at IS NULL) — common lookup for the graph and
-- official-detail pages.
CREATE INDEX IF NOT EXISTS official_committee_memberships_current_idx
  ON public.official_committee_memberships(committee_id, official_id)
  WHERE ended_at IS NULL;

CREATE TRIGGER official_committee_memberships_updated_at
  BEFORE UPDATE ON public.official_committee_memberships
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 3. RLS — public read, service-role write only ───────────────────────────

ALTER TABLE public.official_committee_memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_official_committee_memberships_select"
  ON public.official_committee_memberships FOR SELECT
  TO anon, authenticated
  USING (true);

-- No INSERT/UPDATE/DELETE policies → service_role (createAdminClient) is the
-- only writer, matching how officials/governing_bodies are populated by
-- pipelines.
