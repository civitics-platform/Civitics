/**
 * GET /api/phases
 *
 * Reads docs/PHASE_GOALS.md at runtime and returns phase completion data.
 * Replaces the hard-coded PHASES array in DashboardClient.
 */

import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

export const revalidate = 3600; // cache 1 hour at edge

type Phase = {
  name: string;
  label: string;
  pct: number;
  done: boolean;
};

function parsePhases(md: string): Phase[] {
  const phases: Phase[] = [];
  // Match lines like: ## Phase 0 — Scaffold ✓ `Weeks 1–2` `100% complete`
  // or: ## Phase 1 — MVP `Weeks 3–10` `~88% complete` ← **current**
  const headerRe = /^## (Phase \d+) — ([^\n`]+?)(?:\s*✓)?\s*`[^`]+`\s*`~?(\d+)% complete`/gm;
  let match: RegExpExecArray | null;
  while ((match = headerRe.exec(md)) !== null) {
    const phaseName = match[1]!.trim();
    const label = match[2]!.trim();
    const pct = parseInt(match[3]!, 10);
    phases.push({ name: phaseName, label, pct, done: pct === 100 });
  }
  return phases;
}

export async function GET() {
  try {
    // Walk up from app/ to repo root, then to docs/
    const mdPath = join(process.cwd(), "../../docs/PHASE_GOALS.md");
    const md = readFileSync(mdPath, "utf8");
    const phases = parsePhases(md);
    if (phases.length === 0) throw new Error("No phases found");
    return NextResponse.json({ phases });
  } catch (e) {
    // Fall back to known-good static data rather than 500
    return NextResponse.json({
      phases: [
        { name: "Phase 0", label: "Foundation", pct: 100, done: true },
        { name: "Phase 1", label: "Civic Core",  pct: 88,  done: false },
        { name: "Phase 2", label: "Community",   pct: 0,   done: false },
        { name: "Phase 3", label: "Economy",      pct: 0,   done: false },
        { name: "Phase 4", label: "Blockchain",   pct: 0,   done: false },
        { name: "Phase 5", label: "Candidates",   pct: 0,   done: false },
      ],
      fallback: true,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
