"use server";

import { cookies, headers } from "next/headers";
import { createClient } from "@supabase/supabase-js";

/**
 * Server Action: send a magic-link / OTP email.
 *
 * We use a plain supabase-js createClient (NOT @supabase/ssr's createServerClient)
 * because createServerClient hard-codes flowType:'pkce', which embeds a PKCE
 * challenge in the email link. That challenge needs to be stored in a cookie
 * and matched on the callback — unreliable in Next.js SSR.
 *
 * The plain createClient defaults to flowType:'implicit', so signInWithOtp
 * sends a magic link that goes through Supabase's own /auth/v1/verify endpoint,
 * then redirects back with tokens in the URL hash fragment:
 *
 *   http://localhost:3000/#access_token=xxx&...
 *
 * AuthHashHandler (in the root layout) intercepts the hash fragment and
 * redirects to /auth/callback-hash, which sets proper server-side cookies.
 *
 * We embed the post-sign-in destination as ?sign_in_next= in the emailRedirectTo
 * URL so AuthHashHandler can read it from URL params — no localStorage required.
 * The cookie fallback (/auth/confirm reads it) is kept for any token-hash flows.
 *
 * supabase/config.toml allows http://localhost:3000/** so the redirect_to URL
 * with query params is accepted by the local auth server.
 */
export async function sendSignInEmail(
  email: string,
  next?: string
): Promise<{ error: string | null }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    return { error: "Supabase environment variables are not configured." };
  }

  // Cookie fallback for /auth/confirm (token-hash flow).
  if (next && next.startsWith("/") && next !== "/") {
    const cookieStore = await cookies();
    cookieStore.set("sign_in_next", next, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 600, // 10 minutes
      path: "/",
    });
  }

  // Build emailRedirectTo with next embedded as a URL param.
  // Supabase will use this as redirect_to after verifying the token, so
  // the user lands at e.g. http://localhost:3000/?sign_in_next=/initiatives/abc
  // AuthHashHandler reads sign_in_next from the URL and passes it to
  // /auth/callback-hash, which redirects there after setting cookies.
  const headersList = await headers();
  const origin = headersList.get("origin") ?? "";
  const emailRedirectTo =
    next && next.startsWith("/") && next !== "/" && origin
      ? `${origin}/?sign_in_next=${encodeURIComponent(next)}`
      : undefined;

  const supabase = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      // flowType intentionally omitted — defaults to 'implicit' in auth-js v2
    },
  });

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: emailRedirectTo ? { emailRedirectTo } : undefined,
  });

  return { error: error?.message ?? null };
}
