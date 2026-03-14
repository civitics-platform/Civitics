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
// Admin client — server only, bypasses RLS
// Uses the secret key (replaces legacy service_role key).
// Never import this in client components or expose it to the browser.
// ---------------------------------------------------------------------------
export function createAdminClient() {
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const key = process.env["SUPABASE_SECRET_KEY"];

  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY");
  }

  return createClient<Database>(url, key, {
    auth: { persistSession: false },
  });
}
