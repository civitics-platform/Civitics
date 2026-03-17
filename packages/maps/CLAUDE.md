# packages/maps/CLAUDE.md

## Purpose
Mapbox GL JS + Deck.gl utilities for the Civitics civic governance app.
Shared spatial query helpers built on PostGIS.

---

## Status

**Pending Mapbox API key** — waiting on privacy.com virtual card to complete Mapbox account setup.
Code structure is ready; map components render placeholder until key is configured.

```
NEXT_PUBLIC_MAPBOX_TOKEN
```

---

## Stack

- **Mapbox GL JS** — Main map tiles, district boundary rendering, geocoding
  (50k loads/mo free tier, then $0.50/1k)
- **Deck.gl** — Data overlays: spending flows, donation geography, engagement heat maps
  (free, WebGL-powered)
- **PostGIS** — All boundary files stored locally in `jurisdictions` table
  (no per-query cost, no external dependency for spatial lookups)

---

## Privacy Rules

**Never store precise user coordinates.**

1. Geocode user address once (Mapbox API)
2. Coarsen to ~1km accuracy before any database write
3. Store: coarsened lat/lng + district IDs (congressional, state, county, city)
4. Never store: exact address, precise GPS coordinates
5. Update only when user changes their address

This is a Core Principle — not a preference.

---

## PostGIS District Lookup Pattern

The canonical spatial query. Given coarsened coordinates, return every jurisdiction containing that point:

```sql
-- Find all officials representing a specific location
SELECT
  o.id,
  o.full_name,
  o.role_title,
  o.party,
  gb.name AS governing_body,
  j.name AS jurisdiction
FROM officials o
JOIN governing_bodies gb ON o.governing_body_id = gb.id
JOIN jurisdictions j ON o.jurisdiction_id = j.id
WHERE
  o.is_active = true
  AND ST_Contains(
    j.boundary_geometry,
    ST_SetSRID(ST_Point($user_lng, $user_lat), 4326)
  )
ORDER BY j.type, o.role_title;
```

**Spatial index — required for performance:**
```sql
CREATE INDEX jurisdictions_boundary_gist ON jurisdictions USING GIST(boundary_geometry);
```
Test with `EXPLAIN ANALYZE` to confirm the GIST index is being used on any spatial query.

**Boundary data setup (run once per census cycle):**
```sql
SELECT AddGeometryColumn('jurisdictions', 'boundary_geometry', 4326, 'MULTIPOLYGON', 2);
```
Import Census TIGER GeoJSON files after adding the column.

---

## Geographic Data Sources (all free)

| Data | Source |
|------|--------|
| Congressional districts | Census TIGER files |
| State legislative districts | OpenStates GeoJSON |
| County/municipal boundaries | Census TIGER |
| Precincts | OpenPrecincts.org |
| Census tracts | Census Bureau |

---

## Map Use Cases (Where Maps Earn Their Place)

Maps appear only where geography changes the meaning of the data.
Test: *Does seeing WHERE something happens change how you understand it?* If no — use a table.

| Location | Map | Why it earns its place |
|----------|-----|----------------------|
| Homepage | District context map | "Who represents me?" answered instantly |
| Proposal pages | Impact choropleth | Makes abstract policy concrete to the user's county |
| Official profiles | District + donor geography | Who they represent vs. who funds them |
| Agency pages | Spending geography | Where does the money actually go? |
| Spending data | Default to map | Geography IS the story |
| Connection graph | Optional geographic overlay | Lobbying corridors become literal |
| Civic crowdfunding | Supporter origin map | Proves grassroots spread |
| Global governance | Civic Health Map | The platform's visual north star |

---

## The Civic Health Map

The single most important map in the platform. A world map showing democratic health by jurisdiction.

**Score components:**
- Official engagement and constituent response rates
- Promise fulfillment scores
- Donor capture index (vote/donor correlation)
- Civic participation rate (comment submissions per capita)
- Platform transparency score

**Visual language:** Dark (low civic health) → bright (high civic health). Never red vs. blue.
Zoom from world → country → state → district. Every level shows its specific score with explanation.

The map is also an action surface: click any jurisdiction → "Here's why this score / here's what's improving / here's how to help."

---

## Visual Principles

- Neutral base map style — no red vs. blue for political data
- Data drives color: spending = green scale, engagement = blue scale
- Progressive disclosure: simple view first, expert layers optional
- Mobile-first — touch-friendly controls
