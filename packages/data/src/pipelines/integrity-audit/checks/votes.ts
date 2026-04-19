import type { Check, CheckResult } from "../types";

export const votesChecks: Check = async ({ query }) => {
  const out: CheckResult[] = [];

  const orphanOfficial = await query<{
    id: string;
    official_id: string;
    voted_at: string | null;
  }>(
    `SELECT v.id, v.official_id, v.voted_at
       FROM votes v
      WHERE v.official_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM officials o WHERE o.id = v.official_id
        )`,
  );
  out.push({
    category: "votes.orphan_official_id",
    severity: orphanOfficial.length === 0 ? "info" : "error",
    expected: 0,
    actual: orphanOfficial.length,
    sample: orphanOfficial.slice(0, 10),
    detail: "votes.official_id values not present in officials.id.",
  });

  const invalidVote = await query<{ id: string; vote: string }>(
    `SELECT id, vote
       FROM votes
      WHERE vote IS NOT NULL
        AND vote NOT IN ('yes','no','present','not voting')`,
  );
  out.push({
    category: "votes.invalid_vote_value",
    severity: invalidVote.length === 0 ? "info" : "error",
    expected: 0,
    actual: invalidVote.length,
    sample: invalidVote.slice(0, 10),
    detail:
      "votes.vote values outside the allowed enum {yes, no, present, not voting}.",
  });

  return out;
};
