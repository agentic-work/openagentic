/**
 * LLMTracingService — unit tests.
 *
 * T1: recordCall fan-out to configured adapter
 * T5: provider selection via OBSERVABILITY_PROVIDER env
 * T6: fail-open — adapter errors never propagate
 * T8: PII truncation — prompt/completion stripped unless OBSERVABILITY_INCLUDE_CONTENT=true
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LLMTracingService } from '../LLMTracingService.js';
import type { LLMCallRecord, TracingAdapter } from '../LLMTracingService.js';

function makeRecord(overrides: Partial<LLMCallRecord> = {}): LLMCallRecord {
  return {
    nodeId: 'node-1',
    executionId: 'exec-abc',
    workflowId: 'wf-xyz',
    model: 'router-pick',
    promptTokens: 10,
    completionTokens: 20,
    costUsd: 0.00015,
    latencyMs: 350,
    ...overrides,
  };
}

function makeMockAdapter(): TracingAdapter {
  return {
    record: vi.fn().mockResolvedValue(undefined),
    flush: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  delete process.env.OBSERVABILITY_PROVIDER;
  delete process.env.OBSERVABILITY_INCLUDE_CONTENT;
});

afterEach(() => {
  delete process.env.OBSERVABILITY_PROVIDER;
  delete process.env.OBSERVABILITY_INCLUDE_CONTENT;
});

describe('LLMTracingService', () => {
  // T5: default = none (no-op)
  it('defaults to none provider and does not call any adapter', async () => {
    const svc = new LLMTracingService();
    // Should not throw or call anything
    await svc.recordCall(makeRecord());
  });

  // T1: fan-out to injected adapter
  it('calls adapter.record with the full record', async () => {
    const adapter = makeMockAdapter();
    const svc = new LLMTracingService({ adapter });
    const rec = makeRecord({ tenantId: 'tenant-1' });
    await svc.recordCall(rec);
    expect(adapter.record).toHaveBeenCalledOnce();
    const called = (adapter.record as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(called.nodeId).toBe('node-1');
    expect(called.executionId).toBe('exec-abc');
    expect(called.workflowId).toBe('wf-xyz');
    expect(called.model).toBe('router-pick');
    expect(called.promptTokens).toBe(10);
    expect(called.completionTokens).toBe(20);
    expect(called.costUsd).toBe(0.00015);
    expect(called.latencyMs).toBe(350);
    expect(called.tenantId).toBe('tenant-1');
  });

  // T6: fail-open — adapter error must not propagate
  it('swallows adapter errors and does not throw', async () => {
    const adapter: TracingAdapter = {
      record: vi.fn().mockRejectedValue(new Error('network timeout')),
      flush: vi.fn().mockResolvedValue(undefined),
    };
    const svc = new LLMTracingService({ adapter });
    // Must not throw
    await expect(svc.recordCall(makeRecord())).resolves.toBeUndefined();
  });

  // T8: PII truncation — off by default
  it('truncates prompt and completion to 200 chars and sets truncated flags when OBSERVABILITY_INCLUDE_CONTENT is not set', async () => {
    const adapter = makeMockAdapter();
    const svc = new LLMTracingService({ adapter });
    const longPrompt = 'A'.repeat(500);
    const longCompletion = 'B'.repeat(500);
    await svc.recordCall(makeRecord({ prompt: longPrompt, completion: longCompletion }));
    const called = (adapter.record as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(called.prompt).toHaveLength(200);
    expect(called.promptTruncated).toBe(true);
    expect(called.completion).toHaveLength(200);
    expect(called.completionTruncated).toBe(true);
  });

  // T8: full content when OBSERVABILITY_INCLUDE_CONTENT=true
  it('passes full prompt and completion when OBSERVABILITY_INCLUDE_CONTENT=true', async () => {
    process.env.OBSERVABILITY_INCLUDE_CONTENT = 'true';
    const adapter = makeMockAdapter();
    const svc = new LLMTracingService({ adapter });
    const longPrompt = 'A'.repeat(500);
    const longCompletion = 'B'.repeat(500);
    await svc.recordCall(makeRecord({ prompt: longPrompt, completion: longCompletion }));
    const called = (adapter.record as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(called.prompt).toHaveLength(500);
    expect(called.promptTruncated).toBeUndefined();
    expect(called.completion).toHaveLength(500);
    expect(called.completionTruncated).toBeUndefined();
  });

  // T5: service reads OBSERVABILITY_PROVIDER at construction time
  it('selects none adapter when OBSERVABILITY_PROVIDER=none', async () => {
    process.env.OBSERVABILITY_PROVIDER = 'none';
    const svc = new LLMTracingService();
    // Should not throw — truly a no-op
    await svc.recordCall(makeRecord());
  });

  // T1: error field is forwarded correctly
  it('forwards error field to the adapter', async () => {
    const adapter = makeMockAdapter();
    const svc = new LLMTracingService({ adapter });
    const err = 'API timeout';
    await svc.recordCall(makeRecord({ error: err }));
    const called = (adapter.record as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(called.error).toBe(err);
  });
});
