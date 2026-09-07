/**
 * FIX-1165 — the manifest seam, and the tail cost table.
 *
 * Two rules live here, both learned the same way: on prod, on 2026-09-07, from a
 * 28-row change that cost the front door 202 statement cancellations against a
 * baseline of 1.
 *
 * RULE 1 — A REMEDIATION APPLIES FROM A MANIFEST AND NEVER DERIVES ON PROD.
 *
 *   The derivation these scripts run to FIND their population is a full audit
 *   scan of financial_relationships. It is the right query to run on a clone,
 *   where it is the only thing running. On prod it was 80% of the front-door
 *   damage for a change that touched 28 rows: 81 minutes, 132 x 57014. So the
 *   derivation is a CLONE-ONLY phase. It writes a TSV. Prod consumes the TSV.
 *
 *   Prod still recomputes every row-level fact it is about to act on — it must,
 *   because a clone dry run is stale the moment prod moves — but KEYED on the
 *   manifest's ids, which is an index range scan on financial_relationships
 *   (to_type, to_id), not a scan of the table. Rows prod has that the clone did
 *   not see are REPORTED and SKIPPED, never forced.
 *
 * RULE 2 — EVERY TAIL STEP SCALES WITH THE MANIFEST OR HAS A SCHEDULED OWNER.
 *
 *   Anything that is neither is a bug in the script, not a cost of the change.
 *   The 28-row apply's three manifest-scoped rollups took 78 seconds; the
 *   platform-scoped rebuild that followed them ran 28 minutes and was killed by
 *   hand, and the cancellation rate was HIGHEST during it.
 *
 *   A step's presence in a tail is not evidence it has an owner. Owners are
 *   checked in three places BY NAME: cron.job.command, pg_proc.prosrc (a pg_cron
 *   job may CALL a procedure that calls it), and the GHA workflows. Doing that
 *   for FIX-1165 found refresh_group_donor_rollup() with no scheduled owner at
 *   all — FIX-688 moved the EC rebuild to pg_cron and left it behind, and its
 *   only non-script caller sits in a workflow that is now workflow_dispatch-only.
 *   It had been re-derived purely as a side effect of remediation-script tails.
 */

import * as fs from "fs";

// ---------------------------------------------------------------------------
// Tail cost classes
// ---------------------------------------------------------------------------

/**
 * What a tail step's runtime is a function of.
 *
 * The reviewer's test, and it is a measurement rather than a judgement: if a
 * step's runtime does not move when the manifest goes from 28 rows to 2,736, it
 * is platform-scoped by definition.
 */
export type TailClass =
  /** Cost scales with the manifest. Always runs — this is the work. */
  | "manifest"
  /** Cost is independent of the manifest, and something scheduled collects it. */
  | "platform-owned"
  /** Cost is independent of the manifest and NOTHING collects it. A bug. */
  | "platform-orphan";

export interface TailStep {
  /** The exact label the script logs when it runs the step. */
  label: string;
  cls: TailClass;
  /** Scheduled owner, by job or pipeline NAME. Null iff cls is platform-orphan. */
  owner: string | null;
  /** True when --defer-tails skips this step. */
  deferred: boolean;
}

/**
 * Under --defer-tails, a step runs here iff its cost is the manifest's.
 *
 * Both platform classes defer. platform-owned defers because its owner will do
 * it anyway; platform-orphan defers because a remediation script is not an
 * owner, and the fix for an orphan is to give it one (FIX-1165 gave
 * refresh_group_donor_rollup a weekly job), not to keep paying for it out of
 * whatever change happens to be landing.
 */
export function deferredUnder(cls: TailClass, defer: boolean): boolean {
  return defer && cls !== "manifest";
}

/** Build a tail step with `deferred` derived from the class, never hand-set. */
export function tailStep(
  label: string,
  cls: TailClass,
  owner: string | null,
  defer: boolean,
): TailStep {
  if (cls === "platform-orphan" && owner !== null) {
    throw new Error(`tailStep(${label}): platform-orphan carries no owner`);
  }
  if (cls !== "platform-orphan" && !owner) {
    throw new Error(`tailStep(${label}): ${cls} must name an owner`);
  }
  return { label, cls, owner, deferred: deferredUnder(cls, defer) };
}

const CLASS_LABEL: Record<TailClass, string> = {
  manifest: "manifest-scoped",
  "platform-owned": "platform-scoped (owned)",
  "platform-orphan": "platform-scoped (ORPHAN)",
};

/**
 * FIX-1165 (c) — the dry run prints this BEFORE the go-ahead, so the trade is
 * visible at decision time rather than discovered at minute 28.
 */
