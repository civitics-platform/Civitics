import {
  createBrowserClient as createSSRBrowserClient,
  createServerClient as createSSRServerClient,
  type CookieOptions,
} from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types/database";

// ---------------------------------------------------------------------------
// Browser client — safe to call in client components
// Uses the publishable key (replaces legacy anon key)
// ---------------------------------------------------------------------------
export function createBrowserClient() {
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const key = process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
    );
  }

  return createSSRBrowserClient<Database>(url, key);
}

// ---------------------------------------------------------------------------
// Cookie store interface — matches Next.js ReadonlyRequestCookies and
// ResponseCookies without importing from next/headers (keeps this package
// framework-agnostic).
// ---------------------------------------------------------------------------
export interface CookieStore {
  getAll(): { name: string; value: string }[];
  setAll?(
    cookies: { name: string; value: string; options: CookieOptions }[]
  ): void;
}

// ---------------------------------------------------------------------------
// Server client (auth-aware) — for Next.js Server Components and Route Handlers
// Reads and writes auth cookies so the user's session is preserved during SSR.
//
// Usage in a Server Component:
//   import { cookies } from "next/headers"
//   const supabase = createServerClient(await cookies())
//
// Usage in a Route Handler:
//   const supabase = createServerClient(cookies())
// ---------------------------------------------------------------------------
export function createServerClient(cookieStore: CookieStore) {
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const key = process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
    );
  }

  return createSSRServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookieStore.setAll?.(cookiesToSet);
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Public client — server-side, no cookies, RLS-respecting (anon role).
// Use for Server Components that only read public civic data and don't need
// the user's session. Calling cookies() in a Server Component opts that
// page out of static rendering / ISR; createPublicClient avoids that, so
// the page can use `export const revalidate = N` and be served from disk
// (true static generation) or the Vercel CDN cache (cf. FIX-201).
//
// Auth-aware reads (anything that depends on auth.uid()) still need
// createServerClient(cookies()) — civic_comments, follows, user_positions,
// profile pages, etc. Use createPublicClient only on routes that are
// genuinely public.
// ---------------------------------------------------------------------------
export function createPublicClient() {
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const key = process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
    );
  }

  return createClient<Database>(url, key, {
    auth: { persistSession: false },
  });
}

// ---------------------------------------------------------------------------
// Admin client — server only, bypasses RLS
// Uses the secret key (replaces legacy service_role key).
// Never import this in client components or expose it to the browser.
//
// Pipeline guard (FIX-158): when invoked from a tsx pipeline (no NEXT_RUNTIME
// or VERCEL env var), prints a one-line target banner to stderr and refuses
// to run against a non-local URL unless --allow-prod is in process.argv.
// Prevents accidental cross-env writes when .env.local was last copied from
// .env.local.prod. Skipped entirely inside Next.js (server routes, build).
// ---------------------------------------------------------------------------
let pipelineGuardChecked = false;

function isLocalUrl(url: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(url);
}

function runPipelineGuard(url: string): void {
  if (pipelineGuardChecked) return;
  pipelineGuardChecked = true;
  if (process.env["NEXT_RUNTIME"] || process.env["VERCEL"]) return;

  const local = isLocalUrl(url);
  const banner = `[pipeline] target: ${url} (${local ? "local" : "REMOTE"})`;
  process.stderr.write(`${banner}\n`);

  if (!local && !process.argv.includes("--allow-prod")) {
    process.stderr.write(
      `[pipeline] REFUSING to run against a non-local DB without --allow-prod\n` +
        `[pipeline] If intentional, re-invoke with --allow-prod.\n` +
        `[pipeline] To switch back to local: Copy-Item .env.local.dev .env.local\n`,
    );
    process.exit(1);
  }
}

export function createAdminClient() {
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const key = process.env["SUPABASE_SECRET_KEY"];

  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY");
  }

  runPipelineGuard(url);

  return createClient<Database>(url, key, {
    auth: { persistSession: false },
  });
}

// Cross-environment admin client for one-shot scripts that need to talk to
// local + prod simultaneously (e.g. copy-pac-tags-to-prod). Caller passes the
// url/key explicitly — no process.env reads. The pipeline guard is skipped
// because the caller has, by definition, opted into a non-active-env target.
export function createAdminClientWith(url: string, key: string) {
  if (!url || !key) {
    throw new Error("createAdminClientWith requires both url and key");
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false },
  });
}
