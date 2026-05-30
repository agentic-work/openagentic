/**
 * Extended Thinking Metric Writer — Task B.2 (2026-05-19)
 *
 * Fire-and-forget helper that writes an ExtendedThinkingMetric row after
 * each assistant turn. Extracted from stream.handler.ts so it can be unit-
 * tested independently of the full Fastify / runChat stack.
 *
 * Design notes:
 *  - ALWAYS fire-and-forget: caller MUST catch all errors so a metric DB
 *    hiccup never breaks the live chat turn.
 *  - `requested` = user did NOT turn off thinking AND registry says model
 *    supports it. Mirrors AnthropicProvider.shouldEnableThinking (Task A).
 *  - `delivered` = at least one thinking_delta arrived on the wire (tracked
 *    by thinkingTokensAccumulated counter in stream.handler.ts).
 *  - `thinking_tokens` is a character-count approximation (~4 chars/token).
 *    The real reasoning token count would require the provider to surface it
 *    in usage.reasoning_tokens — not yet plumbed; this is a best-effort proxy.
 */

import type { Logger } from 'pino';

export interface ExtendedThinkingMetricInput {
  userId: string | undefined;
  sessionId: string | undefined;
  /** turnId used as message_id for idempotent upsert. */
  turnId: string | undefined;
  /** Provider ID (from ProviderManager, best-effort). */
  providerId: string;
  /** Model identifier selected by SmartModelRouter. */
  model: string;
  /** True when user did NOT turn off thinking AND registry says model is capable. */
  requested: boolean;
  /** True when at least one thinking_delta was received from the provider. */
  delivered: boolean;
  /** Character-count approximation of thinking tokens (chars ÷ 4). */
  thinkingTokensApprox: number | undefined;
  /** Wall-clock duration of the thinking window (first → last delta). */
  thinkingDurationMs: number | undefined;
  /** Total output tokens from the provider (if available). */
  totalOutputTokens?: number | undefined;
  /** Total wall-clock ms for the turn (pipeline start → now). */
  totalTurnMs: number | undefined;
}

/**
 * Write an extended thinking metric row to admin.extended_thinking_metrics.
 * Returns a Promise that resolves when the write completes or rejects with
 * an error. Caller MUST catch — this function does NOT swallow errors itself
 * so that the test can assert rejection paths.
 *
 * The stream.handler.ts call site wraps this in try/catch with a warn log.
 */
export async function writeExtendedThinkingMetric(
  prismaClient: any,
  input: ExtendedThinkingMetricInput,
): Promise<void> {
  await prismaClient.extendedThinkingMetric.create({
    data: {
      user_id: input.userId ?? null,
      session_id: input.sessionId ?? null,
      message_id: input.turnId ?? null,
      provider_id: input.providerId,
      model: input.model,
      requested: input.requested,
      delivered: input.delivered,
      thinking_tokens: input.thinkingTokensApprox && input.thinkingTokensApprox > 0
        ? input.thinkingTokensApprox
        : null,
      thinking_duration_ms: input.thinkingDurationMs ?? null,
      total_output_tokens: input.totalOutputTokens ?? null,
      total_turn_ms: input.totalTurnMs ?? null,
    },
  });
}

/**
 * Compute whether extended thinking was REQUESTED on this turn.
 *
 * Contract:
 *  - User must NOT have explicitly turned it off (extendedThinkingEnabled !== false).
 *  - The registry must confirm the model supports thinking.
 *  - Both conditions are required — either alone is insufficient.
 */
export function computeThinkingRequested(
  extendedThinkingEnabledFlag: boolean | undefined,
  modelSupportsThinking: boolean,
): boolean {
  // undefined = "don't override" (UI did not set the flag) = effectively ON.
  // false = user explicitly turned off the Brain toggle.
  return extendedThinkingEnabledFlag !== false && modelSupportsThinking;
}
