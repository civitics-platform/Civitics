import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// ── Load root .env.local for monorepo ────────────────────────────────────────
// Next.js only looks for .env.local in the app directory (apps/civitics/).
// In this monorepo the single .env.local lives at the repo root, so we load
// it manually here before Next.js initialises — covering both dev and build.
const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const content = readFileSync(resolve(__dirname, "../../.env.local"), "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
} catch {
  // Root .env.local not present — fall through to app-level .env.local
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Note: `output: "standalone"` would shrink the Vercel cold-start image but
  // breaks `pnpm build` on Windows (EPERM on symlink without Developer Mode).
  // Re-enable once Windows Dev Mode is on or builds move to Linux/CI only.
  staticPageGenerationTimeout: 30,
  transpilePackages: [
    "@civitics/ui",
    "@civitics/db",
    "@civitics/auth",
    "@civitics/blockchain",
    "@civitics/maps",
    "@civitics/graph",
    "@civitics/ai",
  ],
  // Tree-shake icon and util packages aggressively. Without this, importing
  // a single icon from lucide-react pulls in the whole barrel.
  experimental: {
    optimizePackageImports: [
      "@civitics/graph",
      "@civitics/maps",
      "@civitics/ui",
      "lucide-react",
      "d3",
    ],
  },
  // Mapbox + Deck.gl are browser-only; keep them out of the server bundle so
  // SSR builds don't try to evaluate WebGL/window references.
  serverExternalPackages: [
    "mapbox-gl",
    "@deck.gl/core",
    "@deck.gl/layers",
    "@deck.gl/mapbox",
  ],
  images: {
    remotePatterns: [
      // Official photos from Congress.gov
      { protocol: "https", hostname: "bioguide.congress.gov" },
      // Cloudflare R2 bucket (no egress fees)
      { protocol: "https", hostname: "*.r2.cloudflarestorage.com" },
    ],
  },
  async redirects() {
    return [
      {
        source: "/:path*.php",
        destination: "/404",
        permanent: false,
      },
      {
        source: "/wp-:path*",
        destination: "/404",
        permanent: false,
      },
      {
        source: "/.env:path*",
        destination: "/404",
        permanent: false,
      },
    ];
  },
  async headers() {
    // Security headers everything inherits.
    const securityHeaders = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    ];
    return [
      {
        // Static assets — content-hashed, immutable.
        source: "/_next/static/(.*)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        // Auth + admin + mutating routes — never cache. Auth callbacks set
        // session cookies; admin endpoints expose privileged reads.
        source: "/api/auth/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }, ...securityHeaders],
      },
      {
        source: "/api/admin/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }, ...securityHeaders],
      },
      {
        source: "/auth/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }, ...securityHeaders],
      },
      {
        source: "/profile/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }, ...securityHeaders],
      },
      {
        // Dashboard is admin/transparency-tool; content is stable. Hold on
        // the edge for 30 minutes, serve stale up to an hour. Replaces the
        // FIX-8 cache-busting headers — which were a workaround for the now
        // resolved cache-key collision, not a real freshness requirement.
        source: "/dashboard",
        headers: [
          {
            key: "Cache-Control",
            value: "public, s-maxage=1800, stale-while-revalidate=3600",
          },
          ...securityHeaders,
        ],
      },
      {
        // Read-heavy public pages — let Vercel's edge cache hold the response
        // for a few minutes and serve stale while revalidating in the
        // background. Civic data changes slowly; SWR keeps freshness OK.
        source: "/((?!_next/static|api/auth|api/admin|auth|profile|dashboard).*)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, s-maxage=300, stale-while-revalidate=600",
          },
          ...securityHeaders,
        ],
      },
    ];
  },
};

export default nextConfig;
