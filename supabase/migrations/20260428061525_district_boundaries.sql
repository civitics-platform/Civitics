-- District boundaries support — FIX-160 / state-legislative-district maps work.
--
-- The TIGER pipeline at packages/data/src/pipelines/districts-tiger seeds
-- public.jurisdictions with one row per state legislative district (SLD-U,
-- SLD-L) and per congressional district. We need:
--   1. A way to dedup by (parent_id, type, census_geoid) on re-runs.
--   2. An RPC to insert/update + set boundary_geometry from GeoJSON in one
--      round-trip (PostgREST can't speak PostGIS literals directly).

-- Unique index for the district upsert key. Partial — only district rows.
-- TIGER GEOIDs are STATE_FIPS+DISTRICT (no chamber), so an SLDU and SLDL row
-- with the same district number collide. metadata->>'chamber' disambiguates.
CREATE UNIQUE INDEX IF NOT EXISTS jurisdictions_district_geoid_chamber_unique
  ON public.jurisdictions (parent_id, type, census_geoid, (metadata->>'chamber'))
  WHERE type = 'district' AND census_geoid IS NOT NULL;

-- Composite index for "all districts under this state" queries (used by the
-- /api/districts route and /districts/[id] page).
CREATE INDEX IF NOT EXISTS jurisdictions_parent_type
  ON public.jurisdictions (parent_id, type);

-- Upsert function. Insert-or-update by (parent_id, type='district',
-- census_geoid, p_chamber). p_geojson is a GeoJSON FeatureGeometry string
-- (Polygon or MultiPolygon); we coerce to MultiPolygon to match the column.
CREATE OR REPLACE FUNCTION public.upsert_district_jurisdiction(
  p_parent_id    uuid,
  p_name         text,
  p_short_name   text,
  p_fips_code    text,
  p_census_geoid text,
  p_chamber      text,
  p_metadata     jsonb,
  p_geojson      text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id  uuid;
  v_geom geometry(MultiPolygon, 4326);
BEGIN
  v_geom := ST_Multi(ST_GeomFromGeoJSON(p_geojson))::geometry(MultiPolygon, 4326);

  SELECT id INTO v_id
  FROM public.jurisdictions
  WHERE parent_id = p_parent_id
    AND type = 'district'
    AND census_geoid = p_census_geoid
    AND metadata->>'chamber' = p_chamber;

  IF v_id IS NULL THEN
    INSERT INTO public.jurisdictions (
      parent_id, type, name, short_name, fips_code, census_geoid,
      boundary_geometry, metadata, is_active
    ) VALUES (
      p_parent_id, 'district', p_name, p_short_name, p_fips_code, p_census_geoid,
      v_geom, p_metadata, true
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.jurisdictions
       SET name              = p_name,
           short_name        = p_short_name,
           fips_code         = p_fips_code,
           boundary_geometry = v_geom,
           metadata          = p_metadata,
           updated_at        = now()
     WHERE id = v_id;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_district_jurisdiction(uuid, text, text, text, text, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_district_jurisdiction(uuid, text, text, text, text, text, jsonb, text) TO service_role;

-- Cross-link officials to district jurisdictions. Match on
-- (state_abbr, chamber, district_id) with leading-zero normalisation, since
-- TIGER pads ("002") and OpenStates does not ("2"). Officials' district_name
-- holds the raw string from OpenStates. Returns the count of officials
-- updated, for pipeline reporting.
CREATE OR REPLACE FUNCTION public.link_officials_to_districts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH matches AS (
    SELECT o.id AS official_id, d.id AS district_id
    FROM public.officials o
    JOIN public.jurisdictions d
      ON d.type = 'district'
     AND d.metadata->>'source' = 'tiger'
     AND d.metadata->>'state_abbr'  = o.metadata->>'state'
     AND d.metadata->>'chamber'     = o.metadata->>'org_classification'
     AND ltrim(d.metadata->>'district_id', '0') = ltrim(o.district_name, '0')
    WHERE o.district_name IS NOT NULL
      AND o.metadata->>'state' IS NOT NULL
      AND o.metadata->>'org_classification' IN ('upper', 'lower')
      AND (
        o.metadata->>'district_jurisdiction_id' IS NULL
        OR o.metadata->>'district_jurisdiction_id' <> d.id::text
      )
  )
  UPDATE public.officials o
     SET metadata = o.metadata || jsonb_build_object('district_jurisdiction_id', m.district_id::text)
    FROM matches m
   WHERE o.id = m.official_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.link_officials_to_districts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_officials_to_districts() TO service_role;

-- Districts query for the maps UI. Returns one row per district that intersects
-- the bounding box (or the whole set if bbox is null), with geometry simplified
-- for client-side rendering. Output is GeoJSON-ready: the `geom_geojson` column
-- holds a JSON-encoded geometry that the API route can drop into a Feature.
--
-- Tolerance 0.001 (~111m at the equator) keeps shapes recognisable while
-- shrinking payloads ~5-10x. Caller can override via p_simplify_tolerance.
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
SET search_path = public
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
    AND d.metadata->>'source' = 'tiger'
    AND d.boundary_geometry IS NOT NULL
    AND (p_id      IS NULL OR d.id = p_id)
    AND (p_chamber IS NULL OR d.metadata->>'chamber' = p_chamber)
    AND (p_state   IS NULL OR d.metadata->>'state_abbr' = p_state)
    AND (bbox.env IS NULL OR d.boundary_geometry && bbox.env)
    AND (bbox.pt  IS NULL OR ST_Contains(d.boundary_geometry, bbox.pt))
  ORDER BY d.metadata->>'state_abbr', d.metadata->>'chamber', d.metadata->>'district_id'
  LIMIT GREATEST(p_limit, 1);
$$;

REVOKE ALL ON FUNCTION public.query_districts(text, text, double precision, double precision, double precision, double precision, double precision, double precision, double precision, integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.query_districts(text, text, double precision, double precision, double precision, double precision, double precision, double precision, double precision, integer, uuid) TO anon, authenticated, service_role;
