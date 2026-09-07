-- FIX-1165 — refresh_group_donor_rollup() gets a scheduled owner.
--
-- ============================================================================
-- THE FINDING
-- ============================================================================
-- public.refresh_group_donor_rollup() had NO scheduled owner. Checked BY NAME
-- in all three places a caller can hide, on prod, 2026-09-07:
--
--   cron.job.command  ILIKE '%group_donor_rollup%'          -> 0 rows
--   pg_proc.prosrc    ILIKE '%refresh_group_donor_rollup%'  -> 0 rows
--                                                    (excluding itself)
--   .github/workflows -> rebuild-entity-connections.yml only, and FIX-688
--                        stripped its `schedule:` triggers when the EC rebuild
--                        moved into pg_cron. It is workflow_dispatch-only —
--                        manual break-glass, not an owner.
--
-- So the table was re-derived purely as a SIDE EFFECT of remediation-script
-- tails: three separate scripts call it unconditionally at the end of a run.
-- That is not a schedule. It means group_donor_rollup was fresh exactly when
-- someone happened to land a data remediation, and arbitrarily stale otherwise,
-- and it is why FIX-1165's rule is "every tail step scales with the manifest OR
-- has a scheduled owner" rather than "…or looks like someone is handling it".
--
-- The evidence that this was live and not theoretical: group_donor_rollup_summary
-- carried max(refreshed_at) = 2026-09-07 20:56 UTC when this was written. That
-- refresh was the FIX-954 set-2 apply's tail — a 28-row remediation — and it only
-- ran at all because the hand-cancel of the PRECEDING tail step was swallowed by
-- a catch that rethrew only BudgetExceeded, so the loop advanced instead of
-- stopping. The rollup's freshness was, literally, a side effect of a bug in the
-- error handling of an unrelated script. Both halves are fixed: the scripts now
-- stop on a cancel and defer this step, and this migration gives it an owner.
--
-- Readers: apps/civitics/app/api/graph/group/route.ts reads
-- group_donor_rollup_summary (the materialized-vs-not disambiguator) and then
-- group_donor_rollup (indexed top-N, zero-join). A stale rollup is not a wrong
-- page — the route degrades to live compute — but it is a slow one.
--
-- ============================================================================
-- SIZING — measured, not projected
-- ============================================================================
--   prod   414.3 s, ONE call, from pg_stat_statements (the 2026-09-07 20:48
--          -> 20:56 firing described above). This is a real prod measurement of
--          the real function against the real data, which is worth more than
--          any clone extrapolation and is what the budget is sized off.
--   clone   43.6 s (579 cohorts, 539,052 donor rows, local Docker,
--          max_parallel_workers_per_gather = 0).
--
-- The clone understates by 9.5x, which is the usual shape on this instance:
-- prod runs 256 MB shared_buffers at ~54% cache hit and this function does a
-- full DELETE + re-INSERT of a 542k-row table, so it is I/O-bound in exactly
-- the way a warm clone is not. Anyone re-sizing this should quote the prod
-- number; clone x xN is not a bound here and never was.
--
-- budget_seconds = 1800. Outside bound, ~4.3x the single observed prod run,
-- matching what every other bounded job on this instance carries. A cancel here
-- is SAFE by construction: the function is one transaction (DELETE then INSERT,
-- deliberately DELETE and not TRUNCATE so concurrent request-path reads keep
-- the prior snapshot until commit), so a cancelled run rolls back whole and the
-- route keeps serving the previous rollup. The first firings re-size it with
-- real numbers.
--
-- ============================================================================
-- SCHEDULE — Wed 03:10 UTC ('10 3 * * 3')
-- ============================================================================
-- Weekly, hour 03, deliberately NOT Tuesday and NOT Monday:
--   * Tuesday carries the weekly stack (00:05 agency-staffing, 00:47
--     refresh-derived-mvs-weekly, 14:00 treemap-individuals-global, 15:00
--     donor-party-rollup) — three of those four last failed cancelled or on a
--     startup timeout, and nothing new belongs on that day.
--   * Monday 01:00 / 01:30 are the fr- and officials- vacuum owners.
-- Wednesday 03:10 leaves the run (~7 min observed) finished ~13 minutes before
-- vote-stats-refresh at 03:30 and ~43 before platform-counts-daily at 03:53,
-- and it is well clear of the 05:45-09:00 blackout and of dpr-vacuum-analyze
-- (Wed 02:00), which is an hour ahead of it.
--
-- WEEKLY, NOT DAILY, is a deliberate under-commitment. The table's inputs are
-- governing-body membership and donation edges: membership changes on election
-- and appointment cadences, and the donation side already has a daily owner in
-- the donor rollup. A weekly floor is a large improvement on "whenever a
-- remediation lands" and can be tightened once there are firings to reason
-- from. If the first few runs show it comfortably inside its budget, moving to
-- twice-weekly is a one-line alter_job.
--
-- FOLLOW-UP, if the budget is ever hit: the function is a single unchunked
-- transaction, so the outside bound can only cancel it whole. Chunking it by
-- gb_id (the natural grain — the DELETE and both INSERTs are already keyed on
-- it) would make it resumable the way the treemap sweep is. Not done here: a
-- slow weekly job with an owner is strictly better than a fast one with none,
-- and 414 s against a 1800 s bound is not close enough to justify rewriting a
-- working function on the same day it acquires a schedule.

