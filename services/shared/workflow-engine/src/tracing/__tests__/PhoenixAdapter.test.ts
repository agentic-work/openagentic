/**
 * PhoenixAdapter — unit tests.
 *
 * T3: POST to Arize Phoenix using OTel-style spans.
 *
 * Covers:
 *  1. happy path — posts OTel span to {host}/v1/traces
 *  2. network error — swallowed, no throw
 *  3. PHOENIX_API_KEY auth header included
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { PhoenixAdapter } from '../adapters/PhoenixAdapter.js';
import type { LLMCallRecord } from '../LLMTracingService.js';

function makeRecord(overrides: Partial<LLMCallRecord> = {}): LLMCallRecord {
  return {
    nodeId: 'n2',
    executionId: 'exec-2',
    workflowId: 'wf-2',
    model: 'vertex-model',
    promptTokens: 8,
    completionTokens: 15,
    costUsd: 0.0002,
    latencyMs: 400,
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  delete process.env.PHOENIX_HOST;
  delete process.env.PHOENIX_API_KEY;
});

afterEach(() => {
  delete process.env.PHOENIX_HOST;
  delete process.env.PHOENIX_API_KEY;
});

describe('PhoenixAdapter', () => {
  it('posts an OTel span to {host}/v1/traces', async () => {
    process.env.PHOENIX_HOST = 'http://phoenix.local:6006';
    process.env.PHOENIX_API_KEY = 'phoenix-key';

    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({ status: 200, data: {} });

    const adapter = new PhoenixAdapter();
    await adapter.record(makeRecord());
    await adapter.flush();

    expect(postSpy).toHaveBeenCalledOnce();
    const [url, body, config] = postSpy.mock.calls[0] as any[];
    expect(url).toBe('http://phoenix.local:6006/v1/traces');
    // OTel-style body has resourceSpans
    expect(body).toHaveProperty('resourceSpans');
    // API key auth
    expect(config?.headers?.['api-key'] ?? config?.headers?.Authorization).toBeTruthy();
    // span has gen_ai attributes
    const spans = body.resourceSpans[0]?.scopeSpans?.[0]?.spans ?? [];
    expect(spans.length).toBeGreaterThan(0);
    const attrs: Record<string, any> = {};
    for (const kv of spans[0].attributes ?? []) {
      attrs[kv.key] = kv.value?.stringValue ?? kv.value?.intValue ?? kv.value?.doubleValue;
    }
    expect(attrs['gen_ai.request.model']).toBe('vertex-model');
  });

  it('swallows network errors and does not throw', async () => {
    process.env.PHOENIX_HOST = 'http://phoenix.local:6006';
    vi.spyOn(axios, 'post').mockRejectedValueOnce(new Error('timeout'));

    const adapter = new PhoenixAdapter();
    await adapter.record(makeRecord());
    await expect(adapter.flush()).resolves.toBeUndefined();
  });

  it('includes PHOENIX_API_KEY in auth header', async () => {
    process.env.PHOENIX_HOST = 'http://phoenix.local:6006';
    process.env.PHOENIX_API_KEY = 'secret-phoenix-key';

    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({ status: 200, data: {} });

    const adapter = new PhoenixAdapter();
    await adapter.record(makeRecord());
    await adapter.flush();

    const [, , config] = postSpy.mock.calls[0] as any[];
    const authHeader = config?.headers?.['api-key'] ?? config?.headers?.Authorization ?? '';
    expect(authHeader).toContain('secret-phoenix-key');
  });
});
