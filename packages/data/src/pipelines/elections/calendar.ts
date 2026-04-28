/**
 * State election calendar — FIX-022 (state-accurate dates).
 *
 * Curated list of state general elections through 2032. The original
 * elections pipeline only knew about federal-general dates (Tuesday after
 * first Monday in November of even years), which silently misses:
 *   - NJ / VA odd-year state-government cycles
 *   - KY / LA / MS odd-year governor + statewide cycles
 *   - State legislatures with biennial cycles offset from the federal one
 *
 * Each entry's source URL is documented inline so future-Craig can refresh
 * after each cycle without re-researching.
 *
 * Date format: ISO YYYY-MM-DD (US Eastern conceptually; we never store time).
 */

export interface StateElectionCalendar {
  /**
   * General-election dates for state legislators (and governors, where
   * gubernatorial races coincide). Dates BEFORE the asOf date in the
   * elections pipeline are filtered out at lookup time.
   */
  legislative: string[];

  /**
   * Gubernatorial-only dates for states that decouple their governor's
   * race from the legislative cycle. If empty, governor races align with
   * the legislative calendar.
   */
  gubernatorial?: string[];
}

// US federal-general dates (used as the default for all federal officials
// and as the legislative cycle for the majority of states).
export const FEDERAL_GENERAL_ELECTIONS: string[] = [
  "2024-11-05",
  "2026-11-03",
  "2028-11-07",
  "2030-11-05",
  "2032-11-02",
];

/**
 * State-by-state overrides where the legislative or gubernatorial cycle
 * differs from the federal cycle. States not in this map use
 * FEDERAL_GENERAL_ELECTIONS for both legislators and governor.
 *
 * Sources:
 *   NJ Division of Elections: https://www.nj.gov/state/elections/election-information.shtml
 *   VA Dept. of Elections:    https://www.elections.virginia.gov/casting-a-ballot/election-day-results/
 *   KY State Board:           https://elect.ky.gov/CandidateInformation/Pages/Election-Schedule.aspx
 *   LA Sec. of State:         https://www.sos.la.gov/ElectionsAndVoting/Pages/UpcomingElections.aspx
 *   MS Sec. of State:         https://www.sos.ms.gov/elections-voting/election-information
 *   NH Sec. of State:         https://www.sos.nh.gov/elections (2-yr senate + house, on federal cycle)
 *   VT Sec. of State:         https://sos.vermont.gov/elections (2-yr senate + house, on federal cycle)
 */
export const STATE_ELECTION_CALENDAR: Record<string, StateElectionCalendar> = {
  // Odd-year legislative + gubernatorial. NJ Senate is on a 2-yr cycle starting
  // the year after the decennial census; assembly races are every 2 years on
  // the same odd-year cycle. Governor: every 4 years (2025, 2029, ...).
  NJ: {
    legislative:   ["2025-11-04", "2027-11-02", "2029-11-06", "2031-11-04"],
    gubernatorial: ["2025-11-04", "2029-11-04"],
  },

  // VA House every 2 yrs (odd years), Senate every 4 yrs (odd years), Governor
  // every 4 years (2025, 2029, ...). Lt. Gov + AG also on odd-year cycle.
  VA: {
    legislative:   ["2025-11-04", "2027-11-02", "2029-11-04", "2031-11-03"],
    gubernatorial: ["2025-11-04", "2029-11-04"],
  },

  // KY: General Assembly on the federal cycle, but Governor on odd-years.
  KY: {
    legislative:   FEDERAL_GENERAL_ELECTIONS,
    gubernatorial: ["2027-11-02", "2031-11-04"],  // KY guv: 2023, 2027, 2031
  },

  // LA: Legislature every 4 years on odd cycle; Governor every 4 years on odd
  // cycle (2023, 2027, 2031). LA uses jungle primary in October with November
  // runoff if needed; we use the November date as the canonical "election".
  LA: {
    legislative:   ["2027-10-09", "2031-10-11"],  // Louisiana state primaries
    gubernatorial: ["2027-10-09", "2031-10-11"],
  },

  // MS: Legislature + Governor every 4 years on odd cycle.
  MS: {
    legislative:   ["2027-11-02", "2031-11-04"],
    gubernatorial: ["2027-11-02", "2031-11-04"],
  },
};

/**
 * Returns the next legislative-election date strictly after asOf for a
 * given state abbreviation. Falls back to FEDERAL_GENERAL_ELECTIONS for
 * states not in the override map. Returns null if no future date is known.
 */
export function nextLegislativeElection(stateAbbr: string | null, asOfIso: string): string | null {
  const dates =
    (stateAbbr && STATE_ELECTION_CALENDAR[stateAbbr]?.legislative) ?? FEDERAL_GENERAL_ELECTIONS;
  for (const d of dates) if (d > asOfIso) return d;
  return null;
}

/**
 * Returns the next gubernatorial-election date for a given state.
 * Falls back to that state's legislative calendar if no governor-specific
 * dates are configured.
 */
export function nextGubernatorialElection(stateAbbr: string | null, asOfIso: string): string | null {
  if (stateAbbr && STATE_ELECTION_CALENDAR[stateAbbr]) {
    const dates = STATE_ELECTION_CALENDAR[stateAbbr].gubernatorial
      ?? STATE_ELECTION_CALENDAR[stateAbbr].legislative;
    for (const d of dates) if (d > asOfIso) return d;
    return null;
  }
  for (const d of FEDERAL_GENERAL_ELECTIONS) if (d > asOfIso) return d;
  return null;
}
