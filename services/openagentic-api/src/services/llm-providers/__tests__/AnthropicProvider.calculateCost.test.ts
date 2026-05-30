/**
 * H13 behavioral test — AnthropicProvider.calculateCost now reads pricing
 * from ModelCapabilityRegistry → admin.model_role_assignments.
 *
 *   • Registry hit → math uses inputCostPer1k / outputCostPer1k.
 *   • Registry miss → returns 0 (operator's signal that the row is missing,
 *     not a "best-guess wrong number").
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import pino from 'pino';

const mockGetCapabilities = vi.fn();
vi.mock('../../ModelCapabilityRegistry.js', () => ({
  getModelCapabilityRegistry: () => ({ getCapabilities: mockGetCapabilities }),
}));

// Stub the SDK normalizer module — sibling-package resolution is a known
// issue under vitest (api #304/#510). Not relevant to calculateCost tests.
vi.mock('@agentic-work/llm-sdk/lib/normalizers/index.js', () => ({
  selectCanonicalNormalizer: () => null,
}));

import { AnthropicProvider } from '../AnthropicProvider.js';

describe('AnthropicProvider.calculateCost — registry-priority pricing (H13)', () => {
  beforeEach(() => {
    mockGetCapabilities.mockReset();
  });

  it('uses ModelCapabilityRegistry inputCostPer1k / outputCostPer1k when registered', () => {
    mockGetCapabilities.mockReturnValue({
      modelId: 'claude-sonnet-4-6',
      inputCostPer1k: 0.003,    // $3 per 1M input tokens
      outputCostPer1k: 0.015,   // $15 per 1M output tokens
    });

    const provider = new AnthropicProvider(pino({ level: 'silent' }));
    const cost = (provider as any).calculateCost('claude-sonnet-4-6', 1000, 1000);

    // 1000 in × 0.003/1k + 1000 out × 0.015/1k = 0.003 + 0.015 = 0.018
    expect(cost).toBeCloseTo(0.018, 5);
  });

  it('returns 0 when registry has no row for the model', () => {
    mockGetCapabilities.mockReturnValue({
      modelId: 'unknown-model',
      // costs intentionally undefined — registry exists but no pricing
    });

    const provider = new AnthropicProvider(pino({ level: 'silent' }));
    const cost = (provider as any).calculateCost('unknown-model', 1_000_000, 500_000);

    expect(cost).toBe(0);
  });

  it('handles partial registry data (input cost only)', () => {
    mockGetCapabilities.mockReturnValue({
      inputCostPer1k: 0.005,
      outputCostPer1k: undefined,
    });

    const provider = new AnthropicProvider(pino({ level: 'silent' }));
    const cost = (provider as any).calculateCost('partial', 2000, 1000);

    // 2000 in × 0.005/1k + 1000 out × 0/1k = 0.01
    expect(cost).toBeCloseTo(0.01, 5);
  });
});
