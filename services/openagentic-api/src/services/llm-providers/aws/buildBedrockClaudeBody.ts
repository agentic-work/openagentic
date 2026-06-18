/**
 * AWSBedrockProvider — Claude-on-Bedrock InvokeModelWithResponseStream
 * body builder.
 *
 * Phase 0.4 (audit §0.4): replaces the Claude branches of the in-class
 * `convertToBedrock` with a thin SDK-adapter wrapper. The 'anthropic'
 * adapter produces the Anthropic Messages API body shape that Bedrock's
 * InvokeModel commands accept (Bedrock-Anthropic is wire-identical to
 * Anthropic.com direct — verified by the buildAnthropicWireBody.real
 * round-trip test).
 *
 * Two Bedrock-specific tweaks on top:
 *   - `model` is stripped from the body (it goes in InvokeModel.modelId,
 *     which is the URL/parameter not the JSON).
 *   - `anthropic_version: 'bedrock-2023-05-31'` is added at top level
 *     (required by Bedrock's bedrock-claude integration layer).
 *   - `stream` is NOT carried in the body — Bedrock uses
 *     InvokeModelWithResponseStream (the command, not a body flag) for
 *     streaming.
 *
 * The non-Claude branches of convertToBedrock (Llama/Nova/Titan)
 * produce different wire shapes (inputText/prompt/etc.) and route
 * through ConverseAPI not InvokeModel. They remain in-class for now;
 * separate Phase 0.4 migration.
 *
 * Tests: aws/__tests__/buildBedrockClaudeBody.test.ts (8 unit) +
 *        aws/__tests__/buildBedrockClaudeBody.real.test.ts (1 live).
 */

import { buildAnthropicWireBody } from '../anthropic/buildAnthropicWireBody.js';
import type { CompletionRequest } from '../ILLMProvider.js';

export interface BuildBedrockClaudeBodyOptions {
  /** Whether parallel tool calls should be allowed for this turn.
   * Defaults to true. INVERTED into Anthropic's `disable_parallel_tool_use`. */
  parallelOn: boolean;
  /** Bedrock-Claude supports extended thinking on certain inference
   * profiles (Sonnet 4.x family). Provider-config decision. */
  supportsThinking?: boolean;
  thinkingBudgetTokens?: number;
  /** #cap-sync — thinking wire shape: 'adaptive' (Opus 4.7/4.8, no budget) vs
   *  'enabled' (≤ Opus 4.6, fixed budget). Threaded to buildAnthropicWireBody. */
  thinkingMode?: 'enabled' | 'adaptive';
  /**
   * Sev-1 #794 — model's real output ceiling (registry-row or
   * inferMaxOutputTokens). Threaded through to
   * `buildAnthropicWireBody.modelOutputCap`. See the wire-body helper
   * for full semantics: this lifts the FLOOR when the caller omits
   * `request.max_tokens`, never reduces an explicit value.
   */
  modelOutputCap?: number;
}

export function buildBedrockClaudeBody(
  request: CompletionRequest,
  opts: BuildBedrockClaudeBodyOptions,
): Record<string, unknown> {
  // Reuse the Anthropic wire helper since Bedrock-Claude accepts the
  // same Messages API body shape. `model` is set as a placeholder; we
  // strip it below since Bedrock uses InvokeModel.modelId instead.
  const wire = buildAnthropicWireBody(request, {
    model: 'bedrock-placeholder', // stripped below
    parallelOn: opts.parallelOn,
    supportsThinking: opts.supportsThinking,
    thinkingMode: opts.thinkingMode,
    thinkingBudgetTokens: opts.thinkingBudgetTokens,
    modelOutputCap: opts.modelOutputCap,
  }) as Record<string, unknown>;

  // Bedrock InvokeModel quirks:
  //   1. Strip `model` (it's in the modelId parameter).
  //   2. Add `anthropic_version` at top level.
  //   3. Strip `stream` — Bedrock uses InvokeModelWithResponseStream
  //      (the command, not a body flag) for streaming.
  const { model: _model, stream: _stream, ...body } = wire;

  return {
    ...body,
    anthropic_version: 'bedrock-2023-05-31',
  };
}
