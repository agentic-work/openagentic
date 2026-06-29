/**
 * SmartModelRouter — createProfileFromDiscovery substring-sniff rip (#911).
 *
 * RED-PHASE bug repro:
 *   Pre-rip behavior: when discoverFromProviders found a model in the
 *   registry pool, it called createProfileFromDiscovery(model, providerName)
 *   which inferred capabilities by SUBSTRING SNIFFING the model name:
 *     - claude  → functionCalling, jsonMode, structuredOutput
 *     - gpt     → functionCalling, jsonMode, structuredOutput
 *     - gemini  → vision (regardless of registry value)
 *     - haiku   → FCA 0.91
 *     - sonnet  → FCA 0.94
 *     - opus    → FCA 0.96
 *     - llama / mistral → FCA 0.80
 *     - qwen / gpt-oss → FCA 0.87
 *
 *   This bypassed the registry row's `capabilities` JSON entirely. Per
 *   the no-hardcoded-models rule + the two-SoT contract, capabilities
 *   MUST come from `model_role_assignments.capabilities`.
 *
 * GREEN contract pinned here:
 *   1. createProfileFromDiscovery, when given a registry-supplied
 *      capabilities object, copies it directly to profile.capabilities
 *      (no derived or inferred fields).
 *   2. Substring matches on the model name do NOT override registry
 *      values — a model named "claude-sonnet-9000" with registry
 *      capabilities { functionCalling: false } has functionCalling
 *      false on the profile.
 *   3. When the registry row is missing capabilities, the profile builder
 *      throws/returns null — does NOT silently infer.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import pino from 'pino';
import { SmartModelRouter } from '../../SmartModelRouter.js';

const SILENT_LOGGER = pino({ level: 'silent' });

describe('SmartModelRouter — createProfileFromDiscovery substring-sniff rip (#911)', () => {
  let router: SmartModelRouter;

  beforeEach(() => {
    router = new SmartModelRouter(SILENT_LOGGER);
  });

  test('with registry capabilities supplied, profile.capabilities mirrors registry exactly', () => {
    // Registry says: this is a claude-sonnet-class model but admin
    // explicitly disabled function calling on it (e.g. a low-tier deploy).
    const registryCapabilities = {
      chat: true,
      functionCalling: false,             // explicit registry override
      functionCallingAccuracy: 0.50,      // explicit registry override
      vision: false,
      imageGeneration: false,
      embeddings: false,
      streaming: true,
      jsonMode: false,
      structuredOutput: false,
      supportsToolInputDelta: false,
      supportsThinking: false,
      supportsCitations: false,
      supportsSyntheticThinking: false,
    };

    // Use a model name that the OLD substring sniffer would mis-infer
    // capabilities for ("claude-sonnet" → high FCA + tools + json).
    const profile = (router as any).createProfileFromDiscovery(
      { id: 'claude-sonnet-test-9000', name: 'claude-sonnet-test', provider: 'bedrock-test' },
      'bedrock-test',
      { capabilities: registryCapabilities, contextWindowTokens: 200_000 },
    );

    // Profile must NOT derive capabilities from name substrings.
    expect(profile.capabilities.functionCalling).toBe(false);
    expect(profile.capabilities.functionCallingAccuracy).toBe(0.50);
    expect(profile.capabilities.jsonMode).toBe(false);
    expect(profile.capabilities.structuredOutput).toBe(false);
    expect(profile.capabilities.vision).toBe(false);
  });

  test('registry capabilities object is treated as the source of truth', () => {
    // Registry: a tool-capable, vision-capable, high-FCA model.
    const registryCapabilities = {
      chat: true,
      functionCalling: true,
      functionCallingAccuracy: 0.96,
      vision: true,
      imageGeneration: false,
      embeddings: false,
      streaming: true,
      jsonMode: true,
      structuredOutput: true,
      supportsToolInputDelta: true,
      supportsThinking: true,
      supportsCitations: true,
      supportsSyntheticThinking: false,
    };

    // Use a model name that wouldn't normally infer tools/vision
    // ("nemotron-foo") — substring sniff would yield FCA 0.70.
    const profile = (router as any).createProfileFromDiscovery(
      { id: 'nemotron-foo-bar', name: 'nemotron-foo-bar', provider: 'bedrock-test' },
      'bedrock-test',
      { capabilities: registryCapabilities, contextWindowTokens: 128_000 },
    );

    expect(profile.capabilities.functionCalling).toBe(true);
    expect(profile.capabilities.functionCallingAccuracy).toBe(0.96);
    expect(profile.capabilities.vision).toBe(true);
    expect(profile.capabilities.supportsThinking).toBe(true);
  });

  test('rejects missing/empty registry capabilities — does NOT silently infer', () => {
    // The two-SoT rule says: if the registry doesn't have capabilities,
    // we DON'T make them up. The router must refuse to build a profile
    // for a model the admin hasn't fully described.
    expect(() => {
      (router as any).createProfileFromDiscovery(
        { id: 'claude-sonnet-fake', name: 'claude-sonnet-fake', provider: 'bedrock-test' },
        'bedrock-test',
        { capabilities: null, contextWindowTokens: undefined },
      );
    }).toThrow(/MODEL_NOT_IN_REGISTRY|capabilities/i);
  });

  test('rejects undefined registry argument — fail-closed', () => {
    expect(() => {
      (router as any).createProfileFromDiscovery(
        { id: 'gpt-test-model', name: 'gpt-test-model', provider: 'aif-test' },
        'aif-test',
        undefined,
      );
    }).toThrow(/MODEL_NOT_IN_REGISTRY|capabilities|registry/i);
  });

  test('contextWindowTokens passes through from registry row', () => {
    const registryCapabilities = {
      chat: true,
      functionCalling: true,
      functionCallingAccuracy: 0.94,
      vision: false,
      imageGeneration: false,
      embeddings: false,
      streaming: true,
      jsonMode: true,
      structuredOutput: true,
      supportsToolInputDelta: true,
      supportsThinking: false,
      supportsCitations: true,
      supportsSyntheticThinking: false,
    };
    const profile = (router as any).createProfileFromDiscovery(
      { id: 'sonnet-class-X', name: 'sonnet-class-X', provider: 'bedrock-test' },
      'bedrock-test',
      { capabilities: registryCapabilities, contextWindowTokens: 200_000 },
    );
    expect(profile.performance.maxContextTokens).toBe(200_000);
  });
});
