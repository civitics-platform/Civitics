/**
 * Legistar data pipeline — city council legislation for 4 pilot metros.
 *
 * Metros: Seattle (seattle), San Francisco (sfgov), New York City (newyork),
 *         Austin (austintexas).
 * DC uses a separate DC LIMS adapter (dc-lims/) — not Legistar.
 *
 * Pipeline steps per metro:
 *   1. Bodies    → public.governing_bodies
 *   2. Persons   → public.officials
 *   3. Matters   → shadow.proposals + shadow.bill_details + shadow.external_source_refs
 *   4. Events    → shadow.meetings
 *   5. EventItems → shadow.agenda_items (per-event, recent events only)
 *   6. Votes     → shadow.votes (for EventItems with VoteFlag=1)
 *
 * Delta support: MatterLastModifiedUtc + EventDate cursors stored in
 * pipeline_state keyed as "legistar_{client}_last_run".
 *
 * Run:
 *   pnpm --filter @civitics/data data:legistar              (all metros)
 *   pnpm --filter @civitics/data data:legistar -- --metro seattle
 *   pnpm --filter @civitics/data data:legistar -- --force   (skip recency guard)
 */

import { createAdminClient } from "@civitics/db";
import { shadowClient, sleep, type ShadowDb } from "../utils";
import { startSync, completeSync, failSync, type PipelineResult } from "../sync-log";
import { seedPilotMetros } from "../../jurisdictions/pilot-metros";
import { LegistarClient } from "./client";
import {
  bodyToGoverningBodyRow,
  personToOfficialRow,
  matterToProposalRow,
  matterToBillDetailsRow,
  eventToMeetingRow,
  eventItemToAgendaItemRow,
  legistarVoteToRow,
} from "./mappers";
import type {
  MetroConfig,
  MetroIdMaps,
  LegistarEventItem,
} from "./types";

// ---------------------------------------------------------------------------
// Metro registry
// (jurisdictionId is populated at startup from seedPilotMetros)
// ---------------------------------------------------------------------------

const METRO_CLIENTS: Array<{ client: string; name: string }> = [
  { client: "seattle",     name: "Seattle"       },
  { client: "sfgov",       name: "San Francisco" },
  { client: "newyork",     name: "New York City" },
  { client: "austintexas", name: "Austin"        },
];

const UPSERT_SIZE = 200;

// How far back to fetch events on first run (days).
const FIRST_RUN_EVENT_LOOKBACK_DAYS = 90;

// ---------------------------------------------------------------------------
// Step 1 — Bodies → public.governing_bodies
// ---------------------------------------------------------------------------

async function syncBodies(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  sdb: ShadowDb,
  api: LegistarClient,
  config: MetroConfig,
): Promise<Map<number, string>> {
  const bodies = await api.fetchBodies();
  console.log(`    Bodies: ${bodies.length} fetched`);

  const idMap = new Map<number, string>(); // LegistarBodyId → UUID

  for (let i = 0; i < bodies.length; i += UPSERT_SIZE) {
    const chunk = bodies.slice(i, i + UPSERT_SIZE);

    for (const body of chunk) {
      const sourceKey = `${config.source}:body`;
      const extId     = String(body.BodyId);

      // Check shadow.external_source_refs first
      const { data: ref } = await sdb
        .from("external_source_refs")
        .select("entity_id")
        .eq("source", sourceKey)
        .eq("external_id", extId)
        .maybeSingle();

      if (ref) {
        idMap.set(body.BodyId, String(ref.entity_id));
        await sdb.from("external_source_refs")
          .update({ last_seen_at: new Date().toISOString() })
          .eq("source", sourceKey).eq("external_id", extId);
        continue;
      }

      // Insert governing_body
      const row = bodyToGoverningBodyRow(body, config.jurisdictionId);
      const { data: inserted, error } = await db
        .from("governing_bodies")
        .insert(row)
        .select("id")
        .single();

      if (error || !inserted) {
        console.error(`      Body ${body.BodyName}: insert error — ${error?.message}`);
        continue;
      }

      idMap.set(body.BodyId, inserted.id);

      await sdb.from("external_source_refs").insert({
        source:      sourceKey,
        external_id: extId,
        entity_type: "governing_body",
        entity_id:   inserted.id,
        last_seen_at: new Date().toISOString(),
        metadata:    { body_name: body.BodyName, body_type: body.BodyTypeName },
      });
    }

    await sleep(50);
  }

  console.log(`    Bodies: ${idMap.size} upserted`);
  return idMap;
}

