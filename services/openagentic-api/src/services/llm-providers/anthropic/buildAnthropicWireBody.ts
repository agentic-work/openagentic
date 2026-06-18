/**
 * AnthropicProvider — wire-body builder.
 *
 * Phase 0.4 (audit §0.4): the provider becomes a thin HTTP/auth/keep-alive
 * client; wire-shape translation moves to the SDK adapter at
 * `@agentic-work/llm-sdk/lib/adapters` (`selectOutboundAdapter('anthropic')`).
 *
 * Provider-specific decoration layered ON TOP of the SDK adapter:
 *   - `disable_parallel_tool_use` on tool_choice (Anthropic-specific
 *     INVERTED flag — `parallelOn=true` ⇔ `disable_parallel_tool_use=false`)
 *   - `thinking: { type: 'enabled', budget_tokens }` for extended-thinking
 *     models (Sonnet 4.x / Opus 4.x) — provider-config decision based on
 *     model capability + ANTHROPIC_THINKING_* env, not wire-shape
 *   - `output_config` for structured JSON schema outputs (Anthropic-native)
 *   - `stream` toggle
 *   - `temperature` / `top_p` pass-through (SDK adapter doesn't carry
 *     sampling params — they're provider-config)
 *
 * Pre-existing in-class converters (`convertMessages`, `convertTools`,
 * `convertToolChoice`) are DELETED. The SDK adapter is now the SoT for
 * canonical → Anthropic wire translation.
 *
 * Bedrock-Anthropic + Vertex-Anthropic + Foundry-Anthropic share this
 * same Anthropic Messages wire shape; they route through
 * `OpenagenticToAnthropic` via different ProviderHint discriminators
 * (see openagentic-sdk/src/lib/adapters/index.ts).
 *
 * Tests: anthropic/__tests__/buildAnthropicWireBody.test.ts (13 cases).
 */

import {
  completionRequestToCanonical,
  selectOutboundAdapter,
} from '@agentic-work/llm-sdk/lib/adapters/index.js';
import type { CompletionRequest } from '../ILLMProvider.js';

export interface BuildAnthropicWireBodyOptions {
  /** Resolved model name (after model-router / env-default fallback). */
  model: string;
  /** Whether parallel tool calls should be allowed for this turn. The
   * SDK's `disable_parallel_tool_use` flag is INVERTED — `parallelOn=true`
   * ⇒ `disable_parallel_tool_use=false`. Default true. */
  parallelOn: boolean;
  /** Provider capability: only certain Anthropic models accept the
   * `thinking` field in the request body (Sonnet 4.x reasoning, Opus 4.x).
   * When `true` AND `thinkingBudgetTokens` provided, attaches
   * `thinking: { type:'enabled', budget_tokens }`. */
  supportsThinking?: boolean;
  thinkingBudgetTokens?: number;
  /**
   * #cap-sync (2026-06-16) — the Anthropic thinking WIRE shape this model
   * accepts. Opus 4.7/4.8 + Fable 5 REJECT `{type:'enabled', budget_tokens}`
   * with a 400 and require `{type:'adaptive'}` (depth via `effort`, no budget).
   * Sourced from the ModelCapabilityRegistry row's
   * `thinkingCapabilities.thinkingMode`. Defaults to `'enabled'` (legacy
   * fixed-budget) when unset, so ≤ Opus 4.6 / Sonnet 4.6 are unchanged.
   * When `'adaptive'`, `thinkingBudgetTokens` is ignored (there is no budget),
   * the budget-floor on `max_tokens` is NOT applied, and the wire emits
   * `thinking: { type: 'adaptive' }`.
   */
  thinkingMode?: 'enabled' | 'adaptive';
  /**
   * Sev-1 #794 (2026-05-13) — model's real output-token ceiling (per the
   * registry row's `max_tokens` column OR the provider's
   * inferMaxOutputTokens helper). When the caller did NOT supply
   * `request.max_tokens` (canonical defaults to 4096), this lifts the
   * floor so synth code-gen / compose_app HTML generation isn't capped
   * at 4 K. Caller-supplied max_tokens (above OR below the cap) wins —
   * the cap is a FLOOR for the "caller forgot" case, never a ceiling on
   * an explicit request.
   *
   * Pass this from the provider class (AWSBedrockProvider /
   * AnthropicProvider / etc.) which already knows the model. Keeps this
   * helper free of model-string literals (per
   * docs/rules/no-hardcoded-models.md).
   */
  modelOutputCap?: number;
}

/**
 * Reserved output budget when extended thinking is attached.
 *
 * Anthropic / Bedrock-Claude requires `max_tokens > thinking.budget_tokens`
 * — the model needs headroom to emit the final answer AFTER finishing its
 * thinking budget. The platform's typical chat-loop turn outputs <4K tokens
 * of text + tool_use, so reserving 4096 above the thinking budget covers
 * the worst case without bloating the request floor unnecessarily.
 *
 * Spec: https://docs.claude.com/en/docs/build-with-claude/extended-thinking#max-tokens-and-context-window-size
 *
 * Q1 live capture 2026-05-13: with budget=4096 and caller-supplied max_tokens
 * undefined → canonical default 4096 → body.max_tokens === body.thinking.
 * budget_tokens → Bedrock ValidationException. Floor must be strictly above
 * budget.
 */
