-- FIX-914 — teach query_districts() about the derived floterial overlay.
--
-- The 39 New Hampshire floterial districts seeded by
-- 20260910120000_fix914_nh_floterial_districts.sql carry
-- metadata.source = 'derived' (honestly — they are not TIGER features), and the
-- body this replaces filtered hard on source = 'tiger'. That filter did the
-- right thing for one caller and the wrong thing for two:
--
--   RIGHT — the per-state fill (/api/graph/voting-divergence, /api/districts
--     with bbox= or state=). New Hampshire's 'HD' rows no longer partition the
--     state, and painting 39 overlapping fills on top of the 164 they cover
--     would make the choropleth worse, not better. The overlay belongs in its
--     own layer (filed separately); the fill stays a partition. This is the
--     design's D7 and it is preserved here explicitly rather than by accident.
--
--     Not only cosmetic: voting-divergence pages the RPC per state at
--     p_limit 200. New Hampshire's lower chamber is 164 rows today and would be
--     203 with the overlay folded in, so an unfiltered fill would silently
--     TRUNCATE three districts off that map. Whoever builds the overlay layer
--     must raise that cap.
--
--   WRONG — /districts/[id]. The page loads the row straight from
--     jurisdictions (fine) and its officials by district_jurisdiction_id (fine,
--     and after FIX-914 the 58 floterial representatives are there), but takes
--     its GEOMETRY from this RPC by p_id. Under source='tiger' that returned
--     zero rows, so every floterial page would have rendered with no map.
--
--   WRONG — the point lookup (/api/districts?point=lng,lat). "Which districts
--     contain this address" is the question floterials exist to answer
--     differently: a Belmont resident really is represented by Belknap 4 AND
--     Belknap 8, and returning only the base district is a wrong answer, not a
--     tidy one. This is the design's D6, and it is the user-facing win.
--
-- So: the source filter widens to both, and the floterial rows are excluded
-- only from the FILL path -- never from an exact-id lookup or a containment
-- query. Signature is unchanged, so every existing caller keeps working with no
-- code change and PostgREST gains no ambiguous overload.
--
-- Note for readers of jurisdictions_containing_point() (the other spatial
-- lookup, used by /api/auth/verify-constituent): it was already correct. It
-- RETURNS TABLE, its caller iterates every match and writes one constituent
-- grant per jurisdiction, so an NH address now earns a grant on its floterial
-- too -- which is exactly right, and needed no change.

CREATE OR REPLACE FUNCTION public.query_districts(
  p_chamber  text DEFAULT NULL,        -- 'upper' | 'lower' | NULL (both)
  p_state    text DEFAULT NULL,        -- state abbr, e.g. 'CA'
  p_bbox_w   double precision DEFAULT NULL,
  p_bbox_s   double precision DEFAULT NULL,
  p_bbox_e   double precision DEFAULT NULL,
  p_bbox_n   double precision DEFAULT NULL,
  p_point_lng double precision DEFAULT NULL,
  p_point_lat double precision DEFAULT NULL,
  p_simplify_tolerance double precision DEFAULT 0.001,
  p_limit    integer DEFAULT 500,
  p_id       uuid    DEFAULT NULL      -- exact id lookup (overrides other filters)
) RETURNS TABLE (
  id            uuid,
  name          text,
  short_name    text,
  state_abbr    text,
  chamber       text,
  district_id   text,
  geom_geojson  text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH bbox AS (
    SELECT
      CASE
        WHEN p_bbox_w IS NOT NULL AND p_bbox_s IS NOT NULL
         AND p_bbox_e IS NOT NULL AND p_bbox_n IS NOT NULL
        THEN ST_MakeEnvelope(p_bbox_w, p_bbox_s, p_bbox_e, p_bbox_n, 4326)
        ELSE NULL
      END AS env,
      CASE
        WHEN p_point_lng IS NOT NULL AND p_point_lat IS NOT NULL
        THEN ST_SetSRID(ST_MakePoint(p_point_lng, p_point_lat), 4326)
        ELSE NULL
      END AS pt
  )
  SELECT
    d.id,
    d.name,
    d.short_name,
    (d.metadata->>'state_abbr')::text  AS state_abbr,
    (d.metadata->>'chamber')::text     AS chamber,
    (d.metadata->>'district_id')::text AS district_id,
    ST_AsGeoJSON(ST_SimplifyPreserveTopology(d.boundary_geometry, p_simplify_tolerance))::text AS geom_geojson
  FROM public.jurisdictions d, bbox
  WHERE d.type = 'district'
    AND d.metadata->>'source' IN ('tiger', 'derived')
    AND d.boundary_geometry IS NOT NULL
    -- FIX-914: overlay districts answer "what contains this point" and "give me
    -- this district", but never "paint the state". See the header.
    AND (
      p_id IS NOT NULL
      OR bbox.pt IS NOT NULL
      OR NOT COALESCE((d.metadata->>'floterial')::boolean, false)
    )
    AND (p_id      IS NULL OR d.id = p_id)
    AND (p_chamber IS NULL OR d.metadata->>'chamber' = p_chamber)
    AND (p_state   IS NULL OR d.metadata->>'state_abbr' = p_state)
    AND (bbox.env IS NULL OR d.boundary_geometry && bbox.env)
    AND (bbox.pt  IS NULL OR ST_Contains(d.boundary_geometry, bbox.pt))
  ORDER BY d.metadata->>'state_abbr', d.metadata->>'chamber', d.metadata->>'district_id'
  LIMIT GREATEST(p_limit, 1);
$$;

-- Grants restated so this migration is self-contained if ever replayed out of
-- order; CREATE OR REPLACE preserves the existing ACL either way.
REVOKE ALL ON FUNCTION public.query_districts(text, text, double precision, double precision, double precision, double precision, double precision, double precision, double precision, integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.query_districts(text, text, double precision, double precision, double precision, double precision, double precision, double precision, double precision, integer, uuid) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.query_districts(text, text, double precision, double precision, double precision, double precision, double precision, double precision, double precision, integer, uuid) IS
  'District geometry for the maps UI, simplified server-side. Returns TIGER base '
  'districts plus (FIX-914) the derived floterial overlay -- the overlay only on '
  'an exact p_id lookup or a point-containment query, never in a bbox/state fill, '
  'so a choropleth of a state stays a partition of it.';
