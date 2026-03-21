/**
 * packages/ai/src/cost-config.ts
 *
 * Central cost configuration for all AI pipelines.
 * Every limit, threshold, and price lives here — nowhere else.
 * Update this file when Anthropic changes model pricing.
 */

export const COST_CONFIG = {
  // Monthly hard limit in USD — ALL pipelines stop if hit, no exceptions
  monthly_hard_limit_usd: 3.50,

  // Warning alert threshold — dashboard banner appears
  monthly_warning_usd: 2.50,

  // Auto-approve runs under this cost — no confirmation prompt needed
  // Good for tiny nightly runs (e.g. incremental summaries)
  auto_approve_under_usd: 0.05,

  // Pause pipeline if actual cost exceeds estimate by this ratio at midpoint
  // 1.5 = pause at 50% over estimate
  variance_pause_threshold: 1.5,

  // How many sample calls to make before estimating full batch cost
  // 3 is accurate enough and fast enough
  estimate_sample_size: 3,

  // Per-pipeline run limits in USD — hard stop per individual run
  // regardless of remaining monthly budget
  per_run_limits: {
    ai_summaries:  0.50,
    ai_tagger:     0.50,
    ai_classifier: 0.25,
    ai_narrative:  0.10,
    default:       0.20,
  },

  // Anthropic model pricing — prices per million tokens
  // Update if Anthropic changes pricing
  model_pricing: {
    "claude-haiku-4-5-20251001": {
      input_per_million:  0.25,
      output_per_million: 1.25,
    },
    "claude-sonnet-4-6": {
      input_per_million:  3.00,
      output_per_million: 15.00,
    },
    "claude-opus-4-6": {
      input_per_million:  15.00,
      output_per_million: 75.00,
    },
    default: {
      input_per_million:  0.25,
      output_per_million: 1.25,
    },
  } as Record<string, { input_per_million: number; output_per_million: number }>,

  // Alert channels — Phase 1: console + supabase only
  // Phase 2: add email + webhook
  alerts: {
    console:  true,
    supabase: true,
    email:    false,
    webhook:  false,
  },

  // Autonomous mode — rules used in cron/CI environments instead of terminal prompts.
  // These are defaults; admins can override via pipeline_state key 'cost_config_overrides'.
  autonomous: {
    // Max estimated cost to auto-approve without any human review
    max_auto_approve_usd: 0.10,

    // Skip AI pipeline if remaining monthly budget falls below this
    min_budget_remaining_usd: 0.50,

    // Skip if entity count is suspiciously high (something unusual may have happened)
    max_entity_count: 50,

    // Skip if the last run of this pipeline failed or was paused
    skip_if_last_run_failed: true,

    // Skip if last run actual cost exceeded estimate by this ratio
    // 1.5 = last run was 50% over estimate
    skip_if_variance_over: 1.5,

    // Use 1 sample call instead of 3 — saves time and cost in cron runs
    sample_size_override: 1,
  },
} as const;

/**
 * Calculate cost in USD from token counts and model name.
 * Uses exact arithmetic — no rounding, no Math.ceil.
 */
export function calculateCostUsd(
  inputTokens: number,
  outputTokens: number,
  model: string = "claude-haiku-4-5-20251001"
): number {
  const pricing =
    COST_CONFIG.model_pricing[model] ??
    COST_CONFIG.model_pricing["default"]!;

  return (
    inputTokens  * pricing.input_per_million +
    outputTokens * pricing.output_per_million
  ) / 1_000_000;
}

export type PipelineName = keyof typeof COST_CONFIG.per_run_limits;

/**
 * Return the effective cost config, merging hardcoded defaults with any
 * admin overrides stored in pipeline_state key 'cost_config_overrides'.
 * Overrides allow adjusting thresholds from the dashboard without code changes.
 *
 * Falls back to base COST_CONFIG on any DB error.
 */
export async function getEffectiveConfig(): Promise<typeof COST_CONFIG> {
  try {
    const { createAdminClient } = await import("@civitics/db");
    const supabase = createAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from("pipeline_state")
      .select("value")
      .eq("key", "cost_config_overrides")
      .single();

    if (!data?.value) return COST_CONFIG;

    return {
      ...COST_CONFIG,
      ...(data.value as Partial<typeof COST_CONFIG>),
      // Deep-merge nested sections so partial overrides work
      autonomous: {
        ...COST_CONFIG.autonomous,
        ...((data.value as Partial<typeof COST_CONFIG>).autonomous ?? {}),
      },
      per_run_limits: {
        ...COST_CONFIG.per_run_limits,
        ...((data.value as Partial<typeof COST_CONFIG>).per_run_limits ?? {}),
      },
    } as typeof COST_CONFIG;
  } catch {
    return COST_CONFIG;
  }
}
