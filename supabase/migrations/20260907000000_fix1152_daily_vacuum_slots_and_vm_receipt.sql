-- ─────────────────────────────────────────────────────────────────────────────
-- FIX-1152 — the EC and FE vacuum owners go DAILY, placed ahead of the 06:00
-- daily, and the daily records the visibility map it ran against.
--
-- THE MEASUREMENT
-- ---------------
-- `rebuild_entity_search_index`, the ninth unit of the daily cadence, has a
-- 900s per-unit budget (FIX-1030). Its measured wall time on prod:
--
--   2026-09-02 06:00   202.5s   complete   (4h after ec-vacuum-analyze)
--   2026-09-03 06:00  1017.4s   partial    (28h after)
--   2026-09-04 06:00  1015.0s   partial    (52h after)
--   2026-09-05 06:00  1012.0s   partial    (76h after)
--   2026-09-06 06:00   234.8s   complete   (4h after ec-vacuum-analyze)
--   2026-09-07 06:00   236.0s   complete   (28h after)
--
-- A `partial` run is not cosmetic: the unit watchdog cancels at 900s and every
-- unit after it is SKIPPED. On each of 09-03/04/05 that cost five units --
-- rebuild_all_primary_sources and all four prunes -- units_ok 8 of 13 instead
-- of 13 of 13.
--
-- WHY NOT A CALENDAR RULE
-- -----------------------
-- The obvious read of those six rows is "it degrades after ~24h". It does not.
-- 09-03 and 09-07 sit at the SAME 28h offset from their vacuum and differ by
-- 781s. What separates them is write volume: the 2026-09-01 FEC catch-up landed
-- 3.65M rows, and the ec-crawl donation arm rewrote entity_connections over the
-- days that followed. 09-07 followed a quiet week.
--
-- So the driver is EC write volume, and the fix has to key on that rather than
-- on the calendar. A VACUUM already does: it skips every all-visible heap page
-- via the visibility map and (PG14+) bypasses the index pass entirely when the
-- dead-item count is small. A quiet day costs about the ANALYZE sample; a heavy
-- day costs what the writes made it cost. That is a decay-keyed gate with no
-- moving part that can be left stuck in the wrong position.
--
-- The prod record bears the shape out -- ec-vacuum-analyze's last nine runs:
-- 83.3s, 26.9s, 14.5s, 111.6s, 10.6s, 721.7s, 91.2s, 278.0s, 175.6s. The 721.7s
-- outlier is 08-26, right after a catch-up. Under a daily cadence the worst case
-- shrinks further, because each run has one day of writes to clean up, not four.
--
-- WHAT WAS CONSIDERED AND REJECTED
-- --------------------------------
-- * Having the daily itself check all-visible and vacuum when it is low. NOT
--   IMPLEMENTABLE: VACUUM cannot be issued from a function or a procedure
--   (PreventInTransactionBlock -- "VACUUM cannot be executed from a function"),
--   which is why these are separate pg_cron jobs in the first place. Toggling
--   the jobs' active flag from inside the daily would be a second scheduler
--   state that fails silent in the wrong direction.
-- * Per-table autovacuum on entity_connections (scale_factor 0.05 -> 0.02).
--   REJECTED, and packages/db/CLAUDE.md's reason stands: autovacuum keys on DEAD
--   TUPLES, not on the visibility map. At 0.05 on 10.5M rows it does not look at
--   EC until ~526k dead, and the 09-03 failure came at 325k. At 0.02 it would
--   fire during the day, cost-delay-throttled, sweeping 3.5 GB of indexes across
--   the request path on a 256MB-shared_buffers box -- the single move most
--   likely to hurt the front door. 0.05 stays.
-- * FIX-1074's pre-drain convention alone. The EC writer that matters here is
--   the IN-DB ec-crawl donation arm, which cannot vacuum what it rewrites.
--   FIX-1074 stays for the Node-side landers; it does not reach this.
-- * Ordering the unit after a Sunday/Wednesday vacuum. That is what we already
--   had, and 09-03 is the proof it is not enough.
-- * A bigger unit budget. Never: 900s stays. The budget is not the bug.
--
-- THE SLOTS
-- ---------
-- Both jobs move by cron.alter_job on the NAME, so jobid and the whole of
-- cron.job_run_details survive (FIX-946: never key on jobid).
--
--   ec-vacuum-analyze   0 2 * * 0,3    ->  30 4 * * *
--   fe-vacuum-analyze   0 2 * * 0,1,3  ->  50 4 * * *
--
-- Placement is off the startup-timeout histogram (FIX-1124 / rule 16), prod,
-- 14 days to 2026-09-07, "job startup timeout" as a share of firings per UTC
-- hour: 00 0.0%, 01 1.2%, 02 0.2%, 03 0.0%, 04 0.0%, 05 0.0%, 06 9.2%,
-- 11 4.6%, 12 11.5%, 13 10.4%, 14 6.7%, 15 9.0%, 16 7.9%, 17 7.7%.
-- Hour 04 is one of five that measured a clean zero over ~915 firings, and it
-- is the last such hour before the daily. Hour 06 -- the daily's own hour -- is
-- 9.2%, which is its own argument for not placing a dependency inside it.
--
-- SEQUENTIAL, NOT CONCURRENT. Two VACUUMs at once is two background workers on
-- an I/O-bound instance. EC goes first with 20 minutes of headroom (worst run
-- ever 721.7s = 12.0min, and that was a four-day backlog); FE's worst is 280.9s.
-- Both finish by ~05:00 worst case -- clear of the 05:15 heavy-op cutoff and
-- well clear of the 05:45-09:00 nightly blackout.
--
-- FE IS ON THE SAME FOOTING AND FOR A SHARPER REASON. Its vacuum owner is
-- fe-vacuum-analyze (FIX-975/FIX-1027) -- NOT jobid 13
-- financial-entity-totals-incremental, which is the PAUSED WRITER and stays
-- paused. Checked before changing anything: all twelve fe-vacuum-analyze
-- firings in the last 30 days SUCCEEDED, so this is not the FIX-1073/FIX-1137
-- startup-timeout class and cadence is the right lever. What decays FE is
-- fe-crawl (jobid 46, every 30 minutes, active) -- 48 writes a day against a
-- three-times-a-week vacuum. FE measured 39.8% all-visible on 09-05, in the
-- four-day Wed->Sun gap. Daily closes that gap.
--
-- Cross-ref FIX-884 (the index-only-scan degradation this protects), FIX-885
-- (the vm[] shape mirrored below), FIX-943 (the bulk-rewrite vacuum rule),
-- FIX-975, FIX-1027, FIX-1030, FIX-1031, FIX-1073, FIX-1124, FIX-1129, FIX-1144.
--
-- Fixes: FIX-1152
-- ─────────────────────────────────────────────────────────────────────────────

