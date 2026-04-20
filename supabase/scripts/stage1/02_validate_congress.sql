-- =============================================================================
-- Stage 1B · Validation: Congress backfill parity checks
--
-- Compares public.* vs shadow.* after 01_backfill_congress.sql. All assertions
-- raise NOTICE on match and RAISE EXCEPTION on drift beyond the tolerance
-- window so this script fails loudly in a CI-ish context.
--
-- Run from psql:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -f supabase/scripts/stage1/02_validate_congress.sql
-- =============================================================================

\echo '============================================================'
\echo 'Stage 1 validation: public vs shadow congress parity'
\echo '============================================================'

-- ── Parity check 1: proposals ───────────────────────────────────────────────
--
-- shadow.proposals count for congress-backfilled rows must equal public source
-- count exactly (id is preserved; every public row maps to exactly one shadow
-- row).

DO $$
DECLARE
  pub_count INTEGER;
  shd_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO pub_count
  FROM public.proposals
  WHERE source_ids ? 'congress_gov_bill';

  SELECT COUNT(*) INTO shd_count
  FROM shadow.proposals
  WHERE metadata ? 'legacy_bill_number';

  RAISE NOTICE 'proposals: public=% shadow=%', pub_count, shd_count;

  IF pub_count <> shd_count THEN
    RAISE EXCEPTION 'proposals parity FAILED — drift of % rows', pub_count - shd_count;
  END IF;
END $$;

-- ── Parity check 2: bill_details ────────────────────────────────────────────
--
-- Every shadow.proposals row of type bill/resolution/amendment with a
-- congress_gov ref should have a shadow.bill_details row.

DO $$
DECLARE
  prop_count INTEGER;
  bd_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO prop_count
  FROM shadow.proposals
  WHERE metadata ? 'legacy_bill_number'
    AND type IN ('bill','resolution','amendment');

  SELECT COUNT(*) INTO bd_count
  FROM shadow.bill_details bd
  JOIN shadow.proposals p ON p.id = bd.proposal_id
  WHERE p.metadata ? 'legacy_bill_number';

  RAISE NOTICE 'bill_details: proposals=% details=%', prop_count, bd_count;

  IF prop_count <> bd_count THEN
    RAISE EXCEPTION 'bill_details parity FAILED — % proposals missing bill_details', prop_count - bd_count;
  END IF;
END $$;

-- ── Parity check 3: external_source_refs ────────────────────────────────────

DO $$
DECLARE
  pub_count INTEGER;
  ref_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO pub_count
  FROM public.proposals
  WHERE source_ids ? 'congress_gov_bill'
    AND source_ids->>'congress_gov_bill' IS NOT NULL;

  SELECT COUNT(*) INTO ref_count
  FROM shadow.external_source_refs
  WHERE source = 'congress_gov';

  RAISE NOTICE 'external_source_refs: public=% refs=%', pub_count, ref_count;

  IF pub_count <> ref_count THEN
    RAISE EXCEPTION 'refs parity FAILED — drift of % rows', pub_count - ref_count;
  END IF;
END $$;

-- ── Parity check 4: votes (with drift tolerance) ────────────────────────────
--
-- Public votes without `voted_at` are skipped in the backfill. Duplicates
-- under the same (roll_call_id, official_id) are dropped by ON CONFLICT.
-- Tolerance: up to 100 rows of acceptable drift from source-feed dupes.

DO $$
DECLARE
  pub_count INTEGER;
  shd_count INTEGER;
  drift INTEGER;
BEGIN
  SELECT COUNT(*) INTO pub_count
  FROM public.votes v
  JOIN public.proposals p ON p.id = v.proposal_id
  WHERE p.source_ids ? 'congress_gov_bill'
    AND v.voted_at IS NOT NULL;

  SELECT COUNT(*) INTO shd_count FROM shadow.votes;

  drift := pub_count - shd_count;
  RAISE NOTICE 'votes: public=% shadow=% drift=%', pub_count, shd_count, drift;

  IF drift > 100 OR drift < 0 THEN
    RAISE EXCEPTION 'votes parity FAILED — drift % outside tolerance ±100', drift;
  END IF;
END $$;

-- ── Spot check: 10 random bills + their votes ───────────────────────────────
--
-- Cheap eyeball comparison. Shows legacy_bill_number vs new bill_details
-- columns side by side.

\echo ''
\echo 'Spot check (10 random bills):'
SELECT
  p.id,
  p.metadata->>'legacy_bill_number'      AS legacy_num,
  bd.bill_number                          AS new_num,
  bd.session                              AS session,
  bd.chamber                              AS chamber,
  p.type,
  p.status,
  LEFT(p.title, 60)                       AS title_prefix
FROM shadow.proposals p
JOIN shadow.bill_details bd ON bd.proposal_id = p.id
WHERE p.metadata ? 'legacy_bill_number'
ORDER BY RANDOM()
LIMIT 10;

-- ── Spot check: roll_call_id distribution ───────────────────────────────────
--
-- Confirms we're storing multiple roll calls per bill now (the fix for the
-- old (official_id, proposal_id) unique constraint that was silently dropping
-- everything after the first roll call per bill).

\echo ''
\echo 'Roll-call distribution — bills with >1 roll_call_id:'
SELECT
  v.bill_proposal_id,
  COUNT(DISTINCT v.roll_call_id) AS distinct_rolls,
  bd.bill_number,
  p.title
FROM shadow.votes v
JOIN shadow.bill_details bd ON bd.proposal_id = v.bill_proposal_id
JOIN shadow.proposals p     ON p.id           = v.bill_proposal_id
GROUP BY v.bill_proposal_id, bd.bill_number, p.title
HAVING COUNT(DISTINCT v.roll_call_id) > 1
ORDER BY COUNT(DISTINCT v.roll_call_id) DESC
LIMIT 10;

-- ── Spot check: vote_question promoted to first-class column ────────────────

\echo ''
\echo 'Sample of first-class vote_question values (should not be null/empty):'
SELECT
  COUNT(*) FILTER (WHERE vote_question IS NOT NULL AND vote_question <> '') AS with_question,
  COUNT(*) FILTER (WHERE vote_question IS NULL OR vote_question = '')       AS without_question,
  COUNT(*)                                                                   AS total
FROM shadow.votes;

\echo ''
\echo '============================================================'
\echo 'Validation complete. If you reached here, all parity checks passed.'
\echo '============================================================'
