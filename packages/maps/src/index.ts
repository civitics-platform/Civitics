/**
 * @civitics/maps
 *
 * Mapbox GL JS + Deck.gl utilities for Civitics platform maps.
 *
 * Map stack:
 *  - Mapbox GL JS: main maps (50k loads/mo free, then $0.50/1k)
 *  - Deck.gl: data overlays — spending flows, donation geography (WebGL, free)
 *  - PostGIS: boundary files stored locally (no per-query API cost)
 *
 * Visual principles:
 *  - Neutral base style — never red vs. blue for political data
 *  - Data drives color: spending=green scale, engagement=blue scale
 *  - Progressive disclosure: simple view first, expert layers optional
 *  - Mobile-first
 *
 * Maps appear ONLY where geography changes the meaning of the data.
 * Test: "Does seeing WHERE change how you understand it?" If no, use a table.
 */

export const MAP_STYLES = {
  // Neutral civic base — no political color associations
  civic: "mapbox://styles/mapbox/light-v11",
  civicDark: "mapbox://styles/mapbox/dark-v11",
  satellite: "mapbox://styles/mapbox/satellite-streets-v12",
} as const;

// Color scales — never red vs. blue for political data
export const COLOR_SCALES = {
  spending: {
    low: [209, 250, 229] as [number, number, number],   // green-100
    mid: [52, 211, 153] as [number, number, number],    // emerald-400
    high: [6, 95, 70] as [number, number, number],      // emerald-900
  },
  engagement: {
    low: [219, 234, 254] as [number, number, number],   // blue-100
    mid: [59, 130, 246] as [number, number, number],    // blue-500
    high: [30, 58, 138] as [number, number, number],    // blue-900
  },
  // Civic health map: dark = low health, bright = high health
  civicHealth: {
    low: [31, 41, 55] as [number, number, number],      // gray-800
    mid: [99, 102, 241] as [number, number, number],    // indigo-500
    high: [224, 231, 255] as [number, number, number],  // indigo-100
  },
} as const;

export type MapStyle = keyof typeof MAP_STYLES;
export type ColorScale = keyof typeof COLOR_SCALES;