const RESERVED_OUTPUT_TOKENS_WHEN_THINKING = 4096;

/**
 * Sev-1 #794 — mirrors `DEFAULT_MAX_TOKENS` in openagentic-sdk/canonical/
 * legacyShape.ts. The canonical layer's `completionRequestToCanonical()`
 * substitutes this value when the caller's `request.max_tokens` is
 * undefined. We use it as a "caller did not supply max_tokens" signal so
 * the `modelOutputCap` floor only fires for the omission case (not when
 * the caller deliberately chose 4096).
 *
 * KEEP IN SYNC with openagentic-sdk/src/lib/canonical/legacyShape.ts:72.
 * Pinned indirectly by the wire-body unit tests — if either side drifts,
 * the modelOutputCap fixtures break loudly.
 */
const CANONICAL_DEFAULT_MAX_TOKENS = 4096;

export function buildAnthropicWireBody(
  request: CompletionRequest,
  opts: BuildAnthropicWireBodyOptions,
): Record<string, unknown> {
  const canonical = completionRequestToCanonical(request);
  const adapter = selectOutboundAdapter('anthropic');
  const wire = adapter.adaptRequest(canonical) as {
    messages: Array<{ role: 'user' | 'assistant'; content: any[] }>;
    system?: string | Array<{ type: 'text'; text: string }>;
    tools?: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
    tool_choice?:
      | { type: 'auto' }
      | { type: 'any' }
      | { type: 'none' }
      | { type: 'tool'; name: string };
    max_tokens: number;
  };

  // Q1-blocker-4 (2026-05-13) — when extended thinking is attached,
  // Anthropic / Bedrock-Claude requires `max_tokens > thinking.budget_tokens`.
  // The canonical layer defaults max_tokens to 4096 when the caller omits
  // it (streamProvider.ts's oaiRequest does omit it), and BEDROCK_THINKING_
  // BUDGET_TOKENS also defaults to 4096 — so both collide at 4096 → 400.
  // Compute a floor that guarantees strict inequality plus reserved output
  // headroom. Caller-supplied max_tokens is honored only when already above
  // the floor.
  // #cap-sync — adaptive mode has NO budget_tokens, so the budget-floor on
  // max_tokens does not apply (it exists only to keep max_tokens strictly
  // above the fixed budget). The temperature=1 constraint still applies to
  // both modes (any thinking on Anthropic requires temperature 1).
  const adaptiveThinking = opts.thinkingMode === 'adaptive';
  const enabledBudgetThinking = !adaptiveThinking && !!(opts.supportsThinking && opts.thinkingBudgetTokens);
  const thinkingWillBeAttached = !!(opts.supportsThinking && (adaptiveThinking || opts.thinkingBudgetTokens));
  const thinkingFloor = enabledBudgetThinking
    ? (opts.thinkingBudgetTokens as number) + RESERVED_OUTPUT_TOKENS_WHEN_THINKING
    : 0;

  // Sev-1 #794 (2026-05-13) — `modelOutputCap` lifts the floor to the
  // model's real output ceiling when the caller did NOT supply max_tokens.
  // The canonical layer's 4096 default is appropriate for short chat
  // replies but starves synth code-gen / compose_app HTML generation,
  // which can legitimately need 30K-60K output tokens for a single PDF
  // report. The cap applies only when `wire.max_tokens` equals the
  // canonical default (CANONICAL_DEFAULT_MAX_TOKENS) — explicit caller
  // values, above or below the cap, are honored unchanged.
  const callerOmittedMaxTokens = wire.max_tokens === CANONICAL_DEFAULT_MAX_TOKENS;
  const capFloor =
    callerOmittedMaxTokens && opts.modelOutputCap && opts.modelOutputCap > 0
      ? opts.modelOutputCap
      : 0;

  const max_tokens = Math.max(wire.max_tokens, thinkingFloor, capFloor);

  const body: Record<string, unknown> = {
    model: opts.model,
    max_tokens,
    messages: wire.messages,
  };

  // System prompt: SDK adapter returns it as either string OR an array
  // (single-block wrap). Anthropic accepts BOTH at runtime; we pass
  // through unchanged so cache_control markers — when the SDK eventually
  // forwards them — survive.
  if (wire.system != null) body.system = wire.system;

  // Sampling params — provider-config, not wire-shape. The SDK adapter
  // doesn't carry temperature/top_p (those vary per request, not per
  // wire format). Pass through directly.
  //
  // Sev-1 (2026-05-12) — Anthropic extended thinking requires the default
  // sampling params: temperature MUST be 1, and top_p / top_k must NOT
  // be modified. Otherwise Anthropic / Bedrock-Claude rejects with
  //   "temperature may only be set to 1 when thinking is enabled."
  // Spec: https://docs.claude.com/en/docs/build-with-claude/extended-thinking
  // Bug surface: chat-dev 2026-05-12 Sonnet 4.6 turn — every chat call
  // failed because streamProvider passes temperature=0.7 and the provider
  // attaches thinking for Sonnet 4.x.
  if (thinkingWillBeAttached) {
    // Force the default — required when thinking is enabled.
    body.temperature = 1;
    // top_p MUST be omitted (Anthropic rejects any value here with
    // thinking on). Same for top_k, which buildAnthropicWireBody doesn't
    // currently surface but would need the same treatment.
  } else {
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.top_p !== undefined) body.top_p = request.top_p;
  }

  // Tools + tool_choice: SDK adapter emits the right Anthropic shape
  // (name/description/input_schema). Decorate tool_choice with the
  // Anthropic-specific `disable_parallel_tool_use` flag.
  if (wire.tools && wire.tools.length > 0) {
    body.tools = wire.tools;
    body.tool_choice = decorateToolChoice(wire.tool_choice, opts.parallelOn);
  } else if (request.tool_choice) {
    // Edge case: caller set tool_choice but no tools. SDK adapter still
    // emits tool_choice; we still need to decorate.
    body.tool_choice = decorateToolChoice(wire.tool_choice, opts.parallelOn);
  }

  // Extended thinking: provider-config decision. Anthropic accepts this
  // ONLY on models in the reasoning families (Sonnet 4.x / Opus 4.x).
  //
  // C2 — Anthropic API constraint: thinking is incompatible with forced
  // tool_choice ('any' or named-function 'tool'). When chatLoop forces
  // tool_choice for artifact-verb dispatch, we MUST skip the thinking field
  // or Bedrock/Anthropic returns:
  //   "Thinking may not be enabled when tool_choice forces tool use"
  // The SDK adapter (OpenagenticToAnthropic) already strips thinking from
  // the canonical-to-wire translation; this guard covers the provider-level
  // decoration path which adds thinking AFTER the adapter runs.
  // Source: https://platform.claude.com/docs/en/agents-and-tools/tool-use
  //         §"Forcing tool use" — extended thinking note.
  const forcedToolChoice =
    wire.tool_choice?.type === 'any' || wire.tool_choice?.type === 'tool';
  if (adaptiveThinking && opts.supportsThinking && !forcedToolChoice) {
    // #cap-sync — Opus 4.7/4.8 + Fable 5: adaptive thinking is the ONLY
    // accepted on-mode. `{type:'enabled', budget_tokens}` 400s here. No
    // budget_tokens field — depth is controlled by `effort` (set elsewhere).
    body.thinking = { type: 'adaptive' as const };
  } else if (enabledBudgetThinking && !forcedToolChoice) {
    // ≤ Opus 4.6 / Sonnet 4.6: legacy fixed-budget extended thinking.
    body.thinking = {
      type: 'enabled' as const,
      budget_tokens: opts.thinkingBudgetTokens as number,
    };
  } else if (opts.supportsThinking && (adaptiveThinking || opts.thinkingBudgetTokens) && forcedToolChoice) {
    // Log the strip for observability (matches SDK adapter debug line).
    // eslint-disable-next-line no-console
    console.debug(
      `[buildAnthropicWireBody] stripping thinking: incompatible with wire tool_choice.type="${wire.tool_choice?.type}" (Anthropic API constraint)`,
    );
  }

  // Structured outputs (JSON schema): Anthropic-native `output_config`
  // field. Caller provides `outputSchema` via CompletionRequest.
  if (request.outputSchema) {
    body.output_config = {
      type: 'json_schema' as const,
      schema: request.outputSchema,
    };
  }

  // Stream toggle: respect caller's explicit choice; default off (the
  // SDK adapter doesn't set this — it's a transport decision).
  if (request.stream !== undefined) body.stream = request.stream;

  return body;
}

/**
 * Decorate the SDK adapter's `tool_choice` output with the Anthropic-
 * specific `disable_parallel_tool_use` flag. The flag is INVERTED —
 * `parallelOn=true` ⇒ `disable_parallel_tool_use=false`.
 *
 * `type:'none'` cannot accept the flag (Anthropic 400s on it).
 */
function decorateToolChoice(
  tc:
    | { type: 'auto' }
    | { type: 'any' }
    | { type: 'none' }
    | { type: 'tool'; name: string }
    | undefined,
  parallelOn: boolean,
): unknown {
  if (!tc) return undefined;
  const disable_parallel_tool_use = !parallelOn;
  switch (tc.type) {
    case 'auto':
      return { type: 'auto', disable_parallel_tool_use };
    case 'any':
      return { type: 'any', disable_parallel_tool_use };
    case 'none':
      return { type: 'none' };
    case 'tool':
      return { type: 'tool', name: tc.name, disable_parallel_tool_use };
    default: {
      const _exhaustive: never = tc;
      return _exhaustive;
    }
  }
}
