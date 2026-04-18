"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@civitics/db";

/**
 * Handles post-sign-in redirect for the magic link flow.
 *
 * When the user requests a magic link, SignInForm stores the originating page
 * path in localStorage under "sign_in_next". After clicking the magic link,
 * /auth/confirm verifies the token and redirects to "/" (no next= in the URL).
 * This component runs on every page, checks for a pending redirect destination,
 * and navigates there once the user is authenticated.
 *
 * Clears the localStorage key immediately after redirecting so it only fires once.
 */
export function PostAuthRedirect() {
  const router = useRouter();
  const checked = useRef(false);

  useEffect(() => {
    if (checked.current) return;
    checked.current = true;

    const dest =
      typeof window !== "undefined"
        ? localStorage.getItem("sign_in_next")
        : null;

    if (!dest || !dest.startsWith("/") || dest === "/") return;

    // Only redirect if the user is actually signed in
    const supabase = createBrowserClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        localStorage.removeItem("sign_in_next");
        router.replace(dest);
      }
    });
  }, [router]);

  return null;
}
