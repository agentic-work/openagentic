/**
 * SmartModelRouter — T3 capability-gate (#828, 2026-05-20).
 *
 * RED-PHASE bug repro:
 *   Live 2026-05-20 14:08 UTC: enterprise AFD/AppGW prompt with explicit
 *   "pick the most capable model" routed to a Haiku-class model (FCA
 *   ~0.91 / 200K context) instead of a Sonnet/Opus-class model (FCA
 *   ≥0.93 / 200K context). Auto-Routing was silently downgrading on a
 *   prompt where the user explicitly asked for premium reasoning.
 *
 * GREEN contract pinned here (STRUCTURAL — no model-name literals):
 *   1. When the prompt complexity hits T3 (architecture-design /
 *      cost-audit, FCA-floor 0.93) AND a Sonnet/Opus-tier registry row
 *      (FCA ≥0.93 AND context ≥200K) is available, the router MUST
 *      pick the T3 candidate.
 *   2. When the prompt contains an explicit "most capable" / "premium
 *      model" / "enterprise" signal phrase (anchored regex), the T3
 *      gate fires even on lower-score prompts, and a Haiku-class
 *      candidate (200K context but FCA <0.93) is excluded.
 *   3. When no candidate clears the FCA-0.93 + 200K floor, the router
 *      throws NO_T3_MODEL_IN_REGISTRY — never silently downgrades to a
 *      Haiku-class model.
 *   4. The gate does NOT fire on plain "hi" / pure-chat prompts.
 *
 * Test asserts on FCA + context-window SHAPE — never on model-name
 * literals. Synthetic placeholder IDs only.
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
 * Pool with four tiers to prove the T3 gate:
 *   - T1 cheap-local:   FCA 0.87, context  32K     — excluded by T3
 *   - T2 mid:           FCA 0.91, context 200K     — excluded by T3
 *   - T3 sonnet-class:  FCA 0.94, context 200K     — clears T3
 *   - T3 opus-class:    FCA 0.96, context 200K     — clears T3
 *
 * NOTE: T2 has the 200K context window proxy but FCA 0.91 < 0.93. So
 * the structural floor (FCA + context) excludes Haiku-class.
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
      modelId: 'pool-t2-haiku-class',
      provider: 'anthropic-test',
      providerType: 'aws-bedrock',
      capabilities: { functionCallingAccuracy: 0.91 },
      cost: { inputPer1kTokens: 0.0008, outputPer1kTokens: 0.004, currency: 'USD' },
      performance: { maxContextTokens: 200_000, maxOutputTokens: 8_000, avgLatencyMs: 500, tokensPerSecond: 50 },
    }),
  );
  router.addModelProfile(
    profile({
      modelId: 'pool-t3-sonnet-class',
      provider: 'anthropic-test',
      providerType: 'aws-bedrock',
      capabilities: { functionCallingAccuracy: 0.94 },
      cost: { inputPer1kTokens: 0.003, outputPer1kTokens: 0.015, currency: 'USD' },
      performance: { maxContextTokens: 200_000, maxOutputTokens: 8_000, avgLatencyMs: 500, tokensPerSecond: 50 },
    }),
  );
  router.addModelProfile(
    profile({
      modelId: 'pool-t3-opus-class',
      provider: 'anthropic-test',
      providerType: 'aws-bedrock',
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

describe('SmartModelRouter — T3 capability gate (#828, 2026-05-20)', () => {
  let router: SmartModelRouter;

  beforeEach(() => {
    router = new SmartModelRouter(SILENT_LOGGER);
    buildPool(router);
  });

  test('explicit "most capable model" anchor excludes T1/T2 (FCA<0.93) candidates', async () => {
    const req = userMessage(
      "We're deploying AFD + AppGW in an enterprise tenant. Pick the most capable model for this; budget is not a concern.",
    );
    const decision = await router.routeRequest(req);
    expect(decision.selectedModel.modelId).not.toBe('pool-t1-cheap-local');
    expect(decision.selectedModel.modelId).not.toBe('pool-t2-haiku-class');
    expect(decision.selectedModel.capabilities.functionCallingAccuracy).toBeGreaterThanOrEqual(0.93);
    expect(decision.selectedModel.performance.maxContextTokens).toBeGreaterThanOrEqual(200_000);
  });

  test('"premium model" anchor forces the T3 gate', async () => {
    const req = userMessage(
      'Use the premium model. Design a multi-region AFD layout with WAF policy and OAuth at the edge.',
    );
    const decision = await router.routeRequest(req);
    expect(decision.selectedModel.capabilities.functionCallingAccuracy).toBeGreaterThanOrEqual(0.93);
    expect(decision.selectedModel.modelId).not.toBe('pool-t2-haiku-class');
  });

  test('"enterprise" anchor forces the T3 gate (#828 live repro phrasing)', async () => {
    const req = userMessage(
      'Enterprise customer is rolling out an AFD plus AppGW pattern across 3 hubs — give me the architecture.',
    );
    const decision = await router.routeRequest(req);
    expect(decision.selectedModel.capabilities.functionCallingAccuracy).toBeGreaterThanOrEqual(0.93);
    expect(decision.selectedModel.performance.maxContextTokens).toBeGreaterThanOrEqual(200_000);
  });

  test('T3 task (architecture-design-agentic) excludes Haiku-class via capability gate', async () => {
    const req = userMessage(
      // Long architecture-design prompt that hits PromptClassifier T3.
      'Re-architect our platform for multi-tenant SaaS. Plan the phases ' +
        '(1) data plane, (2) control plane, (3) tenant isolation. ' +
        'Produce an executive summary, dependency graph, risk register, ' +
        'rollback plan, and a phased timeline. ' +
        'Use compose_app and compose_visual for the architecture diagram + ' +
        'topology + sankey + heatmap. Audit existing AWS + Azure footprint.',
    );
    const decision = await router.routeRequest(req);
    // Should select a T3-grade model — never the Haiku-class T2.
    expect(decision.selectedModel.modelId).not.toBe('pool-t2-haiku-class');
    expect(decision.selectedModel.capabilities.functionCallingAccuracy).toBeGreaterThanOrEqual(0.93);
  });

  test('plain "hi" pure-chat prompt does NOT fire T3 gate (cheap model still wins)', async () => {
    // The T3 gate should NOT trigger on pure-chat — keep cheap routing on simple chat.
    const req = userMessage('hi');
    const decision = await router.routeRequest(req);
    // T3 candidates can still win on cost-quality score, but the gate
    // must not be filtering — confirm by asserting either cheap or any
    // candidate is eligible. The key shape: no T3-mandated-floor reason.
    expect(decision.reason.toLowerCase()).not.toMatch(/t3|most.capable|premium.*model|enterprise.*gate/);
  });

  test('throws NO_T3_MODEL_IN_REGISTRY when explicit signal but no qualifier exists', async () => {
    // Build a router with only T1/T2 candidates — no T3-grade model.
    const t1t2Only = new SmartModelRouter(SILENT_LOGGER);
    t1t2Only.addModelProfile(
      profile({
        modelId: 'pool-t1-cheap-local',
        provider: 'ollama-test',
        providerType: 'ollama',
        capabilities: { functionCallingAccuracy: 0.87 },
        performance: { maxContextTokens: 32_000, maxOutputTokens: 4_000, avgLatencyMs: 200, tokensPerSecond: 80 },
      }),
    );
    t1t2Only.addModelProfile(
      profile({
        modelId: 'pool-t2-haiku-class',
        provider: 'anthropic-test',
        providerType: 'aws-bedrock',
        capabilities: { functionCallingAccuracy: 0.91 },
        performance: { maxContextTokens: 200_000, maxOutputTokens: 8_000, avgLatencyMs: 500, tokensPerSecond: 50 },
      }),
    );

    const req = userMessage(
      "We're deploying AFD + AppGW in an enterprise tenant. Pick the most capable model for this; budget is not a concern.",
    );
    // The contract: explicit-most-capable signal MUST throw rather than
    // silently downgrade to Haiku-class.
    await expect(t1t2Only.routeRequest(req)).rejects.toThrow(/NO_T3_MODEL_IN_REGISTRY/);
  });
});
