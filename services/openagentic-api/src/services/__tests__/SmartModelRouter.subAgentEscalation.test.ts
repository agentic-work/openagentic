/**
 * SmartModelRouter — sub-agent dispatch escalation test (T1 follow-up).
 *
 * Sister test to SmartModelRouter.agenticRouting.test.ts. Pins the routing
 * behaviour for the new `sub_agent_dispatch` task type:
 *
 *   - Explicit sub-agent / Task-tool dispatch prompts MUST select a
 *     model that passes the modelTaskGate (FCA ≥ 0.90, context ≥ 64k).
 *     gpt-oss-class (FCA 0.87) and any "low" / "free" cost-tier model
 *     MUST NOT win the routing decision.
 *
 *   - The router's reason field surfaces the capability-profile gate
 *     so operators can audit why the cheap pool was excluded.
 *
 * No model-name literals are asserted — assertions live on FCA tier /
 * cost-tier / context window. Per feedback_provider_registry_pin_authority.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import pino from 'pino';
import { SmartModelRouter, type ModelProfile } from '../SmartModelRouter.js';
import type { CompletionRequest } from '../llm-providers/ILLMProvider.js';

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

function buildPool(router: SmartModelRouter) {
  // gpt-oss-class — cheap local, FCA 0.87, small-ish context. MUST be
  // excluded by the sub_agent_dispatch floor.
  router.addModelProfile(
    profile({
      modelId: 'pool-cheap-local',
      provider: 'ollama-test',
      providerType: 'ollama',
      capabilities: { functionCallingAccuracy: 0.87 },
      cost: { inputPer1kTokens: 0, outputPer1kTokens: 0, currency: 'USD' },
      performance: {
        maxContextTokens: 32_000,
        maxOutputTokens: 4_000,
        avgLatencyMs: 200,
        tokensPerSecond: 80,
      },
    }),
  );
  // Haiku-class — clears FCA 0.90 AND context 64k. Eligible.
  router.addModelProfile(
    profile({
      modelId: 'pool-haiku-mid',
      provider: 'anthropic-test',
      providerType: 'aws-bedrock',
      capabilities: { functionCallingAccuracy: 0.91 },
      cost: { inputPer1kTokens: 0.0008, outputPer1kTokens: 0.004, currency: 'USD' },
    }),
  );
  // Sonnet-class — frontier tool-use. Eligible.
  router.addModelProfile(
    profile({
      modelId: 'pool-sonnet-high',
      provider: 'anthropic-test',
      providerType: 'aws-bedrock',
      capabilities: { functionCallingAccuracy: 0.94 },
      cost: { inputPer1kTokens: 0.003, outputPer1kTokens: 0.015, currency: 'USD' },
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

describe('SmartModelRouter — sub_agent_dispatch escalation', () => {
  let router: SmartModelRouter;

  beforeEach(() => {
    router = new SmartModelRouter(SILENT_LOGGER);
    buildPool(router);
  });

  test('"Use the Task tool to dispatch a security audit agent" does NOT select cheap-local', async () => {
    const req = userMessage('Use the Task tool to dispatch a security audit agent.');
    const decision = await router.routeRequest(req);
    expect(decision.selectedModel.modelId).not.toBe('pool-cheap-local');
    expect(decision.selectedModel.capabilities.functionCallingAccuracy).toBeGreaterThanOrEqual(
      0.90,
    );
  });

  test('"Spawn a cloud_operations sub-agent to audit RBAC" gates cheap-local out', async () => {
    const req = userMessage('Spawn a cloud_operations sub-agent to audit RBAC.');
    const decision = await router.routeRequest(req);
    expect(decision.selectedModel.modelId).not.toBe('pool-cheap-local');
    expect(decision.selectedModel.capabilities.functionCallingAccuracy).toBeGreaterThanOrEqual(
      0.90,
    );
  });

  test('"delegate this to a research agent" gates cheap-local out', async () => {
    const req = userMessage('delegate this to a research agent');
    const decision = await router.routeRequest(req);
    expect(decision.selectedModel.modelId).not.toBe('pool-cheap-local');
  });

  test('Selected sub_agent_dispatch model meets context ≥ 64k (modelTaskGate floor)', async () => {
    const req = userMessage('Have a sub-agent run the EKS upgrade dry-run for me.');
    const decision = await router.routeRequest(req);
    expect(decision.selectedModel.performance.maxContextTokens).toBeGreaterThanOrEqual(64_000);
  });

  test('Routing reason surfaces sub_agent_dispatch capability profile', async () => {
    const req = userMessage('dispatch a sub agent to triage incident-42');
    const decision = await router.routeRequest(req);
    expect(decision.reason.toLowerCase()).toMatch(
      /sub_agent_dispatch|sub-agent|task.*capab|capability/,
    );
  });
});
