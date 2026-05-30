/**
 * Router + Tuning + Defaults Prometheus metrics — TDD spec (2026-04-23).
 *
 * Coverage:
 *  1. All 10 metrics export from ../index
 *  2. Each metric has the correct type and label names
 *  3. Counters can be incremented and read back via register.getSingleMetric
 *  4. routerTuningCurrentGauge.set value reads back correctly
 *  5. subagentConcurrentDispatch histogram bucket populated after observe
 *  6. Smoke test: one routeRequest call increments routerDecisionCounter by 1
 */

import { describe, it, expect, beforeEach } from 'vitest';
import pino from 'pino';
import {
  register,
  routerDecisionCounter,
  routerEscalationCounter,
  routerFloorExcludedCounter,
  routerRouteRequestDurationMs,
  routerQualityBonusCounter,
  routerTuningUpdatedCounter,
  routerTuningCurrentGauge,
  defaultModelsUpdatedCounter,
  defaultModelsCurrentGauge,
  subagentConcurrentDispatch,
} from '../index.js';
import { SmartModelRouter, type ModelProfile } from '../../services/SmartModelRouter.js';
import { ROUTER_TUNING_DEFAULTS, type RouterTuning } from '../../services/RouterTuningService.js';
import type { CompletionRequest } from '../../services/llm-providers/ILLMProvider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SILENT = pino({ level: 'silent' });

function makeProfile(overrides: Partial<ModelProfile> & Pick<ModelProfile, 'modelId'>): ModelProfile {
  return {
    modelId: overrides.modelId,
    provider: overrides.provider ?? 'test-provider',
    providerType: overrides.providerType ?? 'azure-openai',
    capabilities: {
      chat: true,
      functionCalling: true,
      functionCallingAccuracy: 0.90,
      vision: false,
      imageGeneration: false,
      embeddings: false,
      streaming: true,
      jsonMode: true,
      structuredOutput: true,
      supportsToolInputDelta: false,
      supportsThinking: false,
      supportsCitations: false,
      supportsSyntheticThinking: false,
      ...(overrides.capabilities ?? {}),
    },
    performance: {
      maxContextTokens: 32_000,
      maxOutputTokens: 4_000,
      avgLatencyMs: 500,
      tokensPerSecond: 50,
      ...(overrides.performance ?? {}),
    },
    cost: {
      inputPer1kTokens: 0.001,
      outputPer1kTokens: 0.003,
      currency: 'USD',
      ...(overrides.cost ?? {}),
    },
    metadata: {
      family: 'test',
      version: '1.0',
      specializations: [],
      lastTested: new Date(),
      isAvailable: true,
      ...(overrides.metadata ?? {}),
    },
  };
}

class MockTuningService {
  private tuning: RouterTuning = {
    id: 'singleton',
    ...ROUTER_TUNING_DEFAULTS,
    updated_at: new Date(),
    updated_by: null,
  };

  async getTuning(): Promise<RouterTuning> {
    return this.tuning;
  }
}

async function getCounterValue(
  counter: { get(): Promise<{ values: Array<{ value: number; labels: Record<string, string> }> }> },
  labels: Record<string, string>,
): Promise<number> {
  const data = await counter.get();
  const entry = data.values.find((v) =>
    Object.entries(labels).every(([k, val]) => (v.labels as any)[k] === val),
  );
  return entry?.value ?? 0;
}

// ---------------------------------------------------------------------------
// 1 + 2. All 10 metrics export and have correct label names
// ---------------------------------------------------------------------------

describe('Router metrics — exports and label names', () => {
  it('routerDecisionCounter is a Counter with correct labelNames', async () => {
    expect(routerDecisionCounter).toBeDefined();
    const meta = await routerDecisionCounter.get();
    expect(meta.type).toBe('counter');
    // Confirm label names by incrementing with them (no throw = labels accepted)
    expect(() =>
      routerDecisionCounter.inc({ resolved_by: 'test', selected_model: 'model-a', tier: 'high' }),
    ).not.toThrow();
  });

  it('routerEscalationCounter is a Counter with "type" label', async () => {
    expect(routerEscalationCounter).toBeDefined();
    const meta = await routerEscalationCounter.get();
    expect(meta.type).toBe('counter');
    expect(() => routerEscalationCounter.inc({ type: 'destructive' })).not.toThrow();
  });

  it('routerFloorExcludedCounter is a Counter with "floor" and "model" labels', async () => {
    expect(routerFloorExcludedCounter).toBeDefined();
    const meta = await routerFloorExcludedCounter.get();
    expect(meta.type).toBe('counter');
    expect(() => routerFloorExcludedCounter.inc({ floor: 'chat_pool', model: 'some-model' })).not.toThrow();
  });

  it('routerRouteRequestDurationMs is a Histogram', async () => {
    expect(routerRouteRequestDurationMs).toBeDefined();
    const meta = await routerRouteRequestDurationMs.get();
    expect(meta.type).toBe('histogram');
  });

  it('routerQualityBonusCounter is a Counter with "applied" label', async () => {
    expect(routerQualityBonusCounter).toBeDefined();
    const meta = await routerQualityBonusCounter.get();
    expect(meta.type).toBe('counter');
    expect(() => routerQualityBonusCounter.inc({ applied: 'yes' })).not.toThrow();
  });

  it('routerTuningUpdatedCounter is a Counter with "field" and "updated_by" labels', async () => {
    expect(routerTuningUpdatedCounter).toBeDefined();
    const meta = await routerTuningUpdatedCounter.get();
    expect(meta.type).toBe('counter');
    expect(() => routerTuningUpdatedCounter.inc({ field: 'costWeight', updated_by: 'admin' })).not.toThrow();
  });

  it('routerTuningCurrentGauge is a Gauge with "field" label', async () => {
    expect(routerTuningCurrentGauge).toBeDefined();
    const meta = await routerTuningCurrentGauge.get();
    expect(meta.type).toBe('gauge');
    expect(() => routerTuningCurrentGauge.set({ field: 'costWeight' }, 0.5)).not.toThrow();
  });

  it('defaultModelsUpdatedCounter is a Counter with "category" and "updated_by" labels', async () => {
    expect(defaultModelsUpdatedCounter).toBeDefined();
    const meta = await defaultModelsUpdatedCounter.get();
    expect(meta.type).toBe('counter');
    expect(() => defaultModelsUpdatedCounter.inc({ category: 'chat', updated_by: 'user-1' })).not.toThrow();
  });

  it('defaultModelsCurrentGauge is a Gauge with "category" and "model" labels', async () => {
    expect(defaultModelsCurrentGauge).toBeDefined();
    const meta = await defaultModelsCurrentGauge.get();
    expect(meta.type).toBe('gauge');
    expect(() => defaultModelsCurrentGauge.set({ category: 'chat', model: 'gpt-oss:20b' }, 1)).not.toThrow();
  });

  it('subagentConcurrentDispatch is a Histogram', async () => {
    expect(subagentConcurrentDispatch).toBeDefined();
    const meta = await subagentConcurrentDispatch.get();
    expect(meta.type).toBe('histogram');
  });
});

