import type { Check, CheckResult } from "../types";

export const officialsChecks: Check = async ({ query }) => {
  const out: CheckResult[] = [];

  // Federal-only scope: officials.source_ids has 'congress_gov' for U.S.
  // congressional officials. State legislators (from OpenStates) carry
  // 'openstates_id' instead.
  const FED_FILTER = `source_ids ? 'congress_gov'`;

  const senators = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM officials
      WHERE is_active = true
        AND role_title ILIKE '%senator%'
        AND ${FED_FILTER}`,
  );
  const senatorCount = Number(senators[0]?.count ?? 0);
  out.push({
    category: "officials.senator_count",
    severity: senatorCount === 100 ? "info" : "error",
    expected: 100,
    actual: senatorCount,
    sample: [],
    detail: "Active U.S. senators (2 per state × 50 states).",
  });

  const senatorsByState = await query<{ state: string | null; count: string }>(
    `SELECT COALESCE(NULLIF(metadata->>'state', ''), NULLIF(metadata->>'state_abbr', '')) AS state,
            COUNT(*)::text AS count
       FROM officials
      WHERE is_active = true
        AND role_title ILIKE '%senator%'
        AND ${FED_FILTER}
      GROUP BY 1`,
  );
  const wrongStates = senatorsByState.filter((row) => Number(row.count) !== 2);
  if (wrongStates.length > 0) {
    out.push({
      category: "officials.senators_per_state",
      severity: "error",
      expected: "every state = 2",
      actual: `${wrongStates.length} states ≠ 2`,
      sample: wrongStates.slice(0, 20),
      detail: "States that don't have exactly two active senators.",
    });
  }

  const reps = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM officials
      WHERE is_active = true
        AND role_title ILIKE '%representative%'
        AND ${FED_FILTER}`,
  );
  const repCount = Number(reps[0]?.count ?? 0);
  out.push({
    category: "officials.rep_count",
    severity: repCount === 441 ? "info" : "error",
    expected: 441,
    actual: repCount,
    sample: [],
    detail: "Active U.S. House: 435 voting + 6 non-voting delegates.",
  });

  const president = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM officials
      WHERE is_active = true
        AND role_title ILIKE '%president%'
        AND role_title NOT ILIKE '%vice%'`,
  );
  const presCount = Number(president[0]?.count ?? 0);
  out.push({
    category: "officials.president_count",
    severity: presCount === 1 ? "info" : "error",
    expected: 1,
    actual: presCount,
    sample: [],
    detail: "Sitting U.S. President.",
  });

  const vp = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM officials
      WHERE is_active = true
        AND role_title ILIKE '%vice president%'`,
  );
  const vpCount = Number(vp[0]?.count ?? 0);
  out.push({
    category: "officials.vp_count",
    severity: vpCount === 1 ? "info" : "error",
    expected: 1,
    actual: vpCount,
    sample: [],
    detail: "Sitting U.S. Vice President.",
  });

  const dupes = await query<{ congress_gov: string; count: string }>(
    `SELECT source_ids->>'congress_gov' AS congress_gov, COUNT(*)::text AS count
       FROM officials
      WHERE source_ids ? 'congress_gov'
      GROUP BY 1
      HAVING COUNT(*) > 1`,
  );
  out.push({
    category: "officials.duplicate_congress_gov",
    severity: dupes.length === 0 ? "info" : "error",
    expected: 0,
    actual: dupes.length,
    sample: dupes.slice(0, 20),
    detail:
      "Distinct officials sharing the same source_ids->>'congress_gov' (federal congressional ID).",
  });

  const missingParty = await query<{ id: string; full_name: string; role_title: string }>(
    `SELECT id, full_name, role_title
       FROM officials
      WHERE is_active = true
        AND party IS NULL
        AND (role_title ILIKE '%senator%' OR role_title ILIKE '%representative%')
        AND ${FED_FILTER}`,
  );
  out.push({
    category: "officials.missing_party",
    severity: missingParty.length === 0 ? "info" : "error",
    expected: 0,
    actual: missingParty.length,
    sample: missingParty.slice(0, 20),
    detail:
      "Active senators/reps with NULL party. Independents should be 'independent', not NULL.",
  });

  return out;
};
