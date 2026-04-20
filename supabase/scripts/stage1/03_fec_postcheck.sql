-- =============================================================================
-- Stage 1B · Post-check: FEC bulk pipeline shadow writes
--
-- Runs AFTER `pnpm --filter @civitics/data data:fec-bulk` completes. Validates
-- that the Stage 1B shadow-native rewrite produced sensible output — no drift
-- from public (this source is rebuilt from scratch per Decision #4, so there
-- is nothing to compare against), just invariants on the new shadow tables.
--
-- Run from psql, local Supabase:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -f supabase/scripts/stage1/03_fec_postcheck.sql
-- =============================================================================

\echo '============================================================'
\echo 'Stage 1 post-check: FEC bulk → shadow'
\echo '============================================================'

-- ── Invariant 1: row counts are non-zero ────────────────────────────────────

DO $$
DECLARE
  entity_count INTEGER;
  rel_count    INTEGER;
BEGIN
  SELECT COUNT(*) INTO entity_count FROM shadow.financial_entities
  WHERE fec_committee_id IS NOT NULL;

  SELECT COUNT(*) INTO rel_count FROM shadow.financial_relationships
  WHERE relationship_type = 'donation';

  RAISE NOTICE 'FEC entities (with fec_committee_id): %', entity_count;
  RAISE NOTICE 'donation relationships:               %', rel_count;

  IF entity_count = 0 THEN
    RAISE EXCEPTION 'No FEC committees written — did the pipeline run?';
  END IF;
  IF rel_count = 0 THEN
    RAISE EXCEPTION 'No donation relationships written — did pas224 match any candidates?';
  END IF;
END $$;

-- ── Invariant 2: every donation has from=financial_entity, to=official ──────

DO $$
DECLARE
  bad INTEGER;
BEGIN
  SELECT COUNT(*) INTO bad
  FROM shadow.financial_relationships
  WHERE relationship_type = 'donation'
    AND (from_type <> 'financial_entity' OR to_type <> 'official');

  RAISE NOTICE 'donations with wrong polymorphic from/to: %', bad;
  IF bad > 0 THEN
    RAISE EXCEPTION 'Found % donation rows with unexpected polymorphic shape', bad;
  END IF;
END $$;

-- ── Invariant 3: every donation from_id points at a real entity ─────────────

DO $$
DECLARE
  orphaned INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphaned
  FROM shadow.financial_relationships r
  LEFT JOIN shadow.financial_entities e ON e.id = r.from_id
  WHERE r.relationship_type = 'donation'
    AND r.from_type         = 'financial_entity'
    AND e.id IS NULL;

  RAISE NOTICE 'donations with orphan from_id: %', orphaned;
  IF orphaned > 0 THEN
    RAISE EXCEPTION 'Found % donation rows whose from_id has no matching financial_entity', orphaned;
  END IF;
END $$;

-- ── Invariant 4: every donation to_id points at a real public.officials row ─

DO $$
DECLARE
  orphaned INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphaned
  FROM shadow.financial_relationships r
  LEFT JOIN public.officials o ON o.id = r.to_id
  WHERE r.relationship_type = 'donation'
    AND r.to_type           = 'official'
    AND o.id IS NULL;

  RAISE NOTICE 'donations with orphan to_id: %', orphaned;
  IF orphaned > 0 THEN
    RAISE EXCEPTION 'Found % donation rows whose to_id has no matching public.officials row', orphaned;
  END IF;
END $$;

-- ── Invariant 5: temporal CHECK constraint behavior ─────────────────────────
--   donations are one-off events → occurred_at NOT NULL, started_at IS NULL

DO $$
DECLARE
  bad_temporal INTEGER;
BEGIN
  SELECT COUNT(*) INTO bad_temporal
  FROM shadow.financial_relationships
  WHERE relationship_type = 'donation'
    AND (occurred_at IS NULL OR started_at IS NOT NULL OR ended_at IS NOT NULL);

  RAISE NOTICE 'donations with bad temporal shape: %', bad_temporal;
  IF bad_temporal > 0 THEN
    RAISE EXCEPTION 'Found % donation rows violating the one-off temporal model', bad_temporal;
  END IF;
END $$;

-- ── Invariant 6: entity_type is populated sensibly ──────────────────────────

\echo ''
\echo 'Entity type distribution (PAC committees):'
SELECT entity_type, COUNT(*) AS count
FROM shadow.financial_entities
WHERE fec_committee_id IS NOT NULL
GROUP BY entity_type
ORDER BY count DESC;

-- ── Invariant 7: cycle_year is set and consistent ───────────────────────────

\echo ''
\echo 'Cycle-year distribution:'
SELECT cycle_year, COUNT(*) AS donation_count
FROM shadow.financial_relationships
WHERE relationship_type = 'donation'
GROUP BY cycle_year
ORDER BY cycle_year DESC;

-- ── Spot check: top 10 PAC donors by total_donated_cents ────────────────────
-- Sanity expectation: EMILY's List, NRA, SEIU, NEA, DCCC, NRCC, etc.

\echo ''
\echo 'Top 10 PAC donors by total_donated_cents:'
SELECT
  display_name,
  entity_type,
  industry,
  fec_committee_id,
  (total_donated_cents / 100)::BIGINT || ' USD' AS total_donated
FROM shadow.financial_entities
WHERE fec_committee_id IS NOT NULL
  AND total_donated_cents > 0
ORDER BY total_donated_cents DESC
LIMIT 10;

-- ── Spot check: top 10 donation relationships by amount ─────────────────────

\echo ''
\echo 'Top 10 donation relationships by amount:'
SELECT
  e.display_name                                 AS pac,
  o.full_name                                    AS recipient,
  o.role_title                                   AS role,
  r.cycle_year,
  (r.amount_cents / 100)::BIGINT || ' USD'       AS amount,
  r.occurred_at                                  AS latest_txn_date
FROM shadow.financial_relationships r
JOIN shadow.financial_entities e ON e.id = r.from_id
JOIN public.officials          o ON o.id = r.to_id
WHERE r.relationship_type = 'donation'
ORDER BY r.amount_cents DESC
LIMIT 10;

-- ── Spot check: officials with the most distinct PAC donors ─────────────────

\echo ''
\echo 'Officials with the most distinct PAC donors:'
SELECT
  o.full_name,
  o.role_title,
  COUNT(DISTINCT r.from_id)                     AS distinct_pacs,
  (SUM(r.amount_cents) / 100)::BIGINT || ' USD' AS total_pac_received
FROM shadow.financial_relationships r
JOIN public.officials o ON o.id = r.to_id
WHERE r.relationship_type = 'donation'
  AND r.to_type           = 'official'
GROUP BY o.full_name, o.role_title
ORDER BY distinct_pacs DESC
LIMIT 10;

\echo ''
\echo '============================================================'
\echo 'Post-check complete. All invariants held; spot checks above.'
\echo '============================================================'
