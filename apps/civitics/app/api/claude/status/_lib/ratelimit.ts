// Shared in-memory per-IP rate limiter for /api/claude/status, /core, /quality.
// All three routes share this Map, so the 60/hour budget is total across them.

const RL = new Map<string, { n: number; t: number }>();
const RL_MAX = 60;
const RL_WIN_MS = 60 * 60 * 1000;

export function getIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export function rateOk(ip: string): boolean {
  const now = Date.now();
  const s = RL.get(ip);
  if (!s || now - s.t > RL_WIN_MS) {
    RL.set(ip, { n: 1, t: now });
    return true;
  }
  if (s.n >= RL_MAX) return false;
  s.n++;
  return true;
}

export const RL_LIMIT = RL_MAX;