-- ── 1. The procedure ─────────────────────────────────────────────────────────
--
-- A PROCEDURE wrapper rather than scheduling the function directly, for one
-- reason that matters: the function returns jsonb and writes nothing to
-- data_sync_log, so a bare `SELECT refresh_group_donor_rollup()` in cron.job
-- would be invisible to every instrument on this instance —
-- list_scheduled_rollup_pipelines() builds its census from DISTINCT pipeline in
-- data_sync_log, and check_rollup_freshness counts only status='complete' rows.
-- An unlogged job is an unwatched job.

CREATE OR REPLACE PROCEDURE public.run_group_donor_rollup_refresh()
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $procedure$
DECLARE
  v_started timestamptz := clock_timestamp();
  v_result  jsonb;
BEGIN
  -- Session-scoped guard, not transaction-scoped: this procedure is CALLed, so
  -- if pg_cron ever queues a firing behind an overrunning one (which it does —
  -- it queues rather than skips), the second must decline rather than run a
  -- second full DELETE + re-INSERT concurrently with the first.
  IF NOT pg_try_advisory_xact_lock(hashtext('group_donor_rollup_refresh')::bigint) THEN
    RAISE NOTICE '[group-donor-rollup] advisory lock held — skipping';
    RETURN;
  END IF;

  SELECT public.refresh_group_donor_rollup() INTO v_result;

  -- `source: pg_cron` is load-bearing, not decoration: it is what
  -- list_scheduled_rollup_pipelines() reads to classify the driver and to
  -- correlate this pipeline to its cron job. The correlation is BY NAME via
  -- replace(jobname, '-', '_'), so the pipeline string below and the jobname in
  -- section 2 must stay in lockstep: 'group-donor-rollup-refresh' <->
  -- 'group_donor_rollup_refresh'. 'complete' is likewise the only status
  -- check_rollup_freshness counts (FIX-1140) — a non-complete row freezes the
  -- freshness clock rather than advancing it.
  INSERT INTO public.data_sync_log
    (pipeline, status, started_at, completed_at, rows_inserted, metadata)
  VALUES (
    'group_donor_rollup_refresh',
    'complete',
    v_started,
    clock_timestamp(),
    COALESCE((v_result->>'donor_rows')::bigint, 0),
    jsonb_build_object(
      'source',      'pg_cron',
      'cohorts',     v_result->'cohorts',
      'donor_rows',  v_result->'donor_rows',
      'refreshed_at', v_result->'refreshed_at'));

  RAISE NOTICE '[group-donor-rollup] complete — %', v_result;
END;
$procedure$;

