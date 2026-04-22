/**
 * Congress bills/proposals + individual member vote records pipeline.
 *
 * Proposals are fetched from the Congress.gov v3 API (which has no /vote endpoint).
 * Individual member vote records are fetched from the official XML feeds:
 *   - House: https://clerk.house.gov/evs/{year}/roll{NNN}.xml
 *   - Senate: https://www.senate.gov/legislative/LIS/roll_call_votes/vote{congress}{session}/vote_{congress}_{session}_{NNNNN}.xml
 *
 * Post-cutover, single-write against public. The shadow schema is gone; votes
 * land directly in public.votes which now keys on (roll_call_id, official_id)
 * and FKs through bill_details.proposal_id.
 *
 * Run standalone:  pnpm --filter @civitics/data data:votes
 */

import { createAdminClient } from "@civitics/db";
import type { Database } from "@civitics/db";
import {
  fetchCongressApi,
  fetchText,
  mapLegislationType,
  mapVote,
  mapVoteResult,
  sleep,
  CURRENT_CONGRESS,
} from "./members";
import {
  findOrCreateBillProposal,
  upsertBillProposal,
  chamberForBillType,
} from "./bills";
import { XMLParser } from "fast-xml-parser";

// ---------------------------------------------------------------------------
// Type aliases
// ---------------------------------------------------------------------------

type ProposalType = Database["public"]["Enums"]["proposal_type"];
type ProposalStatus = Database["public"]["Enums"]["proposal_status"];
type VoteInsert = Database["public"]["Tables"]["votes"]["Insert"];

// ---------------------------------------------------------------------------
// Exported interfaces
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Internal types (Congress.gov bill list)
// ---------------------------------------------------------------------------

interface BillListResponse {
  bills: BillSummary[];
  pagination: { count: number; next?: string };
}

