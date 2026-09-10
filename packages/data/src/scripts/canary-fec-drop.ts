/**
 * FIX-1166 — "a FEC drop is pending and nobody collected it".
 *
 * THE GAP THIS FILLS. fec_bulk is already in the FIX-1011 freshness registry,
 * but that watcher answers a different question: it derives fec_bulk's cadence
 * from fec_bulk's own history (prod 2026-09-10: 96.04h observed median, reports
 * past 144.1h, escalates past 240.1h) and asks whether the pipeline has run
 * lately. It knows nothing about FEC. So it cannot fire until day TEN, and on a
 * quiet stretch where FEC publishes nothing it will eventually report a stale
 * pipeline that is in fact perfectly correct. Both directions are wrong for the
 * thing that actually costs money: FEC published, and we did not collect it.
 *
 * The instrument for that already exists and nothing reads it. FIX-1163 half
 * (b) made every nightly's enrichment-light phase HEAD the active cycle's indiv
 * file and write the verdict to `pipeline_state.fec_drop_probe` — a phase that
 * always runs, deliberately upstream of the fec phase that is the thing failing.
 * This module turns that row into a verdict.
 *
 * NO NEW TABLE, NO NEW JOB, NO NEW INSTRUMENTATION. Two reads the canary makes
 * anyway: the probe row, and the newest `fec_bulk` closure in data_sync_log.
 *
 * ---------------------------------------------------------------------------
 * WHY `pending === false` IS NOT HEALTH, AND WHAT THE RING IS FOR.
 *
 * probeIndivDrop FAILS CLOSED: an unreadable HEAD returns `pending: false` with
 * a NULL remote_last_modified, because launching a ~2.5h writer run on a probe
 * we could not read is worse than waiting. That is the right call for the
 * TRIGGER and a trap for a WATCHER — a permanently broken probe reads exactly
 * like a permanently level watermark.
 *
 * The null remote_last_modified is what separates them, but one null is not a
 * finding: a single transient HEAD failure against FEC is ordinary. So
 * recordDropProbe keeps a three-deep ring of {probed_at, remote_last_modified}
 * in the same pipeline_state value, and only three consecutive blind probes
 * report. Under three, the state is still named `probe-blind` — it is not
 * silently relabelled healthy — it simply carries no tier.
 *
 * The ring lives in the probe key rather than being reconstructed from the
 * canary's own meta rows for two reasons: the writer already knows the history,
 * so the reader needs no second query; and it keeps working across a stretch
 * where the canary itself did not run, which is exactly when a blind probe is
 * most likely to go unnoticed.
 *
 * ---------------------------------------------------------------------------
 * FIVE STATES, ONE PREDICATE EACH, EVALUATED IN THIS ORDER.
 *
 *   probe-missing        WARN.  No probe row, or probed_at older than 36h. Says
 *                        nothing about FEC — it says the nightly's light phase
 *                        did not run. Distinct from every state below for that
 *                        reason, and first because a stale row's `pending` is
 *                        not evidence about today.
 *   probe-blind          WARN, quieter. remote_last_modified NULL on this probe
 *                        AND the two before it. Reports at a streak of three;
 *                        under three it is named and carries no tier.
 *   pending-uncollected  ESCALATE. A drop is pending and the newest fec_bulk
 *                        closure is more than two days older than the probe (or
 *                        there is none). This is the FIX-1156 condition: money
 *                        sitting at FEC that nothing collected.
 *   pending-within-window  Informational, no tier. A drop is pending and
 *                        fec_bulk closed inside two days. FEC publishes Sundays
 *                        ~15:20-15:50 UTC and the following run collects, so a
 *                        one-day lag is the NORMAL shape — tiering it would page
 *                        weekly, by design, and train the alert to be ignored.
 *   collected            Healthy. Not pending, probe readable, probe fresh.
 *
 * `collected` and `pending-within-window` push no condition. Both are still
 * recorded in the canary's meta row on every run, the same way vm[] and bloat[]
 * are: the trail is what makes an onset findable after the fact.
 *
 * Pure functions over plain data — no DB, no network — so this is meaningful in
 * CI, which has no Postgres. Mirrors canary-transitions.ts.
 */

