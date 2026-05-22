/**
 * modelTaskGate unit tests — #843 hard capability gate for Task tool.
 *
 * RED→GREEN per case. Pins the structural gate behavior so future
 * changes can't silently re-open Task to confabulating small models.
 */

import { describe, it, expect } from 'vitest';
import type { DiscoveredModel } from '../llm-providers/ILLMProvider.js';
import { modelSupportsTaskDispatch } from '../modelTaskGate.js';

function caps(overrides: Partial<DiscoveredModel> = {}): DiscoveredModel {
  return {
    id: 'test-model',
    name: 'Test Model',
    provider: 'test-provider',
    capabilities: {
      chat: true,
      vision: false,
      tools: true,
      thinking: false,
      embeddings: false,
      imageGeneration: false,
      streaming: true,
    },
    contextWindow: 128_000,
    costTier: 'mid',
    ...overrides,
  };
}

describe('modelSupportsTaskDispatch', () => {
  it('returns true when caps is null (fail-open on unknown model)', () => {
    expect(modelSupportsTaskDispatch(null)).toBe(true);
    expect(modelSupportsTaskDispatch(undefined)).toBe(true);
  });

  it('returns false when the model has no tool capability', () => {
    const c = caps({
      capabilities: {
        chat: true,
        vision: false,
        tools: false,
        thinking: false,
        embeddings: false,
        imageGeneration: false,
        streaming: true,
      },
    });
    expect(modelSupportsTaskDispatch(c)).toBe(false);
  });

  it('returns false for low-cost-tier models even with large context', () => {
    const c = caps({ costTier: 'low', contextWindow: 200_000 });
    expect(modelSupportsTaskDispatch(c)).toBe(false);
  });

  it('returns false for free-tier models', () => {
    const c = caps({ costTier: 'free', contextWindow: 128_000 });
    expect(modelSupportsTaskDispatch(c)).toBe(false);
  });

  it('returns false when context window is below 64k', () => {
    const c = caps({ contextWindow: 8_192, costTier: 'mid' });
    expect(modelSupportsTaskDispatch(c)).toBe(false);
  });

  it('returns true for mid-tier model with large context + tools', () => {
    const c = caps({ costTier: 'mid', contextWindow: 128_000 });
    expect(modelSupportsTaskDispatch(c)).toBe(true);
  });

  it('returns true for high/premium-tier models', () => {
    expect(modelSupportsTaskDispatch(caps({ costTier: 'high', contextWindow: 200_000 }))).toBe(true);
    expect(modelSupportsTaskDispatch(caps({ costTier: 'premium', contextWindow: 1_000_000 }))).toBe(true);
  });

  it('treats contextWindow=0 (unknown) as not-blocking — fall through to other checks', () => {
    // Unknown context window shouldn't be treated as "tiny" — the costTier
    // check carries the gate when context is unset.
    const c = caps({ contextWindow: 0, costTier: 'mid' });
    expect(modelSupportsTaskDispatch(c)).toBe(true);
  });
});
