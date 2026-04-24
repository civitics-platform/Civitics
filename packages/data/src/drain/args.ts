/**
 * Minimal flag parser for drain CLI scripts. Supports `--key value` and
 * `--flag` (boolean). No positionals, no short flags.
 */

export function parseFlags(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = "true";
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

export function requireFlag(flags: Record<string, string>, name: string): string {
  const v = flags[name];
  if (!v || v === "true") {
    throw new Error(`--${name} is required`);
  }
  return v;
}

export function intFlag(
  flags: Record<string, string>,
  name: string,
  opts: { default?: number; min?: number; max?: number } = {},
): number {
  const raw = flags[name];
  if (raw === undefined || raw === "true") {
    if (opts.default !== undefined) return opts.default;
    throw new Error(`--${name} is required`);
  }
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new Error(`--${name} must be an integer (got ${raw})`);
  if (opts.min !== undefined && n < opts.min) {
    throw new Error(`--${name} must be >= ${opts.min} (got ${n})`);
  }
  if (opts.max !== undefined && n > opts.max) {
    throw new Error(`--${name} must be <= ${opts.max} (got ${n})`);
  }
  return n;
}
