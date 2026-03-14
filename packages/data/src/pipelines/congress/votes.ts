/**
 * Congress.gov votes pipeline.
 *
 * Fetches recent roll-call votes for both chambers, upserts the related
 * proposals, and records individual member votes.
 *
 * Run standalone:  pnpm --filter @civitics/data data:votes
 */

import { createAdminClient } from "@civitics/db";
import type { Database } from "@civitics/db";
import {
  fetchCongressApi,
  getMemberVotes,
  mapLegislationType,
  mapVote,
  mapVoteResult,
  sleep,
  VoteDetailResponse,
  VoteListResponse,
  CURRENT_CONGRESS,
} from "./members";

export interface VotesPipelineOptions {
  apiKey: string;
  federalId: string;
  senateGovBodyId: string;
  houseGovBodyId: string;
}

export interface VotesPipelineResult {
  proposalsUpserted: number;
  votesInserted: number;
}

type ProposalInsert = Database["public"]["Tables"]["proposals"]["Insert"];
type ProposalType = Database["public"]["Enums"]["proposal_type"];
type ProposalStatus = Database["public"]["Enums"]["proposal_status"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Capitalize first letter of a string (e.g. "senate" → "Senate"). */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Map a Congress.gov legislation type code to the URL path segment used on
 * congress.gov bill URLs.
 */
function getLegislationPath(type: string): string {
  switch (type.toUpperCase()) {
    case "HR":      return "house-bill";
    case "S":       return "senate-bill";
    case "HJRES":   return "house-joint-resolution";
    case "SJRES":   return "senate-joint-resolution";
    case "HRES":    return "house-resolution";
    case "SRES":    return "senate-resolution";
    case "HCONRES": return "house-concurrent-resolution";
    case "SCONRES": return "senate-concurrent-resolution";
    default:        return "other";
  }
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

export async function runVotesPipeline(
  options: VotesPipelineOptions
): Promise<VotesPipelineResult> {
  const { apiKey, federalId, senateGovBodyId, houseGovBodyId } = options;

  console.log("Starting Congress.gov votes pipeline...");

  const db = createAdminClient();

  // --- Build official lookup map: bioguideId → official UUID ---
  let officialMap = new Map<string, string>();

  try {
    const { data: officials, error } = await db
      .from("officials")
      .select("id, source_ids")
      .not("source_ids->>congress_gov", "is", null);

    if (error) {
      console.error("Error fetching officials for vote lookup:", error);
    } else if (officials) {
      for (const row of officials) {
        const sourceIds = row.source_ids as Record<string, string> | null;
        if (sourceIds?.congress_gov) {
          officialMap.set(sourceIds.congress_gov, row.id);
        }
      }
      console.log(
        `  Loaded ${officialMap.size} officials into lookup map`
      );
    }
  } catch (err) {
    console.error("Unexpected error building official map:", err);
  }

  let proposalsUpserted = 0;
  let votesInserted = 0;

  // --- Process each chamber ---
  for (const chamber of ["senate", "house"] as const) {
    const govBodyId =
      chamber === "senate" ? senateGovBodyId : houseGovBodyId;

    console.log(`\n  Fetching recent ${chamber} votes...`);

    let voteList: VoteListResponse["votes"] = [];

    try {
      const listData = await fetchCongressApi<VoteListResponse>(
        `/v3/vote/${CURRENT_CONGRESS}/${chamber}?limit=20&sort=date+desc`,
        apiKey
      );
      voteList = listData.votes ?? [];
      console.log(`  Fetched ${voteList.length} recent ${chamber} votes`);
    } catch (err) {
      console.error(`  Error fetching ${chamber} vote list:`, err);
      continue;
    }

    for (const vote of voteList) {
      console.log(
        `  Processing ${chamber} roll call ${vote.rollNumber}: ${vote.question}`
      );

      // --- Skip-check: have we already recorded votes for this roll call? ---
      try {
        const { count, error: countErr } = await db
          .from("votes")
          .select("id", { count: "exact", head: true })
          .eq("roll_call_number", String(vote.rollNumber))
          .eq("chamber", capitalize(chamber))
          .eq("session", String(CURRENT_CONGRESS));

        if (countErr) {
          console.error(
            `  Error checking existing votes for roll call ${vote.rollNumber}:`,
            countErr
          );
        } else if ((count ?? 0) > 0) {
          console.log("  Already processed, skipping");
          continue;
        }
      } catch (err) {
        console.error(
          `  Unexpected error checking roll call ${vote.rollNumber}:`,
          err
        );
      }

      // --- Fetch vote detail ---
      let detail: VoteDetailResponse["vote"] | null = null;

      try {
        const detailData = await fetchCongressApi<VoteDetailResponse>(
          `/v3/vote/${CURRENT_CONGRESS}/${chamber}/${vote.rollNumber}`,
          apiKey
        );
        detail = detailData.vote;
      } catch (err) {
        console.error(
          `  Error fetching detail for roll call ${vote.rollNumber}:`,
          err
        );
        continue;
      }

      if (!detail) {
        console.error(
          `  No detail returned for roll call ${vote.rollNumber}, skipping`
        );
        continue;
      }

      // --- Upsert proposal ---
      let proposalId: string | null = null;

      try {
        const hasLegislation = !!detail.legislation;

        if (hasLegislation && detail.legislation) {
          const leg = detail.legislation;
          const congressGovBillKey = `${leg.congress}-${leg.type}-${leg.number}`;
          const billNumber = `${leg.type} ${leg.number}`;
          const proposalTitle =
            leg.title ?? `${leg.type} ${leg.number}`;
          const proposalType = mapLegislationType(leg.type);
          const congressGovUrl = `https://congress.gov/bill/${leg.congress}th-congress/${getLegislationPath(leg.type)}/${leg.number}`;

          // Check for existing proposal
          const { data: existingProposal, error: proposalSelectErr } = await db
            .from("proposals")
            .select("id")
            .filter("source_ids->>congress_gov_bill", "eq", congressGovBillKey)
            .maybeSingle();

          if (proposalSelectErr) {
            console.error(
              `  Error checking proposal for ${billNumber}:`,
              proposalSelectErr
            );
          } else if (existingProposal) {
            proposalId = existingProposal.id;
            // Update status in case it changed
            await db
              .from("proposals")
              .update({ status: mapVoteResult(detail.result) as ProposalStatus })
              .eq("id", proposalId);
            proposalsUpserted++;
          } else {
            const proposalRecord: ProposalInsert = {
              title: proposalTitle.slice(0, 500),
              bill_number: billNumber,
              type: proposalType as ProposalType,
              jurisdiction_id: federalId,
              congress_number: CURRENT_CONGRESS,
              session: String(CURRENT_CONGRESS),
              status: mapVoteResult(detail.result) as ProposalStatus,
              governing_body_id: govBodyId,
              source_ids: { congress_gov_bill: congressGovBillKey },
              congress_gov_url: congressGovUrl,
              metadata: {},
            };
            const { data: newProposal, error: insertProposalErr } = await db
              .from("proposals")
              .insert(proposalRecord)
              .select("id")
              .single();

            if (insertProposalErr) {
              console.error(
                `  Error inserting proposal for ${billNumber}:`,
                insertProposalErr
              );
            } else {
              proposalId = newProposal.id;
              proposalsUpserted++;
            }
          }
        } else {
          // Procedural vote — no linked legislation
          const voteKey = `${CURRENT_CONGRESS}-${chamber}-${detail.rollNumber}`;
          const truncatedTitle = detail.question.slice(0, 500);

          const { data: existingProposal, error: proposalSelectErr } = await db
            .from("proposals")
            .select("id")
            .filter("source_ids->>congress_gov_vote", "eq", voteKey)
            .maybeSingle();

          if (proposalSelectErr) {
            console.error(
              `  Error checking procedural proposal for ${voteKey}:`,
              proposalSelectErr
            );
          } else if (existingProposal) {
            proposalId = existingProposal.id;
            await db
              .from("proposals")
              .update({ status: mapVoteResult(detail.result) as ProposalStatus })
              .eq("id", proposalId);
            proposalsUpserted++;
          } else {
            const proceduralRecord: ProposalInsert = {
              title: truncatedTitle,
              type: "other",
              jurisdiction_id: federalId,
              congress_number: CURRENT_CONGRESS,
              session: String(CURRENT_CONGRESS),
              status: mapVoteResult(detail.result) as ProposalStatus,
              governing_body_id: govBodyId,
              source_ids: { congress_gov_vote: voteKey },
              metadata: {},
            };
            const { data: newProposal, error: insertProposalErr } = await db
              .from("proposals")
              .insert(proceduralRecord)
              .select("id")
              .single();

            if (insertProposalErr) {
              console.error(
                `  Error inserting procedural proposal ${voteKey}:`,
                insertProposalErr
              );
            } else {
              proposalId = newProposal.id;
              proposalsUpserted++;
            }
          }
        }
      } catch (err) {
        console.error(
          `  Unexpected error upserting proposal for roll call ${vote.rollNumber}:`,
          err
        );
      }

      if (!proposalId) {
        console.error(
          `  Could not resolve proposal ID for roll call ${vote.rollNumber}, skipping votes`
        );
        await sleep(200);
        continue;
      }

      // --- Build and insert vote records ---
      const memberVotes = getMemberVotes(detail);
      const voteRecords: Array<{
        official_id: string;
        proposal_id: string;
        vote: string;
        chamber: string;
        roll_call_number: string;
        session: string;
        voted_at: string | null;
        source_ids: Record<string, unknown>;
        metadata: Record<string, unknown>;
      }> = [];

      let skippedVotes = 0;

      for (const mv of memberVotes) {
        const officialId = officialMap.get(mv.bioguideId);
        if (!officialId) {
          skippedVotes++;
          continue;
        }

        voteRecords.push({
          official_id: officialId,
          proposal_id: proposalId,
          vote: mapVote(mv.vote),
          chamber: capitalize(chamber),
          roll_call_number: String(vote.rollNumber),
          session: String(CURRENT_CONGRESS),
          voted_at: detail.date ?? null,
          source_ids: {
            congress_gov_roll: `${CURRENT_CONGRESS}-${chamber}-${detail.rollNumber}`,
          },
          metadata: {},
        });
      }

      if (skippedVotes > 0) {
        console.log(
          `  Skipped ${skippedVotes} votes (officials not in database)`
        );
      }

      if (voteRecords.length > 0) {
        try {
          const { error: insertVotesErr } = await db
            .from("votes")
            .insert(voteRecords);

          if (insertVotesErr) {
            console.error(
              `  Error inserting votes for roll call ${vote.rollNumber}:`,
              insertVotesErr
            );
          } else {
            votesInserted += voteRecords.length;
            console.log(
              `  Inserted ${voteRecords.length} votes for roll call ${vote.rollNumber}`
            );
          }
        } catch (err) {
          console.error(
            `  Unexpected error inserting votes for roll call ${vote.rollNumber}:`,
            err
          );
        }
      } else {
        console.log(
          `  No vote records to insert for roll call ${vote.rollNumber}`
        );
      }

      // Pause between roll calls (fetchCongressApi already sleeps on detail fetch)
      await sleep(200);
    }
  }

  console.log(
    `\nVotes pipeline complete: ${proposalsUpserted} proposals upserted, ${votesInserted} votes inserted`
  );

  return { proposalsUpserted, votesInserted };
}

// ---------------------------------------------------------------------------
// Standalone entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  const apiKey = process.env["CONGRESS_API_KEY"];
  if (!apiKey) {
    console.error(
      "Error: CONGRESS_API_KEY environment variable is not set.\n" +
        "Add it to .env.local and re-run."
    );
    process.exit(1);
  }

  const { seedJurisdictions, seedGoverningBodies } = require("../../jurisdictions/us-states");
  const db = createAdminClient();

  (async () => {
    try {
      const { federalId } = await seedJurisdictions(db);
      const { senateId, houseId } = await seedGoverningBodies(db, federalId);

      const result = await runVotesPipeline({
        apiKey,
        federalId,
        senateGovBodyId: senateId,
        houseGovBodyId: houseId,
      });

      console.log("Votes pipeline complete:", result);
      process.exit(0);
    } catch (err) {
      console.error("Fatal error:", err);
      process.exit(1);
    }
  })();
}
