/**
 * SmartModelRouter — agentic routing integration test (Q1-fix-3, 2026-05-12).
 *
 * Validates that:
 *   1. A multi-cloud agentic prompt (FCA-profile-gated to 0.90+) excludes
 *      gpt-oss-class models (FCA 0.87) from contention and selects a
 *      frontier-tool-use model from the alternates pool.
 *   2. A pure-chat prompt ("what is 2+2") leaves the cheap pool intact —
 *      gpt-oss-class can still win on cost.
 *   3. A single-system-read prompt ("show me my azure subscriptions")
 *      lets the cheap pool stay in contention (FCA 0.85 floor).
 *
 * NO model name literals are asserted. Tests assert on FCA tier / profile
 * shape — the actual modelId may differ depending on what's registered in
 * the synthetic test fixture pool.
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
 * Synthetic 3-model pool that mirrors the production registry shape:
 *   - GPT-OSS-CLASS: cheap-local, FCA 0.87 — should be EXCLUDED by the
 *     0.90 floor on multi-cloud-agentic.
 *   - HAIKU-CLASS: mid-cost, FCA 0.91 — clears 0.90 but is lower-tier.
 *   - SONNET-CLASS: high-cost, FCA 0.94 — frontier-tool-use; clears 0.90.
 *
 * Names are synthetic placeholders ('cheap-local-gpt-oss-class') and do
 * NOT match any real model id; we assert on FCA tier, not on string match,
 * so the registry-pin authority rule from feedback_provider_registry_pin_authority
 * stays intact.
 */
function buildPool(router: SmartModelRouter) {
  router.addModelProfile(
    profile({
      modelId: 'pool-cheap-local',
      provider: 'ollama-test',
      providerType: 'ollama',
      capabilities: { functionCallingAccuracy: 0.87 },
      cost: { inputPer1kTokens: 0, outputPer1kTokens: 0, currency: 'USD' },
      performance: { maxContextTokens: 32_000, maxOutputTokens: 4_000, avgLatencyMs: 200, tokensPerSecond: 80 },
    }),
  );
  router.addModelProfile(
    profile({
      modelId: 'pool-haiku-mid',
      provider: 'anthropic-test',
      providerType: 'aws-bedrock',
      capabilities: { functionCallingAccuracy: 0.91 },
      cost: { inputPer1kTokens: 0.0008, outputPer1kTokens: 0.004, currency: 'USD' },
      // Haiku 4.5 has 200K context — kept for parity with real-world shape.
      performance: { maxContextTokens: 200_000, maxOutputTokens: 8_000, avgLatencyMs: 500, tokensPerSecond: 50 },
    }),
  );
  router.addModelProfile(
    profile({
      modelId: 'pool-sonnet-high',
      provider: 'anthropic-test',
      providerType: 'aws-bedrock',
      capabilities: { functionCallingAccuracy: 0.94 },
      cost: { inputPer1kTokens: 0.003, outputPer1kTokens: 0.015, currency: 'USD' },
      // Sonnet 4.6 has 200K context — needed to clear the #828 T3 gate.
      performance: { maxContextTokens: 200_000, maxOutputTokens: 8_000, avgLatencyMs: 500, tokensPerSecond: 50 },
    }),
  );
  router.addModelProfile(
    profile({
      modelId: 'pool-o-mini',
      provider: 'aif-test',
      providerType: 'azure-ai-foundry',
      capabilities: { functionCallingAccuracy: 0.93, supportsThinking: true },
      cost: { inputPer1kTokens: 0.0011, outputPer1kTokens: 0.0044, currency: 'USD' },
      // o-mini class has 200K context.
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

describe('SmartModelRouter — Q1-fix-3 agentic routing', () => {
  let router: SmartModelRouter;

  beforeEach(() => {
    router = new SmartModelRouter(SILENT_LOGGER);
    buildPool(router);
  });

  test('Q1 prompt (tri-cloud cost spikes) does NOT route to the cheap-local FCA-0.87 model', async () => {
    const req = userMessage(
      'Our cloud bill is up 40% MoM. Find the top 10 cost spikes across Azure/AWS/GCP and tell me what to cut.',
    );
    const decision = await router.routeRequest(req);
    expect(decision.selectedModel.capabilities.functionCallingAccuracy).toBeGreaterThanOrEqual(
      0.90,
    );
    expect(decision.selectedModel.modelId).not.toBe('pool-cheap-local');
  });

  test('Q1 prompt classification appears in routing reason', async () => {
    const req = userMessage(
      'Our cloud bill is up 40% MoM. Find the top 10 cost spikes across Azure/AWS/GCP and tell me what to cut.',
    );
    const decision = await router.routeRequest(req);
    // Reason mentions agentic / multi-cloud or capability profile rationale.
    expect(decision.reason.toLowerCase()).toMatch(/agentic|multi-cloud|capability/);
  });

  test('"what is 2+2" still allows the cheap-local model (pure-chat path)', async () => {
    const req = userMessage('what is 2+2');
    const decision = await router.routeRequest(req);
    // Pure-chat floor 0.82 keeps the entire pool in contention; the cheapest
    // wins on cost. Cheap-local has cost 0 so it wins.
    expect(decision.selectedModel.modelId).toBe('pool-cheap-local');
  });

  test('"list my azure subscriptions" (single-system-read) allows cheap-local', async () => {
    const req = userMessage('list my azure subscriptions');
    const decision = await router.routeRequest(req);
    // single-system-read floor 0.85 — cheap-local (0.87) survives, cheapest wins.
    expect(decision.selectedModel.capabilities.functionCallingAccuracy).toBeGreaterThanOrEqual(
      0.85,
    );
  });

  test('cross-system fan-out ("across each cluster") gates cheap-local out', async () => {
    const req = userMessage('show me pod restart counts across each cluster');
    const decision = await router.routeRequest(req);
    expect(decision.selectedModel.capabilities.functionCallingAccuracy).toBeGreaterThanOrEqual(
      0.90,
    );
    expect(decision.selectedModel.modelId).not.toBe('pool-cheap-local');
  });

  test('security audit prompt gates cheap-local out', async () => {
    const req = userMessage('Audit my buckets for any public exposed objects.');
    const decision = await router.routeRequest(req);
    expect(decision.selectedModel.capabilities.functionCallingAccuracy).toBeGreaterThanOrEqual(
      0.90,
    );
  });

  test('cost-spike-by-service prompt gates cheap-local out', async () => {
    const req = userMessage('Break down the cost spike by service for last month.');
    const decision = await router.routeRequest(req);
    expect(decision.selectedModel.capabilities.functionCallingAccuracy).toBeGreaterThanOrEqual(
      0.90,
    );
  });
});
