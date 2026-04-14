"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Handles the implicit-flow auth redirect from magic links.
 *
 * When Supabase sends a magic link via the implicit flow, it redirects back
 * with tokens in the URL hash fragment:
 *   http://localhost:3000/#access_token=xxx&refresh_token=xxx&type=magiclink
 *
 * Servers can't read hash fragments, so the @supabase/ssr client (which has
 * flowType:"pkce" hardcoded) ignores them. This component extracts the tokens
 * from the hash and redirects to /auth/callback-hash — a server route that
 * verifies the tokens and sets proper auth cookies.
 *
 * Lives in the root layout so it runs on every page.
 */
export function AuthHashHandler() {
  const router = useRouter();
  const hasProcessedRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (hasProcessedRef.current) return;

    const hash = window.location.hash;
    if (!hash.includes("access_token=")) return;

    hasProcessedRef.current = true;

    // Manually parse the hash fragment to extract tokens
    const hashParams = new URLSearchParams(hash.replace("#", ""));
    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");

    if (!accessToken) return;

    // Redirect to server route that verifies the token and sets auth cookies
    const callbackUrl = `/auth/callback-hash?access_token=${encodeURIComponent(accessToken)}${refreshToken ? `&refresh_token=${encodeURIComponent(refreshToken)}` : ""}`;
    router.push(callbackUrl);
  }, [router]);

  return null;
}
