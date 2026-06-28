/**
 * SmartModelRouter — regex-detector regression test
 *
 * Plan reference: docs/chatmode-ux-mock-parity/02-plan-canonical.md §38-52, §156.
 * Wave2-D, task 1.7 + 1.17 of chatmode-ux-mock-parity Phase 1.
 *
 * The five hand-tuned regex detectors inside `analyzeRequest()` (TOOL_INTENT_VERBS,
 * RESOURCE_KEYWORDS, BREADTH_INDICATORS, hasCompoundResourceList, hasDiscoveryPlusReport)
 * have been deleted. The classifier-driven FCA-floor escalation that briefly
 * replaced them (RouterTuning.intentToFcaFloor) was itself ripped 2026-05-02
 * with the viz-tier ladder — the IntentClassifier still runs (consumed by
 * ToolRankerService + V2 chat pipeline) but the router uses only structural
 * chat-pool / simple-tool FCA floors.
 *
 * Per plan §80: "Regex-as-fallback IS regex routing." When the classifier
 * returns null or throws, we do NOT fall back to regex — we let the
 * structural FCA-floor scoring path produce a neutral default.
 *
 * This file STARTS RED before the deletion lands and goes GREEN after the
 * source has been stripped. After GREEN it stays as a regression guard.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pino from 'pino';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROUTER_SOURCE_PATH = join(__dirname, '..', 'SmartModelRouter.ts');

const ROUTER_SRC = readFileSync(ROUTER_SOURCE_PATH, 'utf8');

// ---------------------------------------------------------------------------
// SOURCE GREP — the five named regex detectors must be deleted.
// ---------------------------------------------------------------------------

describe('SmartModelRouter — regex detectors deleted (source grep)', () => {
  it('does not contain TOOL_INTENT_VERBS regex constant', () => {
    expect(ROUTER_SRC).not.toContain('TOOL_INTENT_VERBS');
  });

  it('does not contain RESOURCE_KEYWORDS regex constant', () => {
    expect(ROUTER_SRC).not.toContain('RESOURCE_KEYWORDS');
  });

  it('does not contain BREADTH_INDICATORS regex constant', () => {
    expect(ROUTER_SRC).not.toContain('BREADTH_INDICATORS');
  });

  it('does not contain hasCompoundResourceList derivation', () => {
    expect(ROUTER_SRC).not.toContain('hasCompoundResourceList');
  });

  it('does not contain hasDiscoveryPlusReport derivation', () => {
    expect(ROUTER_SRC).not.toContain('hasDiscoveryPlusReport');
  });

  it('does not contain "falling back to regex" log string', () => {
    expect(ROUTER_SRC).not.toContain('falling back to regex');
  });
});

// ---------------------------------------------------------------------------
// PUBLIC API SMOKE — routeRequest still returns a well-formed RoutingDecision.
// ---------------------------------------------------------------------------

describe('SmartModelRouter — public API surface preserved', () => {
  // Lazy import so the source-grep tests above run even if the runtime
  // module fails to load (e.g. during a half-applied refactor).
  const SILENT_LOGGER = pino({ level: 'silent' });

  async function loadRouter() {
    const mod = await import('../SmartModelRouter.js');
    return mod;
  }

  function buildProfile(overrides: Partial<any> & { modelId: string }): any {
    return {
      modelId: overrides.modelId,
      provider: overrides.provider ?? 'test-provider',
      providerType: overrides.providerType ?? 'azure-openai',
      capabilities: {
        chat: true,
        functionCalling: true,
        functionCallingAccuracy: 0.92,
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
        maxContextTokens: 200_000,
        maxOutputTokens: 8_000,
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

  it('routeRequest returns RoutingDecision shape on minimal input', async () => {
    const { SmartModelRouter } = await loadRouter();
    const router = new SmartModelRouter(SILENT_LOGGER);
    router.addModelProfile(buildProfile({
      modelId: 'test/sonnet',
      capabilities: { functionCallingAccuracy: 0.94 } as any,
    }));

    const decision = await router.routeRequest({
      messages: [{ role: 'user', content: 'hello' }],
    } as any);

    expect(decision).toBeDefined();
    expect(decision.selectedModel).toBeDefined();
    expect(decision.selectedModel.modelId).toBe('test/sonnet');
    expect(decision.reason).toBeTypeOf('string');
    expect(decision.alternativeModels).toBeInstanceOf(Array);
    expect(decision.analysisResults).toBeDefined();
    expect(decision.analysisResults.hasTools).toBeTypeOf('boolean');
    expect(decision.analysisResults.requiresVision).toBeTypeOf('boolean');
    expect(decision.analysisResults.estimatedTokens).toBeTypeOf('number');
    expect(decision.analysisResults.recommendedCapabilities).toBeInstanceOf(Array);
  });

  it('analyzeRequest no longer emits isMultiCloud / isMultiStep / isComplexReasoning fields', async () => {
    const { SmartModelRouter } = await loadRouter();
    const router = new SmartModelRouter(SILENT_LOGGER);
    const analysis: any = router.analyzeRequest({
      messages: [
        {
          role: 'user',
          content:
            'list all my azure subscriptions and aws ec2 instances across all my accounts then design an architecture',
        },
      ],
    } as any);

    expect(analysis).not.toHaveProperty('isMultiCloud');
    expect(analysis).not.toHaveProperty('isMultiStep');
    expect(analysis).not.toHaveProperty('isComplexReasoning');
  });
});

// ---------------------------------------------------------------------------
// CLASSIFIER ROBUSTNESS — the classifier path is best-effort metadata only.
// The FCA-floor escalation branch that consumed it was ripped 2026-05-02
// with the viz-tier ladder. Routing now relies purely on structural
// chat-pool / simple-tool FCA floors. Classifier outage / null / throw
// must never crash routing.
// ---------------------------------------------------------------------------

describe('SmartModelRouter — classifier outage robustness (post-FCA-floor rip)', () => {
  const SILENT_LOGGER = pino({ level: 'silent' });

  function buildProfile(overrides: Partial<any> & { modelId: string }): any {
    return {
      modelId: overrides.modelId,
      provider: overrides.provider ?? 'test-provider',
      providerType: overrides.providerType ?? 'azure-openai',
      capabilities: {
        chat: true,
        functionCalling: true,
        functionCallingAccuracy: 0.9,
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
        maxContextTokens: 200_000,
        maxOutputTokens: 8_000,
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

  async function loadRouter() {
    const mod = await import('../SmartModelRouter.js');
    return mod;
  }

  it('falls back to neutral scoring (NOT regex) when classifier returns null', async () => {
    const { SmartModelRouter } = await loadRouter();
    const { ROUTER_TUNING_DEFAULTS } = await import('../RouterTuningService.js');

    const tuningService = {
      async getTuning() {
        return {
          id: 'singleton',
          ...ROUTER_TUNING_DEFAULTS,
          intentClassifierEnabled: true,
          updated_at: new Date(),
          updated_by: null,
        };
      },
    };

    const intentClassifier = {
      async classify() {
        return null;
      },
      async clearCache() {},
      async clearAllCache() {
        return 0;
      },
    };

    const router = new SmartModelRouter(SILENT_LOGGER, {
      tuningService: tuningService as any,
      intentClassifier: intentClassifier as any,
    });

    router.addModelProfile(
      buildProfile({
        modelId: 'low-fca',
        capabilities: { functionCallingAccuracy: 0.87 } as any,
        cost: { inputPer1kTokens: 0, outputPer1kTokens: 0, currency: 'USD' },
      }),
    );
    router.addModelProfile(
      buildProfile({
        modelId: 'high-fca',
        capabilities: { functionCallingAccuracy: 0.95 } as any,
      }),
    );

    // Prompt that previously would have tripped the destructive regex
    // (and pre-T2, frontier-floor escalated). With classifier null +
    // regex deleted, the router relies on neutral FCA-floor scoring.
    const decision = await router.routeRequest({
      messages: [{ role: 'user', content: 'delete the dev resource group' }],
    } as any);

    // Sanity: a routing decision is returned without crashing or
    // regex-escalating. Reason must NOT contain the deleted regex
    // signatures.
    expect(decision.selectedModel).toBeDefined();
    expect(decision.reason.toLowerCase()).not.toContain('destructive intent detected');
    expect(decision.reason.toLowerCase()).not.toContain('infra-ops intent detected');
    expect(decision.reason.toLowerCase()).not.toContain('cloud-list intent detected');
    expect(decision.reason.toLowerCase()).not.toContain('complexity intent detected');
  });

  it('falls back to neutral scoring (NOT regex) when classifier throws', async () => {
    const { SmartModelRouter } = await loadRouter();
    const { ROUTER_TUNING_DEFAULTS } = await import('../RouterTuningService.js');

    const tuningService = {
      async getTuning() {
        return {
          id: 'singleton',
          ...ROUTER_TUNING_DEFAULTS,
          intentClassifierEnabled: true,
          updated_at: new Date(),
          updated_by: null,
        };
      },
    };

    const intentClassifier = {
      async classify(): Promise<any> {
        throw new Error('classifier outage');
      },
      async clearCache() {},
      async clearAllCache() {
        return 0;
      },
    };

    const router = new SmartModelRouter(SILENT_LOGGER, {
      tuningService: tuningService as any,
      intentClassifier: intentClassifier as any,
    });

    router.addModelProfile(
      buildProfile({
        modelId: 'one-model',
        capabilities: { functionCallingAccuracy: 0.92 } as any,
      }),
    );

    // Must not throw — neutral default path swallows the classifier error.
    const decision = await router.routeRequest({
      messages: [{ role: 'user', content: 'show me my azure subs' }],
    } as any);

    expect(decision.selectedModel.modelId).toBe('one-model');
  });
});
