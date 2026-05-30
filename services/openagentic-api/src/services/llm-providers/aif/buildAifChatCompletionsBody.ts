/**
 * AzureAIFoundryProvider — Chat Completions API wire-body builder.
 *
 * Phase 0.4 (audit §0.4): the non-Responses AIF path (gpt-4.x / gpt-5.x
 * non-reasoning / Claude-on-AIF when isAnthropicFormat=false) routes
 * through the SDK's `'openai'` adapter for messages/tools shape, then
 * layers AIF-specific model-family surgery on top:
 *
 *   - GPT-5.x: `temperature` STRIPPED (Azure rejects temperature !== 1)
 *   - o-series (o1/o3/o4): no `temperature`, no `top_p`, use
 *     `max_completion_tokens` instead of `max_tokens`
 *   - GPT-5.1+ and reasoning models: `max_completion_tokens`
 *   - All other models: `max_tokens` (legacy field name)
 *   - `normalizeAifToolParameters` on every tool's JSON Schema (Azure
 *     rejects unstrict schemas — `oneOf` at top, missing `type:'object'`)
 *   - `reasoning_effort` pass-through (let API reject unsupported)
 *   - `stream_options: { include_usage: true }` ONLY when streaming
 *
 * Pre-existing `convertAnthropicMessagesToOpenAI` (~157 LOC) is now
 * called transitively through `completionRequestToCanonical` (the SDK
 * helper handles Anthropic → canonical → OpenAI). Eventually the
 * in-class function can be deleted; for now it stays as a backup for
 * call sites that bypass this helper.
 *
 * Tests: aif/__tests__/buildAifChatCompletionsBody.test.ts
 */

import {
  completionRequestToCanonical,
  selectOutboundAdapter,
} from '@agentic-work/llm-sdk/lib/adapters/index.js';
import type { CompletionRequest } from '../ILLMProvider.js';
import { normalizeAifToolParameters } from '../AzureAIFoundryProvider.js';

export interface BuildAifChatCompletionsBodyOptions {
  /** Resolved Azure deployment name. */
  model: string;
  /** Fallback temperature for non-gpt-5 non-reasoning models. */
  defaultTemperature: number;
}

export function buildAifChatCompletionsBody(
  request: CompletionRequest,
  opts: BuildAifChatCompletionsBodyOptions,
): Record<string, unknown> {
  const canonical = completionRequestToCanonical(request);
  const adapter = selectOutboundAdapter('openai');
  const wire = adapter.adaptRequest(canonical) as {
    messages: Array<Record<string, unknown>>;
    tools?: Array<{
      type: 'function';
      function: { name: string; description: string; parameters: Record<string, unknown> };
    }>;
    tool_choice?: unknown;
    max_tokens: number;
    stop?: string[];
  };

  const modelLower = opts.model.toLowerCase();
  const isGPT5 = modelLower.includes('gpt-5');
  const isReasoning = /(?:^|[^a-z])(o1|o3|o4)\b/.test(modelLower);
  const usesMaxCompletionTokens = isGPT5 || isReasoning;

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: wire.messages,
  };

  // Stream flag: ONLY set when caller explicitly enables streaming.
  // Sev-1 audit (2026-05-12 round 2): Azure Chat Completions on some
  // deployments interprets an explicit `stream:false` as a config
  // request (e.g. asking for `stream_options=null`) that conflicts
  // with the default non-streaming behavior. Safer to omit the field
  // entirely when caller wants non-streaming.
  if (request.stream === true) {
    body.stream = true;
  }

  // Token-limit field name varies by model family.
  if (usesMaxCompletionTokens) {
    body.max_completion_tokens = wire.max_tokens;
  } else {
    body.max_tokens = wire.max_tokens;
  }

  // Temperature: stripped for gpt-5.x and reasoning models.
  if (!isGPT5 && !isReasoning) {
    body.temperature = request.temperature ?? opts.defaultTemperature;
  }

  // top_p: stripped for reasoning models.
  if (!isReasoning) {
    body.top_p = request.top_p ?? 1;
  }

  // stream_options ONLY when streaming (Azure rejects on non-stream calls).
  if (request.stream) {
    body.stream_options = { include_usage: true };
  }

  // Tools: SDK adapter emits the correct OpenAI shape; re-pass each
  // tool's parameters through the AIF-strict normalizer so a single
  // bad schema doesn't kill the whole request.
  if (wire.tools && wire.tools.length > 0) {
    body.tools = wire.tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.function.name,
        description: t.function.description,
        parameters: normalizeAifToolParameters(t.function.parameters),
      },
    }));
    body.tool_choice = wire.tool_choice ?? 'auto';
  }

  // reasoning_effort: pass through verbatim. API rejects on
  // unsupported models, but that's a model-config issue not a wire-shape one.
  const reasoningEffort = (request as any).reasoning_effort;
  if (reasoningEffort) {
    body.reasoning_effort = reasoningEffort;
  }

  // Stop sequences: SDK adapter carries them under `stop`.
  if (wire.stop && wire.stop.length > 0) {
    body.stop = wire.stop;
  }

  return body;
}