-- ── step 1: the two vacuum owners go daily, by NAME ─────────────────────────

DO $$
DECLARE
  c_jobname CONSTANT text := 'ec-vacuum-analyze';
  c_new     CONSTANT text := '30 4 * * *';
  v_id      bigint;
  v_old     text;
BEGIN
  SELECT jobid, schedule INTO v_id, v_old FROM cron.job WHERE jobname = c_jobname;
  IF v_id IS NULL THEN
    -- Not an error: a fresh local DB may not carry the cron catalogue yet.
    RAISE WARNING '[fix1152] job % not found — skipped', c_jobname;
    RETURN;
  END IF;
  PERFORM cron.alter_job(v_id, schedule := c_new);
  RAISE NOTICE '[fix1152] % (jobid %) -> % (was %)', c_jobname, v_id, c_new, v_old;
END $$;

DO $$
DECLARE
  c_jobname CONSTANT text := 'fe-vacuum-analyze';
  c_new     CONSTANT text := '50 4 * * *';
  v_id      bigint;
  v_old     text;
BEGIN
  SELECT jobid, schedule INTO v_id, v_old FROM cron.job WHERE jobname = c_jobname;
  IF v_id IS NULL THEN
    RAISE WARNING '[fix1152] job % not found — skipped', c_jobname;
    RETURN;
  END IF;
  PERFORM cron.alter_job(v_id, schedule := c_new);
  RAISE NOTICE '[fix1152] % (jobid %) -> % (was %)', c_jobname, v_id, c_new, v_old;
