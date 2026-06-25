/**
 * Tests for the Phase F.4 client-side cost estimator.
 */

import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  findModelPricing,
  estimateCost,
  formatCost,
  MODEL_PRICING,
  UNKNOWN_MODEL_PRICING,
} from '../estimateCost';

describe('estimateTokens', () => {
  it('returns 0 for empty / null input', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens(undefined as unknown as string)).toBe(0);
  });

  it('uses the 4-chars-per-token rule', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('a'.repeat(40))).toBe(10);
    expect(estimateTokens('a')).toBe(1); // ceil rounds up
  });
});

describe('findModelPricing', () => {
  it('falls back to UNKNOWN when no model id is given', () => {
    expect(findModelPricing(null)).toEqual({ pricing: UNKNOWN_MODEL_PRICING, known: false });
    expect(findModelPricing(undefined)).toEqual({ pricing: UNKNOWN_MODEL_PRICING, known: false });
  });

  it('picks the longest matching prefix first', () => {
    // "claude-opus-4-7" must beat "claude-opus" and bare "claude".
    expect(findModelPricing('claude-opus-4-7').pricing).toBe(MODEL_PRICING['claude-opus-4-7']);
    expect(findModelPricing('claude-opus-4-6').pricing).toBe(MODEL_PRICING['claude-opus-4-6']);
    expect(findModelPricing('claude-opus-3-5').pricing).toBe(MODEL_PRICING['claude-opus']);
  });

  it('is case-insensitive on the model id', () => {
    expect(findModelPricing('CLAUDE-Sonnet-4-6').pricing).toBe(MODEL_PRICING['claude-sonnet-4-6']);
    expect(findModelPricing('GPT-5-turbo').pricing).toBe(MODEL_PRICING['gpt-5']);
  });

  it('matches local/Ollama families at zero cost', () => {
    expect(findModelPricing('gpt-oss:20b').pricing.inputPer1M).toBe(0);
    expect(findModelPricing('qwen3-32b').pricing.inputPer1M).toBe(0);
  });

  it('returns known:false for genuinely unknown models', () => {
    const out = findModelPricing('some-weirdmodel-7b');
    expect(out.known).toBe(false);
    expect(out.pricing).toBe(UNKNOWN_MODEL_PRICING);
  });
});

describe('estimateCost', () => {
  it('returns zero cost with no input/output', () => {
    const out = estimateCost({ model: 'claude-sonnet-4-6' });
    expect(out.usd).toBe(0);
    expect(out.inputTokens).toBe(0);
    expect(out.outputTokens).toBe(0);
    expect(out.known).toBe(true);
  });

  it('computes USD from token counts + pricing table (Sonnet 4.6: $3 in / $15 out per 1M)', () => {
    const out = estimateCost({
      model: 'claude-sonnet-4-6',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(out.usd).toBeCloseTo(18, 5); // $3 + $15
  });

  it('accepts raw text and derives tokens from it', () => {
    // 4 chars/token → 4000 chars = 1000 tokens on each side.
    const out = estimateCost({
      model: 'claude-opus-4-7',
      inputText: 'a'.repeat(4000),
      outputText: 'b'.repeat(4000),
    });
    // 1000 tokens at $15/1M = $0.015 + 1000 at $75/1M = $0.075 → $0.09
    expect(out.inputTokens).toBe(1000);
    expect(out.outputTokens).toBe(1000);
    expect(out.usd).toBeCloseTo(0.09, 5);
  });

  it('clamps negative/zero to zero (defensive)', () => {
    const out = estimateCost({
      model: 'gpt-oss:20b', // zero pricing
      inputTokens: 100_000,
      outputTokens: 100_000,
    });
    expect(out.usd).toBe(0);
  });

  it('marks unknown models with known:false but still returns a number', () => {
    const out = estimateCost({
      model: 'garbage-unknown-model',
      inputTokens: 1000,
      outputTokens: 500,
    });
    expect(out.known).toBe(false);
    expect(out.usd).toBeGreaterThan(0);
  });
});

describe('formatCost', () => {
  it('renders 0 explicitly as $0.00', () => {
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(-1)).toBe('$0.00'); // defensive
  });

  it('renders sub-penny as <$0.01 so users do not see $0.000012', () => {
    expect(formatCost(0.0001)).toBe('<$0.01');
    expect(formatCost(0.009)).toBe('<$0.01');
  });

  it('renders sub-dollar with three decimals', () => {
    expect(formatCost(0.023)).toBe('$0.023');
    expect(formatCost(0.999)).toBe('$0.999');
  });

  it('renders dollars with two decimals up to $100', () => {
    expect(formatCost(1)).toBe('$1.00');
    expect(formatCost(12.345)).toBe('$12.35');
    expect(formatCost(99.99)).toBe('$99.99');
  });

  it('renders very large amounts as whole dollars', () => {
    expect(formatCost(150)).toBe('$150');
    expect(formatCost(1234.56)).toBe('$1235');
  });
});
