import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@civitics/db";
import { supabaseUnavailable, unavailableResponse } from "@/lib/supabase-check";

export const dynamic = "force-dynamic";

interface DistrictRow {
  id:           string;
  name:         string | null;
  short_name:   string | null;
  state_abbr:   string | null;
  chamber:      string | null;
  district_id:  string | null;
  geom_geojson: string | null;
}

// GET /api/districts
//
// Query params (all optional):
//   chamber  upper | lower
//   state    XX (state postal abbr)
//   bbox     W,S,E,N (lng/lat decimal pairs, comma-separated)
//   point    lng,lat (returns districts CONTAINING the point)
//   simplify Douglas-Peucker tolerance in degrees (default 0.001 ~ 111m)
//   limit    max features (default 500, hard-capped at 2000)
//
// Returns a GeoJSON FeatureCollection. Properties include id, name, short_name,
// state_abbr, chamber, district_id. Backed by query_districts() PostGIS RPC.
export async function GET(request: NextRequest) {
  if (supabaseUnavailable()) return unavailableResponse();
  const { searchParams } = new URL(request.url);

  const chamber = searchParams.get("chamber");
  const state   = searchParams.get("state")?.toUpperCase() ?? null;

  let bboxW: number | null = null;
  let bboxS: number | null = null;
  let bboxE: number | null = null;
  let bboxN: number | null = null;
  const bbox = searchParams.get("bbox");
  if (bbox) {
    const parts = bbox.split(",").map((s) => parseFloat(s.trim()));
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      [bboxW, bboxS, bboxE, bboxN] = parts as [number, number, number, number];
    } else {
      return NextResponse.json({ error: "bbox must be W,S,E,N" }, { status: 400 });
    }
  }

  let pointLng: number | null = null;
  let pointLat: number | null = null;
  const point = searchParams.get("point");
  if (point) {
    const parts = point.split(",").map((s) => parseFloat(s.trim()));
    if (parts.length === 2 && parts.every((n) => Number.isFinite(n))) {
      [pointLng, pointLat] = parts as [number, number];
    } else {
      return NextResponse.json({ error: "point must be lng,lat" }, { status: 400 });
    }
  }

  const simplify = Math.max(0, Math.min(parseFloat(searchParams.get("simplify") ?? "0.001") || 0.001, 0.05));
  const limit    = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "500", 10) || 500, 1), 2000);

  if (chamber && chamber !== "upper" && chamber !== "lower") {
    return NextResponse.json({ error: "chamber must be upper or lower" }, { status: 400 });
  }

  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(cookieStore);

    const { data, error } = await supabase.rpc("query_districts" as never, {
      p_chamber:  chamber,
      p_state:    state,
      p_bbox_w:   bboxW,
      p_bbox_s:   bboxS,
      p_bbox_e:   bboxE,
      p_bbox_n:   bboxN,
      p_point_lng: pointLng,
      p_point_lat: pointLat,
      p_simplify_tolerance: simplify,
      p_limit:    limit,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    if (error) throw error;

    const rows = (data ?? []) as DistrictRow[];
    const features = rows.flatMap((r) => {
      if (!r.geom_geojson) return [];
      let geometry: unknown;
      try { geometry = JSON.parse(r.geom_geojson); } catch { return []; }
      return [{
        type: "Feature" as const,
        id: r.id,
        properties: {
          id:          r.id,
          name:        r.name,
          short_name:  r.short_name,
          state_abbr:  r.state_abbr,
          chamber:     r.chamber,
          district_id: r.district_id,
        },
        geometry,
      }];
    });

    return NextResponse.json(
      { type: "FeatureCollection", features },
      { headers: { "Cache-Control": "public, max-age=300, s-maxage=900" } },
    );
  } catch {
    return NextResponse.json({ type: "FeatureCollection", features: [] });
  }
}
