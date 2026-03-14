import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database";

type DB = SupabaseClient<Database>;

/**
 * Canonical district lookup: find every official who represents a point.
 * Coordinates must be pre-coarsened (~1km accuracy) before calling.
 * Never pass full-precision GPS coordinates — exact user location is never stored.
 *
 * Mirrors the PostGIS query documented in CLAUDE.md.
 * Backed by the find_representatives_by_location() stored function in the migration.
 */
export async function findRepresentativesByLocation(
  db: DB,
  lat: number,
  lng: number
) {
  const { data, error } = await db.rpc("find_representatives_by_location", {
    user_lat: lat,
    user_lng: lng,
  });
  if (error) throw error;
  return data;
}

/**
 * Find all jurisdictions containing a point (for district assignment on signup).
 * Returns jurisdictions ordered from most-specific (precinct) to least (country).
 * Backed by the find_jurisdictions_by_location() stored function in the migration.
 */
export async function findJurisdictionsByLocation(
  db: DB,
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
