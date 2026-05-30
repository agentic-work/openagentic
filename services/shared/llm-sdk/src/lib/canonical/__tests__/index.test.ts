/**
 * canonical/index — re-export aggregator regression. Pins that every public
 * symbol the future adapters depend on is reachable from both the subpath
 * (`@agentic-work/llm-sdk/lib/canonical`) and the root entry-point.
 *
 * Spec: docs/superpowers/plans/2026-05-11-chatmode-five-layer-remediation.md
 *        §"Phase 0.2 — SDK shared canonical invariants"
 */
import { describe, it, expect } from 'vitest';

describe('canonical/index — public surface re-export', () => {
  it('re-exports every Phase 0.2 invariant from the subpath', async () => {
    const mod = await import('../index.js');
    // Types are erased at runtime; only the runtime values are asserted here.
    expect(typeof mod.CANONICAL_REQUEST_VERSION).toBe('string');
    expect(typeof mod.mapAnthropicStopReason).toBe('function');
    expect(typeof mod.mapOpenAIFinishReason).toBe('function');
    expect(typeof mod.mapBedrockStopReason).toBe('function');
    expect(typeof mod.mapVertexFinishReason).toBe('function');
    expect(typeof mod.mapOllamaDoneReason).toBe('function');
    expect(typeof mod.toAnthropicStopReason).toBe('function');
    expect(typeof mod.toOpenAIFinishReason).toBe('function');
    expect(typeof mod.toBedrockStopReason).toBe('function');
    expect(typeof mod.toVertexFinishReason).toBe('function');
    expect(typeof mod.toOllamaDoneReason).toBe('function');
    expect(typeof mod.toToolu).toBe('function');
    expect(typeof mod.fromToolu).toBe('function');
    expect(typeof mod.stripCacheControl).toBe('function');
    expect(typeof mod.extractThinkingFromOpenAIDelta).toBe('function');
    expect(typeof mod.extractThinkingFromAIFResponses).toBe('function');
    expect(typeof mod.extractThinkingFromVertexGemini).toBe('function');
    expect(typeof mod.extractThinkingFromOllamaContent).toBe('function');
    expect(typeof mod.wrapAsCanonicalThinking).toBe('function');
  });

  it('re-exports every Phase 0.2 invariant from the package root', async () => {
    const mod = await import('../../../index.js');
    expect(typeof mod.CANONICAL_REQUEST_VERSION).toBe('string');
    expect(typeof mod.mapAnthropicStopReason).toBe('function');
    expect(typeof mod.toToolu).toBe('function');
    expect(typeof mod.stripCacheControl).toBe('function');
    expect(typeof mod.wrapAsCanonicalThinking).toBe('function');
  });
});
