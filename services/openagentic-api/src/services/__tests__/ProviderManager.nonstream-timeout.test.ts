/**
 * ProviderManager — non-stream completion timeout (SEV-1, 2026-05-02).
 *
 * Live failure: AIF gpt-5.4 produced a complete 18,698-token response in 97s
 * for the prompt "give me a full diagram of a typical architecture of an aws
 * enterprise cloud", but the chat pipeline's `executeWithFailover` aborted
 * the call at the 90s `failoverTimeout` mark. The failover then targeted
 * ollama-hal with model name "gpt-5.4" (not present on Ollama) → error
 * propagated as REQUEST_TIMEOUT to the UI.
 *
 * Root cause: `failoverTimeout` is a single budget for both stream and
 * non-stream paths. For streaming completions the budget governs
 * time-to-first-byte (fast). For non-streaming completions the same budget
 * governs total generation time, which is dominated by reasoning models
 * (gpt-5.4, claude-sonnet-4-x, o-series) that legitimately take 60-300s.
 *
 * Contract pinned by this suite:
 *   - When the request is non-streaming (`request.stream !== true`), the
 *     ProviderManager honors `nonStreamFailoverTimeout` (default: 10x
 *     `failoverTimeout`, env `LLM_NONSTREAM_TIMEOUT_MS`).
 *   - When the request is streaming, the existing `failoverTimeout` budget
 *     still applies (governs time-to-generator-handle, not iteration).
 *   - Non-stream call that exceeds `failoverTimeout` but completes within
 *     `nonStreamFailoverTimeout` SUCCEEDS without triggering failover.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
  loggers: { services: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } },
}));

import { ProviderManager } from '../llm-providers/ProviderManager.js';

function makePM(opts: {
  failoverTimeout: number;
  nonStreamFailoverTimeout?: number;
}): ProviderManager {
  const fakeLogger: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const pm = new ProviderManager(fakeLogger, {
    providers: [],
    enableFailover: true,
    failoverTimeout: opts.failoverTimeout,
    nonStreamFailoverTimeout: opts.nonStreamFailoverTimeout,
    imageGenTimeout: 60000,
    enableLoadBalancing: false,
    loadBalancingStrategy: 'priority',
  } as any);
  (pm as any).initialized = true;
  return pm;
}

describe('ProviderManager.executeWithFailover — non-stream timeout SEV-1', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('non-stream completion that exceeds failoverTimeout but completes within nonStreamFailoverTimeout succeeds', async () => {
    // failoverTimeout=200ms; nonStreamFailoverTimeout=2000ms.
    // The fake provider takes 600ms — would time out under the old single-budget logic.
    const pm = makePM({ failoverTimeout: 200, nonStreamFailoverTimeout: 2000 });

    const slowProvider: any = {
      type: 'ollama',
      name: 'slow',
      createCompletion: vi.fn(async () => {
        await new Promise(r => setTimeout(r, 600));
        return { content: 'OK', usage: { totalTokens: 1 } } as any;
      }),
    };
    (pm as any).providers = new Map([['slow', slowProvider]]);
    (pm as any).providerConfigs = [{ name: 'slow', provider_type: 'ollama' }];
    (pm as any).metrics = new Map([
      ['slow', { provider: 'slow', totalRequests: 0, successfulRequests: 0, failedRequests: 0, averageLatency: 0, totalTokens: 0, totalCost: 0, uptime: 100 }],
    ]);

    const start = Date.now();
    const result = await (pm as any).executeWithFailover(slowProvider, 'slow', {
      model: 'whatever',
      messages: [{ role: 'user', content: 'hi' }],
      stream: false,
    } as any);
    const elapsed = Date.now() - start;

    expect((result as any).content).toBe('OK');
    expect(elapsed).toBeGreaterThanOrEqual(550); // ~600ms (provider's fake delay)
    expect(elapsed).toBeLessThan(900); // not 200ms (would mean timeout fired)
    expect(slowProvider.createCompletion).toHaveBeenCalledTimes(1);
  });

  it('stream completion still respects failoverTimeout (TTFB budget)', async () => {
    const pm = makePM({ failoverTimeout: 200, nonStreamFailoverTimeout: 2000 });

    // Stream provider: returns generator handle quickly (<200ms), iteration unbounded.
    const fastStreamProvider: any = {
      type: 'aif',
      name: 'fast',
      createCompletion: vi.fn(async () => {
        await new Promise(r => setTimeout(r, 50));
        return (async function* () { yield { type: 'text_delta', text: 'hi' }; })();
      }),
    };
    (pm as any).providers = new Map([['fast', fastStreamProvider]]);
    (pm as any).providerConfigs = [{ name: 'fast', provider_type: 'aif' }];
    (pm as any).metrics = new Map([
      ['fast', { provider: 'fast', totalRequests: 0, successfulRequests: 0, failedRequests: 0, averageLatency: 0, totalTokens: 0, totalCost: 0, uptime: 100 }],
    ]);

    const result = await (pm as any).executeWithFailover(fastStreamProvider, 'fast', {
      model: 'gpt-5.4',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    } as any);

    // Result should be an AsyncGenerator (still iterable).
    expect(typeof (result as any)[Symbol.asyncIterator]).toBe('function');
  });

  it('default nonStreamFailoverTimeout is 10x failoverTimeout when not provided', () => {
    const pm = makePM({ failoverTimeout: 30000 }); // no nonStreamFailoverTimeout
    const cfg = (pm as any).config;
    expect(cfg.failoverTimeout).toBe(30000);
    expect(cfg.nonStreamFailoverTimeout).toBeGreaterThanOrEqual(300000); // 10x default
  });
});