END $$;

-- ── step 2: the daily records the visibility map it ran against ─────────────
-- Re-stated from prod's pg_get_functiondef verbatim apart from the three
-- FIX-1152 additions (the v_vm declaration, the catalog read, and the
-- vm_before key on the running row), so nothing else drifts on redefinition.
-- prod pg_proc.proconfig for this procedure is NULL — there is no SET clause to
-- carry (rule 34, checked 2026-09-07); the REVOKE/GRANT block below re-asserts
-- the ACL regardless, exactly as FIX-1129 left it.

CREATE OR REPLACE PROCEDURE public.refresh_derived_mvs(IN p_cadence text)
LANGUAGE plpgsql
AS $procedure$
DECLARE
  c_lock_key bigint := hashtext('refresh_derived_mvs')::bigint;  -- shared by both cadences: never two at once
  v_log_id   uuid;
  v_units    text[];   -- SQL command per unit
  v_labels   text[];   -- human label per unit (data_sync_log / NOTICE)
  v_cmd      text;
  v_label    text;
  v_ok       int := 0;
  v_failures text[] := ARRAY[]::text[];
  i          int;
  -- FIX-1021 additions
  c_budget     double precision;         -- seconds; per-cadence, GUC-overridable
  v_budget_cfg int;
  v_started    timestamptz := clock_timestamp();
  v_unit_beg   timestamptz;
  v_unit_secs  double precision;
  v_max_unit   double precision := 0;
  v_elapsed    double precision := 0;
  v_unit_times jsonb := '{}'::jsonb;     -- label -> seconds, ALWAYS written
  v_skipped    text[] := ARRAY[]::text[];
  v_budget_hit boolean := false;
  v_canceled   text := NULL;             -- non-NULL = query_canceled caught
  v_status     text;
  -- FIX-1030 addition
  c_unit_budget int;                     -- seconds; per-UNIT, enforced externally
  -- FIX-1152 addition
  v_vm          jsonb;                   -- visibility-map state this run ran against
