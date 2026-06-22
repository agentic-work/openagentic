/**
 * AzureAIFoundryProvider — Responses API wire-body builder.
 *
 * Phase 0.4 (audit §0.4) — replace the 220-LOC inline `buildResponsesApiBody`
 * with a thin wrapper that delegates wire-shape translation to the SDK's
 * `OpenagenticToAIFResponses` adapter and layers AIF-specific decoration on
 * top:
 *
 *   - deployment as `model` (AIF puts model in body, not URL like Vertex)
 *   - `max_output_tokens` (AIF spelling) from `max_tokens`/`max_completion_tokens`
 *   - `reasoning.effort` for reasoning-capable deployments (o1/o3/codex/gpt-5)
 *   - `normalizeAifToolParameters` on every tool's JSON Schema (Azure rejects
 *     unstrict schemas — `oneOf` at top level, missing `type:'object'`, etc.)
 *   - Orphan `function_call_output` filter — drop items whose `call_id`
 *     doesn't match a prior `function_call` in the SAME input[] array
 *     (Sev-0 #774 contract; the SDK adapter EMITS them paired, but caller
 *     history can carry stale outputs from prior turns that need filtering)
 *   - `stream: true` toggle
 *
 * The Sev-0 #774 pairing contract itself lives in the SDK adapter
 * (`OpenagenticToAIFResponses.flattenMessageInto`); see
 * openagentic-sdk/src/lib/adapters/__tests__/adapters.shape.test.ts for the
 * 37 shape tests that pin it.
 *
 * Tests: aif/__tests__/buildAifResponsesBody.test.ts
 */

import {
  completionRequestToCanonical,
  selectOutboundAdapter,
} from '@agentic-work/llm-sdk/lib/adapters/index.js';
import type { CompletionRequest } from '../ILLMProvider.js';
import { normalizeAifToolParameters } from '../AzureAIFoundryProvider.js';

export interface BuildAifResponsesBodyOptions {
  /** Azure deployment name — goes into the body's `model` slot. */
  deployment: string;
  /** Stream toggle. Default true. */
  stream?: boolean;
  /** Reasoning effort (`'low' | 'medium' | 'high'`) for o-series / codex /
   * gpt-5 reasoning models. Omit for chat-tier deployments. */
  reasoningEffort?: string;
  /** Max output tokens fallback chain: explicit param wins, else
   * `request.max_tokens`, else 32768 (AIF's default cap). */
  maxOutputTokensOverride?: number;
}

export function buildAifResponsesBody(
  request: CompletionRequest,
  opts: BuildAifResponsesBodyOptions,
): Record<string, unknown> {
  const canonical = completionRequestToCanonical(request);
  const adapter = selectOutboundAdapter('aif-responses');
  const wire = adapter.adaptRequest(canonical) as {
    input: Array<Record<string, unknown>>;
    instructions?: string;
    tools?: Array<{ type: 'function'; name: string; description: string; parameters: Record<string, unknown> }>;
    tool_choice?: unknown;
    max_output_tokens?: number;
  };

  // Sev-0 #774 belt-and-suspenders — drop orphan function_call_output items
  // whose call_id has no preceding function_call in the same input[] array.
  // The SDK adapter emits paired, but multi-turn replay history (e.g.
  // /v1/messages or chatLoop history reconstruct) sometimes ships a stale
  // tool_result from a thinking-only assistant turn where the function_call
  // was dropped — Azure 400s on those.
  const filteredInput = filterOrphanFunctionCallOutputs(wire.input);

  // Tools: SDK adapter emits flat `{type:'function', name, description, parameters}`
  // — the exact Responses-API shape. Re-pass parameters through the AIF
  // Azure-strict normalizer (the SDK adapter doesn't run Azure-specific
  // schema validation; that's provider-specific).
  const tools = wire.tools && wire.tools.length > 0
    ? wire.tools
        .map((t) => ({
          type: 'function' as const,
          name: t.name,
          description: t.description,
          parameters: normalizeAifToolParameters(t.parameters),
        }))
        .filter((t) => t.name)
    : undefined;

  const body: Record<string, unknown> = {
    model: opts.deployment,
    stream: opts.stream ?? true,
    input: filteredInput,
    max_output_tokens:
      opts.maxOutputTokensOverride ?? wire.max_output_tokens ?? 32768,
  };
  if (wire.instructions) body.instructions = wire.instructions;
  if (tools && tools.length > 0) body.tools = tools;
  if (wire.tool_choice != null) body.tool_choice = wire.tool_choice;
  if (opts.reasoningEffort) {
    body.reasoning = { effort: opts.reasoningEffort };
  }

  return body;
}

/**
 * Drop function_call_output items whose call_id doesn't match a preceding
 * function_call in the same input[] array. AIF rejects orphan outputs with
 * `invalid_request_error: missing function_call_output's preceding function_call`.
 */
export function filterOrphanFunctionCallOutputs(
  input: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const seenCallIds = new Set<string>();
  const out: Array<Record<string, unknown>> = [];
  for (const item of input) {
    if (item.type === 'function_call' && typeof item.call_id === 'string') {
      seenCallIds.add(item.call_id);
      out.push(item);
      continue;
    }
    if (item.type === 'function_call_output') {
      const cid = typeof item.call_id === 'string' ? item.call_id : '';
      if (!cid || !seenCallIds.has(cid)) continue;
      out.push(item);
      continue;
    }
    out.push(item);
  }
  return out;
}
