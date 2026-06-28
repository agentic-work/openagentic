/**
 * #651 — LLMMetricsService.calculateCost embedding-shape silent skip.
 *
 * Bug: Embedding requests (completionTokens===0, model name contains 'embed')
 * fall through to the chat-completion fallback branch, which logs a noisy
 * `⚠️ FALLBACK PRICING: Model not found in registry` warn on EVERY embedding
 * call. The warn is also factually wrong — `capabilitiesFound:true` shows
 * the model IS in the registry, just without input/outputCostPer1k (because
 * embeddings price via embeddingCostPer1k, not chat-completion fields).
 *
 * Fix: short-circuit embedding-shape calls to a silent zero-cost result with
 * pricingSource:'embedding-skip' BEFORE reaching the chat-pricing branch.
 * Embedding cost tracking lives in a separate ledger and is not load-bearing
 * for the chat cost ledger surfaced in the UI.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger } from '../../utils/logger.js';
import { LLMMetricsService } from '../LLMMetricsService.js';

describe('LLMMetricsService.calculateCost embedding-shape (#651)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let svc: LLMMetricsService;

  beforeEach(() => {
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    svc = LLMMetricsService.getInstance();
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('does NOT log FALLBACK PRICING warn for text-embedding-3-large', () => {
    svc.calculateCost('azure-openai', 'text-embedding-3-large', 80, 0);
    const fallbackCalls = warnSpy.mock.calls.filter(([, msg]) =>
      typeof msg === 'string' && msg.includes('FALLBACK PRICING'),
    );
    expect(fallbackCalls).toHaveLength(0);
  });

  it('returns zero-cost embedding-skip result for embedding-shape call', () => {
    const r = svc.calculateCost('azure-openai', 'text-embedding-3-large', 80, 0);
    expect(r.totalCost).toBe(0);
    expect(r.promptCost).toBe(0);
    expect(r.completionCost).toBe(0);
    expect(r.pricingSource).toBe('embedding-skip');
  });

  it('still warns for an unknown chat-completion model (not embedding shape)', () => {
    svc.calculateCost('openai', 'unknown-chat-model-xyz', 100, 50);
    const fallbackCalls = warnSpy.mock.calls.filter(([, msg]) =>
      typeof msg === 'string' && msg.includes('FALLBACK PRICING'),
    );
    expect(fallbackCalls.length).toBeGreaterThan(0);
  });
});