BEGIN
  IF p_cadence NOT IN ('daily', 'weekly') THEN
    RAISE EXCEPTION 'refresh_derived_mvs: invalid p_cadence %, expected ''daily'' or ''weekly''', p_cadence;
  END IF;

  -- Session advisory lock (survives the per-unit COMMITs below). Stampede guard.
  IF NOT pg_try_advisory_lock(c_lock_key) THEN
    INSERT INTO public.data_sync_log (pipeline, status, started_at, completed_at, metadata)
    VALUES ('refresh_derived_mvs', 'skipped', now(), now(),
            jsonb_build_object('cadence', p_cadence,
                               'skip_reason', 'advisory lock held by a concurrent refresh_derived_mvs',
                               'source', 'pg_cron'));
    RAISE NOTICE '[derived-mvs] advisory lock held — skipping (cadence=%)', p_cadence;
    RETURN;
  END IF;

  -- Bounded per-unit memory. Plain SET (not SET LOCAL) survives the COMMITs.
  SET work_mem = '128MB';

  -- FIX-1109 finding 2 / FIX-1129: parallel workers OFF for the weekly cadence.
  -- The weekly's units 1 and 2 both build a hash over the whole of
  -- financial_entities (3.06M rows; width 16 for unit 1, width 26 for unit 2).
  -- Under a Parallel Hash Join that build lives in a DYNAMIC SHARED MEMORY
  -- segment, and on 2026-08-25 unit 2's segment could not grow:
  --   could not resize shared memory segment "/PostgreSQL.3323093180"
  --   to 134217728 bytes: No space left on device
  -- 134217728 = 128MB = exactly the work_mem set above, and 3.06M x 26 bytes
  -- plus tuple overhead is what asks for it. Reproduced on the prod-scale clone
  -- (2026-09-03): unit 2 at max_parallel_workers_per_gather=1 fails with the
  -- same error, and at 0 completes in 32.2s.
  --
  -- With no parallelism the same join becomes a plain Hash Join whose build is
  -- PRIVATE backend memory, bounded by work_mem x hash_mem_multiplier
  -- (128MB x 2 = 256MB) and permitted to spill to disk in batches instead of
  -- failing. Measured on the clone, this is not a speed trade: unit 1 ran
  -- 24.2s at 0 against 57.3s at 1, and units 3-6 plan identically either way.
  --
  -- Weekly ONLY. The daily cadence is untouched: none of its units joins
  -- financial_entities and it has never hit this failure class.
  IF p_cadence = 'weekly' THEN
    SET max_parallel_workers_per_gather = 0;
  END IF;

  -- FIX-1021: per-cadence budget. Measured 2026-08-12: work_mem is NOT the
  -- lever here (unit 1 measured 185 s at 256MB vs 198 s at 128MB, identical
  -- plan), so this stays as FIX-748 set it.
  c_budget := CASE p_cadence WHEN 'weekly' THEN 4200 ELSE 3300 END;
  v_budget_cfg := NULLIF(current_setting('civitics.derived_mvs_budget_seconds', true), '')::int;
  IF COALESCE(v_budget_cfg, 0) > 0 THEN
    c_budget := v_budget_cfg;
  END IF;

  -- FIX-1030: per-UNIT budget. Published for enforce_derived_mvs_unit_budget(),
  -- which runs in a different session and cannot read this session's GUC.
  -- NOTE: this procedure cannot enforce it itself — statement_timeout is armed
  -- once at CALL time and neither SET nor SET LOCAL re-arms it across a
  -- procedure's COMMIT (verified on PG 17; see the header and FIX-703).
  c_unit_budget := COALESCE(
    NULLIF(current_setting('civitics.derived_mvs_unit_budget_seconds', true), '')::int, 900);

  IF p_cadence = 'daily' THEN
    -- proposal/vote/comment/engagement-derived + co-located daily maintenance.
    -- FIX-748: rebuild_entity_search_index appended (daily superset — new
    -- entities land on the nightly ingest; TRUNCATE+INSERT is atomic per unit).
    v_labels := ARRAY[
      'proposal_trending_24h', 'proposal_popularity_24h', 'homepage_stats_mv',
      'official_homepage_stats_mv', 'entity_engagement_rollup_mv',
      'homepage_agency_counts_mv', 'commons_active_threads', 'pipeline_runtime_stats_mv',
      'rebuild_entity_search_index',
      'rebuild_all_primary_sources', 'prune_platform_usage_snapshot',
      'prune_kill_switch_events', 'prune_status_snapshot'
    ];
    v_units := ARRAY[
      'REFRESH MATERIALIZED VIEW CONCURRENTLY public.proposal_trending_24h',
      'REFRESH MATERIALIZED VIEW CONCURRENTLY public.proposal_popularity_24h',
      'REFRESH MATERIALIZED VIEW public.homepage_stats_mv',
      'REFRESH MATERIALIZED VIEW CONCURRENTLY public.official_homepage_stats_mv',
      'REFRESH MATERIALIZED VIEW CONCURRENTLY public.entity_engagement_rollup_mv',
      'REFRESH MATERIALIZED VIEW CONCURRENTLY public.homepage_agency_counts_mv',
      'REFRESH MATERIALIZED VIEW CONCURRENTLY public.commons_active_threads',
      'REFRESH MATERIALIZED VIEW CONCURRENTLY public.pipeline_runtime_stats_mv',
      'SELECT public.rebuild_entity_search_index()',
      'SELECT public.rebuild_all_primary_sources()',
      'SELECT public.prune_platform_usage_snapshot()',
      'SELECT public.prune_kill_switch_events()',
      'SELECT public.prune_status_snapshot()'
    ];
  ELSE  -- weekly (donation-derived)
    v_labels := ARRAY[
      'chord_industry_flows_mv', 'chord_donor_type_party_flows_mv',
      'chord_donor_state_party_flows_mv', 'chord_subject_party_flows_mv',
      'official_sector_dollars_mv', 'refresh_spending_totals'
    ];
    v_units := ARRAY[
      'REFRESH MATERIALIZED VIEW CONCURRENTLY public.chord_industry_flows_mv',
      'REFRESH MATERIALIZED VIEW CONCURRENTLY public.chord_donor_type_party_flows_mv',
      'REFRESH MATERIALIZED VIEW CONCURRENTLY public.chord_donor_state_party_flows_mv',
      'REFRESH MATERIALIZED VIEW CONCURRENTLY public.chord_subject_party_flows_mv',
      'REFRESH MATERIALIZED VIEW CONCURRENTLY public.official_sector_dollars_mv',
      'SELECT public.refresh_spending_totals()'
    ];
  END IF;

  -- FIX-1152 — record the visibility map this run ran against.
  --
  -- A vacuum receipt is a RATE, not a reading: the search unit measured 202.5s
  -- (2026-09-02, 4h after a vacuum), 1017.4s / 1015.0s / 1012.0s on the three
  -- days after it, then 234.8s and 236.0s on the two days following the next
  -- one. Reconstructing which visibility-map state each of those ran against
  -- took a Cowork pass over pg_class every time, and pg_class only ever holds
  -- NOW -- the state at 06:00 three days ago is not recoverable from anything.
  -- So the run records it itself, and from here every unit_seconds reading is
  -- paired with the heap state that produced it.
  --
  -- entity_connections and financial_entities specifically: those are the two
  -- relations rebuild_entity_search_index scans, and the two whose all-visible
  -- fraction the FIX-884 index-only-scan degradation keys on.
  --
  -- Taken at RUN START rather than immediately before the search unit, which is
  -- both simpler and strictly more useful: neither relation is written by any
  -- of the eight units that precede it, so the value is the same, and taking it
  -- here means a run that dies BEFORE reaching the search unit still carries the
  -- reading -- which is exactly the 'partial' case this exists to explain.
  --
  -- Catalog-only: pg_class and pg_stat_user_tables, two index lookups each. It
  -- mirrors the vm[] shape check_rebuild_autovacuum_status() publishes (FIX-885)
  -- so both can be read with the same expression.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'relation',        t.relname,
           'relpages',        t.relpages,
           'relallvisible',   t.relallvisible,
           'pct_all_visible', CASE WHEN t.relpages > 0
                                   THEN round(100.0 * t.relallvisible / t.relpages, 1)
                                   ELSE 100.0 END,
           'n_dead_tup',      t.n_dead_tup,
           'n_live_tup',      t.n_live_tup,
           'last_vacuum',     t.last_vacuum,
           'last_autovacuum', t.last_autovacuum
         ) ORDER BY t.relname), '[]'::jsonb)
    INTO v_vm
    FROM (
      SELECT c.relname, c.relpages, c.relallvisible,
             s.n_dead_tup, s.n_live_tup, s.last_vacuum, s.last_autovacuum
      FROM pg_class c
      JOIN pg_stat_user_tables s ON s.relid = c.oid
      WHERE c.relname IN ('entity_connections', 'financial_entities')
    ) t;

  INSERT INTO public.data_sync_log (pipeline, status, started_at, metadata)
  VALUES ('refresh_derived_mvs', 'running', now(),
          jsonb_build_object('cadence', p_cadence,
                             'units', array_length(v_units, 1),
                             'budget_seconds', c_budget,
                             'unit_budget_seconds', c_unit_budget,
                             'vm_before', v_vm,
                             'source', 'pg_cron'))
  RETURNING id INTO v_log_id;
  COMMIT;  -- publish the running row; keep the first unit's txn short

  FOR i IN 1 .. array_length(v_units, 1) LOOP
    v_cmd   := v_units[i];
    v_label := v_labels[i];

    -- FIX-1021 PREDICTIVE budget check (FIX-944 idiom): stop when the slowest
    -- unit observed so far, plus 25% headroom, would not fit in what remains.
    -- Deliberately BETWEEN units — playbook C3, a REFRESH cannot be interrupted
    -- from inside.
    v_elapsed := EXTRACT(epoch FROM (clock_timestamp() - v_started));
    IF v_max_unit > 0 AND v_elapsed + (v_max_unit * 1.25) > c_budget THEN
      v_budget_hit := true;
      -- Everything from here on is skipped; name each one so the log says what
      -- is stale rather than just that something is.
      v_skipped := v_skipped || v_labels[i : array_length(v_labels, 1)];
      RAISE WARNING '[derived-mvs] budget guard — stopping before % (elapsed %s of %s budget, slowest unit %s); % unit(s) skipped',
        v_label, round(v_elapsed)::int, round(c_budget)::int, round(v_max_unit)::int,
        array_length(v_skipped, 1);
      EXIT;
    END IF;

    v_unit_beg := clock_timestamp();

    -- FIX-1030: publish the in-flight unit and COMMIT, so
    -- enforce_derived_mvs_unit_budget() — running in another session, on its
    -- own pg_cron cadence — can see WHICH unit is running, since when, and in
    -- which backend. Without this commit the watchdog sees nothing: everything
    -- this transaction writes is invisible to it until the unit ends, which is
    -- exactly the case it exists to handle.
    UPDATE public.data_sync_log
    SET metadata = metadata || jsonb_build_object(
                     'current_unit',            v_label,
                     'current_unit_index',      i,
                     'current_unit_started_at', v_unit_beg,
                     'backend_pid',             pg_backend_pid())
    WHERE id = v_log_id;
    COMMIT;

    BEGIN
      EXECUTE v_cmd;
      v_ok := v_ok + 1;
      RAISE NOTICE '  [derived-mvs] % — ok', v_label;
    EXCEPTION
      -- FIX-1021: query_canceled is NOT matched by OTHERS (PL/pgSQL trapping
      -- rules), and statement_timeout raises exactly that. Trapping it by name
      -- is the only way this procedure can close its own row. The docs' caution
      -- about swallowing user cancels is answered by the EXIT below: we stop the
      -- whole loop immediately and do nothing but bookkeeping afterwards, so a
      -- deliberate pg_cancel_backend still ends the run — it just ends it
      -- tidily instead of leaving a stranded 'running' row behind.
      -- FIX-1030: this is now also the landing point for the unit watchdog's
      -- cancel, which is why that watchdog needs no error path of its own.
      WHEN query_canceled THEN
        v_canceled := format('%s: %s', v_label, SQLERRM);
        RAISE WARNING '  [derived-mvs] % — CANCELED (statement_timeout, unit watchdog, or operator cancel): %', v_label, SQLERRM;
      WHEN OTHERS THEN
        v_failures := v_failures || format('%s: %s', v_label, SQLERRM);
        RAISE WARNING '  [derived-mvs] % — FAILED: %', v_label, SQLERRM;
    END;

    -- Timing is recorded for EVERY outcome (ok, failed, canceled) — a unit that
    -- died at 6 h is the single most interesting number in the run.
    v_unit_secs  := EXTRACT(epoch FROM (clock_timestamp() - v_unit_beg));
    v_unit_times := v_unit_times || jsonb_build_object(v_label, round(v_unit_secs::numeric, 1));
    IF v_unit_secs > v_max_unit THEN
      v_max_unit := v_unit_secs;
    END IF;

    COMMIT;

    IF v_canceled IS NOT NULL THEN
      -- The timer that fired is disarmed once it has thrown, so the bookkeeping
      -- UPDATE below still runs. Continuing the loop would not: the next unit
      -- would be starting on a box that has already proven it cannot finish one.
      IF i < array_length(v_units, 1) THEN
        v_skipped := v_skipped || v_labels[i + 1 : array_length(v_labels, 1)];
      END IF;
      EXIT;
    END IF;
  END LOOP;

  v_elapsed := EXTRACT(epoch FROM (clock_timestamp() - v_started));

  v_status := CASE
                WHEN v_canceled IS NOT NULL THEN 'partial'
                WHEN array_length(v_failures, 1) > 0 THEN 'failed'
                WHEN v_budget_hit THEN 'partial'
                ELSE 'complete'
              END;

  UPDATE public.data_sync_log
  SET status        = v_status,
      completed_at  = now(),
      rows_inserted = v_ok,
      rows_failed   = COALESCE(array_length(v_failures, 1), 0),
      error_message = CASE
                        WHEN v_canceled IS NOT NULL
                          THEN left(format('canceled mid-unit — %s; %s unit(s) skipped',
                                           v_canceled, COALESCE(array_length(v_skipped, 1), 0)), 1000)
                        WHEN array_length(v_failures, 1) > 0
                          THEN left(array_to_string(v_failures, '; '), 1000)
                        WHEN v_budget_hit
                          THEN left(format('budget exhausted after %ss of %ss — %s unit(s) skipped: %s',
                                           round(v_elapsed)::int, round(c_budget)::int,
                                           COALESCE(array_length(v_skipped, 1), 0),
                                           array_to_string(v_skipped, ', ')), 1000)
                        ELSE NULL
                      END,
      -- FIX-1030: strip the in-flight publish keys, so a terminal row never
      -- looks like it is mid-unit to the watchdog or to a human reading it.
      metadata      = (metadata
                        - 'current_unit' - 'current_unit_index'
                        - 'current_unit_started_at' - 'backend_pid')
                      || jsonb_build_object(
                        'units_ok', v_ok,
                        'unit_failures', COALESCE(array_length(v_failures, 1), 0),
                        'unit_seconds', v_unit_times,
                        'elapsed_seconds', round(v_elapsed::numeric, 1),
                        'slowest_unit_seconds', round(v_max_unit::numeric, 1),
                        'budget_hit', v_budget_hit,
                        'canceled', v_canceled IS NOT NULL,
                        'skipped_units', to_jsonb(v_skipped))
  WHERE id = v_log_id;

  RAISE NOTICE '[derived-mvs] % (cadence=%) — %/% units ok (% failures, % skipped, %ss elapsed)',
    upper(v_status), p_cadence, v_ok, array_length(v_units, 1),
    COALESCE(array_length(v_failures, 1), 0), COALESCE(array_length(v_skipped, 1), 0),
    round(v_elapsed)::int;

  -- FIX-1109 finding 1: a failed unit must fail the CALL.
  -- Until now this procedure returned normally on EVERY path, so a run whose
  -- own data_sync_log row said 'failed' was recorded by pg_cron as
  -- 'succeeded' (prod, jobid 10, 2026-08-25: runid 15272 succeeded / 1361.9s,
  -- while the sync row for the same run says failed on
  -- chord_donor_type_party_flows_mv). That hid the failure from
  -- cron.job_run_details, from check_cron_job_health() and from FIX-1073's
  -- escalation tiers -- every consumer that keys on pg_cron's own verdict.
  --
  -- Order matters: COMMIT makes the terminal row durable, and the advisory
  -- unlock is session-scoped (not transactional), so both survive the raise.
  -- Raising before either would roll the terminal UPDATE back and strand the
  -- lock, which is the failure mode this is meant to end, not start.
  COMMIT;
  PERFORM pg_advisory_unlock(c_lock_key);

  -- 'partial' deliberately does NOT raise: a budget stop and a watchdog cancel
  -- are this system's own decisions, already recorded in the row, and pg_cron
  -- should not be told that its job errored when the bound worked as designed.
  IF v_status = 'failed' THEN
    RAISE EXCEPTION '[derived-mvs] % of % unit(s) FAILED (cadence=%): %',
      COALESCE(array_length(v_failures, 1), 0), array_length(v_units, 1),
      p_cadence, array_to_string(v_failures, '; ');
  END IF;
