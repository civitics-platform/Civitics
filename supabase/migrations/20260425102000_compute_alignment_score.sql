-- compute_alignment_score: compares a user's civic_comments positions against
-- an official's votes on the same substantive proposals. Returns ratio, counts,
-- and per-vote detail for the USER node alignment tooltip (FIX-042).
CREATE OR REPLACE FUNCTION public.compute_alignment_score(
  p_user_id     UUID,
  p_official_id UUID
) RETURNS TABLE (
  alignment_ratio  NUMERIC,   -- 0.0–1.0; 0 if no overlap
  matched_votes    INT,
  total_votes      INT,
  vote_details     JSONB      -- [{proposal_id, title, user_pos, official_vote, aligned}] up to 10 rows
) LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  WITH overlap AS (
    SELECT
      cc.proposal_id,
      COALESCE(p.short_title, p.title) AS proposal_title,
      cc.position                       AS user_pos,
      v.vote                            AS official_vote,
      CASE
        WHEN cc.position = 'support' AND v.vote = 'yes' THEN true
        WHEN cc.position = 'oppose'  AND v.vote = 'no'  THEN true
        ELSE false
      END                               AS aligned
    FROM civic_comments cc
    JOIN votes     v ON v.proposal_id = cc.proposal_id
                     AND v.official_id = p_official_id
    JOIN proposals p ON p.id = cc.proposal_id
    WHERE cc.user_id      = p_user_id
      AND p.vote_category = 'substantive'
  )
  SELECT
    ROUND(COALESCE(AVG(aligned::int), 0)::numeric, 2),
    COALESCE(SUM(aligned::int), 0)::int,
    COUNT(*)::int,
    COALESCE(
      (SELECT jsonb_agg(row_data ORDER BY (row_data->>'aligned')::boolean DESC)
       FROM (
         SELECT jsonb_build_object(
           'proposal_id',   proposal_id,
           'title',         proposal_title,
           'user_pos',      user_pos,
           'official_vote', official_vote,
           'aligned',       aligned
         ) AS row_data
         FROM overlap
         LIMIT 10
       ) sub),
      '[]'::jsonb
    )
  FROM overlap;
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_alignment_score(UUID, UUID) TO authenticated;
