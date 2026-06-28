/**
 * SmartModelRouter — cost-audit T3 floor integration (2026-05-17).
 *
 * Validates that cost-audit task type forces FCA >= 0.93 (T3 frontier),
 * excluding T2 models (FCA 0.90-0.92) from contention. Mirrors the
 * agenticRouting test pattern but with a tighter floor.
 *
 * NO model name literals are asserted — tests assert on FCA tier shape.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import pino from 'pino';
import { SmartModelRouter, type ModelProfile } from '../../SmartModelRouter.js';
import type { CompletionRequest } from '../../llm-providers/ILLMProvider.js';

const SILENT_LOGGER = pino({ level: 'silent' });

function profile(overrides: Partial<ModelProfile> & Pick<ModelProfile, 'modelId'>): ModelProfile {
  return {
    modelId: overrides.modelId,
    provider: overrides.provider ?? 'test-provider',
    providerType: overrides.providerType ?? 'azure-openai',
    deployment: overrides.deployment,
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
      maxContextTokens: 128_000,
      maxOutputTokens: 8_000,
      avgLatencyMs: 500,
      tokensPerSecond: 50,
      ...(overrides.performance ?? {}),
    },
    cost: {
      inputPer1kTokens: 0.003,
      outputPer1kTokens: 0.015,
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

/**
 * Pool with three tiers so we can prove the T3 floor:
 *   - T1 cheap-local:  FCA 0.87 (excluded by every agentic floor)
 *   - T2 mid:          FCA 0.91 (excluded by T3 / cost-audit, included by T2)
 *   - T3 frontier:     FCA 0.94 (clears T3 floor)
 *   - T3 high-cost:    FCA 0.96 (clears T3 floor)
 *
 * Synthetic placeholder model IDs — no real model names asserted.
 */
function buildPool(router: SmartModelRouter) {
  router.addModelProfile(
    profile({
      modelId: 'pool-t1-cheap-local',
      provider: 'ollama-test',
      providerType: 'ollama',
      capabilities: { functionCallingAccuracy: 0.87 },
      cost: { inputPer1kTokens: 0, outputPer1kTokens: 0, currency: 'USD' },
      performance: { maxContextTokens: 32_000, maxOutputTokens: 4_000, avgLatencyMs: 200, tokensPerSecond: 80 },
    }),
  );
  router.addModelProfile(
    profile({
      modelId: 'pool-t2-mid',
      provider: 'anthropic-test',
      providerType: 'aws-bedrock',
      capabilities: { functionCallingAccuracy: 0.91 },
      cost: { inputPer1kTokens: 0.0008, outputPer1kTokens: 0.004, currency: 'USD' },
      performance: { maxContextTokens: 200_000, maxOutputTokens: 8_000, avgLatencyMs: 500, tokensPerSecond: 50 },
    }),
  );
  router.addModelProfile(
    profile({
      modelId: 'pool-t3-frontier',
      provider: 'anthropic-test',
      providerType: 'aws-bedrock',
      capabilities: { functionCallingAccuracy: 0.94 },
      cost: { inputPer1kTokens: 0.003, outputPer1kTokens: 0.015, currency: 'USD' },
      performance: { maxContextTokens: 200_000, maxOutputTokens: 8_000, avgLatencyMs: 500, tokensPerSecond: 50 },
    }),
  );
  router.addModelProfile(
    profile({
      modelId: 'pool-t3-frontier-high',
      provider: 'aif-test',
      providerType: 'azure-ai-foundry',
      capabilities: { functionCallingAccuracy: 0.96, supportsThinking: true },
      cost: { inputPer1kTokens: 0.005, outputPer1kTokens: 0.02, currency: 'USD' },
      performance: { maxContextTokens: 200_000, maxOutputTokens: 8_000, avgLatencyMs: 500, tokensPerSecond: 50 },
    }),
  );
}

function userMessage(content: string): CompletionRequest {
  return {
    model: 'auto',
    messages: [{ role: 'user', content }],
    stream: false,
  };
}

describe('SmartModelRouter — cost-audit T3 floor (2026-05-17)', () => {
  let router: SmartModelRouter;

  beforeEach(() => {
    router = new SmartModelRouter(SILENT_LOGGER);
    buildPool(router);
  });

  test('tri-cloud cost-spike prompt (cost-audit) excludes T1 (FCA 0.87)', async () => {
    const req = userMessage(
      'Our cloud bill is up 40% MoM. Find the top 10 cost spikes across Azure/AWS/GCP and tell me what to cut.',
    );
    const decision = await router.routeRequest(req);
    expect(decision.selectedModel.modelId).not.toBe('pool-t1-cheap-local');
    expect(decision.selectedModel.capabilities.functionCallingAccuracy).toBeGreaterThanOrEqual(0.93);
  });

  test('tri-cloud cost-spike prompt (cost-audit) excludes T2 (FCA 0.91)', async () => {
    const req = userMessage(
      'Our cloud bill is up 40% MoM. Find the top 10 cost spikes across Azure/AWS/GCP and tell me what to cut.',
    );
    const decision = await router.routeRequest(req);
    // T2 model at 0.91 must be filtered out by the T3 floor.
    expect(decision.selectedModel.modelId).not.toBe('pool-t2-mid');
    expect(decision.selectedModel.capabilities.functionCallingAccuracy).toBeGreaterThanOrEqual(0.93);
  });

  test('"finops audit across Azure and AWS" picks T3-grade model', async () => {
    const req = userMessage(
      'Run a finops audit across Azure and AWS — where can we cut spend?',
    );
    const decision = await router.routeRequest(req);
    expect(decision.selectedModel.capabilities.functionCallingAccuracy).toBeGreaterThanOrEqual(0.93);
  });

  test('cost-audit decision reason mentions cost-audit / capability profile', async () => {
    const req = userMessage(
      'Reconcile our cross-cloud spend across Azure, AWS, and GCP for last quarter.',
    );
    const decision = await router.routeRequest(req);
    expect(decision.reason.toLowerCase()).toMatch(/cost-audit|capability|frontier/);
  });
});
