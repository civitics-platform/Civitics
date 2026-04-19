// Edge / CDN cache header helper for read-only GET routes.
//
// Apply only to routes that:
//   - Are GET-only
//   - Return data that's identical for all users (no RLS-scoped content)
//   - Don't use createAdminClient() for anything user-specific
//
// s-maxage: how long a shared cache (Vercel edge / CDN) may serve the response.
// stale-while-revalidate: how long after s-maxage expires the cache may serve
//   a stale response while it revalidates in the background.
// max-age=0: clients (browsers) must always revalidate — only the CDN caches.

import { NextResponse } from "next/server";

export type CachePreset = "graph-hourly" | "graph-daily" | "entity" | "stats";

const PRESETS: Record<CachePreset, { sMaxage: number; staleWhileRevalidate: number }> = {
  // Graph snapshots refresh hourly in production.
  "graph-hourly": { sMaxage: 3600, staleWhileRevalidate: 7200 },
  // Heavier graph aggregates (sunburst, treemap) — 1 day.
  "graph-daily": { sMaxage: 86400, staleWhileRevalidate: 172800 },
  // Entity pages (officials, proposals) — 5 minutes.
  entity: { sMaxage: 300, staleWhileRevalidate: 3600 },
  // Platform stats — 10 minutes.
  stats: { sMaxage: 600, staleWhileRevalidate: 3600 },
};

export function withCacheHeaders<T>(
  data: T,
  preset: CachePreset,
  init?: ResponseInit,
): NextResponse {
  const { sMaxage, staleWhileRevalidate } = PRESETS[preset];
  const response = NextResponse.json(data, init);
  response.headers.set(
    "Cache-Control",
    `public, max-age=0, s-maxage=${sMaxage}, stale-while-revalidate=${staleWhileRevalidate}`,
  );
  return response;
}