// ---------------------------------------------------------------------------
// Step 2 — Persons → public.officials
// ---------------------------------------------------------------------------

async function syncPersons(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  sdb: ShadowDb,
  api: LegistarClient,
  config: MetroConfig,
  bodyIdMap: Map<number, string>,
): Promise<Map<number, string>> {
  const persons = await api.fetchPersons();
  console.log(`    Persons: ${persons.length} fetched`);

  // Resolve the primary city council body for this metro so we have a valid
  // governing_body_id to supply (officials.governing_body_id is NOT NULL).
  // Prefer municipal_council type; fall back to the first body we know about.
  const { data: councilBody } = await db
    .from("governing_bodies")
    .select("id")
    .eq("jurisdiction_id", config.jurisdictionId)
    .eq("type", "municipal_council")
    .limit(1)
    .maybeSingle();
  const primaryBodyId: string | null =
    councilBody?.id ?? (bodyIdMap.size > 0 ? [...bodyIdMap.values()][0] : null);

  if (!primaryBodyId) {
    console.warn(`    Persons: no governing body found for ${config.name} — skipping persons`);
    return new Map();
  }

  const personSourceKey = `${config.source}:person`;
  const idMap = new Map<number, string>(); // LegistarPersonId → UUID

  for (const person of persons) {
    const extId = String(person.PersonId);

    // Check shadow.external_source_refs
    const { data: ref } = await sdb
      .from("external_source_refs")
      .select("entity_id")
      .eq("source", personSourceKey)
      .eq("external_id", extId)
      .maybeSingle();

    if (ref) {
      idMap.set(person.PersonId, String(ref.entity_id));
      await sdb.from("external_source_refs")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("source", personSourceKey).eq("external_id", extId);
      continue;
    }

    const row = personToOfficialRow(person, config.source, primaryBodyId, config.jurisdictionId);
    const { data: inserted, error } = await db
      .from("officials")
      .insert(row)
      .select("id")
      .single();

    if (error || !inserted) {
      console.error(`      Person ${person.PersonFullName}: insert error — ${error?.message}`);
      continue;
    }

    idMap.set(person.PersonId, inserted.id);

    await sdb.from("external_source_refs").insert({
      source:      personSourceKey,
      external_id: extId,
      entity_type: "official",
      entity_id:   inserted.id,
      last_seen_at: new Date().toISOString(),
      metadata:    { full_name: person.PersonFullName },
    });

    await sleep(20);
  }

  console.log(`    Persons: ${idMap.size} upserted`);
  return idMap;
}

// ---------------------------------------------------------------------------
// Step 3 — Matters → shadow.proposals + bill_details + external_source_refs
// ---------------------------------------------------------------------------

