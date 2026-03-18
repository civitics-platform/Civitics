/**
 * packages/maps/src/client.ts
 *
 * Client-side only — import in 'use client' components.
 * Sets the Mapbox access token and re-exports mapboxgl for convenience.
 *
 * Usage:
 *   import { initMapbox, mapboxgl } from "@civitics/maps/client"
 *   // Call initMapbox() once before creating any Map instance.
 */

import mapboxgl from "mapbox-gl";

export function initMapbox(): void {
  mapboxgl.accessToken = process.env["NEXT_PUBLIC_MAPBOX_TOKEN"]!;
}

export { mapboxgl };
