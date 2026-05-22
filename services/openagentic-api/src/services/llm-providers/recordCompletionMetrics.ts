/**
 * recordCompletionMetrics — pure helper that maps a CompletionResponse
 * (or an error) into LLMRequestMetrics + calls llmMetricsService.logRequest.
 *
 * Used by ProviderManager.executeCompletion AFTER each non-streaming
 * provider.createCompletion call so all chat traffic — Ollama, Anthropic,
 * Bedrock, Vertex, Azure-via-PM, etc. — populates the same gen_ai_*
 * Prom metrics + LLMRequestLog fact-table that the Azure-direct chat
 * path now does (commit edb4bf9c).
 *
 * Streaming path is wired separately at the point where the AsyncGenerator
 * resolves its final usage frame.
 */
import { llmMetricsService } from '../LLMMetricsService.js';
import type { CompletionResponse } from './ILLMProvider.js';

export interface RecordCompletionMetricsArgs {
  /** Provider response — when present, success path. Absent on error path. */
  response?: CompletionResponse;
  /** Provider entry name (e.g. 'azure-openai-prod', 'ollama-hal'). */
  providerName: string;
  /** Canonical provider type for Prom labels (anthropic, openai, azure-openai,
   *  google-vertex, aws-bedrock, ollama, etc.). */
  providerType: string;
  /** Model id — supplied separately on the error path where there's no
   *  response.model to read. Pulled from response.model on success. */
  model?: string;
  /** Wall-clock at request send. Used to derive total_duration_ms. */
  startedAt: Date;
  /** Optional caller context — userId/sessionId/messageId for the
   *  per-request DB row. */
  userId?: string;
  sessionId?: string;
  messageId?: string;
  /** TTFT measured at the streaming pipeline if available. */
  timeToFirstTokenMs?: number;
  /** Streaming flag — defaults to false (non-streaming path). */
  streaming?: boolean;
  /** Error path — when set, status='error' is written + errorClass derived. */
  error?: unknown;
}

export type CompletionErrorClass =
  | 'timeout'
  | 'rate_limit'
  | 'client_error'
  | 'server_error'
  | 'network'
  | 'unknown';

/**
 * Coarse-classify a completion error for the gen_ai_errors_total label.
 * Pattern-matches HTTP status (when present) + common error-message strings.
 */
export function classifyCompletionError(err: unknown): CompletionErrorClass {
  if (!err) return 'unknown';
  const anyErr = err as any;
  const status = typeof anyErr.status === 'number' ? anyErr.status : undefined;
  const msg = String(anyErr.message ?? err).toLowerCase();

  // Status-code first — most reliable.
  if (status === 429) return 'rate_limit';
  if (typeof status === 'number' && status >= 500 && status < 600) return 'server_error';
  if (typeof status === 'number' && status >= 400 && status < 500) return 'client_error';

  // Message patterns.
  if (msg.includes('timed out') || msg.includes('timeout') || msg.includes('etimedout')) return 'timeout';
  if (msg.includes('rate limit') || msg.includes('429')) return 'rate_limit';
  if (msg.includes('econnrefused') || msg.includes('econnreset') || msg.includes('enotfound')) return 'network';

  return 'unknown';
}

export async function recordCompletionMetrics(args: RecordCompletionMetricsArgs): Promise<void> {
  const totalDurationMs = Math.max(0, Date.now() - args.startedAt.getTime());

  if (args.error) {
    // Error path — no response/usage; just status + duration + errorClass.
    await llmMetricsService.logRequest({
      userId: args.userId,
      sessionId: args.sessionId,
      messageId: args.messageId,
      providerType: args.providerType,
      providerName: args.providerName,
      model: args.model || 'unknown',
      requestType: 'chat',
      source: 'chat',
      streaming: args.streaming ?? false,
      totalDurationMs,
      status: 'error',
      errorClass: classifyCompletionError(args.error),
      errorMessage:
        typeof (args.error as any)?.message === 'string'
          ? (args.error as any).message
          : String(args.error),
      requestStartedAt: args.startedAt,
      requestCompletedAt: new Date(),
    });
    return;
  }

  // Success path — extract from response.
  const response = args.response;
  if (!response) return;

  const usage = (response as any).usage ?? {};
  const finishReason = response.choices?.[0]?.finish_reason;
  // Some providers (Anthropic via Bedrock SDK normalize, OpenAI) put the
  // reasoning-token count in completion_tokens_details.reasoning_tokens.
  const reasoningTokens =
    (usage.completion_tokens_details as any)?.reasoning_tokens ??
    (usage.reasoning_tokens as number | undefined);
  // OpenAI uses prompt_tokens_details.cached_tokens; some normalizers flatten
  // to usage.cached_tokens.
  const cachedTokens =
    (usage.prompt_tokens_details as any)?.cached_tokens ??
    (usage.cached_tokens as number | undefined);

  await llmMetricsService.logRequest({
    userId: args.userId,
    sessionId: args.sessionId,
    messageId: args.messageId,
    providerType: args.providerType,
    providerName: args.providerName,
    model: response.model || args.model || 'unknown',
    requestType: 'chat',
    source: 'chat',
    streaming: args.streaming ?? false,
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    cachedTokens,
    reasoningTokens,
    totalDurationMs,
    timeToFirstTokenMs: args.timeToFirstTokenMs,
    finishReason,
    status: 'success',
    requestStartedAt: args.startedAt,
    requestCompletedAt: new Date(),
  });
}