async function syncMatters(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  sdb: ShadowDb,
  api: LegistarClient,
  config: MetroConfig,
  bodyIdMap: Map<number, string>,
  since?: string,
): Promise<Map<number, string>> {
  const matters = await api.fetchMatters(since);
  console.log(`    Matters: ${matters.length} fetched`);

  const matterSourceKey = `${config.source}:matter`;
  const idMap = new Map<number, string>(); // LegistarMatterId → proposalId

  for (let i = 0; i < matters.length; i += UPSERT_SIZE) {
    const chunk = matters.slice(i, i + UPSERT_SIZE);

    for (const matter of chunk) {
      const extId = String(matter.MatterId);

      // Check shadow.external_source_refs
      const { data: ref } = await sdb
        .from("external_source_refs")
        .select("entity_id")
        .eq("source", matterSourceKey)
        .eq("external_id", extId)
        .maybeSingle();

      if (ref) {
        idMap.set(matter.MatterId, String(ref.entity_id));
        // Update timestamps
        await sdb.from("external_source_refs")
          .update({ last_seen_at: new Date().toISOString() })
          .eq("source", matterSourceKey).eq("external_id", extId);
        // Update proposal status/dates in shadow
        const governingBodyId = matter.MatterBodyId ? bodyIdMap.get(matter.MatterBodyId) ?? null : null;
        const updateRow = matterToProposalRow(matter, config.jurisdictionId, governingBodyId, config.client);
        await sdb.from("proposals").update({
          status:         updateRow.status,
          last_action_at: updateRow.last_action_at,
          resolved_at:    updateRow.resolved_at,
          updated_at:     new Date().toISOString(),
        }).eq("id", ref.entity_id);
        continue;
      }

      // Skip matters with no title (not displayable)
      if (!matter.MatterTitle && !matter.MatterName && !matter.MatterFile) continue;

      const governingBodyId = matter.MatterBodyId ? bodyIdMap.get(matter.MatterBodyId) ?? null : null;
      const proposalRow     = matterToProposalRow(matter, config.jurisdictionId, governingBodyId, config.client);

      // Insert shadow.proposals
      const { data: inserted, error: pErr } = await sdb
        .from("proposals")
        .insert(proposalRow)
        .select("id")
        .single();

      if (pErr || !inserted) {
        console.error(`      Matter ${matter.MatterFile ?? matter.MatterId}: proposal insert error — ${pErr?.message}`);
        continue;
      }

      const proposalId = inserted.id;
      idMap.set(matter.MatterId, proposalId);

      // Insert shadow.bill_details
      const billRow = matterToBillDetailsRow(matter, proposalId, config.jurisdictionId);
      const { error: bErr } = await sdb.from("bill_details").insert(billRow);
      if (bErr) {
        console.error(`      Matter ${matter.MatterFile}: bill_details insert error — ${bErr.message}`);
      }

      // Insert external_source_refs
      await sdb.from("external_source_refs").insert({
        source:      matterSourceKey,
        external_id: extId,
        entity_type: "proposal",
        entity_id:   proposalId,
        last_seen_at: new Date().toISOString(),
        metadata:    { matter_file: matter.MatterFile, matter_type: matter.MatterTypeName },
      });

      await sleep(10);
    }

    if (Math.ceil(i / UPSERT_SIZE) % 10 === 0) {
      console.log(`    Matters: ${Math.min(i + UPSERT_SIZE, matters.length)}/${matters.length}...`);
    }
  }

  console.log(`    Matters: ${idMap.size} proposals upserted`);
  return idMap;
}

// ---------------------------------------------------------------------------
// Step 4 — Events → shadow.meetings
// ---------------------------------------------------------------------------

async function syncEvents(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  sdb: ShadowDb,
  api: LegistarClient,
  config: MetroConfig,
  bodyIdMap: Map<number, string>,
  since?: string,
): Promise<Map<number, string>> {
  // On first run, limit to last FIRST_RUN_EVENT_LOOKBACK_DAYS days
  const eventSince = since ?? (() => {
    const d = new Date();
    d.setDate(d.getDate() - FIRST_RUN_EVENT_LOOKBACK_DAYS);
    return d.toISOString().slice(0, 19);
  })();

  const events = await api.fetchEvents(eventSince);
  console.log(`    Events: ${events.length} fetched (since ${eventSince.slice(0, 10)})`);

  const eventSourceKey = `${config.source}:event`;
  const idMap = new Map<number, string>(); // LegistarEventId → meetingId

  for (const event of events) {
    const extId = String(event.EventId);
    const governingBodyId = bodyIdMap.get(event.EventBodyId) ?? null;
    if (!governingBodyId) continue; // body not in our DB — skip

    // Check shadow.external_source_refs
    const { data: ref } = await sdb
      .from("external_source_refs")
      .select("entity_id")
      .eq("source", eventSourceKey)
      .eq("external_id", extId)
      .maybeSingle();

    if (ref) {
      idMap.set(event.EventId, String(ref.entity_id));
      await sdb.from("external_source_refs")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("source", eventSourceKey).eq("external_id", extId);
      continue;
    }

    const meetingRow = eventToMeetingRow(event, governingBodyId, config.client);
    const { data: inserted, error } = await sdb
      .from("meetings")
      .insert(meetingRow)
      .select("id")
      .single();

    if (error || !inserted) {
      console.error(`      Event ${event.EventId}: insert error — ${error?.message}`);
      continue;
    }

    idMap.set(event.EventId, inserted.id);
    await sdb.from("external_source_refs").insert({
      source:      eventSourceKey,
      external_id: extId,
      entity_type: "meeting",
      entity_id:   inserted.id,
      last_seen_at: new Date().toISOString(),
      metadata:    { event_date: event.EventDate, body_name: event.EventBodyName },
    });

    await sleep(20);
  }

  console.log(`    Events: ${idMap.size} meetings upserted`);
  return idMap;
}

