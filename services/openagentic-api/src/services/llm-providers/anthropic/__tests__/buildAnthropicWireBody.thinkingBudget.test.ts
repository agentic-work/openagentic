/**
 * Q1-blocker-4 (2026-05-12 live capture) — Bedrock-Claude rejects request
 * with `max_tokens` <= `thinking.budget_tokens`:
 *
 *   ValidationException: `max_tokens` must be greater than
 *   `thinking.budget_tokens`. Please consult our documentation at
 *   https://docs.claude.com/en/docs/build-with-claude/extended-thinking
 *
 * Live error from chat-dev 2026-05-13T00:26Z, model us.anthropic.claude-
 * sonnet-4-5-20250929-v1:0, Q1 re-drive (commit 62856653, image
 * 0.7.1-62856653). Smart Router classified the tri-cloud cost prompt as
 * agentic → Sonnet 4.5 via AWSBedrockProvider. With BEDROCK_THINKING_BUDGET_TOKENS
 * default 4096 AND streamProvider's oaiRequest carrying NO max_tokens
 * (so canonical defaulted to 4096), Bedrock saw body.max_tokens === body.
 * thinking.budget_tokens === 4096 → 400.
 *
 * Anthropic docs:
 *   https://docs.claude.com/en/docs/build-with-claude/extended-thinking#max-tokens-and-context-window-size
 * "max_tokens must be greater than budget_tokens. The model needs tokens
 *  to emit the final answer AFTER finishing its thinking budget."
 *
 * Pin: when thinking is attached, max_tokens MUST be at least
 *   budget_tokens + RESERVED_OUTPUT_TOKENS (4096).
 * The adapter computes this floor — caller-supplied max_tokens is honored
 * only when it already exceeds the floor.
 */

import { describe, it, expect } from 'vitest';
import { buildAnthropicWireBody } from '../buildAnthropicWireBody.js';
import type { CompletionRequest } from '../../ILLMProvider.js';

const RESERVED_OUTPUT_TOKENS = 4096;

const baseReq: CompletionRequest = {
  messages: [{ role: 'user', content: 'hello' }],
  // Intentionally omit max_tokens — mirrors streamProvider.ts:118 which
  // doesn't set it. The canonical layer defaults to 4096, the exact case
  // that triggered the live Q1 ValidationException.
} as CompletionRequest;

const sonnetThinkOpts = {
  model: 'placeholder-bedrock',
  parallelOn: true,
  supportsThinking: true,
  thinkingBudgetTokens: 4096,
};

describe('buildAnthropicWireBody — Q1 max_tokens vs thinking.budget_tokens floor', () => {
  it('bumps max_tokens to budget + reserved-output floor when thinking attached and caller did not set max_tokens', () => {
    const body = buildAnthropicWireBody(baseReq, sonnetThinkOpts) as any;
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 4096 });
    // 4096 (budget) + 4096 (reserved output) = 8192 floor.
    expect(body.max_tokens).toBeGreaterThanOrEqual(4096 + RESERVED_OUTPUT_TOKENS);
    expect(body.max_tokens).toBeGreaterThan(body.thinking.budget_tokens);
  });

  it('bumps max_tokens to floor when caller-supplied max_tokens is below floor', () => {
    const req = { ...baseReq, max_tokens: 2048 } as CompletionRequest;
    const body = buildAnthropicWireBody(req, sonnetThinkOpts) as any;
    expect(body.max_tokens).toBeGreaterThanOrEqual(4096 + RESERVED_OUTPUT_TOKENS);
    expect(body.max_tokens).toBeGreaterThan(body.thinking.budget_tokens);
  });

  it('honors caller-supplied max_tokens when already above the floor', () => {
    const req = { ...baseReq, max_tokens: 32000 } as CompletionRequest;
    const body = buildAnthropicWireBody(req, sonnetThinkOpts) as any;
    // Caller explicitly asked for 32000 and that's already > budget + floor → keep it.
    expect(body.max_tokens).toBe(32000);
    expect(body.max_tokens).toBeGreaterThan(body.thinking.budget_tokens);
  });

  it('does NOT bump max_tokens when thinking is NOT attached (back-compat)', () => {
    const req = { ...baseReq, max_tokens: 2048 } as CompletionRequest;
    const body = buildAnthropicWireBody(req, {
      model: 'placeholder-haiku',
      parallelOn: true,
      supportsThinking: false,
    }) as any;
    expect(body.thinking).toBeUndefined();
    expect(body.max_tokens).toBe(2048);
  });

  it('passes through canonical 4096 default when thinking is NOT attached', () => {
    // baseReq has no max_tokens → canonical defaults to 4096 → adapter
    // returns wire.max_tokens=4096, no floor applied since no thinking.
    const body = buildAnthropicWireBody(baseReq, {
      model: 'placeholder-haiku',
      parallelOn: true,
      supportsThinking: false,
    }) as any;
    expect(body.thinking).toBeUndefined();
    expect(body.max_tokens).toBe(4096);
  });
});
