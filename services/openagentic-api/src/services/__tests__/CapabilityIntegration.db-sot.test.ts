/**
 * Red-green lock for SoT fix in CapabilityIntegration (plan task 6a, File 4).
 *
 * Pre-fix sites:
 *   Line 35 (constructor):
 *     fallbackModel: process.env.AZURE_OPENAI_DEPLOYMENT || process.env.DEFAULT_MODEL
 *   Lines 232-233 (selectModelForMessage catch block):
 *     process.env.AZURE_OPENAI_DEPLOYMENT || process.env.DEFAULT_MODEL
 *
 * Fix strategy:
 *   Line 35: drop env read from constructor; DynamicModelSelector fallbackModel = undefined
 *   Lines 232-233: await ModelConfigurationService.getDefaultChatModel().catch(() => '')
 *
 * CapabilityIntegration is a singleton (private constructor + getInstance).
 * We test via selectModelForMessage() which exercises the catch-block fallback.
 *
 * Scenarios:
 *   1. DB chat model wins over poisoned env vars (used as fallback in routing error)
 *   2. DB fails → empty string fallback (not env value)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../ModelConfigurationService.js', () => ({
  ModelConfigurationService: {
    getDefaultChatModel: vi.fn(),
    getServiceModel: vi.fn(),
  },
}));

// Stub all the dependency modules that CapabilityIntegration pulls in
vi.mock('../ModelCapabilitiesService.js', () => ({
  ExtendedCapabilitiesService: vi.fn().mockImplementation(() => ({
    discoverAllCapabilities: vi.fn().mockResolvedValue({ models: [], tools: [] }),
    updateCapabilityScores: vi.fn().mockResolvedValue(undefined),
    exportCapabilityCatalog: vi.fn().mockResolvedValue('{}'),
  })),
}));

vi.mock('../DynamicModelSelector.js', () => ({
  DynamicModelSelector: vi.fn().mockImplementation(() => ({
    refreshModelCapabilities: vi.fn().mockResolvedValue(undefined),
    getBestModel: vi.fn().mockResolvedValue(null),
  })),
}));

vi.mock('../IntelligentModelRouter.js', () => ({
  IntelligentModelRouter: vi.fn().mockImplementation(() => ({
    routeRequest: vi.fn().mockRejectedValue(new Error('routing-error')),
  })),
}));

vi.mock('../../providers/AzureOpenAIProvider.js', () => ({
  AzureOpenAIProvider: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    modelCapability: {
      create: vi.fn().mockResolvedValue({}),
    },
    mCPToolCapabilities: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));

import { ModelConfigurationService } from '../ModelConfigurationService.js';
import { CapabilityIntegration } from '../CapabilityIntegration.js';

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}

// Reset singleton between tests
function resetSingleton() {
  // Access the private static instance field via any cast
  (CapabilityIntegration as any).instance = undefined;
}

describe('CapabilityIntegration — DB is SoT for fallback model', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    (ModelConfigurationService.getDefaultChatModel as any).mockReset();
    resetSingleton();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
    resetSingleton();
  });

  it('DB chat model used as fallback when routing fails, env vars ignored', async () => {
    process.env.AZURE_OPENAI_DEPLOYMENT = 'env-poisoned-deployment';
    process.env.DEFAULT_MODEL = 'env-poisoned-default';

    (ModelConfigurationService.getDefaultChatModel as any).mockResolvedValue('db-chat');

    const instance = CapabilityIntegration.getInstance(
      {},
      {},
      makeLogger() as any
    );

    // selectModelForMessage internally routes and catches errors — in the catch block
    // it should use getDefaultChatModel(), not env vars.
    const result = await instance.selectModelForMessage('test message');

    expect(result.model).toBe('db-chat');
    expect(result.model).not.toBe('env-poisoned-deployment');
    expect(result.model).not.toBe('env-poisoned-default');
    expect(ModelConfigurationService.getDefaultChatModel).toHaveBeenCalled();
  });

  it('DB fails → empty string fallback (not env value)', async () => {
    process.env.AZURE_OPENAI_DEPLOYMENT = 'env-poisoned-deployment';
    process.env.DEFAULT_MODEL = 'env-poisoned-default';

    (ModelConfigurationService.getDefaultChatModel as any).mockRejectedValue(new Error('DB down'));

    const instance = CapabilityIntegration.getInstance(
      {},
      {},
      makeLogger() as any
    );

    const result = await instance.selectModelForMessage('test message');

    expect(result.model).toBe('');
    expect(result.model).not.toBe('env-poisoned-deployment');
    expect(result.model).not.toBe('env-poisoned-default');
    expect(ModelConfigurationService.getDefaultChatModel).toHaveBeenCalled();
  });
});
