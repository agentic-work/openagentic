/**
 * ProviderManager.generateImage — registry-SoT short-circuit (#1083 follow-up).
 *
 * RED reproduction: the legacy code at ProviderManager.ts:1813-1825 filtered
 * image providers by walking `providerConfig.config.models[].capabilities`,
 * which only sees bootstrap-helm-seeded models. Registry models added via the
 * admin UI (e.g. amazon.nova-canvas-v1:0 under bedrock-dev) live in
 * `admin.model_role_assignments` and were invisible to that scan → every
 * generate_image call threw "No providers with image generation capability
 * are configured" even though the provider's modelToProviderMap correctly
 * resolved the model to the provider.
 *
 * GREEN: when the caller passes `request.model`, look it up in
 * `modelToProviderMap` (registry-SoT). If its provider implements
 * generateImage(), use it directly. Legacy capability scan kept as a
 * no-model-set fallback.
 */
import { describe, test, expect, vi } from 'vitest';

const SILENT_LOGGER: any = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => SILENT_LOGGER,
};

describe('ProviderManager.generateImage — registry-SoT short-circuit (#1083)', () => {
  test('uses provider from modelToProviderMap when request.model is set, even when legacy provider-config models[] is empty', async () => {
    // Stub the prisma-import side-effect for cost-cap enforcement (which calls
    // enforceCostCap → costLimitsService — unrelated to the short-circuit).
    const { ProviderManager } = await import('../ProviderManager.js');

    const bedrockStub: any = {
      generateImage: vi.fn().mockResolvedValue({
        imageBase64: 'ZmFrZS1wbmctYnl0ZXM=',
        model: 'amazon.nova-canvas-v1:0',
        provider: 'bedrock-dev',
        format: 'png',
        generationTimeMs: 1234,
      }),
    };

    const pm: any = Object.create(ProviderManager.prototype);
    pm.initialized = true;
    pm.providers = new Map([['bedrock-dev', bedrockStub]]);
    pm.modelToProviderMap = new Map([['amazon.nova-canvas-v1:0', 'bedrock-dev']]);
    // Legacy config has NO image models — this is the live regression shape.
    pm.config = { providers: [{ name: 'bedrock-dev', config: { models: [] } }], imageGenTimeout: 60_000 };
    pm.logger = SILENT_LOGGER;
    pm.ensureFreshProviders = async () => {};
    pm.enforceCostCap = async () => {};
    pm.incrementDailySpend = () => {};
    pm.executeImageGen = async (provider: any, _name: string, req: any) => provider.generateImage(req);

    const resp = await pm.generateImage({
      prompt: 'a man at a computer',
      model: 'amazon.nova-canvas-v1:0',
    });

    expect(bedrockStub.generateImage).toHaveBeenCalledOnce();
    expect(resp.imageBase64).toBe('ZmFrZS1wbmctYnl0ZXM=');
    expect(resp.model).toBe('amazon.nova-canvas-v1:0');
  });

  test('throws clean error when request.model resolves to a provider without generateImage()', async () => {
    const { ProviderManager } = await import('../ProviderManager.js');
    const ollamaStub: any = {}; // no generateImage method

    const pm: any = Object.create(ProviderManager.prototype);
    pm.initialized = true;
    pm.providers = new Map([['node-ollama', ollamaStub]]);
    pm.modelToProviderMap = new Map([['gpt-oss:20b', 'node-ollama']]);
    pm.config = { providers: [{ name: 'node-ollama', config: { models: [] } }], imageGenTimeout: 60_000 };
    pm.logger = SILENT_LOGGER;
    pm.ensureFreshProviders = async () => {};
    pm.enforceCostCap = async () => {};

    await expect(
      pm.generateImage({ prompt: 'x', model: 'gpt-oss:20b' }),
    ).rejects.toThrow(/No providers with image generation capability/);
  });

  test('legacy fallback still works when request.model is absent (no model-set caller)', async () => {
    const { ProviderManager } = await import('../ProviderManager.js');

    const bedrockStub: any = {
      generateImage: vi.fn().mockResolvedValue({
        imageBase64: 'YWJj',
        model: 'amazon.nova-canvas-v1:0',
        provider: 'bedrock-dev',
        format: 'png',
        generationTimeMs: 100,
      }),
    };

    const pm: any = Object.create(ProviderManager.prototype);
    pm.initialized = true;
    pm.providers = new Map([['bedrock-dev', bedrockStub]]);
    pm.modelToProviderMap = new Map();
    // Legacy config DOES have an image model for the fallback path.
    pm.config = {
      providers: [
        {
          name: 'bedrock-dev',
          config: { models: [{ id: 'nova-canvas', capabilities: { imageGeneration: true } }] },
        },
      ],
      imageGenTimeout: 60_000,
    };
    pm.logger = SILENT_LOGGER;
    pm.ensureFreshProviders = async () => {};
    pm.enforceCostCap = async () => {};
    pm.incrementDailySpend = () => {};
    pm.executeImageGen = async (provider: any, _name: string, req: any) => provider.generateImage(req);

    const resp = await pm.generateImage({ prompt: 'a thing' });
    expect(bedrockStub.generateImage).toHaveBeenCalledOnce();
    expect(resp.imageBase64).toBe('YWJj');
  });
});
