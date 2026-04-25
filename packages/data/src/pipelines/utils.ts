/**
 * Shared fetch utilities for all data pipelines.
 */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Thrown when an API returns a daily/monthly quota-exhausted signal.
 * Callers should catch this and abort gracefully rather than retry —
 * continued requests will keep failing until the quota resets.
 */
export class QuotaExhaustedError extends Error {
  readonly url: string;
  readonly body: string;
  constructor(url: string, body: string) {
    super(`Daily quota exhausted — ${url}\n  ${body.slice(0, 200)}`);
    this.name = "QuotaExhaustedError";
    this.url  = url;
    this.body = body;
  }
}

/** Detect daily-quota signals in a 429 body. Per-minute limits do NOT match. */
function isDailyQuotaBody(body: string): boolean {
  const b = body.toLowerCase();
  // OpenStates: "exceeded limit of 250/day: 256"
  if (/\/day\b/.test(b) && b.includes("exceeded")) return true;
  // Generic monthly/hour caps — treat as unrecoverable for the session
  if (/\/month\b/.test(b) && b.includes("exceeded")) return true;
  // Common patterns
  if (b.includes("daily limit"))   return true;
  if (b.includes("quota exceeded")) return true;
  return false;
}

/** GET JSON with one automatic retry after 30s on failure. */
export async function fetchJson<T>(
  url: string,
  options: RequestInit = {},
  retries = 1
): Promise<T> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      console.log(`  Retrying in 30s (attempt ${attempt + 1})...`);
      await sleep(30_000);
    }
    try {
      const res = await fetch(url, options);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        if (res.status === 429 && isDailyQuotaBody(body)) {
          throw new QuotaExhaustedError(url, body);
        }
        throw new Error(`HTTP ${res.status} — ${url}\n  ${body.slice(0, 200)}`);
      }
      return res.json() as Promise<T>;
    } catch (err) {
      if (err instanceof QuotaExhaustedError) throw err;   // do not retry
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt < retries) console.error(`  Request failed: ${lastErr.message}`);
    }
  }
  throw lastErr ?? new Error("Request failed");
}

/** POST JSON body, return parsed JSON response. */
export async function postJson<T>(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
  retries = 1
): Promise<T> {
  return fetchJson<T>(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    },
    retries
  );
}

/** Chunk an array into batches of size n. */
export function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