interface BillSummary {
  congress: number;
  number: string;
  type: string; // "HR", "S", "HJRES", etc.
  title: string;
  originChamber?: string;
  latestAction?: {
    actionDate?: string;
    text?: string;
  };
  updateDate?: string;
  introducedDate?: string;
  url?: string;
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function mapBillStatus(latestActionText: string | undefined): ProposalStatus {
  if (!latestActionText) return "introduced";
  const t = latestActionText.toLowerCase();
  if (t.includes("became public law") || t.includes("signed by president")) return "enacted";
  if (t.includes("signed") && t.includes("president")) return "signed";
  if (t.includes("vetoed")) return "vetoed";
  if (t.includes("passed") && (t.includes("senate") || t.includes("house"))) {
    if (t.includes("both") || (t.includes("senate") && t.includes("house"))) {
      return "passed_both_chambers";
    }
    return "passed_chamber";
  }
  if (t.includes("reported") || t.includes("ordered to be reported")) return "passed_committee";
  if (t.includes("referred to")) return "in_committee";
  return "introduced";
}

function chamberGovBodyId(
  billType: string,
  senateId: string,
  houseId: string
): string {
  const t = billType.toUpperCase();
  if (t === "S" || t === "SJRES" || t === "SRES" || t === "SCONRES" || t === "SAMDT") {
    return senateId;
  }
  return houseId;
}

function congressGovBillUrl(congress: number, type: string, number: string): string {
  const typeMap: Record<string, string> = {
    HR: "house-bill",
    S: "senate-bill",
    HJRES: "house-joint-resolution",
    SJRES: "senate-joint-resolution",
    HRES: "house-resolution",
    SRES: "senate-resolution",
    HCONRES: "house-concurrent-resolution",
    SCONRES: "senate-concurrent-resolution",
    HAMDT: "house-amendment",
    SAMDT: "senate-amendment",
  };
  const path = typeMap[type.toUpperCase()] ?? "other";
  return `https://congress.gov/bill/${congress}th-congress/${path}/${number}`;
}

/**
 * Parse House Clerk legis-num strings.
 *
 * The Clerk uses space-separated format without dots: "H R 29", "H RES 5",
 * "H J RES 2", "H CON RES 5". Older documents may use dotted format:
 * "H.R. 1", "H.RES. 5". We normalize to handle both.
 *
 * Returns null for procedural strings like "QUORUM" or "ELECTION OF SPEAKER"
 * where no bill number is present.
 */
function parseHouseLegisNum(legisNum: string): { type: string; number: string } | null {
  if (!legisNum || !legisNum.trim()) return null;

  const s = legisNum.trim().toUpperCase().replace(/\./g, " ").replace(/\s+/g, " ").trim();

  if (s.startsWith("H J RES ")) {
    const num = s.slice("H J RES ".length).trim();
    return num ? { type: "HJRES", number: num } : null;
  }
  if (s.startsWith("H CON RES ")) {
    const num = s.slice("H CON RES ".length).trim();
    return num ? { type: "HCONRES", number: num } : null;
  }
  if (s.startsWith("H RES ")) {
    const num = s.slice("H RES ".length).trim();
    return num ? { type: "HRES", number: num } : null;
  }
  if (s.startsWith("H R ")) {
    const num = s.slice("H R ".length).trim();
    return num ? { type: "HR", number: num } : null;
  }
  if (s.startsWith("S J RES ")) {
    const num = s.slice("S J RES ".length).trim();
    return num ? { type: "SJRES", number: num } : null;
  }
  if (s.startsWith("S CON RES ")) {
    const num = s.slice("S CON RES ".length).trim();
    return num ? { type: "SCONRES", number: num } : null;
  }
  if (s.startsWith("S RES ")) {
    const num = s.slice("S RES ".length).trim();
    return num ? { type: "SRES", number: num } : null;
  }
  if (/^S \d/.test(s)) {
    const num = s.slice(2).trim();
    return num ? { type: "S", number: num } : null;
  }

  return null;
}

/**
 * Normalize Senate document_type strings to our bill type codes.
 */
function normalizeSenateDocType(docType: string): string {
  const t = docType.trim().toUpperCase();
  if (t === "S." || t === "S") return "S";
  if (t === "H.R." || t === "H.R") return "HR";
  if (t === "S.RES." || t === "S.RES" || t === "S. RES.") return "SRES";
  if (t === "H.RES." || t === "H.RES" || t === "H. RES.") return "HRES";
  if (t === "S.J.RES." || t === "S.J.RES" || t === "S.J. RES.") return "SJRES";
  if (t === "H.J.RES." || t === "H.J.RES" || t === "H.J. RES.") return "HJRES";
  if (t === "S.CON.RES." || t === "S.CON.RES" || t === "S. CON. RES.") return "SCONRES";
  if (t === "H.CON.RES." || t === "H.CON.RES" || t === "H. CON. RES.") return "HCONRES";
  return "S";
}

/**
 * Parse House action-date like "03-Jan-2025" → "2025-01-03"
 */
function parseHouseDate(dateStr: string): string | null {
  if (!dateStr) return null;
  const match = dateStr.match(/^(\d{1,2})-([A-Za-z]+)-(\d{4})$/);
  if (!match) return null;

  const [, day, mon, year] = match;
  const months: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04",
    may: "05", jun: "06", jul: "07", aug: "08",
    sep: "09", oct: "10", nov: "11", dec: "12",
  };
  const mm = months[mon.toLowerCase()];
  if (!mm) return null;
  return `${year}-${mm}-${day.padStart(2, "0")}`;
}

/**
 * Parse Senate vote_date — two formats observed:
 *   "January 9, 2025,  02:54 PM"  (Senate LIS XML)
 *   "01-03-2025"                  (older MM-DD-YYYY format)
 */
