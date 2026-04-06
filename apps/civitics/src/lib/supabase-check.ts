import { NextResponse } from "next/server";

export function supabaseUnavailable(): boolean {
  return process.env.SUPABASE_AVAILABLE === "false";
}

export function unavailableResponse(): NextResponse {
  return NextResponse.json(
    { error: "Service temporarily unavailable", retry_after: 3600 },
    {
      status: 503,
      headers: {
        "Retry-After": "3600",
        "Cache-Control": "no-store",
      },
    }
  );
}

/**
 * Wraps a Supabase query in a 5-second timeout.
 * On timeout, resolves with { data: null, error: Error } instead of hanging.
 * Preserves the full return type (including count, status, etc.) via generic T.
 *
 * Usage:
 *   const { data, error } = await withDbTimeout(
 *     supabase.from("table").select("col").limit(100)
 *   );
 */
export async function withDbTimeout<T>(
  query: PromiseLike<T>,
  ms = 5000
): Promise<T> {
  const timeoutResult = { data: null, error: new Error(`Supabase query timed out after ${ms}ms`) };
  return Promise.race([
    Promise.resolve(query),
    new Promise<T>((resolve) =>
      setTimeout(() => resolve(timeoutResult as unknown as T), ms)
    ),
  ]);
}
