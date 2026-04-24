/**
 * Enrichment queue — claim a batch for a subagent to process.
 *
 * Calls the claim_enrichment_batch RPC and writes
 *   { claimed_by, task_type, items: [{queue_id, entity_id, entity_type, task_type, context}] }
 * to stdout (or --output FILE). Logs a short progress line to stderr.
 *
 * Exits 0 with { items: [] } when the queue is drained for that task_type.
 *
 *   pnpm --filter @civitics/data data:drain:claim \
 *     --task tag --size 20 --worker sub-1 --output /tmp/batch-sub-1.json
 */

import { createAdminClient } from "@civitics/db";
import { writeFileSync } from "node:fs";
import { parseFlags, requireFlag, intFlag } from "./args";

type QueueClaim = {
  id: number;
  entity_id: string;
  entity_type: string;
  task_type: string;
  context: unknown;
};

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));

  const task = requireFlag(flags, "task");
  if (task !== "tag" && task !== "summary") {
    throw new Error(`--task must be 'tag' or 'summary' (got ${task})`);
  }
  const size = intFlag(flags, "size", { default: 20, min: 1, max: 100 });
  const worker = requireFlag(flags, "worker");
  const output = flags["output"] && flags["output"] !== "true" ? flags["output"] : undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any;

  const { data, error } = await db.rpc("claim_enrichment_batch", {
    p_task_type: task,
    p_limit: size,
    p_claimed_by: worker,
  });
  if (error) {
    console.error("claim_enrichment_batch failed:", error.message);
    process.exit(1);
  }

  const items = ((data ?? []) as QueueClaim[]).map((r) => ({
    queue_id: r.id,
    entity_id: r.entity_id,
    entity_type: r.entity_type,
    task_type: r.task_type,
    context: r.context,
  }));

  const payload = { claimed_by: worker, task_type: task, items };
  const json = JSON.stringify(payload, null, 2);

  if (output) {
    writeFileSync(output, json, "utf8");
    console.error(`[drain:claim] claimed ${items.length} ${task} item(s) → ${output}`);
  } else {
    process.stdout.write(json + "\n");
    console.error(`[drain:claim] claimed ${items.length} ${task} item(s)`);
  }
}

main()
  .then(() => setTimeout(() => process.exit(0), 200))
  .catch((err) => {
    console.error("[drain:claim] failed:", err instanceof Error ? err.message : err);
    setTimeout(() => process.exit(1), 200);
  });