// ---------------------------------------------------------------------------
// Step 5+6 — EventItems → agenda_items, then Votes → shadow.votes
// ---------------------------------------------------------------------------

async function syncEventItemsAndVotes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  sdb: ShadowDb,
  api: LegistarClient,
  config: MetroConfig,
  eventIdMap: Map<number, string>,
  matterIdMap: Map<number, string>,
  personIdMap: Map<number, string>,
  eventItemIdMap: Map<number, string>,
): Promise<{ agendaItems: number; votes: number }> {
  let agendaCount = 0;
  let voteCount   = 0;

  const eventIds = [...eventIdMap.keys()];
  console.log(`    EventItems+Votes: fetching for ${eventIds.length} meetings...`);

  for (let i = 0; i < eventIds.length; i++) {
    const legiEventId = eventIds[i];
    const meetingId   = eventIdMap.get(legiEventId)!;

    let items: LegistarEventItem[];
    try {
      items = await api.fetchEventItems(legiEventId);
    } catch (err) {
      console.warn(`      Event ${legiEventId}: fetchEventItems failed — ${(err as Error).message}`);
      continue;
    }

    if (items.length === 0) continue;

    // Sort by sequence to handle the unique(meeting_id, sequence) constraint cleanly
    items.sort((a, b) => (a.EventItemAgendaSequence ?? 999) - (b.EventItemAgendaSequence ?? 999));

    // Deduplicate sequences within the same meeting (Legistar occasionally has dupes)
    const seenSeqs = new Set<number>();

    for (const item of items) {
      const proposalId = item.EventItemMatterId ? matterIdMap.get(item.EventItemMatterId) ?? null : null;
      const extId      = String(item.EventItemId);

      // Check if agenda_item already exists
      const { data: existingRef } = await sdb
        .from("external_source_refs")
        .select("entity_id")
        .eq("source", `${config.source}:item`)
        .eq("external_id", extId)
        .maybeSingle();

      let agendaItemId: string;

      if (existingRef) {
        agendaItemId = String(existingRef.entity_id);
        eventItemIdMap.set(item.EventItemId, agendaItemId);
      } else {
        let seq = item.EventItemAgendaSequence ?? item.EventItemMinutesSequence ?? (i * 1000 + items.indexOf(item));
        // Resolve sequence collisions
        while (seenSeqs.has(seq)) seq++;
        seenSeqs.add(seq);

        const itemRow = { ...eventItemToAgendaItemRow(item, meetingId, proposalId, config.client), sequence: seq };
        const { data: inserted, error } = await sdb
          .from("agenda_items")
          .insert(itemRow)
          .select("id")
          .single();

        if (error || !inserted) {
          // Ignore duplicate sequence errors (concurrent runs)
          if (!error?.message.includes("unique")) {
            console.error(`      EventItem ${item.EventItemId}: insert error — ${error?.message}`);
          }
          continue;
        }

        agendaItemId = inserted.id;
        agendaCount++;
        eventItemIdMap.set(item.EventItemId, agendaItemId);

        await sdb.from("external_source_refs").insert({
          source:      `${config.source}:item`,
          external_id: extId,
          entity_type: "agenda_item",
          entity_id:   agendaItemId,
          last_seen_at: new Date().toISOString(),
        });
      }

      // Fetch votes for items with a roll call
      if (item.EventItemRollCallFlag !== 1 || !proposalId) continue;

      let legiVotes;
      try {
        legiVotes = await api.fetchVotes(item.EventItemId);
      } catch {
        continue; // non-fatal
      }

      const votedAt = items[0] && eventIdMap.size > 0
        ? new Date().toISOString() // placeholder; refined below
        : new Date().toISOString();

      for (const legiVote of legiVotes) {
        const officialId = personIdMap.get(legiVote.VotePersonId);
        if (!officialId) continue;

        const voteRow = legistarVoteToRow(
          legiVote,
          proposalId,
          officialId,
          votedAt,
          agendaItemId,
          config.client,
        );
        if (!voteRow) continue;

        const { error: vErr } = await sdb
          .from("votes")
          .upsert(voteRow, { onConflict: "roll_call_id,official_id" });

        if (vErr && !vErr.message.includes("unique")) {
          console.error(`      Vote ${legiVote.VoteId}: upsert error — ${vErr.message}`);
        } else if (!vErr) {
          voteCount++;
        }
      }

      await sleep(100); // per-event-item rate limit (votes endpoint)
    }

    if ((i + 1) % 20 === 0) {
      console.log(`    EventItems: ${i + 1}/${eventIds.length} meetings processed (${agendaCount} items, ${voteCount} votes)`);
    }
    await sleep(150); // per-event rate limit
  }

  return { agendaItems: agendaCount, votes: voteCount };
}

