-- =============================================================================
-- Web Vitals samples — FIX-049
-- =============================================================================
-- Captures Core Web Vitals (LCP, CLS, INP, FCP, TTFB) from next/web-vitals.
-- Aggregated periodically into platform_usage (service='vercel') for the
-- public transparency page. Individual samples retained 30 days.
-- =============================================================================

CREATE TABLE IF NOT EXISTS web_vitals_samples (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric       TEXT NOT NULL,
  value        NUMERIC NOT NULL,
  rating       TEXT,
  path         TEXT,
  exceeded     BOOLEAN NOT NULL DEFAULT false,
  user_agent   TEXT,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS web_vitals_samples_metric_recorded
  ON web_vitals_samples(metric, recorded_at DESC);
CREATE INDEX IF NOT EXISTS web_vitals_samples_exceeded
  ON web_vitals_samples(recorded_at DESC) WHERE exceeded = true;

ALTER TABLE web_vitals_samples ENABLE ROW LEVEL SECURITY;

-- Anonymous client inserts allowed (no PII; user agent + path only).
CREATE POLICY "anon insert vitals" ON web_vitals_samples
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- Public read for transparency page aggregation.
CREATE POLICY "public read vitals" ON web_vitals_samples
  FOR SELECT USING (true);
