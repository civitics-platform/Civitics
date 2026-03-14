import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database";

/**
 * Canonical district lookup: find every official who represents a point.
 * Coordinates must be pre-coarsened (~1km accuracy) before calling this function.
 * Never pass full-precision GPS coordinates.
 *
 * Mirrors the PostGIS query documented in CLAUDE.md.
 */
export async function findRepresentativesByLocation(
  db: SupabaseClient<Database>,
  lat: number,
  lng: number
) {
  // Using Supabase RPC to call a stored PostGIS function
  // The underlying SQL uses ST_Contains(j.boundary_geometry, ST_SetSRID(ST_Point($lng, $lat), 4326))
  const { data, error } = await db.rpc("find_representatives_by_location", {
    user_lat: lat,
    user_lng: lng,
  });

  if (error) throw error;
  return data;
}

/**
 * Find all jurisdictions containing a point (for district assignment on signup).
 * Returns jurisdictions from most-specific to least-specific.
 */
export async function findJurisdictionsByLocation(
  db: SupabaseClient<Database>,
  lat: number,
  lng: number
) {
  const { data, error } = await db.rpc("find_jurisdictions_by_location", {
    user_lat: lat,
    user_lng: lng,
  });

  if (error) throw error;
  return data;
}
