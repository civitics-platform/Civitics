-- Add federal spending aggregate columns to financial_entities.
-- These are maintained by refresh_spending_totals(), called from the
-- nightly orchestrator after each USASpending bulk pipeline run.

-- Disable statement timeout for this session — the ALTER TABLE needs an
-- ACCESS EXCLUSIVE lock and may wait if financial_entities is busy.
-- lock_timeout provides a safety valve: fail in 30s if the lock is held.
SET statement_timeout = 0;
SET lock_timeout = '30s';

ALTER TABLE public.financial_entities
  ADD COLUMN IF NOT EXISTS total_contract_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_grant_cents    BIGINT NOT NULL DEFAULT 0;

-- Backfill from any existing rows (no-op on prod until the bulk pipeline runs).
UPDATE public.financial_entities fe
SET
  total_contract_cents = COALESCE((
    SELECT SUM(amount_cents) FROM public.financial_relationships
    WHERE to_id = fe.id AND relationship_type = 'contract'
  ), 0),
  total_grant_cents = COALESCE((
    SELECT SUM(amount_cents) FROM public.financial_relationships
    WHERE to_id = fe.id AND relationship_type = 'grant'
  ), 0)
WHERE fe.id IN (
  SELECT DISTINCT to_id FROM public.financial_relationships
  WHERE relationship_type IN ('contract', 'grant')
);

-- Reusable refresh function called post-pipeline.
-- Recomputes contract + grant totals for all entities that have
-- any financial_relationships of those types.
CREATE OR REPLACE FUNCTION public.refresh_spending_totals()
RETURNS void LANGUAGE sql AS $$
  UPDATE public.financial_entities fe
  SET
    total_contract_cents = COALESCE(agg.contract_sum, 0),
    total_grant_cents    = COALESCE(agg.grant_sum, 0)
  FROM (
    SELECT
      to_id,
      SUM(CASE WHEN relationship_type = 'contract' THEN amount_cents ELSE 0 END) AS contract_sum,
      SUM(CASE WHEN relationship_type = 'grant'    THEN amount_cents ELSE 0 END) AS grant_sum
    FROM public.financial_relationships
    WHERE relationship_type IN ('contract', 'grant')
    GROUP BY to_id
  ) agg
  WHERE fe.id = agg.to_id;
$$;
