/**
 * Sev-1 #794 (2026-05-13) — Bedrock-Claude wrapper for buildAnthropicWire-
 * Body's modelOutputCap floor. The provider passes the cap (from the
 * registry row's max_tokens column or inferMaxOutputTokens) so synth
 * code-gen (compose_app html arg generation) gets the model's true ceiling
 * instead of the canonical 4096 default.
 *
 * Sibling spec: buildAnthropicWireBody.modelOutputCap.test.ts (the actual
 * floor logic lives there; buildBedrockClaudeBody is a thin pass-through).
 */

import { describe, it, expect } from 'vitest';
import { buildBedrockClaudeBody } from '../buildBedrockClaudeBody.js';
import type { CompletionRequest } from '../../ILLMProvider.js';

const baseReq: CompletionRequest = {
  messages: [{ role: 'user', content: 'generate a long HTML report' }],
  // Intentionally omit max_tokens — mirrors streamProvider.ts:118.
} as CompletionRequest;

describe('buildBedrockClaudeBody — Sev-1 #794 modelOutputCap pass-through', () => {
  it('threads modelOutputCap → max_tokens bumps from 4096 default to cap', () => {
    const body = buildBedrockClaudeBody(baseReq, {
      parallelOn: true,
      modelOutputCap: 32000,
    }) as any;
    expect(body.max_tokens).toBe(32000);
    // Bedrock-specific top-level field still present.
    expect(body.anthropic_version).toBe('bedrock-2023-05-31');
  });

  it('omitting modelOutputCap preserves legacy canonical 4096 default', () => {
    const body = buildBedrockClaudeBody(baseReq, {
      parallelOn: true,
    }) as any;
    expect(body.max_tokens).toBe(4096);
  });

  it('caller-supplied max_tokens above cap survives (cap = floor, not ceiling)', () => {
    const req = { ...baseReq, max_tokens: 64000 } as CompletionRequest;
    const body = buildBedrockClaudeBody(req, {
      parallelOn: true,
      modelOutputCap: 32000,
    }) as any;
    expect(body.max_tokens).toBe(64000);
  });
});
