/**
 * Sev-1 (2026-05-12 live capture) — buildAnthropicWireBody emits
 * temperature: 0.7 + thinking: { type: 'enabled' } on the same body, and
 * Anthropic / Bedrock-Claude rejects the call with:
 *
 *   "temperature may only be set to 1 when thinking is enabled."
 *
 * Per Anthropic docs (https://docs.claude.com/en/docs/build-with-claude/
 * extended-thinking#supported-models) extended thinking requires the
 * default sampling params: temperature MUST be 1, and top_p / top_k must
 * not be modified.
 *
 * Live error from chat-dev 2026-05-12T15:40Z, model claude-sonnet-4-6,
 * prompt: "show me all of my cloud resources by type — e.g. compute,
 * storage, etc and a full cost interactive table". Empty bubble. The
 * model dispatcher routed to Sonnet (T3 prompt) → AWSBedrockProvider →
 * buildBedrockClaudeBody → buildAnthropicWireBody → wire body had
 * temperature: 0.7 + thinking enabled → Bedrock 400.
 *
 * Pin: when supportsThinking AND thinkingBudgetTokens are set (i.e. the
 * adapter is about to attach `body.thinking`), temperature MUST be 1 and
 * top_p MUST be dropped — regardless of what request.temperature carries.
 */

import { describe, it, expect } from 'vitest';
import { buildAnthropicWireBody } from '../buildAnthropicWireBody.js';
import type { CompletionRequest } from '../../ILLMProvider.js';

const baseReq: CompletionRequest = {
  messages: [{ role: 'user', content: 'hello' }],
  max_tokens: 1024,
  temperature: 0.7,
  top_p: 0.9,
} as CompletionRequest;

const thinkOpts = {
  model: 'claude-sonnet-4-6',
  parallelOn: true,
  supportsThinking: true,
  thinkingBudgetTokens: 4096,
};

describe('buildAnthropicWireBody — Sev-1 thinking/temperature conflict', () => {
  it('forces temperature=1 when supportsThinking AND thinkingBudgetTokens are set', () => {
    const body = buildAnthropicWireBody(baseReq, thinkOpts) as any;
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 4096 });
    expect(body.temperature).toBe(1);
  });

  it('drops top_p when thinking is enabled', () => {
    const body = buildAnthropicWireBody(baseReq, thinkOpts) as any;
    expect(body.thinking).toBeDefined();
    expect(body.top_p).toBeUndefined();
  });

  it('passes temperature through unchanged when thinking is NOT enabled (back-compat)', () => {
    const body = buildAnthropicWireBody(baseReq, {
      model: 'claude-haiku-3-5',
      parallelOn: true,
      supportsThinking: false,
    }) as any;
    expect(body.thinking).toBeUndefined();
    expect(body.temperature).toBe(0.7);
    expect(body.top_p).toBe(0.9);
  });

  it('treats supportsThinking=true with no thinkingBudgetTokens as thinking-OFF (no body.thinking attached)', () => {
    const body = buildAnthropicWireBody(baseReq, {
      model: 'claude-sonnet-4-6',
      parallelOn: true,
      supportsThinking: true,
      // thinkingBudgetTokens omitted
    }) as any;
    expect(body.thinking).toBeUndefined();
    // Thinking isn't attached, so temperature/top_p pass through unchanged.
    expect(body.temperature).toBe(0.7);
    expect(body.top_p).toBe(0.9);
  });
});