function parseSenateDate(dateStr: string): string | null {
  if (!dateStr) return null;

  const longMatch = dateStr.match(/^(\w+)\s+(\d{1,2}),\s+(\d{4})/);
  if (longMatch) {
    const months: Record<string, string> = {
      january: "01", february: "02", march: "03", april: "04",
      may: "05", june: "06", july: "07", august: "08",
      september: "09", october: "10", november: "11", december: "12",
    };
    const mm = months[longMatch[1].toLowerCase()];
    if (mm) return `${longMatch[3]}-${mm}-${longMatch[2].padStart(2, "0")}`;
  }

  const shortMatch = dateStr.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (shortMatch) {
    const [, mm, dd, yyyy] = shortMatch;
    return `${yyyy}-${mm}-${dd}`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// buildOfficialMaps helper
// ---------------------------------------------------------------------------

interface OfficialMaps {
  /** bioguideId → official UUID (for House members) */
  officialMap: Map<string, string>;
  /** "lastName:stateAbbr" → official UUID (for Senate members) */
  senatorByNameState: Map<string, string>;
}

async function buildOfficialMaps(
  db: ReturnType<typeof createAdminClient>,
  senateGovBodyId: string
): Promise<OfficialMaps> {
  const officialMap = new Map<string, string>();
  const senatorByNameState = new Map<string, string>();

  const { data: allOfficials, error: officialsErr } = await db
    .from("officials")
    .select("id, source_ids");

  if (officialsErr) {
    console.error("  Error fetching officials for bioguide map:", officialsErr.message);
  } else if (allOfficials) {
    for (const o of allOfficials) {
      const src = o.source_ids as Record<string, string> | null;
      const bioguide = src?.["congress_gov"];
      if (bioguide) {
        officialMap.set(bioguide, o.id as string);
      }
    }
    console.log(`  Built bioguide map with ${officialMap.size} entries`);
  }

  const { data: senators, error: senErr } = await db
    .from("officials")
    .select("id, last_name, jurisdiction_id")
    .eq("governing_body_id", senateGovBodyId);

  if (senErr) {
    console.error("  Error fetching senators:", senErr.message);
  } else if (senators && senators.length > 0) {
    const jidSet = new Set(senators.map((s) => s.jurisdiction_id).filter(Boolean));
    const jids = Array.from(jidSet) as string[];

    const { data: jurisdictions, error: jErr } = await db
      .from("jurisdictions")
      .select("id, short_name")
      .in("id", jids);

    if (jErr) {
      console.error("  Error fetching jurisdictions for senator map:", jErr.message);
    } else if (jurisdictions) {
      const jMap = new Map<string, string>(
        jurisdictions.map((j) => [j.id as string, (j.short_name as string | null) ?? ""])
      );

      for (const s of senators) {
        const lastName = (s.last_name as string | null) ?? "";
        const stateAbbr = s.jurisdiction_id ? (jMap.get(s.jurisdiction_id as string) ?? "") : "";
        if (lastName && stateAbbr) {
          const key = `${lastName.toLowerCase()}:${stateAbbr.toUpperCase()}`;
          senatorByNameState.set(key, s.id as string);
        }
      }
      console.log(`  Built senator name:state map with ${senatorByNameState.size} entries`);
    }
  }

  return { officialMap, senatorByNameState };
}

// ---------------------------------------------------------------------------
// XML parser instance (shared)
// ---------------------------------------------------------------------------

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => ["recorded-vote", "member"].includes(name),
});

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

