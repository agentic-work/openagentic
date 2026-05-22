/**
 * SmartModelRouter — chat-routing quality guard (task #99, 2026-04-23).
 *
 * Observed bug on the dev environment: simple chat prompts ("write a poem about
 * dogs") were being routed to Ministral-3B. Root cause: after the
 * slider rip (2026-04-19) `scoreModel()` fixed both cost and quality
 * weights at 0.5, but the quality-bonus branch was still gated behind
 * `if (qualityWeight > 0.6)`. That gate never fires at 0.5, so quality
 * never contributed to the score. Cost is linearly rewarded (max 12.5
 * at $0/1k), and cheap local models trivially outscored frontier
 * models on general chat.
 *
 * Stage C (2026-04-23) adds two new behaviors controlled by live tunables:
 *  1. fcaChatPoolFloor — filters low-FCA models from pure-chat routing
 *     (Ministral-3B FCA 0.80 < 0.82 default floor → filtered out).
 *  2. fcaQualityGatedByComplexity — when true (default), quality bonus
 *     only applies when request has complexity signals (tools / multi-step
 *     / complex-reasoning / multi-cloud). Simple chat = cost-dominant.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import pino from 'pino';
import { SmartModelRouter, type ModelProfile } from '../services/SmartModelRouter.js';
import { ROUTER_TUNING_DEFAULTS } from '../services/RouterTuningService.js';
import type { CompletionRequest } from '../services/llm-providers/ILLMProvider.js';

const SILENT_LOGGER = pino({ level: 'silent' });

/** Build a ModelProfile with reasonable defaults, overridable per test. */
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

/** Mock tuning service that returns a fixed tuning object. */
function mockTuningService(overrides: Partial<typeof ROUTER_TUNING_DEFAULTS> = {}) {
  const tuning = { id: 'singleton', ...ROUTER_TUNING_DEFAULTS, ...overrides, updated_at: new Date(), updated_by: null };
  return { getTuning: async () => tuning };
}

describe('SmartModelRouter — simple chat routing (task #99)', () => {
  let router: SmartModelRouter;

  beforeEach(() => {
    router = new SmartModelRouter(SILENT_LOGGER);
  });

  test('picks Sonnet-class frontier over Ministral-3B for "write me a poem" — Ministral filtered by FCA floor', async () => {
    // Ministral-3B FCA (0.80) < default fcaChatPoolFloor (0.82), so it is
    // filtered out of the pure-chat candidate pool before scoring runs.
    // Sonnet survives the floor and wins as the only remaining candidate.
    router.addModelProfile(profile({
      modelId: 'ministral-3b-instruct',
      provider: 'ollama',
      providerType: 'ollama',
      capabilities: { functionCallingAccuracy: 0.80 },
      cost: { inputPer1kTokens: 0, outputPer1kTokens: 0, currency: 'USD' },
      performance: { maxContextTokens: 32_000, maxOutputTokens: 4_000, avgLatencyMs: 200, tokensPerSecond: 80 },
    }));
    router.addModelProfile(profile({
      modelId: 'claude-sonnet-4-6',
      provider: 'aws-bedrock',
      providerType: 'aws-bedrock',
      capabilities: { functionCallingAccuracy: 0.94 },
      cost: { inputPer1kTokens: 0.003, outputPer1kTokens: 0.015, currency: 'USD' },
      performance: { maxContextTokens: 200_000, maxOutputTokens: 8_000, avgLatencyMs: 600, tokensPerSecond: 60 },
    }));

    const req: CompletionRequest = {
      messages: [{ role: 'user', content: 'write me a poem about dogs' }],
    };
    const decision = await router.routeRequest(req);

    expect(decision.selectedModel.modelId).toBe('claude-sonnet-4-6');
  });

  test('still picks the cheap model when quality parity holds', async () => {
    // Both models have identical capability and both clear the 0.82 floor.
    // Cost should be the tiebreaker.
    router.addModelProfile(profile({
      modelId: 'cheap-equivalent',
      provider: 'ollama',
      providerType: 'ollama',
      capabilities: { functionCallingAccuracy: 0.94 },
      cost: { inputPer1kTokens: 0, outputPer1kTokens: 0, currency: 'USD' },
    }));
    router.addModelProfile(profile({
      modelId: 'expensive-equivalent',
      provider: 'aws-bedrock',
      providerType: 'aws-bedrock',
      capabilities: { functionCallingAccuracy: 0.94 },
      cost: { inputPer1kTokens: 0.003, outputPer1kTokens: 0.015, currency: 'USD' },
    }));

    const req: CompletionRequest = {
      messages: [{ role: 'user', content: 'hello, how are you today' }],
    };
    const decision = await router.routeRequest(req);

    expect(decision.selectedModel.modelId).toBe('cheap-equivalent');
  });

  test('below-floor cheap model is filtered out — high-FCA model wins even at higher cost', async () => {
    // low-quality-cheap FCA (0.78) < default floor (0.82) → filtered.
    // high-quality-expensive is the only survivor.
    router.addModelProfile(profile({
      modelId: 'low-quality-cheap',
      provider: 'ollama',
      providerType: 'ollama',
      capabilities: { functionCallingAccuracy: 0.78 },
      cost: { inputPer1kTokens: 0.0001, outputPer1kTokens: 0.0001, currency: 'USD' },
    }));
    router.addModelProfile(profile({
      modelId: 'high-quality-expensive',
      provider: 'azure-openai',
      providerType: 'azure-openai',
      capabilities: { functionCallingAccuracy: 0.94 },
      cost: { inputPer1kTokens: 0.002, outputPer1kTokens: 0.008, currency: 'USD' },
    }));

    const req: CompletionRequest = {
      messages: [{ role: 'user', content: 'tell me a fun fact about space' }],
    };
    const decision = await router.routeRequest(req);

    expect(decision.selectedModel.modelId).toBe('high-quality-expensive');
  });
});

