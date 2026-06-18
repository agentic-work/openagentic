/**
 * SmartModelRouter — VISION HARD GUARD (Chat VISION path gap, sev2).
 *
 * Gap: the vision filter at routeRequest was SOFT —
 *   `if (visionCandidates.length > 0) candidates = visionCandidates;`
 * so when an image turn arrives (analysis.requiresVision === true) and NO
 * vision-capable model is registered/enabled, the filter no-ops and the
 * router silently selects a BLIND (non-vision) model. The model then
 * confidently hallucinates an answer about an image it never saw — strictly
 * worse than surfacing "no vision-capable model configured".
 *
 * Correct behavior (mirrors the NO_T3 degrade-vs-surface contract, but here
 * the verdict is SURFACE not degrade — a blind answer to an image is a
 * hallucination, never an acceptable degrade):
 *   1. When requiresVision && zero vision candidates → throw a loud
 *      NO_VISION_MODEL error that propagates to the user.
 *   2. Post-selection assertion: the chosen model MUST have
 *      capabilities.vision === true whenever the turn carries an image.
 *      A non-vision pick on a vision turn is a hard fail, never returned.
 *
 * These are deterministic candidate-filter assertions (Rule 7c real-model
 * harness governs model OUTPUT shape, not the router's filtering math —
 * same pattern as SmartModelRouter.chatRouting.test.ts).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import pino from 'pino';
import { SmartModelRouter, type ModelProfile } from '../services/SmartModelRouter.js';
import type { CompletionRequest } from '../services/llm-providers/ILLMProvider.js';

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

/** A user message whose content is the OpenAI multimodal array with an image part. */
function imageRequest(): CompletionRequest {
  return {
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is in this image?' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
        ] as any,
      },
    ],
  } as CompletionRequest;
}

describe('SmartModelRouter — vision hard guard (no silent blind routing)', () => {
  let router: SmartModelRouter;

  beforeEach(() => {
    router = new SmartModelRouter(SILENT_LOGGER);
  });

  test('image turn with ZERO vision-capable models → throws loud NO_VISION_MODEL (never silently routes blind)', async () => {
    // Pool has only NON-vision models. Pre-fix the soft filter no-ops and the
    // router returns one of these blind models. Post-fix it must surface.
    router.addModelProfile(profile({
      modelId: 'blind-chat-a',
      capabilities: { vision: false, functionCallingAccuracy: 0.9 },
    }));
    router.addModelProfile(profile({
      modelId: 'blind-chat-b',
      capabilities: { vision: false, functionCallingAccuracy: 0.95 },
    }));

    await expect(router.routeRequest(imageRequest())).rejects.toThrow(/NO_VISION_MODEL/);
  });

  test('image turn WITH a vision-capable model → selects the vision model', async () => {
    // Negation: when a vision model IS registered, the turn routes to it and
    // the guard does NOT fire.
    router.addModelProfile(profile({
      modelId: 'blind-chat',
      capabilities: { vision: false, functionCallingAccuracy: 0.95 },
    }));
    router.addModelProfile(profile({
      modelId: 'vision-model',
      capabilities: { vision: true, functionCallingAccuracy: 0.9 },
    }));

    const decision = await router.routeRequest(imageRequest());
    expect(decision.selectedModel.modelId).toBe('vision-model');
    expect(decision.selectedModel.capabilities.vision).toBe(true);
  });

  test('text-only turn with no vision models → routes normally (guard never fires when no image)', async () => {
    router.addModelProfile(profile({
      modelId: 'blind-chat',
      capabilities: { vision: false, functionCallingAccuracy: 0.95 },
    }));

    const req: CompletionRequest = {
      messages: [{ role: 'user', content: 'hello there' }],
    };
    const decision = await router.routeRequest(req);
    expect(decision.selectedModel.modelId).toBe('blind-chat');
  });
});
