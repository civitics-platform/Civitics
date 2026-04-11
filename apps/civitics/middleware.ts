import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const BOT_PATTERNS = [
  /\.php$/i,
  /wp-content/i,
  /wp-admin/i,
  /wp-login/i,
  /xmlrpc/i,
  /\.env$/i,
  /\.git\//i,
  /actuator/i,
  /solr/i,
  /\.asp(x?)$/i,
  /\.cgi$/i,
  /phpmyadmin/i,
  /\.sql$/i,
  /admin\/config/i,
  /shell\.php/i,
];

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (BOT_PATTERNS.some((p) => p.test(path))) {
    return new NextResponse(null, { status: 404 });
  }

  // ── PKCE code intercept ────────────────────────────────────────────────────
  // When Supabase's emailRedirectTo URL isn't in its allowed_redirect_urls
  // (common in local dev without a config.toml), it falls back to the site_url
  // and appends ?code= there instead. Intercept it here and forward to the
  // callback route which knows how to exchange it for a session.
  const code = request.nextUrl.searchParams.get("code");
  if (code && !path.startsWith("/auth/")) {
    const callbackUrl = request.nextUrl.clone();
    callbackUrl.pathname = "/auth/callback";
    // Pass the original path as `next` so the user lands back where they were
    callbackUrl.searchParams.set("code", code);
    callbackUrl.searchParams.set("next", path === "/" ? "/" : path);
    return NextResponse.redirect(callbackUrl);
  }

  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Silently refresh the session token — no routes are auth-protected yet.
  // All civic content is public. Auth is for engagement features only.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