/** One entry of the probe ring kept in pipeline_state.fec_drop_probe. */
export type DropProbeRingEntry = {
  probed_at: string;
  remote_last_modified: string | null;
};

/** The stored `pipeline_state.fec_drop_probe` value. */
export type StoredDropProbe = {
  cycle?: string;
  pending?: boolean;
  remote_last_modified?: string | null;
  watermark_last_modified?: string | null;
  probed_at?: string;
  phase?: string;
  /** FIX-1166 — newest first, at most RING_DEPTH entries, including this probe. */
  recent?: DropProbeRingEntry[];
};

export type FecDropState =
  | "collected"
  | "pending-within-window"
  | "pending-uncollected"
  | "probe-blind"
  | "probe-missing";

export type FecDropStatus = {
  state: FecDropState;
  /** null means "recorded, but not a finding this run". */
  tier: "escalate" | "report" | null;
  /** Monotone-worse, for the FIX-1036 transition classifier. */
  severity: number;
  detail: string;
  /** Consecutive probes (newest first) with a NULL remote_last_modified. */
  blindStreak: number;
  hoursSinceProbe: number | null;
  /** probed_at minus the newest fec_bulk closure, in days. */
  daysSinceCollect: number | null;
  cycle: string | null;
  pending: boolean | null;
};

/** How deep the probe ring goes, and therefore what counts as a blind streak. */
export const RING_DEPTH = 3;
/** A probe older than this means the nightly's light phase did not run. */
export const PROBE_STALE_HOURS = 36;
/** A pending drop older than this against the newest closure is uncollected. */
export const UNCOLLECTED_DAYS = 2;

/** Stable condition keys — the identity of the problem, not its wording. */
export const KEY_UNCOLLECTED = "fec_drop_uncollected";
export const KEY_BLIND = "fec_drop_probe_blind";
export const KEY_MISSING = "fec_drop_probe_missing";

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/** Severity floor for "never happened", kept finite so WORSEN_FACTOR behaves. */
const NEVER = 1_000_000;

function parseMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * The ring as the classifier sees it: the stored ring when there is one, else
 * the single current probe. Rows written before FIX-1166 carry no `recent`, and
 * a one-entry view is the honest reading of those — never a three-deep blind
 * streak inferred from one probe.
 */
export function probeRing(probe: StoredDropProbe): DropProbeRingEntry[] {
  const stored = Array.isArray(probe.recent) ? probe.recent : null;
  if (stored && stored.length > 0) return stored.slice(0, RING_DEPTH);
  if (probe.probed_at) {
    return [
      { probed_at: probe.probed_at, remote_last_modified: probe.remote_last_modified ?? null },
    ];
  }
  return [];
}

/** Consecutive newest-first entries whose HEAD returned nothing. */
export function blindStreak(ring: DropProbeRingEntry[]): number {
  let n = 0;
  for (const e of ring) {
    if (e.remote_last_modified != null) break;
    n += 1;
  }
  return n;
}

/**
 * Append `entry` to a ring, newest first, trimmed to RING_DEPTH. Exported so
 * the writer and the reader cannot drift on the ordering.
 */
export function pushRing(
  existing: DropProbeRingEntry[] | undefined,
  entry: DropProbeRingEntry,
): DropProbeRingEntry[] {
  const prior = Array.isArray(existing) ? existing : [];
  return [entry, ...prior].slice(0, RING_DEPTH);
}

/**
 * Classify the FEC drop-collection state.
 *
 * @param probe          pipeline_state.fec_drop_probe, or null when absent.
 * @param lastCollectAt  newest data_sync_log fec_bulk row with status='complete'
 *                       (its completed_at), or null when there is none.
 * @param now            the canary run's entry instant.
 */