END;
$procedure$;
;

-- Supabase default-grants EXECUTE to anon/authenticated on CREATE. This is a
-- REPLACE so the existing ACL survives, but re-assert it: this procedure is
-- pg_cron-only and must never be reachable from PostgREST.
REVOKE ALL ON PROCEDURE public.refresh_derived_mvs(text) FROM PUBLIC;
REVOKE ALL ON PROCEDURE public.refresh_derived_mvs(text) FROM anon, authenticated;
GRANT EXECUTE ON PROCEDURE public.refresh_derived_mvs(text) TO service_role;

-- ── guard: fail the migration rather than leave a silent mis-edit on prod ────
-- Every clause is one of the placement constraints argued for in the header, so
-- a future edit that breaks one stops here instead of quietly landing a vacuum
-- inside the nightly blackout or on top of its sibling.
DO $$
DECLARE
  v_ec    text;
  v_fe    text;
  v_ec_h  int;
  v_ec_m  int;
  v_fe_h  int;
  v_fe_m  int;
BEGIN
  SELECT schedule INTO v_ec FROM cron.job WHERE jobname = 'ec-vacuum-analyze';
  SELECT schedule INTO v_fe FROM cron.job WHERE jobname = 'fe-vacuum-analyze';

  IF v_ec IS NULL OR v_fe IS NULL THEN
    RAISE NOTICE '[fix1152] one or both vacuum jobs absent — guard skipped (local DB without the cron catalogue)';
    RETURN;
  END IF;

  -- Both must be daily: day-of-month, month and day-of-week all wildcards.
  IF split_part(v_ec, ' ', 3) <> '*' OR split_part(v_ec, ' ', 4) <> '*' OR split_part(v_ec, ' ', 5) <> '*' THEN
    RAISE EXCEPTION '[fix1152] ec-vacuum-analyze is not daily: %', v_ec;
  END IF;
  IF split_part(v_fe, ' ', 3) <> '*' OR split_part(v_fe, ' ', 4) <> '*' OR split_part(v_fe, ' ', 5) <> '*' THEN
    RAISE EXCEPTION '[fix1152] fe-vacuum-analyze is not daily: %', v_fe;
  END IF;

  v_ec_m := split_part(v_ec, ' ', 1)::int;
  v_ec_h := split_part(v_ec, ' ', 2)::int;
  v_fe_m := split_part(v_fe, ' ', 1)::int;
  v_fe_h := split_part(v_fe, ' ', 2)::int;

  -- Hour 03-05 only: the three consecutive hours that measured a 0.0% startup
  -- timeout rate AND sit before the 06:00 daily.
  IF v_ec_h NOT BETWEEN 3 AND 5 THEN
    RAISE EXCEPTION '[fix1152] ec-vacuum-analyze hour % is outside the clean 03-05 band: %', v_ec_h, v_ec;
  END IF;
  IF v_fe_h NOT BETWEEN 3 AND 5 THEN
    RAISE EXCEPTION '[fix1152] fe-vacuum-analyze hour % is outside the clean 03-05 band: %', v_fe_h, v_fe;
  END IF;

  -- EC before FE, and never closer than 15 minutes: sequential, not concurrent.
  IF (v_fe_h * 60 + v_fe_m) - (v_ec_h * 60 + v_ec_m) < 15 THEN
    RAISE EXCEPTION '[fix1152] fe-vacuum-analyze (%) must start at least 15 min after ec-vacuum-analyze (%)', v_fe, v_ec;
  END IF;

  -- FE must still clear the 05:15 heavy-op cutoff with its worst run (280.9s).
  IF (v_fe_h * 60 + v_fe_m) > 5 * 60 + 5 THEN
    RAISE EXCEPTION '[fix1152] fe-vacuum-analyze (%) starts too late to finish before the 05:15 cutoff', v_fe;
  END IF;

  RAISE NOTICE '[fix1152] slots ok — ec-vacuum-analyze %, fe-vacuum-analyze %', v_ec, v_fe;
END $$;