// ---------------------------------------------------------------------------
// Per-metro orchestrator
// ---------------------------------------------------------------------------

async function runMetro(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  sdb: ShadowDb,
  config: MetroConfig,
  force: boolean,
): Promise<{ matters: number; meetings: number; agendaItems: number; votes: number; officials: number }> {
  console.log(`\n  ── ${config.name} (${config.client}) ──────────────────────────`);

  const stateKey = `legistar_${config.client}_last_run`;
  const { data: stateRow } = await db
    .from("pipeline_state")
    .select("value")
    .eq("key", stateKey)
    .maybeSingle();

  const lastRun   = (stateRow?.value as Record<string, unknown> | null)?.last_run as string | undefined;
  const hoursSince = lastRun ? (Date.now() - new Date(lastRun).getTime()) / 3_600_000 : Infinity;

  if (!force && hoursSince < 6) {
    console.log(`    Skipping — ran ${hoursSince.toFixed(1)}h ago (min 6h). Use --force to override.`);
    return { matters: 0, meetings: 0, agendaItems: 0, votes: 0, officials: 0 };
  }

  const api          = new LegistarClient(config.client);
  const idMaps: MetroIdMaps = {
    bodyIdMap:      new Map(),
    personIdMap:    new Map(),
    matterIdMap:    new Map(),
    eventIdMap:     new Map(),
    eventItemIdMap: new Map(),
  };

  // Step 1: Bodies
  idMaps.bodyIdMap   = await syncBodies(db, sdb, api, config);

  // Step 2: Persons (needs bodyIdMap to resolve primary council body)
  idMaps.personIdMap = await syncPersons(db, sdb, api, config, idMaps.bodyIdMap);

  // Step 3: Matters (delta if we have a prior run)
  idMaps.matterIdMap = await syncMatters(db, sdb, api, config, idMaps.bodyIdMap, lastRun);

  // Step 4: Events (delta)
  idMaps.eventIdMap  = await syncEvents(db, sdb, api, config, idMaps.bodyIdMap, lastRun);

  // Steps 5+6: EventItems + Votes
  const { agendaItems, votes } = await syncEventItemsAndVotes(
    db, sdb, api, config,
    idMaps.eventIdMap, idMaps.matterIdMap, idMaps.personIdMap, idMaps.eventItemIdMap,
  );

  // Persist cursor
  await db.from("pipeline_state").upsert(
    { key: stateKey, value: { last_run: new Date().toISOString(), matters: idMaps.matterIdMap.size, meetings: idMaps.eventIdMap.size } },
    { onConflict: "key" },
  );

  return {
    matters:    idMaps.matterIdMap.size,
    meetings:   idMaps.eventIdMap.size,
    agendaItems,
    votes,
    officials:  idMaps.personIdMap.size,
  };
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

export async function runLegistarPipeline(): Promise<PipelineResult> {
  console.log("\n=== Legistar city council pipeline ===");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db   = createAdminClient() as any;
  const sdb  = shadowClient(db);
  const force = process.argv.includes("--force");
  const metroArg = (() => {
    const idx = process.argv.indexOf("--metro");
    return idx !== -1 ? process.argv[idx + 1] : null;
  })();

  const logId = await startSync("legistar");

  try {
    // ── Seed / resolve pilot metro jurisdictions ──────────────────────────
    console.log("\n  Resolving pilot metro jurisdictions...");
    const jurisdictionMap = await seedPilotMetros(db);

    // Build metro configs
    const metros: MetroConfig[] = METRO_CLIENTS
      .filter((m) => !metroArg || m.client === metroArg)
      .map((m) => {
        const jid = jurisdictionMap.get(m.client);
        if (!jid) console.warn(`  ⚠  ${m.name}: jurisdiction not found — skipping`);
        return jid ? { ...m, source: `legistar:${m.client}`, jurisdictionId: jid } : null;
      })
      .filter((m): m is MetroConfig => m !== null);

    if (metros.length === 0) {
      console.error("  No metros configured — did data:jurisdictions run?");
      await failSync(logId, "no metros with jurisdiction IDs");
      return { inserted: 0, updated: 0, failed: 1, estimatedMb: 0 };
    }

    // ── Run each metro ────────────────────────────────────────────────────
    let totalMatters = 0, totalMeetings = 0, totalItems = 0, totalVotes = 0, totalOfficials = 0;
    const failures: string[] = [];

    for (const config of metros) {
      try {
        const r = await runMetro(db, sdb, config, force);
        totalMatters   += r.matters;
        totalMeetings  += r.meetings;
        totalItems     += r.agendaItems;
        totalVotes     += r.votes;
        totalOfficials += r.officials;
      } catch (err) {
        const msg = `${config.name}: ${err instanceof Error ? err.message : String(err)}`;
        console.error(`  ✗  ${msg}`);
        failures.push(msg);
      }
    }

    console.log("\n  ──────────────────────────────────────────────────");
    console.log("  Legistar pipeline report");
    console.log("  ──────────────────────────────────────────────────");
    console.log(`  ${"proposals (matters):".padEnd(36)} ${totalMatters}`);
    console.log(`  ${"meetings (events):".padEnd(36)} ${totalMeetings}`);
    console.log(`  ${"agenda items:".padEnd(36)} ${totalItems}`);
    console.log(`  ${"votes:".padEnd(36)} ${totalVotes}`);
    console.log(`  ${"officials (persons):".padEnd(36)} ${totalOfficials}`);
    if (failures.length > 0) {
      console.log(`  ${"metro failures:".padEnd(36)} ${failures.join("; ")}`);
    }

    const result: PipelineResult = {
      inserted:    totalMatters + totalMeetings + totalItems + totalVotes,
      updated:     0,
      failed:      failures.length,
      estimatedMb: 0,
    };
    await completeSync(logId, result);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("  Legistar pipeline fatal error:", msg);
    await failSync(logId, msg);
    return { inserted: 0, updated: 0, failed: 1, estimatedMb: 0 };
  }
}

// ---------------------------------------------------------------------------
// Standalone entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  runLegistarPipeline()
    .then(() => { setTimeout(() => process.exit(0), 500); })
    .catch((err) => {
      console.error("Pipeline failed:", err);
      setTimeout(() => process.exit(1), 500);
    });
}