export async function runVotesPipeline(
  options: VotesPipelineOptions
): Promise<VotesPipelineResult> {
  const { apiKey, federalId, senateGovBodyId, houseGovBodyId } = options;

  console.log("Starting Congress bills + XML member votes pipeline...");

  const db = createAdminClient();

  let proposalsUpserted = 0;
  let votesInserted = 0;

  // -------------------------------------------------------------------------
  // Step 1: Sync bills from Congress.gov API
  //
  // Must run BEFORE XML vote feeds so bill_details rows with proper titles
  // exist when votes are inserted (votes.bill_proposal_id FKs to
  // bill_details.proposal_id).
  // -------------------------------------------------------------------------

  console.log("\n--- Step 1: Syncing bills from Congress.gov API ---");

  const billTypes = [
    { type: "hr",    label: "House bills" },
    { type: "s",     label: "Senate bills" },
    { type: "hjres", label: "House joint resolutions" },
    { type: "sjres", label: "Senate joint resolutions" },
  ] as const;

  for (const { type, label } of billTypes) {
    console.log(`\n  Fetching recent ${label}...`);

    let bills: BillSummary[] = [];

    try {
      const listData = await fetchCongressApi<BillListResponse>(
        `bill/${CURRENT_CONGRESS}/${type}?sort=updateDate+desc&limit=50`,
        apiKey
      );
      bills = listData.bills ?? [];
      console.log(`  Got ${bills.length} ${label}`);
    } catch (err) {
      console.error(`  Error fetching ${label}:`, err);
      continue;
    }

    for (const bill of bills) {
      const billKey = `${bill.congress}-${bill.type}-${bill.number}`;
      const billNumber = `${bill.type} ${bill.number}`;
      const title = (bill.title ?? billNumber).slice(0, 500);
      const proposalType = mapLegislationType(bill.type) as ProposalType;
      const status = mapBillStatus(bill.latestAction?.text) as ProposalStatus;
      const govBodyId = chamberGovBodyId(bill.type, senateGovBodyId, houseGovBodyId);
      const congressGovUrl = congressGovBillUrl(bill.congress, bill.type, bill.number);

      try {
        const proposalId = await upsertBillProposal(db, {
          billKey,
          title,
          billNumber,
          billType: bill.type,
          chamber: chamberForBillType(bill.type),
          type: proposalType,
          status,
          jurisdictionId: federalId,
          governingBodyId: govBodyId,
          congressGovUrl,
          introducedAt: bill.introducedDate
            ? new Date(bill.introducedDate).toISOString()
            : null,
          lastActionAt: bill.latestAction?.actionDate
            ? new Date(bill.latestAction.actionDate).toISOString()
            : null,
          latestActionText: bill.latestAction?.text,
          congressNumber: CURRENT_CONGRESS,
          session: String(CURRENT_CONGRESS),
        });

        if (proposalId) proposalsUpserted++;
      } catch (err) {
        console.error(`  Unexpected error processing bill ${billKey}:`, err);
      }

      await sleep(50);
    }

    console.log(`  Proposals upserted so far: ${proposalsUpserted}`);
  }

  // -------------------------------------------------------------------------
  // Step 2: Build official lookup maps (needed for XML vote feeds)
  // -------------------------------------------------------------------------

  const { officialMap, senatorByNameState } = await buildOfficialMaps(db, senateGovBodyId);

  // -------------------------------------------------------------------------
  // 119th Congress session → calendar year mapping
  // Session 1 = 2025, Session 2 = 2026
  // -------------------------------------------------------------------------

  const sessions: Array<{ session: number; year: number }> = [
    { session: 1, year: 2025 },
    { session: 2, year: 2026 },
  ];

  // -------------------------------------------------------------------------
  // Step 3: House Clerk XML vote feeds
  // -------------------------------------------------------------------------

  console.log("\n--- Step 3: Fetching House Clerk XML votes ---");

  let houseUnmatched = 0;

  for (const { session, year } of sessions) {
    console.log(`\n  House session ${session} (${year}):`);

    for (let rollNum = 1; rollNum <= 500; rollNum++) {
      const paddedRoll = String(rollNum).padStart(3, "0");
      const url = `https://clerk.house.gov/evs/${year}/roll${paddedRoll}.xml`;
      const rollCallId = `${year}-house-${paddedRoll}`;

      try {
        const { data: existing } = await db
          .from("votes")
          .select("id")
          .eq("roll_call_id", rollCallId)
          .limit(1)
          .maybeSingle();

        if (existing) {
          console.log(`    Roll ${rollNum}: already in DB, skipping`);
          continue;
        }

        console.log(`    Processing House session ${session} roll call ${rollNum}...`);

        let xmlText: string;
        try {
          xmlText = await fetchText(url);
        } catch (fetchErr: unknown) {
          const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
          if (msg.includes("HTTP 404")) {
            console.log(`    Roll ${rollNum}: 404 — no more rolls for session ${session}`);
            break;
          }
          console.error(`    Roll ${rollNum}: fetch error — ${msg}`);
          continue;
        }

        const parsed = xmlParser.parse(xmlText);
        const meta = parsed["rollcall-vote"]?.["vote-metadata"];
        const voteData = parsed["rollcall-vote"]?.["vote-data"];

        if (!meta || !voteData) {
          console.error(`    Roll ${rollNum}: unexpected XML structure, skipping`);
          continue;
        }

        const legisNum = meta["legis-num"] ?? "";
        const billRef = parseHouseLegisNum(String(legisNum));

        const actionDateStr = meta["action-date"] ?? "";
        const votedAt = parseHouseDate(String(actionDateStr));

        const resultStr = String(meta["vote-result"] ?? "");
        const proposalStatus = mapVoteResult(resultStr) as ProposalStatus;
        const voteQuestion = String(meta["vote-question"] ?? "");

        let proposalId: string | null = null;
        if (billRef) {
          const billKey = `${CURRENT_CONGRESS}-${billRef.type}-${billRef.number}`;
          const billTitle = `${billRef.type} ${billRef.number}`;
          const proposalType = mapLegislationType(billRef.type) as ProposalType;
          const govBodyId = chamberGovBodyId(billRef.type, senateGovBodyId, houseGovBodyId);
          const congressGovUrl = congressGovBillUrl(CURRENT_CONGRESS, billRef.type, billRef.number);
          const introducedIso = votedAt ? new Date(votedAt).toISOString() : null;

          proposalId = await findOrCreateBillProposal(db, {
            billKey,
            title: billTitle,
            billNumber: `${billRef.type} ${billRef.number}`,
            billType: billRef.type,
            chamber: chamberForBillType(billRef.type),
            type: proposalType,
            status: proposalStatus,
            jurisdictionId: federalId,
            governingBodyId: govBodyId,
            congressGovUrl,
            introducedAt: introducedIso,
            lastActionAt: introducedIso,
            congressNumber: CURRENT_CONGRESS,
            session: String(CURRENT_CONGRESS),
          });

          if (proposalId) proposalsUpserted++;
        }

        const recordedVotes: unknown[] = Array.isArray(voteData["recorded-vote"])
          ? voteData["recorded-vote"]
          : voteData["recorded-vote"]
            ? [voteData["recorded-vote"]]
            : [];

        const voteRecords: VoteInsert[] = [];

        if (!proposalId) {
          console.log(`    Roll ${rollNum}: no proposal reference, skipping vote records`);
        } else if (!votedAt) {
          console.log(`    Roll ${rollNum}: no voted_at, skipping (column is NOT NULL)`);
        } else {
          const votedAtIso = new Date(votedAt).toISOString();

          for (const rv of recordedVotes) {
            const rvObj = rv as Record<string, unknown>;
            const legislator = rvObj["legislator"] as Record<string, unknown> | null;
            const voteText = String(rvObj["vote"] ?? "");

            if (!legislator) continue;

            const bioguide = String(legislator["@_name-id"] ?? "");
            if (!bioguide) continue;

            const officialId = officialMap.get(bioguide);
            if (!officialId) {
              houseUnmatched++;
              continue;
            }

            const voteRecord: VoteInsert = {
              official_id: officialId,
              bill_proposal_id: proposalId,
              vote: mapVote(voteText),
              chamber: "House",
              roll_call_id: rollCallId,
              session: String(session),
              voted_at: votedAtIso,
              vote_question: voteQuestion,
              source_url: url,
              metadata: {
                vote_result: resultStr,
                legis_num: legisNum,
              },
            };

            voteRecords.push(voteRecord);
          }
        }

        if (voteRecords.length > 0) {
          const { error: insertErr } = await db
            .from("votes")
            .insert(voteRecords);
          if (insertErr && insertErr.code !== "23505") {
            console.error(`    Roll ${rollNum}: insert error — ${insertErr.message}`);
          } else if (insertErr?.code === "23505") {
            console.log(`    Roll ${rollNum}: unique violation on (roll_call_id, official_id)`);
          } else {
            votesInserted += voteRecords.length;
            console.log(`    Roll ${rollNum}: inserted ${voteRecords.length} votes`);
          }
        } else {
          console.log(`    Roll ${rollNum}: no matchable vote records`);
        }
      } catch (err) {
        console.error(`    House roll ${rollNum} (session ${session}): unexpected error —`, err);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Step 4: Senate LIS XML vote feeds
  // -------------------------------------------------------------------------

  console.log("\n--- Step 4: Fetching Senate LIS XML votes ---");

  let senateUnmatched = 0;

  for (const { session } of sessions) {
    console.log(`\n  Senate session ${session}:`);

    const folderKey = `vote${CURRENT_CONGRESS}${session}`;

    for (let rollNum = 1; rollNum <= 500; rollNum++) {
      const paddedRoll = String(rollNum).padStart(5, "0");
      const url =
        `https://www.senate.gov/legislative/LIS/roll_call_votes/${folderKey}/` +
        `vote_${CURRENT_CONGRESS}_${session}_${paddedRoll}.xml`;
      const rollCallId = `senate-${CURRENT_CONGRESS}-${session}-${paddedRoll}`;

      try {
        const { data: existing } = await db
          .from("votes")
          .select("id")
          .eq("roll_call_id", rollCallId)
          .limit(1)
          .maybeSingle();

        if (existing) {
          console.log(`    Roll ${rollNum}: already in DB, skipping`);
          continue;
        }

        console.log(`    Processing Senate session ${session} roll call ${rollNum}...`);

        let xmlText: string;
        try {
          xmlText = await fetchText(url);
        } catch (fetchErr: unknown) {
          const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
          if (msg.includes("HTTP 404")) {
            console.log(`    Roll ${rollNum}: 404 — no more rolls for session ${session}`);
            break;
          }
          console.error(`    Roll ${rollNum}: fetch error — ${msg}`);
          continue;
        }

        const parsed = xmlParser.parse(xmlText);
        const root = parsed["roll_call_vote"];

        if (!root) {
          console.error(`    Roll ${rollNum}: unexpected XML structure, skipping`);
          continue;
        }

        const docBlock = root["document"] as Record<string, unknown> | null;
        let proposalId: string | null = null;

        if (docBlock) {
          const rawDocType = String(docBlock["document_type"] ?? "");
          const docNumber = String(docBlock["document_number"] ?? "");
          if (rawDocType && docNumber) {
            const billType = normalizeSenateDocType(rawDocType);
            const billKey = `${CURRENT_CONGRESS}-${billType}-${docNumber}`;
            const voteQuestion = String(root["question"] ?? "");
            const resultStr = String(root["result"] ?? "");
            const proposalStatus = mapVoteResult(resultStr) as ProposalStatus;
            const proposalType = mapLegislationType(billType) as ProposalType;
            const govBodyId = chamberGovBodyId(billType, senateGovBodyId, houseGovBodyId);
            const congressGovUrl = congressGovBillUrl(CURRENT_CONGRESS, billType, docNumber);

            const voteDateStr = String(root["vote_date"] ?? "");
            const votedAt = parseSenateDate(voteDateStr);

            const introducedIso = votedAt ? new Date(votedAt).toISOString() : null;
            proposalId = await findOrCreateBillProposal(db, {
              billKey,
              title: `${billType} ${docNumber}`,
              billNumber: `${billType} ${docNumber}`,
              billType,
              chamber: chamberForBillType(billType),
              type: proposalType,
              status: proposalStatus,
              jurisdictionId: federalId,
              governingBodyId: govBodyId,
              congressGovUrl,
              introducedAt: introducedIso,
              lastActionAt: introducedIso,
              congressNumber: CURRENT_CONGRESS,
              session: String(CURRENT_CONGRESS),
            });

            if (proposalId) proposalsUpserted++;
          }
        }

        const voteDateStr = String(root["vote_date"] ?? "");
        const votedAt = parseSenateDate(voteDateStr);
        const voteQuestion = String(root["question"] ?? "");
        const resultStr = String(root["result"] ?? "");

        const membersContainer = root["members"] as Record<string, unknown> | null;
        const memberList: unknown[] = membersContainer
          ? (Array.isArray(membersContainer["member"])
              ? membersContainer["member"]
              : membersContainer["member"]
                ? [membersContainer["member"]]
                : [])
          : [];

        const voteRecords: VoteInsert[] = [];

        if (!proposalId) {
          console.log(`    Roll ${rollNum}: no proposal reference, skipping vote records`);
        } else if (!votedAt) {
          console.log(`    Roll ${rollNum}: no voted_at, skipping (column is NOT NULL)`);
        } else {
          const votedAtIso = new Date(votedAt).toISOString();

          for (const m of memberList) {
            const mObj = m as Record<string, unknown>;
            const lastName = String(mObj["last_name"] ?? "").trim();
            const state = String(mObj["state"] ?? "").trim().toUpperCase();
            const voteText = String(mObj["vote_cast"] ?? "");

            if (!lastName || !state) continue;

            const key = `${lastName.toLowerCase()}:${state}`;
            const officialId = senatorByNameState.get(key);

            if (!officialId) {
              senateUnmatched++;
              continue;
            }

            const voteRecord: VoteInsert = {
              official_id: officialId,
              bill_proposal_id: proposalId,
              vote: mapVote(voteText),
              chamber: "Senate",
              roll_call_id: rollCallId,
              session: String(session),
              voted_at: votedAtIso,
              vote_question: voteQuestion,
              source_url: url,
              metadata: {
                vote_result: resultStr,
              },
            };

            voteRecords.push(voteRecord);
          }
        }

        if (voteRecords.length > 0) {
          const { error: insertErr } = await db
            .from("votes")
            .insert(voteRecords);
          if (insertErr && insertErr.code !== "23505") {
            console.error(`    Roll ${rollNum}: insert error — ${insertErr.message}`);
          } else if (insertErr?.code === "23505") {
            console.log(`    Roll ${rollNum}: unique violation on (roll_call_id, official_id)`);
          } else {
            votesInserted += voteRecords.length;
            console.log(`    Roll ${rollNum}: inserted ${voteRecords.length} votes`);
          }
        } else {
          console.log(`    Roll ${rollNum}: no matchable vote records`);
        }
      } catch (err) {
        console.error(`    Senate roll ${rollNum} (session ${session}): unexpected error —`, err);
      }
    }
  }

  if (houseUnmatched > 0) {
    console.log(`\n  House unmatched bioguide IDs (no official in DB): ${houseUnmatched}`);
  }
  if (senateUnmatched > 0) {
    console.log(`  Senate unmatched name:state keys (no official in DB): ${senateUnmatched}`);
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
