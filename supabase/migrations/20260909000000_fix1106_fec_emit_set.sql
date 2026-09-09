-- FIX-1106 — the FEC indiv/pac emit set: an exact instrument for recipient-set
-- shrinkage.
--
-- THE PROBLEM. The fec_bulk donation writers are upsert-only, so a run that
-- stops emitting to a recipient it emitted to last week leaves that recipient's
-- prior financial_relationships rows standing forever. Measured on prod
-- 2026-08-25 after the PR 3b full replay: 3,416 cycle-2026 recipients with
-- 209,017 rows / $1,481,928,516 that the run never resolved at all, ~94% of the
-- whole 222,229-row residue. Officials' pages double-count $119,979,936 of it
-- today.
--
-- WHY NOTHING ALREADY IN THE SCHEMA ANSWERS IT.
--   * updated_at is a PARTIAL instrument. FIX-1008 added skipUnchangedRows, so a
--     byte-identical re-upsert is never rewritten and never bumps updated_at —
--     a row can be squarely in the emit set and look untouched.
--   * small_dollar_bracket_rollup membership is a PROXY. FIX-1106 measured its
--     false-positive bound at ~2% (806 of 4,605 provably-in-set recipients
--     carry no bracket row), which is fine for sizing a problem and not fine
--     for authorising a DELETE.
--   * An upsert-only replay CANNOT SHRINK A SET. That is the standing rule this
--     table exists to make checkable: the only exact answer to "did this run
--     emit to X" is a record the writer itself wrote at emit time.
--
-- THE SHAPE. Every donation row the three pipeline writers build has its
-- arbiter key appended to fec_emit_keys in the SAME batch statement that
-- upserts it, on the same connection. A cycle's set is TRUNCATED for its
-- (run_id, cycle_year, source) at stage start and STAMPED complete only where
-- FIX-754 clears fec_bulk_run_state — the existing "cycle complete" signal, not
-- a new one. A killed run therefore never stamps, and the audit refuses to read
-- an unstamped slice.
--
-- BOTH TABLES ARE UNLOGGED, DELIBERATELY AND TOGETHER. UNLOGGED buys the write
-- path its cost back (no WAL for a table that is pure scaffolding), and crash
-- recovery truncates them — which is the FAILURE MODE WE WANT. If the ledger
-- were durable and the keys were not, a crash would leave complete_at stamped
-- over an empty key set and the audit would classify EVERY row in the slice as
-- residue. Truncating both together turns that catastrophe into a refusal.
-- Prod crash-recovered on 2026-09-08 15:12 UTC, so this is not hypothetical.
-- The audit ALSO cross-checks the recorded key count against the rows actually
-- present, because two guards for a DELETE authorisation is the right number.

CREATE UNLOGGED TABLE IF NOT EXISTS public.fec_emit_keys (
  run_id            uuid        NOT NULL,
  cycle_year        integer     NOT NULL,
  source            text        NOT NULL,
  -- MATCHES financial_relationships.relationship_type EXACTLY. It is the enum
  -- financial_relationship_type, not text: a text column here makes the
  -- anti-join's `k.relationship_type = fr.relationship_type` fail outright with
  -- 42883 (no operator text = financial_relationship_type), and "fix" it with a
  -- cast on the FR side and the emit index stops being usable.
  relationship_type public.financial_relationship_type NOT NULL,
  to_type           text        NOT NULL,
  to_id             uuid        NOT NULL,
  from_id           uuid        NOT NULL,
  emitted_at        timestamptz NOT NULL DEFAULT now()
);

-- The anti-join's access path. Leading (run_id, cycle_year, source) keys the
-- slice; the trailing arbiter columns let the NOT EXISTS probe be an index-only
-- lookup rather than a heap fetch per candidate row.
CREATE INDEX IF NOT EXISTS fec_emit_keys_slice_idx
  ON public.fec_emit_keys (run_id, cycle_year, source, to_type, to_id, from_id);

COMMENT ON TABLE public.fec_emit_keys IS
  'FIX-1106: every donation arbiter key the fec_bulk writers emitted, per run '
  'and cycle. UNLOGGED scaffolding — read only through the audit, which refuses '
  'unless the matching fec_emit_runs row is stamped complete.';

CREATE UNLOGGED TABLE IF NOT EXISTS public.fec_emit_runs (
  run_id      uuid        NOT NULL,
  cycle_year  integer     NOT NULL,
  source      text        NOT NULL,
  started_at  timestamptz NOT NULL DEFAULT now(),
  -- NULL until the run reaches the FIX-754 clear-run-state path for this cycle.
  -- The audit refuses on NULL. That refusal is the whole point: a killed or
  -- mid-resume run's emit set is a PREFIX of the true set, and anti-joining a
  -- prefix would classify live rows as residue.
  complete_at timestamptz,
  keys        bigint      NOT NULL DEFAULT 0,
  PRIMARY KEY (run_id, cycle_year, source)
);

COMMENT ON TABLE public.fec_emit_runs IS
  'FIX-1106: per (run, cycle, source) emit-set ledger. complete_at is stamped '
  'ONLY where FIX-754 clears fec_bulk_run_state, so it means exactly what '
  '"cycle complete" already meant. UNLOGGED in lockstep with fec_emit_keys so a '
  'crash loses the stamp and the keys together and the audit fails closed.';

-- Scaffolding, not a read surface. The audit and the remediation run as the
-- service role over direct-pg; nothing in the request path touches these.
REVOKE ALL ON public.fec_emit_keys FROM anon, authenticated;
REVOKE ALL ON public.fec_emit_runs FROM anon, authenticated;
