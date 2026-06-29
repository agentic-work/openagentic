/**
 * fetchWithRetry — handles 429 Too Many Requests from upstream LLM providers
 * (specifically AIF/Azure OpenAI which throttles by deployment TPM and returns
 * a Retry-After header).
 *
 * Today AzureAIFoundryProvider uses raw fetch() at lines ~1699 and ~2611 with
 * NO retry — a single 429 propagates straight to ProviderManager and surfaces
 * as "All providers failed" because there's only one gpt-5.4 deployment to
 * fail over to. This helper is the missing retry layer.
 *
 * Contract:
 *   - On 429: read `Retry-After` header (seconds), wait that long (clamped
 *     [1, 30]), retry. Default 3 retries with exponential backoff if no
 *     Retry-After header.
 *   - On 5xx (except 501/505): retry like 429.
 *   - On 4xx other than 429: throw immediately (do not retry).
 *   - On network error: retry like 429.
 *   - After max retries exhausted: throw with the last response/error.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { fetchWithRetry } from '../fetchWithRetry.js';

describe('fetchWithRetry', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  test('passes through a 200 response unchanged on first try', async () => {
    fetchMock.mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const r = await fetchWithRetry('https://x', {});
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('retries on 429 honoring Retry-After header (seconds)', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('throttled', { status: 429, headers: { 'retry-after': '1' } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const start = Date.now();
    const r = await fetchWithRetry('https://x', {}, { maxRetries: 3, logger: undefined });
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(Date.now() - start).toBeGreaterThanOrEqual(900);
  });

  test('retries up to maxRetries times then throws on persistent 429', async () => {
    fetchMock.mockResolvedValue(new Response('throttled', { status: 429, headers: { 'retry-after': '0' } }));
    await expect(fetchWithRetry('https://x', {}, { maxRetries: 2 })).rejects.toThrow(/429/);
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  test('does NOT retry on 400/401/403/404 (client errors except 429)', async () => {
    for (const status of [400, 401, 403, 404]) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValueOnce(new Response('nope', { status }));
      const r = await fetchWithRetry('https://x', {}, { maxRetries: 5 });
      expect(r.status).toBe(status);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  test('retries on 500/502/503/504 server errors', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('boom', { status: 503 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const r = await fetchWithRetry('https://x', {}, { maxRetries: 3 });
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('clamps Retry-After to [1, 30] seconds (no abusive waits)', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('throttled', { status: 429, headers: { 'retry-after': '500' } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const start = Date.now();
    const r = await fetchWithRetry('https://x', {}, { maxRetries: 3 });
    expect(r.status).toBe(200);
    // Must have waited ≤ ~30s (clamped). 33.5s upper bound covers test
    // framework overhead + setTimeout drift.
    expect(Date.now() - start).toBeLessThan(33_500);
  }, 35_000);

  test('falls back to exponential backoff when no Retry-After header is present', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('throttled', { status: 429 })) // no header
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const start = Date.now();
    const r = await fetchWithRetry('https://x', {}, { maxRetries: 3, baseBackoffMs: 200 });
    expect(r.status).toBe(200);
    // Equal-jitter contract: attempt 0 sleeps in [baseBackoffMs/2, baseBackoffMs).
    // With baseBackoffMs=200 → wait ∈ [100, 200). Check ≥ 100ms (halfway floor).
    expect(Date.now() - start).toBeGreaterThanOrEqual(95); // 95 = 100 minus small drift slack
    expect(Date.now() - start).toBeLessThan(300);
  });

  test('retries on network error (TypeError thrown by fetch)', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('fetch failed: ECONNRESET'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const r = await fetchWithRetry('https://x', {}, { maxRetries: 3, baseBackoffMs: 50 });
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('default maxRetries is 3', async () => {
    fetchMock.mockResolvedValue(new Response('throttled', { status: 429, headers: { 'retry-after': '0' } }));
    await expect(fetchWithRetry('https://x', {})).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(4); // initial + 3 retries
  });
});
