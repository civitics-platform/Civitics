/**
 * packages/ai/src/client.ts
 *
 * Server-only. Used by ingestion pipelines and server-side route handlers.
 * Never import this from client components.
 *
 * Cost rules (non-negotiable):
 *  - Monthly spend cap: $4.00 (leaves $1 buffer on $5 card)
 *  - Model: Haiku for all summaries — cheapest at ~$0.25/M input tokens
 *  - Cache first: summaries generated once and served to all users forever
 *  - Log every API call to api_usage_logs for dashboard transparency
 */

import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "crypto";
import { createAdminClient } from "@civitics/db";

export const anthropic = new Anthropic({
  apiKey: process.env["ANTHROPIC_API_KEY"],
});

// $4.00 hard cap — $0.01 = 1 cent
const MONTHLY_SPEND_LIMIT_CENTS = 400;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildCacheKey(text: string, type: string): string {
  return createHash("md5")
    .update(`${type}:${text.slice(0, 1000)}`)
    .digest("hex");
}

async function getMonthlySpendCents(): Promise<number> {
  try {
    const db = createAdminClient();
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);

    const { data } = await db
      .from("api_usage_logs")
      .select("cost_cents")
      .eq("service", "anthropic")
      .gte("created_at", start.toISOString());

    return data?.reduce((sum, r) => sum + (r.cost_cents ?? 0), 0) ?? 0;
  } catch {
    // Fail open — a failed check should not block summary generation
    return 0;
  }
}

async function getCachedSummary(cacheKey: string): Promise<string | null> {
  try {
    const db = createAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (db as any)
      .from("ai_summary_cache")
      .select("summary")
      .eq("cache_key", cacheKey)
      .single();
    return (data as { summary: string } | null)?.summary ?? null;
  } catch {
    // Table may not exist yet — fail open (cache miss)
    return null;
  }
}

async function cacheSummary(cacheKey: string, summary: string): Promise<void> {
  try {
    const db = createAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any)
      .from("ai_summary_cache")
      .upsert({ cache_key: cacheKey, summary }, { onConflict: "cache_key" });
  } catch {
    // Non-critical — cache write failure never blocks the response
  }
}

async function logUsage(
  model: string,
  tokensUsed: number,
  costCents: number
): Promise<void> {
  try {
    const db = createAdminClient();
    await db.from("api_usage_logs").insert({
      service: "anthropic",
      endpoint: "generate_summary",
      model,
      tokens_used: tokensUsed,
      cost_cents: costCents,
    });
  } catch {
    // Non-critical
  }
}

function buildSummaryPrompt(
  text: string,
  type: "bill" | "regulation" | "official"
): string {
  const truncated = text.slice(0, 6000);

  if (type === "bill") {
    return (
      "Summarize this bill in 2-3 sentences in plain language a citizen can understand. " +
      "Focus on what it does and who it affects.\n\n" +
      `Bill text: ${truncated}`
    );
  }

  if (type === "regulation") {
    return (
      "Summarize this proposed regulation in 2-3 sentences. " +
      "What is being changed and what does it mean for ordinary people?\n\n" +
      `Regulation: ${truncated}`
    );
  }

  return (
    "Based on this voting record and donor information, write a 2-3 sentence " +
    "neutral factual summary of this official's legislative profile.\n\n" +
    `Data: ${truncated}`
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a plain-language summary.
 *
 * Checks the cache first (ai_summary_cache table).
 * If not cached: checks monthly spend cap, calls Haiku, caches result, logs usage.
 *
 * Returns cached or freshly generated summary.
 * Throws if monthly spend cap is exceeded.
 */
export async function generateSummary(
  text: string,
  type: "bill" | "regulation" | "official"
): Promise<string> {
  const cacheKey = buildCacheKey(text, type);

  // Check cache first
  const cached = await getCachedSummary(cacheKey);
  if (cached) return cached;

  // Cost guard: never exceed $4.00/month on Anthropic
  const spentCents = await getMonthlySpendCents();
  if (spentCents >= MONTHLY_SPEND_LIMIT_CENTS) {
    throw new Error(
      "Monthly AI spend limit reached ($4.00). Plain-language summaries " +
        "are temporarily unavailable — they will resume next month."
    );
  }

  // Haiku: cheapest model — $0.25/M input, $1.25/M output
  const model = "claude-haiku-4-5-20251001";
  const message = await anthropic.messages.create({
    model,
    max_tokens: 300,
    messages: [{ role: "user", content: buildSummaryPrompt(text, type) }],
  });

  const summary =
    message.content[0]?.type === "text" ? message.content[0].text : "";

  // Estimate cost in cents (Haiku: $0.25/M input + $1.25/M output)
  const inputTokens = message.usage.input_tokens;
  const outputTokens = message.usage.output_tokens;
  const costCents = Math.ceil(
    (inputTokens * 0.00025 + outputTokens * 0.00125) / 10
  );

  // Cache and log in parallel — neither should block the response
  await Promise.all([
    cacheSummary(cacheKey, summary),
    logUsage(model, inputTokens + outputTokens, costCents),
  ]);

  return summary;
}