export function printTailTable(steps: readonly TailStep[], defer: boolean): void {
  console.log(`\n── Tail steps ${defer ? "(--defer-tails)" : "(NO --defer-tails)"} ──────────────────`);
  const w = Math.max(40, ...steps.map((s) => s.label.length));
  console.log(`  ${"step".padEnd(w)}  ${"cost class".padEnd(24)}  ${"owner".padEnd(34)}  runs`);
  console.log(`  ${"-".repeat(w)}  ${"-".repeat(24)}  ${"-".repeat(34)}  ----`);
  for (const s of steps) {
    console.log(
      `  ${s.label.padEnd(w)}  ${CLASS_LABEL[s.cls].padEnd(24)}  ` +
        `${(s.owner ?? "— none —").padEnd(34)}  ${s.deferred ? "deferred" : "HERE"}`,
    );
  }
  const here = steps.filter((s) => !s.deferred);
  const plat = here.filter((s) => s.cls !== "manifest");
  console.log(
    `\n  ${here.length}/${steps.length} run here; ` +
      `${steps.length - here.length} deferred to scheduled owners.`,
  );
  if (plat.length > 0) {
    console.log(
      `  ! ${plat.length} PLATFORM-SCOPED step(s) will run here: ${plat.map((s) => s.label).join(", ")}`,
    );
    console.log(
      `    Their cost is independent of the manifest. On prod this is the FIX-1165\n` +
        `    shape — pass --defer-tails unless you specifically intend to pay it.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Manifests
// ---------------------------------------------------------------------------

export type ManifestRow = Record<string, string>;

export interface Manifest {
  path: string;
  header: string[];
  rows: ManifestRow[];
  /** `#`-prefixed lines, kept so the apply can echo the manifest's own caveats. */
  comments: string[];
}

/**
 * Read a TSV manifest. `#` lines are comments (the FIX-928 manifest is mostly
 * comments and they carry the disposition rationale), blank lines are skipped,
 * the first surviving line is the header.
 */
export function readManifest(file: string): Manifest {
  const raw = fs.readFileSync(file, "utf8");
  const comments: string[] = [];
  const body: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    if (line.startsWith("#")) comments.push(line);
    else body.push(line);
  }
  if (body.length === 0) throw new Error(`manifest ${file} has no data rows`);
  const header = body[0]!.split("\t");
  const rows = body.slice(1).map((line) => {
    const cells = line.split("\t");
    const row: ManifestRow = {};
    header.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    return row;
  });
  return { path: file, header, rows, comments };
}

/** Distinct values of a column, order-preserving. Throws on a missing column. */
export function manifestColumn(m: Manifest, col: string): string[] {
  if (!m.header.includes(col)) {
    throw new Error(`manifest ${m.path} has no column "${col}" (has: ${m.header.join(", ")})`);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of m.rows) {
    const v = r[col];
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/**
 * RULE 1, enforced. Called by every script that can write to prod.
 *
 * Returns the manifest when one was supplied. Exits — it does not throw, so the
 * refusal is one line and not a stack trace — when prod is the target and it was
 * not. Off prod, a manifest is optional: that is the derivation path, and it is
 * the only place the derivation is allowed to run.
 */
export function requireManifestOnProd(opts: {
  prod: boolean;
  manifestPath: string | null;
  /** Script name, for the message. */
  script: string;
  /** The flag that supplies the manifest — `--manifest <path>` or `--pair a,b`. */
  flag: string;
}): Manifest | null {
  const { prod, manifestPath, script, flag } = opts;
  if (!prod) {
    return manifestPath ? readManifest(manifestPath) : null;
  }
  if (!manifestPath) {
    console.error(
      `✗ PROD requires ${flag}.\n` +
        `  ${script} derives its population with a full audit scan of\n` +
        `  financial_relationships. On prod that scan is the change's largest cost and it\n` +
        `  is pure re-derivation: FIX-1165 measured 81 minutes and 132 statement\n` +
        `  cancellations for it against a 28-row manifest. Derive on the clone, review the\n` +
        `  TSV, then apply here with ${flag}.`,
    );
    process.exit(1);
  }
  return readManifest(manifestPath);
}

/** `--manifest <path>`; null when absent. */
export function manifestArg(argv: string[]): string | null {
  const i = argv.indexOf("--manifest");
  if (i === -1) return null;
  const v = argv[i + 1];
  if (!v || v.startsWith("--")) {
    console.error("✗ --manifest needs a path.");
    process.exit(1);
  }
  return v;
}

// ---------------------------------------------------------------------------
// Clone-vs-prod diff
// ---------------------------------------------------------------------------

export interface DiffInput {
  key: string;
  /** What the clone manifest recorded. */
  expectedRows: number;
  expectedCents: number;
  /** What prod holds right now, recomputed keyed on this key. */
  actualRows: number;
  actualCents: number;
}

export type DiffVerdict =
  /** Prod matches the manifest. Act. */
  | "match"
  /** Prod has fewer rows than the manifest — someone already acted. Act on what is here. */
  | "shrunk"
  /** Prod has rows the clone never saw. Report and SKIP: the manifest did not authorise them. */
  | "grown"
  /** Prod has nothing at all for this key. Nothing to do. */
  | "gone";

export function diffVerdict(d: DiffInput): DiffVerdict {
  if (d.actualRows === 0) return "gone";
  if (d.actualRows > d.expectedRows) return "grown";
  if (d.actualRows < d.expectedRows) return "shrunk";
  return "match";
}

/** True iff this key may be acted on. `grown` is the refusal. */
export function diffActionable(v: DiffVerdict): boolean {
  return v === "match" || v === "shrunk";
}

export function formatDiffLine(d: DiffInput, v: DiffVerdict): string {
  const dr = d.actualRows - d.expectedRows;
  const dc = d.actualCents - d.expectedCents;
  const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  return (
    `${d.key}  manifest ${d.expectedRows} rows/$${(d.expectedCents / 100).toLocaleString()}  ` +
    `here ${d.actualRows} rows/$${(d.actualCents / 100).toLocaleString()}  ` +
    `DIFF ${sign(dr)} rows / ${sign(Math.round(dc / 100))} $ -> ${v.toUpperCase()}` +
    (v === "grown" ? "  [SKIPPED — not in the manifest]" : "")
  );
}

// ---------------------------------------------------------------------------
// The tail, declared once
// ---------------------------------------------------------------------------

/**
 * FIX-1165 — the tail, declared as data.
 *
 * One list, consumed twice: the dry run prints it as the cost table, the apply
 * executes it. `labels` here are the exact strings the steps log, which is what
 * lets the unit test assert that nothing executes without appearing in the
 * table (a step that runs but is not declared is exactly how
 * rebuild_financial_entity_ie_totals() stayed invisible through two prompts).
 *
 * Owner column is the answer to "who else would do this?", checked BY NAME in
 * cron.job.command, pg_proc.prosrc and the GHA workflows — not assumed.
 */
export function declareRemediationTail(defer: boolean): TailStep[] {
  const MANIFEST_OWNER = "this run (no other owner exists)";
  const DAILY = "refresh-derived-mvs-daily (06:00)";
  const WEEKLY = "refresh-derived-mvs-weekly (Tue 00:47)";
  return [
    // Phase 2 — cost scales with the manifest. These are the change.
    tailStep("donor_rollup_rebuild_recipients(affected)", "manifest", MANIFEST_OWNER, defer),
    tailStep("financial_entity_donation_totals_rebuild", "manifest", MANIFEST_OWNER, defer),
    tailStep("donor_party_rollup_rebuild_donors", "manifest", MANIFEST_OWNER, defer),
    // Phase 2 — cost is the platform's. All four defer.
    tailStep("rebuild_financial_entity_ie_totals()", "platform-owned", "fec-bulk pipeline (weekly + drop probe)", defer),
    tailStep("refresh_group_donor_rollup()", "platform-owned", "group-donor-rollup-refresh (Wed 03:10)", defer),
    tailStep("rebuild_entity_search_index()", "platform-owned", DAILY, defer),
    tailStep("refresh_treemap_individuals_global()", "platform-owned", "treemap-individuals-global-refresh (Tue 14:00)", defer),
    // Phase 3 — the MV loop.
    tailStep("refresh_official_sector_dollars_mv()", "platform-owned", WEEKLY, defer),
    tailStep("refresh_official_homepage_stats_mv()", "platform-owned", DAILY, defer),
    tailStep("refresh_homepage_stats_mv()", "platform-owned", DAILY, defer),
    tailStep("refresh_chord_industry_flows_mv()", "platform-owned", WEEKLY, defer),
    tailStep("refresh_chord_donor_type_party_flows_mv()", "platform-owned", WEEKLY, defer),
    tailStep("refresh_chord_donor_state_party_flows_mv()", "platform-owned", WEEKLY, defer),
    // Vacuum — FIX-943's convention, handed to the FIX-1152 owners on prod.
    tailStep("VACUUM ANALYZE financial_relationships", "platform-owned", "fr-vacuum-analyze (Mon 01:00)", defer),
    tailStep("VACUUM ANALYZE entity_connections", "platform-owned", "ec-vacuum-analyze (daily 04:30)", defer),
    tailStep("VACUUM ANALYZE officials", "platform-owned", "officials-vacuum-analyze (Mon 01:30)", defer),
    tailStep("VACUUM ANALYZE financial_entities", "platform-owned", "fe-vacuum-analyze (daily 04:50)", defer),
  ];
}