REVOKE ALL ON PROCEDURE public.run_group_donor_rollup_refresh() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON PROCEDURE public.run_group_donor_rollup_refresh() TO service_role;

COMMENT ON PROCEDURE public.run_group_donor_rollup_refresh() IS
  'FIX-1165 — the scheduled owner for refresh_group_donor_rollup(), which had '
  'none: FIX-688 moved the EC rebuild to pg_cron and left this behind, after '
  'which it was re-derived only as a side effect of remediation-script tails. '
  'Driven by the group-donor-rollup-refresh pg_cron job at Wed 03:10 UTC. '
  'Writes the data_sync_log closure the freshness canary needs.';

-- ── 2. Schedule ──────────────────────────────────────────────────────────────
--
-- BY NAME (playbook D3). cron.schedule() with a name is upsert-by-name, so
-- re-running this migration re-points the same jobid rather than minting a new
-- one and orphaning the job's own run history.
--
-- NOTE FOR LOCAL: this schedules an ACTIVE job on whatever database the
-- migration is applied to, local Docker included, where it would run
-- prod-shaped work against local data. Re-park it after `supabase migration up
-- --local`:
--   SELECT cron.alter_job((SELECT jobid FROM cron.job
--                           WHERE jobname = 'group-donor-rollup-refresh'),
--                         active := false);

DO $$
DECLARE
  c_jobname  CONSTANT text := 'group-donor-rollup-refresh';
  c_sched    CONSTANT text := '10 3 * * 3';
  v_id       bigint;
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE WARNING '[fix1165] pg_cron not installed — job not scheduled';
    RETURN;
  END IF;

  SELECT cron.schedule(c_jobname, c_sched, 'CALL public.run_group_donor_rollup_refresh();')
    INTO v_id;
  RAISE NOTICE '[fix1165] scheduled % (jobid %) at %', c_jobname, v_id, c_sched;
END $$;

-- ── 3. Budget ────────────────────────────────────────────────────────────────
-- The outside bound the FIX-1063 watchdog cancels on. See SIZING above.

INSERT INTO public.cron_job_budget (jobname, budget_seconds, note)
VALUES (
  'group-donor-rollup-refresh',
  1800,
  'FIX-1165. Weekly owner for refresh_group_donor_rollup(), which had no '
  'scheduled owner at all and was re-derived only as a side effect of '
  'remediation-script tails. Sized off a REAL PROD MEASUREMENT: 414.3 s for one '
  'call in pg_stat_statements (the 2026-09-07 20:48-20:56 firing, itself a '
  'remediation tail). Clone is 43.6 s and understates by 9.5x — this function '
  'DELETEs and re-INSERTs a 542k-row table and is I/O-bound on a 256 MB '
  'shared_buffers instance at ~54% hit, so clone x N is not a bound. 1800 s is '
  '~4.3x the observed run and matches the outside bound every other bounded job '
  'here carries. A cancel is SAFE: the function is one transaction (DELETE, not '
  'TRUNCATE, so readers keep the prior snapshot until commit), so a cancelled '
  'run rolls back whole and /api/graph/group keeps serving the previous rollup.')
ON CONFLICT (jobname) DO UPDATE
  SET budget_seconds = EXCLUDED.budget_seconds,
      note           = EXCLUDED.note,
      updated_at     = now();

-- ── 4. First-seen ledger ─────────────────────────────────────────────────────
--
-- record_cron_jobs_seen() would fill this on the canary's next tick anyway, but
-- declaring it here makes the migration self-contained and closes the window in
-- between: the FIX-1150 exemption defaults to '-infinity' when a row is ABSENT
-- (absent => NOT exempt, which is what makes the default safe rather than a
-- silent suppressor), so a brand-new weekly job whose first firing is up to
-- seven days out could otherwise be reported missing before it has had any
-- chance to run.

INSERT INTO public.cron_job_first_seen (jobname, first_seen_at)
VALUES ('group-donor-rollup-refresh', now())
ON CONFLICT (jobname) DO NOTHING;
