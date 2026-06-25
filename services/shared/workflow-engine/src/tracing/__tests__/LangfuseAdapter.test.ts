/**
 * LangfuseAdapter — unit tests.
 *
 * T2: POST to Langfuse Cloud or self-hosted; Basic auth; batch semantics.
 *
 * Covers:
 *  1. happy path — posts batch on flush
 *  2. network error — swallowed (fail-open), no throw
 *  3. batch window — records accumulate, flushed correctly
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { LangfuseAdapter } from '../adapters/LangfuseAdapter.js';
import type { LLMCallRecord } from '../LLMTracingService.js';

function makeRecord(overrides: Partial<LLMCallRecord> = {}): LLMCallRecord {
  return {
    nodeId: 'n1',
    executionId: 'exec-1',
    workflowId: 'wf-1',
    model: 'router-pick',
    promptTokens: 5,
    completionTokens: 10,
    costUsd: 0.0001,
    latencyMs: 200,
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  delete process.env.LANGFUSE_PUBLIC_KEY;
  delete process.env.LANGFUSE_SECRET_KEY;
  delete process.env.LANGFUSE_HOST;
});

afterEach(() => {
  delete process.env.LANGFUSE_PUBLIC_KEY;
  delete process.env.LANGFUSE_SECRET_KEY;
  delete process.env.LANGFUSE_HOST;
});

describe('LangfuseAdapter', () => {
  it('flushes a batch POST to the default Langfuse Cloud endpoint', async () => {
    process.env.LANGFUSE_PUBLIC_KEY = 'pk-test';
    process.env.LANGFUSE_SECRET_KEY = 'sk-test';

    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({ status: 200, data: {} });

    const adapter = new LangfuseAdapter();
    const rec = makeRecord();
    await adapter.record(rec);
    await adapter.flush();

    expect(postSpy).toHaveBeenCalledOnce();
    const [url, body, config] = postSpy.mock.calls[0] as any[];
    expect(url).toContain('us.cloud.langfuse.com');
    expect(url).toContain('/api/public/ingestion');
    // Basic auth — base64(pk:sk)
    const expectedToken = Buffer.from('pk-test:sk-test').toString('base64');
    expect(config?.headers?.Authorization).toBe(`Basic ${expectedToken}`);
    // Body has batch of events
    expect(Array.isArray(body?.batch)).toBe(true);
    expect(body.batch.length).toBe(1);
    const event = body.batch[0];
    expect(event.type).toBe('generation-create');
    expect(event.body.model).toBe('router-pick');
  });

  it('uses LANGFUSE_HOST for self-hosted deployments', async () => {
    process.env.LANGFUSE_PUBLIC_KEY = 'pk-self';
    process.env.LANGFUSE_SECRET_KEY = 'sk-self';
    process.env.LANGFUSE_HOST = 'https://langfuse.internal';

    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({ status: 200, data: {} });

    const adapter = new LangfuseAdapter();
    await adapter.record(makeRecord());
    await adapter.flush();

    expect(postSpy).toHaveBeenCalledOnce();
    const [url] = postSpy.mock.calls[0] as any[];
    expect(url).toContain('langfuse.internal');
  });

  it('swallows network errors and does not throw', async () => {
    process.env.LANGFUSE_PUBLIC_KEY = 'pk-test';
    process.env.LANGFUSE_SECRET_KEY = 'sk-test';

    vi.spyOn(axios, 'post').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const adapter = new LangfuseAdapter();
    await adapter.record(makeRecord());
    // flush must not throw
    await expect(adapter.flush()).resolves.toBeUndefined();
  });
});
