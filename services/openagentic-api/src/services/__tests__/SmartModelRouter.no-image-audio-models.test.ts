/**
 * SmartModelRouter — image/audio models must not leak into chat routing.
 *
 * SEV-0 root cause (2026-05-02): `nemotron3:33b` (a GPU test model for
 * image-gen / audio-gen) was returned by `routeRequest` for a chat turn
 * because the heuristic at SmartModelRouter inferProfileFromName sets
 * `chat:true` unconditionally on every inferred profile. The chat user
 * then waited 30s for OllamaProvider to time out (URL not configured)
 * → "REQUEST_TIMEOUT".
 *
 * Architectural rule (CLAUDE.md): NO HARDCODED MODEL IDs. The filter is
 * capability-based (imageGeneration / audioGeneration flags) with a
 * substring fallback for generic audio/speech model name patterns.
 */

import { describe, test, expect } from 'vitest';
import { isImageOrAudioOnlyProfile, type ModelProfile } from '../SmartModelRouter.js';

const baseChatProfile: ModelProfile = {
  modelId: 'gpt-good-chat',
  provider: 'azure-ai-foundry',
  family: 'openai',
  cost: { inputPer1kTokens: 0.001, outputPer1kTokens: 0.002, lastUpdated: new Date() },
  context: { maxTokens: 128000, maxOutput: 8192 },
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
  } as any,
  metadata: { isAvailable: true, lastTested: new Date() } as any,
} as any;

describe('isImageOrAudioOnlyProfile — chat candidate pool exclusion (SEV-0)', () => {
  test('plain chat profile is NOT excluded', () => {
    expect(isImageOrAudioOnlyProfile(baseChatProfile)).toBe(false);
  });

  test('imageGeneration=true + chat=true (heuristic-leak case) IS excluded', () => {
    // nemotron3:33b on the GPU node — what triggered the SEV-0.
    const profile: ModelProfile = {
      ...baseChatProfile,
      modelId: 'nemotron3:33b',
      provider: 'ollama-hal',
      capabilities: { ...baseChatProfile.capabilities, imageGeneration: true },
    } as any;
    expect(isImageOrAudioOnlyProfile(profile)).toBe(true);
  });

  test('audioGeneration=true model IS excluded', () => {
    const profile: ModelProfile = {
      ...baseChatProfile,
      modelId: 'some-audio-test-model',
      capabilities: { ...baseChatProfile.capabilities, audioGeneration: true } as any,
    } as any;
    expect(isImageOrAudioOnlyProfile(profile)).toBe(true);
  });

  test('whisper substring fallback (no capability flag set) IS excluded', () => {
    const profile: ModelProfile = {
      ...baseChatProfile,
      modelId: 'whisper-large-v3',
      // capabilities missing audioGeneration flag — should still get excluded
    } as any;
    expect(isImageOrAudioOnlyProfile(profile)).toBe(true);
  });

  test('dall-e / sdxl / imagen substring fallback IS excluded', () => {
    expect(isImageOrAudioOnlyProfile({ ...baseChatProfile, modelId: 'dall-e-3' } as any)).toBe(true);
    expect(isImageOrAudioOnlyProfile({ ...baseChatProfile, modelId: 'sd-xl-base' } as any)).toBe(true);
    expect(isImageOrAudioOnlyProfile({ ...baseChatProfile, modelId: 'imagen-2' } as any)).toBe(true);
    expect(isImageOrAudioOnlyProfile({ ...baseChatProfile, modelId: 'flux-pro' } as any)).toBe(true);
  });

  test('chat-named models like gpt-oss-120b / sonnet / gemini are NOT excluded', () => {
    expect(isImageOrAudioOnlyProfile({ ...baseChatProfile, modelId: 'gpt-oss-120b' } as any)).toBe(false);
    expect(isImageOrAudioOnlyProfile({ ...baseChatProfile, modelId: 'claude-sonnet-4-6' } as any)).toBe(false);
    expect(isImageOrAudioOnlyProfile({ ...baseChatProfile, modelId: 'gemini-2.5-flash' } as any)).toBe(false);
    expect(isImageOrAudioOnlyProfile({ ...baseChatProfile, modelId: 'gpt-5.4' } as any)).toBe(false);
  });
});
