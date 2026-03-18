"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import { initMapbox, mapboxgl } from "@civitics/maps/client";

type MapState = "placeholder" | "address_input" | "loading" | "active";

type Representative = {
  id: string;
  full_name: string;
  role_title: string;
  party: string | null;
  jurisdiction: string | null;
};

const PARTY_BADGE: Record<string, string> = {
  democrat: "bg-blue-100 text-blue-800",
  republican: "bg-red-100 text-red-800",
  independent: "bg-purple-100 text-purple-800",
};

function track(metric: string) {
  fetch("/api/track-usage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ service: "mapbox", metric }),
  }).catch(() => {});
}

export function DistrictMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const pendingFlyToRef = useRef<{
    lng: number;
    lat: number;
    reps: Representative[];
  } | null>(null);

  const [mapState, setMapState] = useState<MapState>("placeholder");
  const [geolocating, setGeolocating] = useState(false);
  const [address, setAddress] = useState("");
  const [placeName, setPlaceName] = useState<string | null>(null);
  const [representatives, setRepresentatives] = useState<Representative[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastMethod, setLastMethod] = useState<"geo" | "address" | null>(null);

  // Stable helper — only touches refs and the mapboxgl import
  const placeMarkers = useCallback(
    (map: mapboxgl.Map, lng: number, lat: number, reps: Representative[]) => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];

      const userEl = document.createElement("div");
      userEl.style.cssText =
        "width:14px;height:14px;background:#4f46e5;border:2px solid white;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.3)";
      new mapboxgl.Marker({ element: userEl }).setLngLat([lng, lat]).addTo(map);

      reps.forEach((rep, i) => {
        const angle = (i / Math.max(reps.length, 1)) * 2 * Math.PI;
        const spread = reps.length > 1 ? 0.25 : 0;
        const rLng = lng + spread * Math.cos(angle);
        const rLat = lat + spread * Math.sin(angle);

        const popup = new mapboxgl.Popup({ offset: 28, closeButton: false }).setHTML(
          `<div style="font:13px/1.4 system-ui,sans-serif;padding:2px 0">` +
            `<p style="font-weight:600;margin:0 0 2px">${rep.full_name}</p>` +
            `<p style="color:#555;margin:0 0 2px;font-size:11px">${rep.role_title}</p>` +
            (rep.party
              ? `<p style="color:#777;margin:0 0 6px;font-size:11px">${rep.party}</p>`
              : "") +
            `<a href="/officials/${rep.id}" style="color:#4f46e5;font-size:11px;font-weight:500">View profile →</a>` +
            `</div>`
        );

        const marker = new mapboxgl.Marker({ color: "#6366f1" })
          .setLngLat([rLng, rLat])
          .setPopup(popup)
          .addTo(map);

        markersRef.current.push(marker);
      });
    },
    []
  );

  // Initialize Mapbox only once — when mapState first becomes "active".
  // The map div is already in the DOM (absolute positioned) so it has real dimensions.
  useEffect(() => {
    if (mapState !== "active" || mapRef.current || !containerRef.current) return;

    initMapbox();

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/light-v11",
      center: [-98.5795, 39.8283], // geographic center of contiguous US
      zoom: 3.5,
    });

    map.addControl(
      new mapboxgl.NavigationControl({ showCompass: false }),
      "top-right"
    );
    mapRef.current = map;

    // Apply any pending fly-to from address/geo search that ran before map init
    map.on("load", () => {
      const pending = pendingFlyToRef.current;
      if (pending) {
        pendingFlyToRef.current = null;
        map.flyTo({ center: [pending.lng, pending.lat], zoom: 8, duration: 1200 });
        placeMarkers(map, pending.lng, pending.lat, pending.reps);
      }
    });

    track("map_load");
  }, [mapState, placeMarkers]);

  // Shared: fetch representatives, then activate map
  async function activateMapWithLocation(
    lng: number,
    lat: number,
    method: "geo" | "address",
    newPlaceName?: string
  ) {
    setError(null);
    setRepresentatives([]);
    setPlaceName(newPlaceName ?? null);
    setLastMethod(method);
    setMapState("loading");

    try {
      const repsRes = await fetch(`/api/representatives?lat=${lat}&lng=${lng}`);
      const repsData = await repsRes.json();
      const reps: Representative[] = repsData.representatives ?? [];
      setRepresentatives(reps);

      if (mapRef.current) {
        // Map already live — fly and place markers immediately
        mapRef.current.flyTo({ center: [lng, lat], zoom: 8, duration: 1200 });
        placeMarkers(mapRef.current, lng, lat, reps);
      } else {
        // Map will init after state change; store pending location for map.on('load')
        pendingFlyToRef.current = { lng, lat, reps };
      }

      setMapState("active");
    } catch {
      setError("Something went wrong. Please try again.");
      setMapState("address_input");
    }
  }

  async function handleAddressSubmit(e: React.FormEvent) {
    e.preventDefault();
    const query = address.trim();
    if (!query) return;

    track("address_used");
    setError(null);
    setMapState("loading");

    try {
      const token = process.env["NEXT_PUBLIC_MAPBOX_TOKEN"];
      const geocodeRes = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
          `?country=us&types=address,postcode,place,region&access_token=${token}`
      );
      if (!geocodeRes.ok) throw new Error("Geocoding failed");

      const geocodeData = await geocodeRes.json();
      const feature = geocodeData.features?.[0];

      if (!feature) {
        setError("Address not found. Try a street address, city, or ZIP code.");
        setMapState("address_input");
        return;
      }

      const [lng, lat] = feature.center as [number, number];
      // Coarsen on client side before sending — same rule as the server
      const cLat = Math.round(lat * 100) / 100;
      const cLng = Math.round(lng * 100) / 100;

      await activateMapWithLocation(cLng, cLat, "address", feature.place_name);
    } catch {
      setError("Something went wrong. Please try again.");
      setMapState("address_input");
    }
  }

  function handleGeolocate() {
    if (!navigator.geolocation) {
      setError(
        "Geolocation is not supported by your browser. Please enter your address."
      );
      return;
    }

    track("geolocation_used");
    setGeolocating(true);
    setError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGeolocating(false);
        // Coarsen immediately — ~1km accuracy, never store precise coords
        const lat = Math.round(position.coords.latitude * 100) / 100;
        const lng = Math.round(position.coords.longitude * 100) / 100;
        activateMapWithLocation(lng, lat, "geo");
      },
      (err) => {
        setGeolocating(false);
        if (err.code === err.PERMISSION_DENIED) {
          setError("Location access denied. Please enter your address below.");
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setError("Unable to detect location. Please enter your address.");
        } else {
          setError("Location request timed out. Please enter your address.");
        }
      },
      {
        enableHighAccuracy: false, // district-level accuracy is enough
        timeout: 8000,
        maximumAge: 300_000, // cache 5 min — don't re-request on repeat clicks
      }
    );
  }

  // ─── Inactive panel content ────────────────────────────────────────────────

  function renderPlaceholder() {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 px-6 text-center">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-12 h-12 text-gray-300"
          aria-hidden="true"
        >
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
          <circle cx="12" cy="9" r="2.5" />
        </svg>

        <div>
          <p className="text-base font-semibold text-gray-700">
            Find Your Representatives
          </p>
          <p className="mt-1 text-sm text-gray-400 max-w-xs">
            Enter your address to see every elected official who represents
            you — federal, state, and local.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 justify-center">
          <button
            onClick={() => {
              track("map_activated");
              setMapState("address_input");
            }}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
          >
            Search by Address
          </button>
          <button
            onClick={() => {
              track("map_activated");
              setMapState("active");
            }}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Browse the Map
          </button>
        </div>

        <p className="text-xs text-gray-400">
          Your location is never stored. Coordinates are coarsened to district level.
        </p>
      </div>
    );
  }

  function renderAddressInput() {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 px-6">
        <p className="text-base font-semibold text-gray-700">
          Find Your Representatives
        </p>

        {error && (
          <p className="text-sm text-red-600 text-center max-w-sm">{error}</p>
        )}

        {/* Use My Location */}
        <button
          onClick={handleGeolocate}
          disabled={geolocating}
          className="w-full max-w-sm flex items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          {geolocating ? (
            <>
              <svg
                className="animate-spin h-4 w-4 text-indigo-500"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              Getting your location…
            </>
          ) : (
            <>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="w-4 h-4 text-indigo-500"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M11.54 22.351l.07.04.028.016a.76.76 0 00.723 0l.028-.015.071-.041a16.975 16.975 0 001.144-.742 19.58 19.58 0 002.683-2.282c1.944-2.003 3.5-4.697 3.5-8.333 0-4.36-3.14-7.994-7-7.994S5 4.641 5 9.001c0 3.636 1.556 6.33 3.5 8.333a19.58 19.58 0 002.683 2.282 16.975 16.975 0 001.144.742zM12 13.5a4.5 4.5 0 100-9 4.5 4.5 0 000 9z"
                  clipRule="evenodd"
                />
              </svg>
              Use My Location
            </>
          )}
        </button>

        {/* OR separator */}
        <div className="w-full max-w-sm flex items-center gap-2">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="text-xs text-gray-400">or enter address</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        {/* Address form */}
        <form
          onSubmit={handleAddressSubmit}
          className="w-full max-w-sm flex flex-col gap-2"
        >
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="123 Main St, City, State"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <button
            type="submit"
            className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
          >
            Find Representatives →
          </button>
        </form>

        <p className="text-xs text-gray-400 text-center max-w-sm">
          🔒 Your address is used only to find your district. Never stored on
          our servers.
        </p>

        <button
          onClick={() => setMapState(mapRef.current ? "active" : "placeholder")}
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          {mapRef.current ? "← Back to map" : "← Back"}
        </button>
      </div>
    );
  }

  function renderLoading() {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <svg
            className="animate-spin h-4 w-4 text-indigo-500"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          Finding your representatives…
        </div>
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const privacyNote =
    lastMethod === "geo"
      ? "🔒 Your precise location is coarsened to ~1km accuracy. Never stored on our servers."
      : "🔒 Your address is used only to find your district. Never stored on our servers.";

  return (
    <section>
      <div className="mb-4">
        <h2 className="text-xl font-semibold text-gray-900">
          Find your representatives
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Enter your address to see who represents you — federal, state, and local.
        </p>
      </div>

      {/*
        Fixed-height container — no layout shift when map activates.
        Both the inactive panel and the map div are absolutely positioned inside
        and cross-fade via opacity transitions.
      */}
      <div className="relative w-full min-h-[400px] md:min-h-[500px] rounded-lg border border-gray-200 overflow-hidden">

        {/* Inactive panel (placeholder / address_input / loading) — fades out */}
        <div
          className={`absolute inset-0 transition-opacity duration-300 ${
            mapState === "active"
              ? "opacity-0 pointer-events-none"
              : "opacity-100"
          }`}
          style={{
            backgroundColor: "#f9fafb",
            backgroundImage:
              "radial-gradient(circle, #e5e7eb 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        >
          {mapState === "placeholder" && renderPlaceholder()}
          {mapState === "address_input" && renderAddressInput()}
          {mapState === "loading" && renderLoading()}
        </div>

        {/*
          Map container — always in the DOM once first rendered so React never
          unmounts Mapbox. Hidden via opacity until active; absolute positioning
          gives it real dimensions even while invisible so Mapbox can init.
        */}
        <div
          ref={containerRef}
          className={`absolute inset-0 transition-opacity duration-300 ${
            mapState === "active" ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
        />

        {/* Change address — overlaid top-left on the live map */}
        {mapState === "active" && (
          <div className="absolute top-2 left-2 z-10">
            <button
              onClick={() => setMapState("address_input")}
              className="rounded-md bg-white/90 backdrop-blur-sm border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-white shadow-sm transition-colors"
            >
              Change address
            </button>
          </div>
        )}
      </div>

      {/* Below-map metadata */}
      {placeName && mapState === "active" && (
        <p className="mt-1.5 text-xs text-gray-400">{placeName}</p>
      )}
      {lastMethod && mapState === "active" && (
        <p className="mt-1 text-xs text-gray-400">{privacyNote}</p>
      )}

      {/* Representative cards */}
      {representatives.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {representatives.map((rep) => {
            const badge =
              PARTY_BADGE[rep.party?.toLowerCase() ?? ""] ??
              "bg-gray-100 text-gray-700";
            return (
              <a
                key={rep.id}
                href={`/officials/${rep.id}`}
                className="block rounded-lg border border-gray-200 bg-white p-3 hover:border-indigo-300 hover:shadow-sm transition-all"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-900 leading-tight">
                    {rep.full_name}
                  </p>
                  {rep.party && (
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${badge}`}
                    >
                      {rep.party[0]}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-gray-500">{rep.role_title}</p>
                {rep.jurisdiction && (
                  <p className="mt-0.5 text-xs text-gray-400">
                    {rep.jurisdiction}
                  </p>
                )}
                <p className="mt-2 text-xs font-medium text-indigo-600">
                  View profile →
                </p>
              </a>
            );
          })}
        </div>
      )}

      {representatives.length === 0 && lastMethod && mapState === "active" && (
        <p className="mt-3 text-sm text-gray-500">
          No representatives found for this location. District boundary data may
          not be fully loaded yet — check back soon.
        </p>
      )}
    </section>
  );
}