// ---------------------------------------------------------------------------
// Stage-C new tests (haiku regression + gate behavior)
// ---------------------------------------------------------------------------

describe('SmartModelRouter — haiku regression (Stage C)', () => {
  /**
   * Test A — THE regression test.
   *
   * 3-model pool: ollama/gpt-oss:20b (free, FCA 0.85), Haiku (FCA 0.87,
   * cheap), Sonnet (FCA 0.94, expensive). Simple chat prompt.
   *
   * With default tuning (gatedByComplexity=true, chatPoolFloor=0.82):
   *  - All three pass the floor.
   *  - Quality bonus is GATED (no complexity signals) → OFF.
   *  - Cost dominates → ollama/gpt-oss:20b wins (free).
   *
   * Without this fix Sonnet used to win because the quality bonus was
   * unconditional and Sonnet's FCA headroom (0.94 - 0.75) * 100 * 0.5 = 9.5
   * easily overcame the cost advantage of the free model.
   */
  test('Test A — simple haiku chat routes to free ollama, not Sonnet', async () => {
    const router = new SmartModelRouter(SILENT_LOGGER);

    router.addModelProfile(profile({
      modelId: 'ollama/gpt-oss:20b',
      provider: 'ollama',
      providerType: 'ollama',
      capabilities: { functionCallingAccuracy: 0.85 },
      cost: { inputPer1kTokens: 0, outputPer1kTokens: 0, currency: 'USD' },
      performance: { maxContextTokens: 32_000, maxOutputTokens: 4_000, avgLatencyMs: 300, tokensPerSecond: 70 },
    }));
    router.addModelProfile(profile({
      modelId: 'claude-haiku-4-5',
      provider: 'aws-bedrock',
      providerType: 'aws-bedrock',
      capabilities: { functionCallingAccuracy: 0.87 },
      cost: { inputPer1kTokens: 0.001, outputPer1kTokens: 0.005, currency: 'USD' },
      performance: { maxContextTokens: 200_000, maxOutputTokens: 8_000, avgLatencyMs: 400, tokensPerSecond: 80 },
    }));
    router.addModelProfile(profile({
      modelId: 'claude-sonnet-4-6',
      provider: 'aws-bedrock',
      providerType: 'aws-bedrock',
      capabilities: { functionCallingAccuracy: 0.94 },
      cost: { inputPer1kTokens: 0.003, outputPer1kTokens: 0.015, currency: 'USD' },
      performance: { maxContextTokens: 200_000, maxOutputTokens: 8_000, avgLatencyMs: 600, tokensPerSecond: 60 },
    }));

    const req: CompletionRequest = {
      messages: [{ role: 'user', content: 'write me a haiku about the sea' }],
    };
    const decision = await router.routeRequest(req);

    expect(decision.selectedModel.modelId).toBe('ollama/gpt-oss:20b');
  });

  /**
   * Test B — Ministral (FCA 0.80) added to pool.
   * Ministral should be filtered by the 0.82 floor; ollama/gpt-oss:20b still wins.
   */
  test('Test B — Ministral (FCA 0.80) filtered by chat-pool floor, free ollama still wins', async () => {
    const router = new SmartModelRouter(SILENT_LOGGER);

    router.addModelProfile(profile({
      modelId: 'ollama/gpt-oss:20b',
      provider: 'ollama',
      providerType: 'ollama',
      capabilities: { functionCallingAccuracy: 0.85 },
      cost: { inputPer1kTokens: 0, outputPer1kTokens: 0, currency: 'USD' },
      performance: { maxContextTokens: 32_000, maxOutputTokens: 4_000, avgLatencyMs: 300, tokensPerSecond: 70 },
    }));
    router.addModelProfile(profile({
      modelId: 'ministral-3b-instruct',
      provider: 'ollama',
      providerType: 'ollama',
      capabilities: { functionCallingAccuracy: 0.80 },
      cost: { inputPer1kTokens: 0, outputPer1kTokens: 0, currency: 'USD' },
      performance: { maxContextTokens: 32_000, maxOutputTokens: 4_000, avgLatencyMs: 200, tokensPerSecond: 90 },
    }));
    router.addModelProfile(profile({
      modelId: 'claude-haiku-4-5',
      provider: 'aws-bedrock',
      providerType: 'aws-bedrock',
      capabilities: { functionCallingAccuracy: 0.87 },
      cost: { inputPer1kTokens: 0.001, outputPer1kTokens: 0.005, currency: 'USD' },
    }));
    router.addModelProfile(profile({
      modelId: 'claude-sonnet-4-6',
      provider: 'aws-bedrock',
      providerType: 'aws-bedrock',
      capabilities: { functionCallingAccuracy: 0.94 },
      cost: { inputPer1kTokens: 0.003, outputPer1kTokens: 0.015, currency: 'USD' },
    }));

    const req: CompletionRequest = {
      messages: [{ role: 'user', content: 'write me a haiku about the sea' }],
    };
    const decision = await router.routeRequest(req);

    // Ministral filtered; among survivors (gpt-oss, haiku, sonnet) the
    // free gpt-oss wins on cost with quality gate OFF.
    expect(decision.selectedModel.modelId).toBe('ollama/gpt-oss:20b');
  });

  /**
   * Test C — Legacy (gate OFF): fcaQualityGatedByComplexity = false.
   * Quality bonus applies universally → Sonnet wins on quality headroom
   * even though the prompt has no complexity signals.
   *
   * Fixture: cheap model FCA=0.82 (just above the 0.82 floor so it survives
   * the pool filter) vs Sonnet FCA=0.94.
   *
   * Gate ON scores  (default): cheap = 12.5+3.5 = 16.0; Sonnet = 8.75+2.0 = 10.75 → cheap wins
   * Gate OFF scores: cheap = 16.0 + (0.82-0.75)*100*0.5=3.5 = 19.5;
   *                 Sonnet = 10.75 + (0.94-0.75)*100*0.5=9.5 = 20.25 → Sonnet wins
   */
  test('Test C — gate disabled (fcaQualityGatedByComplexity=false) → Sonnet wins on quality', async () => {
    const tuning = mockTuningService({ fcaQualityGatedByComplexity: false });
    const router = new SmartModelRouter(SILENT_LOGGER, { tuningService: tuning as any });

    // cheap-low-fca: FCA=0.82 (exactly at floor, not filtered), cost=free, fast
    router.addModelProfile(profile({
      modelId: 'cheap-low-fca',
      provider: 'ollama',
      providerType: 'ollama',
      capabilities: { functionCallingAccuracy: 0.82 },
      cost: { inputPer1kTokens: 0, outputPer1kTokens: 0, currency: 'USD' },
      performance: { maxContextTokens: 32_000, maxOutputTokens: 4_000, avgLatencyMs: 300, tokensPerSecond: 70 },
    }));
    router.addModelProfile(profile({
      modelId: 'claude-sonnet-4-6',
      provider: 'aws-bedrock',
      providerType: 'aws-bedrock',
      capabilities: { functionCallingAccuracy: 0.94 },
      cost: { inputPer1kTokens: 0.003, outputPer1kTokens: 0.015, currency: 'USD' },
      performance: { maxContextTokens: 200_000, maxOutputTokens: 8_000, avgLatencyMs: 600, tokensPerSecond: 60 },
    }));

    const req: CompletionRequest = {
      messages: [{ role: 'user', content: 'write me a haiku about the sea' }],
    };
    const decision = await router.routeRequest(req);

    // With gate OFF, Sonnet's quality headroom bonus (9.5 pts) overcomes the
    // cost/latency disadvantage vs the free cheap model (delta ~5.25 pts).
    // Sonnet total ≈ 20.25 vs cheap-low-fca ≈ 19.5 → Sonnet wins.
    expect(decision.selectedModel.modelId).toBe('claude-sonnet-4-6');
  });
});