export function classifyFecDrop(
  probe: StoredDropProbe | null,
  lastCollectAt: string | null,
  now: Date,
): FecDropStatus {
  const nowMs = now.getTime();
  const probedMs = parseMs(probe?.probed_at);
  const hoursSinceProbe = probedMs === null ? null : round1((nowMs - probedMs) / MS_PER_HOUR);

  const base = {
    blindStreak: 0,
    hoursSinceProbe,
    daysSinceCollect: null as number | null,
    cycle: probe?.cycle ?? null,
    pending: probe?.pending ?? null,
  };

  // 1. probe-missing — the light phase did not run, or its row predates the
  //    window. A stale row's `pending` is not evidence about today, so this is
  //    checked before anything that reads it.
  if (!probe || probedMs === null) {
    return {
      ...base,
      state: "probe-missing",
      tier: "report",
      severity: NEVER,
      detail:
        "FEC drop probe missing: pipeline_state.fec_drop_probe " +
        (probe ? "has no readable probed_at" : "does not exist") +
        " — the nightly's enrichment-light phase has not recorded a probe",
    };
  }
  if (hoursSinceProbe !== null && hoursSinceProbe > PROBE_STALE_HOURS) {
    return {
      ...base,
      state: "probe-missing",
      tier: "report",
      severity: hoursSinceProbe,
      detail:
        `FEC drop probe stale: last probed ${probe.probed_at} (${hoursSinceProbe}h ago, ` +
        `threshold ${PROBE_STALE_HOURS}h) — the nightly's enrichment-light phase has not run`,
    };
  }

  // 2. probe-blind — the HEAD failed closed, so `pending: false` below would be
  //    an artefact rather than a reading. Three consecutive nulls report.
  const ring = probeRing(probe);
  const streak = blindStreak(ring);
  if (probe.remote_last_modified == null) {
    const reports = streak >= RING_DEPTH;
    return {
      ...base,
      state: "probe-blind",
      tier: reports ? "report" : null,
      severity: streak,
      blindStreak: streak,
      detail:
        `FEC drop probe blind: HEAD returned no Last-Modified on the last ${streak} ` +
        `probe(s)${reports ? "" : ` (reports at ${RING_DEPTH})`} — the probe fails closed, ` +
        "so pending=false here is not evidence that FEC is level with us",
    };
  }

  // 3./4. pending — measured against the newest closure from the PROBE, not
  //    from now: the question is whether a collection followed the drop, and
  //    the canary's own clock has nothing to do with that.
  const collectMs = parseMs(lastCollectAt);
  const daysSinceCollect =
    collectMs === null ? null : round1((probedMs - collectMs) / MS_PER_DAY);

  if (probe.pending === true) {
    const uncollected = daysSinceCollect === null || daysSinceCollect > UNCOLLECTED_DAYS;
    if (uncollected) {
      return {
        ...base,
        state: "pending-uncollected",
        tier: "escalate",
        severity: daysSinceCollect ?? NEVER,
        blindStreak: streak,
        daysSinceCollect,
        detail:
          `FEC drop pending and uncollected: FEC has ${probe.remote_last_modified} for cycle ` +
          `${probe.cycle ?? "?"} against watermark ${probe.watermark_last_modified ?? "none"}, ` +
          "and the newest fec_bulk completion is " +
          (lastCollectAt === null
            ? "NONE on record"
            : `${lastCollectAt} (${daysSinceCollect}d before the probe, threshold ${UNCOLLECTED_DAYS}d)`),
      };
    }
    return {
      ...base,
      state: "pending-within-window",
      tier: null,
      severity: daysSinceCollect ?? 0,
      blindStreak: streak,
      daysSinceCollect,
      detail:
        `FEC drop pending, collection inside the window: fec_bulk completed ${lastCollectAt} ` +
        `(${daysSinceCollect}d before the probe, threshold ${UNCOLLECTED_DAYS}d) — the normal ` +
        "Sunday-publish/next-run-collects shape",
    };
  }

  // 5. collected — not pending, probe readable, probe fresh.
  return {
    ...base,
    state: "collected",
    tier: null,
    severity: 0,
    blindStreak: streak,
    daysSinceCollect,
    detail:
      `FEC drop collected: watermark ${probe.watermark_last_modified ?? "none"} is level with ` +
      `FEC's ${probe.remote_last_modified} for cycle ${probe.cycle ?? "?"} ` +
      `(probed ${hoursSinceProbe}h ago)`,
  };
}