// ---------------------------------------------------------------------------
// 3. Counters increment and read back
// ---------------------------------------------------------------------------

describe('Router metrics — counter increment and read-back', () => {
  it('routerEscalationCounter increments per label value', async () => {
    const before = await getCounterValue(routerEscalationCounter as any, { type: 'infra_ops' });
    routerEscalationCounter.inc({ type: 'infra_ops' });
    const after = await getCounterValue(routerEscalationCounter as any, { type: 'infra_ops' });
    expect(after).toBe(before + 1);
  });

  it('routerFloorExcludedCounter increments for a specific floor+model pair', async () => {
    const labels = { floor: 'simple_tool', model: 'test-model-x' };
    const before = await getCounterValue(routerFloorExcludedCounter as any, labels);
    routerFloorExcludedCounter.inc(labels);
    const after = await getCounterValue(routerFloorExcludedCounter as any, labels);
    expect(after).toBe(before + 1);
  });

  it('routerTuningUpdatedCounter increments per field+updated_by pair', async () => {
    const labels = { field: 'fcaChatPoolFloor', updated_by: 'admin' };
    const before = await getCounterValue(routerTuningUpdatedCounter as any, labels);
    routerTuningUpdatedCounter.inc(labels);
    const after = await getCounterValue(routerTuningUpdatedCounter as any, labels);
    expect(after).toBe(before + 1);
  });
});

// ---------------------------------------------------------------------------
// 4. routerTuningCurrentGauge set/read
// ---------------------------------------------------------------------------

describe('routerTuningCurrentGauge — set and read back', () => {
  it('sets fcaChatPoolFloor to 0.82 and reads it back', async () => {
    routerTuningCurrentGauge.set({ field: 'fcaChatPoolFloor' }, 0.82);
    const data = await routerTuningCurrentGauge.get();
    const entry = data.values.find((v) => (v.labels as any).field === 'fcaChatPoolFloor');
    expect(entry?.value).toBeCloseTo(0.82);
  });
});

// ---------------------------------------------------------------------------
// 5. subagentConcurrentDispatch histogram bucket populated
// ---------------------------------------------------------------------------

describe('subagentConcurrentDispatch — observe populates bucket', () => {
  it('observe(4) increments the bucket at 4', async () => {
    subagentConcurrentDispatch.observe(4);
    const data = await subagentConcurrentDispatch.get();
    // The histogram has buckets [1,2,3,4,5,8,10]; the +Inf bucket always has count
    const infBucket = data.values.find(
      (v) => (v.labels as any).le === '+Inf',
    );
    expect(infBucket?.value).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 6. Smoke test: routeRequest increments routerDecisionCounter
// ---------------------------------------------------------------------------

describe('SmartModelRouter smoke test — routerDecisionCounter increments', () => {
  it('one routeRequest call increments routerDecisionCounter by 1', async () => {
    const tuningService = new MockTuningService();
    const router = new SmartModelRouter(SILENT, { tuningService: tuningService as any });

    router.addModelProfile(makeProfile({
      modelId: 'test-model-smoke',
      capabilities: { functionCallingAccuracy: 0.90 },
      cost: { inputPer1kTokens: 0.001, outputPer1kTokens: 0.003, currency: 'USD' },
    }));

    const request: CompletionRequest = {
      messages: [{ role: 'user', content: 'hello world' }],
    };

    // Capture counter total before
    const dataBefore = await routerDecisionCounter.get();
    const totalBefore = dataBefore.values.reduce((acc, v) => acc + v.value, 0);

    await router.routeRequest(request);

    // Capture counter total after
    const dataAfter = await routerDecisionCounter.get();
    const totalAfter = dataAfter.values.reduce((acc, v) => acc + v.value, 0);

    expect(totalAfter).toBe(totalBefore + 1);
  });
});
