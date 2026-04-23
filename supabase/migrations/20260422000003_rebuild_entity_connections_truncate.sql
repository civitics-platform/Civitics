-- =============================================================================
-- FIX-100 follow-up — switch wipe from DELETE to TRUNCATE
--
-- The body in 20260422000002 used `DELETE FROM public.entity_connections;`
-- which Pro rejects with "DELETE requires a WHERE clause" (psql_safe_update
-- guard). Local Postgres has no such guard so this only failed on Pro at
-- function-call time.
--
-- TRUNCATE is the correct primitive here anyway: faster (no per-row work,
-- no MVCC bloat), bypasses the safe-update guard, and the function still
-- runs inside the caller's transaction so the wipe-and-rebuild is atomic.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.rebuild_entity_connections()
RETURNS TABLE(connection_type TEXT, edges_upserted BIGINT)
LANGUAGE plpgsql
AS $$
DECLARE
  v_count BIGINT;
BEGIN
  -- Wipe the slate. Per L5, all rows are derived.
  TRUNCATE TABLE public.entity_connections;

  -- ── 1. donation ──────────────────────────────────────────────────────────
  WITH agg AS (
    SELECT
      fr.from_type,
      fr.from_id,
      fr.to_type,
      fr.to_id,
      COUNT(*)                                        AS evidence_count,
      SUM(COALESCE(fr.amount_cents, 0))               AS total_cents,
      MIN(fr.occurred_at)                             AS first_at,
      MAX(fr.occurred_at)                             AS last_at,
      (ARRAY_AGG(fr.id ORDER BY fr.occurred_at DESC NULLS LAST))[1:100] AS evidence_ids
    FROM public.financial_relationships fr
    WHERE fr.relationship_type = 'donation'
    GROUP BY fr.from_type, fr.from_id, fr.to_type, fr.to_id
  ), inserted AS (
    INSERT INTO public.entity_connections (
      from_type, from_id, to_type, to_id, connection_type,
      strength, amount_cents, occurred_at, ended_at,
      evidence_count, evidence_source, evidence_ids
    )
    SELECT
      a.from_type, a.from_id, a.to_type, a.to_id, 'donation'::public.connection_type,
      LEAST(0.999, GREATEST(0.001,
        LOG(10, GREATEST(a.total_cents / 100.0, 1.0)) / 8.0
      ))::numeric(4,3),
      a.total_cents, a.first_at, a.last_at,
      a.evidence_count, 'financial_relationships', a.evidence_ids
    FROM agg a
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM inserted;
  connection_type := 'donation'; edges_upserted := v_count; RETURN NEXT;

  -- ── 2. vote_yes / vote_no / vote_abstain ─────────────────────────────────
  WITH ranked AS (
    SELECT
      v.official_id,
      v.bill_proposal_id                              AS proposal_id,
      v.vote,
      v.id,
      v.voted_at,
      ROW_NUMBER() OVER (
        PARTITION BY v.official_id, v.bill_proposal_id
        ORDER BY v.voted_at DESC, v.id DESC
      )                                               AS rn,
      COUNT(*) OVER (PARTITION BY v.official_id, v.bill_proposal_id) AS evidence_count,
      (ARRAY_AGG(v.id) OVER (PARTITION BY v.official_id, v.bill_proposal_id))[1:100] AS evidence_ids
    FROM public.votes v
    WHERE v.bill_proposal_id IS NOT NULL
      AND v.official_id IS NOT NULL
      AND v.vote IN ('yes', 'no', 'abstain')
  ), latest AS (
    SELECT * FROM ranked WHERE rn = 1
  )
  INSERT INTO public.entity_connections (
    from_type, from_id, to_type, to_id, connection_type,
    strength, occurred_at,
    evidence_count, evidence_source, evidence_ids
  )
  SELECT
    'official', l.official_id, 'proposal', l.proposal_id,
    (CASE l.vote
       WHEN 'yes'     THEN 'vote_yes'
       WHEN 'no'      THEN 'vote_no'
       WHEN 'abstain' THEN 'vote_abstain'
     END)::public.connection_type,
    0.500::numeric(4,3),
    l.voted_at::date,
    l.evidence_count, 'votes', l.evidence_ids
  FROM latest l;

  SELECT COUNT(*) INTO v_count
    FROM public.entity_connections ec
    WHERE ec.connection_type = 'vote_yes';
  connection_type := 'vote_yes'; edges_upserted := v_count; RETURN NEXT;

  SELECT COUNT(*) INTO v_count
    FROM public.entity_connections ec
    WHERE ec.connection_type = 'vote_no';
  connection_type := 'vote_no'; edges_upserted := v_count; RETURN NEXT;

  SELECT COUNT(*) INTO v_count
    FROM public.entity_connections ec
    WHERE ec.connection_type = 'vote_abstain';
  connection_type := 'vote_abstain'; edges_upserted := v_count; RETURN NEXT;

  -- ── 3. co_sponsorship ────────────────────────────────────────────────────
  WITH inserted AS (
    INSERT INTO public.entity_connections (
      from_type, from_id, to_type, to_id, connection_type,
      strength, occurred_at,
      evidence_count, evidence_source, evidence_ids
    )
    SELECT
      'official', pc.official_id, 'proposal', pc.proposal_id,
      'co_sponsorship'::public.connection_type,
      CASE WHEN pc.is_original_cosponsor THEN 0.700 ELSE 0.600 END::numeric(4,3),
      pc.date_added,
      1, 'cosponsorship', ARRAY[pc.id]
    FROM public.proposal_cosponsors pc
    WHERE pc.date_withdrawn IS NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM inserted;
  connection_type := 'co_sponsorship'; edges_upserted := v_count; RETURN NEXT;

  -- ── 4. appointment (career_history → governing_body) ─────────────────────
  WITH agg AS (
    SELECT
      ch.official_id,
      ch.governing_body_id,
      MIN(ch.started_at)         AS first_started_at,
      MAX(COALESCE(ch.ended_at, CURRENT_DATE)) FILTER (WHERE ch.ended_at IS NOT NULL) AS last_ended_at,
      BOOL_OR(ch.ended_at IS NULL) AS still_active,
      COUNT(*)                   AS evidence_count,
      (ARRAY_AGG(ch.id ORDER BY ch.started_at DESC NULLS LAST))[1:50] AS evidence_ids
    FROM public.career_history ch
    WHERE ch.is_government = true
      AND ch.governing_body_id IS NOT NULL
    GROUP BY ch.official_id, ch.governing_body_id
  ), inserted AS (
    INSERT INTO public.entity_connections (
      from_type, from_id, to_type, to_id, connection_type,
      strength, occurred_at, ended_at,
      evidence_count, evidence_source, evidence_ids
    )
    SELECT
      'official', a.official_id, 'governing_body', a.governing_body_id,
      'appointment'::public.connection_type,
      CASE WHEN a.still_active THEN 0.700 ELSE 0.500 END::numeric(4,3),
      a.first_started_at,
      CASE WHEN a.still_active THEN NULL ELSE a.last_ended_at END,
      a.evidence_count, 'career_history', a.evidence_ids
    FROM agg a
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM inserted;
  connection_type := 'appointment'; edges_upserted := v_count; RETURN NEXT;

  -- ── 5. oversight (governing_body → agency, static lookup) ────────────────
  WITH inserted AS (
    INSERT INTO public.entity_connections (
      from_type, from_id, to_type, to_id, connection_type,
      strength,
      evidence_count, evidence_source, evidence_ids
    )
    SELECT
      'governing_body', ag.governing_body_id, 'agency', ag.id,
      'oversight'::public.connection_type,
      0.700::numeric(4,3),
      1, 'agency_oversight', ARRAY[ag.id]
    FROM public.agencies ag
    WHERE ag.governing_body_id IS NOT NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM inserted;
  connection_type := 'oversight'; edges_upserted := v_count; RETURN NEXT;

  -- ── 6. holds_position (stock/bond/property, ongoing) ─────────────────────
  WITH agg AS (
    SELECT
      fr.from_type, fr.from_id, fr.to_type, fr.to_id,
      COUNT(*)                          AS evidence_count,
      SUM(COALESCE(fr.amount_cents, 0)) AS total_cents,
      MIN(fr.started_at)                AS first_at,
      (ARRAY_AGG(fr.id ORDER BY fr.started_at DESC NULLS LAST))[1:50] AS evidence_ids
    FROM public.financial_relationships fr
    WHERE fr.relationship_type IN ('owns_stock', 'owns_bond', 'property')
      AND fr.ended_at IS NULL
    GROUP BY fr.from_type, fr.from_id, fr.to_type, fr.to_id
  ), inserted AS (
    INSERT INTO public.entity_connections (
      from_type, from_id, to_type, to_id, connection_type,
      strength, amount_cents, occurred_at,
      evidence_count, evidence_source, evidence_ids
    )
    SELECT
      a.from_type, a.from_id, a.to_type, a.to_id, 'holds_position'::public.connection_type,
      LEAST(0.999, GREATEST(0.001,
        0.4 + LOG(10, GREATEST(a.total_cents / 100.0, 1.0)) / 16.0
      ))::numeric(4,3),
      NULLIF(a.total_cents, 0), a.first_at,
      a.evidence_count, 'financial_relationships', a.evidence_ids
    FROM agg a
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM inserted;
  connection_type := 'holds_position'; edges_upserted := v_count; RETURN NEXT;

  -- ── 7. gift_received (gift / honorarium) ─────────────────────────────────
  WITH agg AS (
    SELECT
      fr.from_type, fr.from_id, fr.to_type, fr.to_id,
      COUNT(*)                          AS evidence_count,
      SUM(COALESCE(fr.amount_cents, 0)) AS total_cents,
      MIN(fr.occurred_at)               AS first_at,
      MAX(fr.occurred_at)               AS last_at,
      (ARRAY_AGG(fr.id ORDER BY fr.occurred_at DESC NULLS LAST))[1:50] AS evidence_ids
    FROM public.financial_relationships fr
    WHERE fr.relationship_type IN ('gift', 'honorarium')
    GROUP BY fr.from_type, fr.from_id, fr.to_type, fr.to_id
  ), inserted AS (
    INSERT INTO public.entity_connections (
      from_type, from_id, to_type, to_id, connection_type,
      strength, amount_cents, occurred_at, ended_at,
      evidence_count, evidence_source, evidence_ids
    )
    SELECT
      a.from_type, a.from_id, a.to_type, a.to_id, 'gift_received'::public.connection_type,
      LEAST(0.999, GREATEST(0.001,
        LOG(10, GREATEST(a.total_cents / 100.0, 1.0)) / 6.0
      ))::numeric(4,3),
      a.total_cents, a.first_at, a.last_at,
      a.evidence_count, 'financial_relationships', a.evidence_ids
    FROM agg a
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM inserted;
  connection_type := 'gift_received'; edges_upserted := v_count; RETURN NEXT;

  -- ── 8. contract_award (contract / grant) ─────────────────────────────────
  WITH agg AS (
    SELECT
      fr.from_type, fr.from_id, fr.to_type, fr.to_id,
      COUNT(*)                          AS evidence_count,
      SUM(COALESCE(fr.amount_cents, 0)) AS total_cents,
      MIN(fr.occurred_at)               AS first_at,
      MAX(fr.occurred_at)               AS last_at,
      (ARRAY_AGG(fr.id ORDER BY fr.occurred_at DESC NULLS LAST))[1:100] AS evidence_ids
    FROM public.financial_relationships fr
    WHERE fr.relationship_type IN ('contract', 'grant')
    GROUP BY fr.from_type, fr.from_id, fr.to_type, fr.to_id
  ), inserted AS (
    INSERT INTO public.entity_connections (
      from_type, from_id, to_type, to_id, connection_type,
      strength, amount_cents, occurred_at, ended_at,
      evidence_count, evidence_source, evidence_ids
    )
    SELECT
      a.from_type, a.from_id, a.to_type, a.to_id, 'contract_award'::public.connection_type,
      LEAST(0.999, GREATEST(0.001,
        LOG(10, GREATEST(a.total_cents / 100.0, 1.0)) / 9.0
      ))::numeric(4,3),
      a.total_cents, a.first_at, a.last_at,
      a.evidence_count, 'financial_relationships', a.evidence_ids
    FROM agg a
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM inserted;
  connection_type := 'contract_award'; edges_upserted := v_count; RETURN NEXT;

  -- ── 9. lobbying (lobbying_spend) ─────────────────────────────────────────
  WITH agg AS (
    SELECT
      fr.from_type, fr.from_id, fr.to_type, fr.to_id,
      COUNT(*)                          AS evidence_count,
      SUM(COALESCE(fr.amount_cents, 0)) AS total_cents,
      MIN(fr.started_at)                AS first_at,
      MAX(COALESCE(fr.ended_at, CURRENT_DATE)) AS last_at,
      (ARRAY_AGG(fr.id ORDER BY fr.started_at DESC NULLS LAST))[1:50] AS evidence_ids
    FROM public.financial_relationships fr
    WHERE fr.relationship_type = 'lobbying_spend'
    GROUP BY fr.from_type, fr.from_id, fr.to_type, fr.to_id
  ), inserted AS (
    INSERT INTO public.entity_connections (
      from_type, from_id, to_type, to_id, connection_type,
      strength, amount_cents, occurred_at, ended_at,
      evidence_count, evidence_source, evidence_ids
    )
    SELECT
      a.from_type, a.from_id, a.to_type, a.to_id, 'lobbying'::public.connection_type,
      LEAST(0.999, GREATEST(0.001,
        LOG(10, GREATEST(a.total_cents / 100.0, 1.0)) / 8.0
      ))::numeric(4,3),
      a.total_cents, a.first_at, a.last_at,
      a.evidence_count, 'financial_relationships', a.evidence_ids
    FROM agg a
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM inserted;
  connection_type := 'lobbying'; edges_upserted := v_count; RETURN NEXT;

  RETURN;
END;
$$;
