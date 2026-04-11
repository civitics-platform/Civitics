-- ─── Civic Initiatives Sprint 6: Milestone event tracking ────────────────────
-- Prevents double-firing of civic milestone notifications when signature
-- thresholds are crossed. One row per initiative per milestone.

CREATE TABLE IF NOT EXISTS civic_initiative_milestone_events (
  id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id     UUID    NOT NULL REFERENCES civic_initiatives(id) ON DELETE CASCADE,

  -- Milestone key — matches THRESHOLDS in _lib/milestones.ts and SignaturePanel.tsx
  milestone         TEXT    NOT NULL
    CHECK (milestone IN ('listed', 'notify_officials', 'response_window', 'featured')),

  -- Counts at the moment the milestone fired (audit trail)
  constituent_count INT     NOT NULL DEFAULT 0,
  total_count       INT     NOT NULL DEFAULT 0,

  fired_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Idempotency: each milestone fires at most once per initiative
  UNIQUE(initiative_id, milestone)
);

CREATE INDEX IF NOT EXISTS civic_milestone_initiative
  ON civic_initiative_milestone_events(initiative_id);

-- RLS: public read; no user INSERT policy — system-only via createAdminClient()
ALTER TABLE civic_initiative_milestone_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "civic_milestones_select_all"
  ON civic_initiative_milestone_events
  FOR SELECT USING (true);

-- DOWN: DROP TABLE IF EXISTS civic_initiative_milestone_events CASCADE;
