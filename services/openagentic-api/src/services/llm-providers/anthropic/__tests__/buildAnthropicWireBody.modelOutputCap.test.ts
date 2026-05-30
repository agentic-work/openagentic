/**
 * Sev-1 #794 (2026-05-13) — synth code-gen via compose_app on Bedrock-Claude
 * hits the 8192 output_tokens cap mid-HTML generation, model regenerates from
 * scratch on next turn instead of resuming, PDFs come out truncated.
 *
 * ROOT CAUSE: streamProvider's `oaiRequest` (routes/chat/pipeline/chat/
 * streamProvider.ts:118-125) does NOT set `max_tokens`. The canonical layer
 * defaults to 4096 (openagentic-sdk/canonical/legacyShape.ts:72). The
 * Bedrock-Claude wire body therefore carries max_tokens=4096 (or 8192 when
 * thinking is attached, via the Q1-blocker-4 thinking-budget floor) — far
 * below the model's true ceiling.
 *
 * Per AWS Bedrock docs:
 *   - Claude Sonnet 4.x: 64K output tokens (max_tokens up to 64000)
 *   - Claude Opus 4.x:   32K output tokens
 *   - Claude Haiku 4.5:  64K output tokens
 *   - Claude 3.5/3.7:    8K (Sonnet 3.5) / 64K (Sonnet 3.7)
 *   - Claude 3:          4K
 *
 * FIX: thread a `modelOutputCap` through buildAnthropicWireBody +
 * buildBedrockClaudeBody. When caller omits max_tokens (canonical default
 * collapses to 4096), the cap raises the FLOOR so the wire body honors the
 * model's real ceiling. Caller-supplied max_tokens above the cap is still
 * honored (e.g., a 64K explicit request for a long compose_app).
 *
 * The fix is intentionally NOT a hardcoded model-string lookup inside
 * buildAnthropicWireBody — the cap is passed in by the provider (Bedrock,
 * Anthropic-direct, Vertex-Anthropic) which already knows the model's
 * capabilities from its registry row or the inferMaxOutputTokens helper.
 */

import { describe, it, expect } from 'vitest';
import { buildAnthropicWireBody } from '../buildAnthropicWireBody.js';
import type { CompletionRequest } from '../../ILLMProvider.js';

const baseReq: CompletionRequest = {
  messages: [{ role: 'user', content: 'generate a long HTML report' }],
  // Intentionally omit max_tokens — mirrors streamProvider.ts:118.
} as CompletionRequest;

describe('buildAnthropicWireBody — Sev-1 #794 modelOutputCap floor for synth code-gen', () => {
  it('bumps max_tokens to modelOutputCap when caller did not set max_tokens and no thinking attached', () => {
    const body = buildAnthropicWireBody(baseReq, {
      model: 'us.anthropic.claude-sonnet-4-6',
      parallelOn: true,
      modelOutputCap: 32000,
    }) as any;
    // Caller omitted max_tokens → canonical defaulted to 4096 → cap lifts it.
    expect(body.max_tokens).toBe(32000);
  });

  it('honors caller-supplied max_tokens when above modelOutputCap (explicit > cap is intentional)', () => {
    const req = { ...baseReq, max_tokens: 64000 } as CompletionRequest;
    const body = buildAnthropicWireBody(req, {
      model: 'us.anthropic.claude-sonnet-4-6',
      parallelOn: true,
      modelOutputCap: 32000,
    }) as any;
    // Caller explicitly asked for 64000 — honor it even though cap is lower
    // (the cap raises the floor, not the ceiling).
    expect(body.max_tokens).toBe(64000);
  });

  it('honors caller-supplied max_tokens below modelOutputCap (caller knows their context)', () => {
    const req = { ...baseReq, max_tokens: 8192 } as CompletionRequest;
    const body = buildAnthropicWireBody(req, {
      model: 'us.anthropic.claude-sonnet-4-6',
      parallelOn: true,
      modelOutputCap: 32000,
    }) as any;
    // Caller explicitly chose 8192 — don't second-guess them. Cap only
    // applies when caller didn't supply (i.e. wire.max_tokens === 4096
    // canonical default).
    expect(body.max_tokens).toBe(8192);
  });

  it('omitting modelOutputCap preserves legacy canonical default (back-compat)', () => {
    const body = buildAnthropicWireBody(baseReq, {
      model: 'us.anthropic.claude-sonnet-4-6',
      parallelOn: true,
    }) as any;
    // No cap supplied → wire.max_tokens stays at canonical default 4096.
    expect(body.max_tokens).toBe(4096);
  });

  it('modelOutputCap interacts with thinking-budget floor: max of the two wins', () => {
    const body = buildAnthropicWireBody(baseReq, {
      model: 'us.anthropic.claude-sonnet-4-6',
      parallelOn: true,
      supportsThinking: true,
      thinkingBudgetTokens: 4096, // → thinking-floor 8192 (budget + 4096)
      modelOutputCap: 32000,
    }) as any;
    // Cap 32000 > thinking-floor 8192 → cap wins.
    expect(body.max_tokens).toBe(32000);
    expect(body.max_tokens).toBeGreaterThan(body.thinking.budget_tokens);
  });

  it('modelOutputCap below thinking-budget floor: floor still wins (safety)', () => {
    const body = buildAnthropicWireBody(baseReq, {
      model: 'us.anthropic.claude-sonnet-4-6',
      parallelOn: true,
      supportsThinking: true,
      thinkingBudgetTokens: 16000, // → thinking-floor 20096 (budget + 4096)
      modelOutputCap: 8000,
    }) as any;
    // Cap 8000 < thinking-floor 20096 → floor wins. Otherwise Bedrock
    // would reject with "max_tokens must be greater than budget_tokens".
    expect(body.max_tokens).toBeGreaterThanOrEqual(20096);
    expect(body.max_tokens).toBeGreaterThan(body.thinking.budget_tokens);
  });
});
