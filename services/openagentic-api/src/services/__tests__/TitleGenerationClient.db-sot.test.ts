/**
 * Red-green lock for SoT fix at TitleGenerationClient constructor (plan task 3).
 *
 * Pre-fix code read in the constructor:
 *   defaultModel: process.env.TITLE_GENERATION_MODEL ||
 *                 process.env.ECONOMICAL_MODEL ||
 *                 process.env.SECONDARY_MODEL ||
 *                 process.env.DEFAULT_MODEL,
 * and cached that in this.config.defaultModel. resolveModel() then returned
 * this cached env value on the first call (before providerManager.listModels
 * was tried), bypassing the DB entirely.
 *
 * Fix: remove the env-read from the constructor default. resolveModel() must
 * call ModelConfigurationService to get the DB-backed model before falling
 * through to providerManager.listModels heuristics.
 *
 * Scenarios:
 *   1. DB service model wins over poisoned env vars
 *   2. DB service assignment null → falls through to getDefaultChatModel()
 *   3. Both DB calls reject → resolveModel() falls through to
 *      providerManager.listModels() heuristics (existing behaviour preserved)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../ModelConfigurationService.js', () => ({
  ModelConfigurationService: {
    getServiceModel: vi.fn(),
    getDefaultChatModel: vi.fn(),
  },
}));

import { ModelConfigurationService } from '../ModelConfigurationService.js';
import { TitleGenerationClient } from '../TitleGenerationClient.js';
import { TEST_PROVIDER_TYPE } from '../../test/sot-constants.js';

const silentLogger = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
};

const testMessages = [
  { role: 'system' as const, content: 'You are a title generator.' },
  { role: 'user' as const, content: 'Generate title for: neural networks' },
];

function makeProviderManager(modelId = 'provider-model') {
  return {
    createCompletion: vi.fn().mockResolvedValue({
      model: modelId,
      choices: [{ message: { role: 'assistant', content: 'Neural Networks' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
    listModels: vi.fn().mockResolvedValue([{ id: modelId }]),
    getHealthStatus: vi.fn().mockResolvedValue(new Map()),
  };
}

describe('TitleGenerationClient.generateCompletion — DB is SoT for title model', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    (ModelConfigurationService.getServiceModel as any).mockReset();
    (ModelConfigurationService.getDefaultChatModel as any).mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it('uses DB service model, not poisoned env vars, when caller passes no model', async () => {
    process.env.TITLE_GENERATION_MODEL = 'env-poisoned-title';
    process.env.ECONOMICAL_MODEL = 'env-poisoned-economical';
    process.env.SECONDARY_MODEL = 'env-poisoned-secondary';
    process.env.DEFAULT_MODEL = 'env-poisoned-default';

    (ModelConfigurationService.getServiceModel as any).mockResolvedValue({
      modelId: 'db-title-model',
      provider: TEST_PROVIDER_TYPE,
    });
    (ModelConfigurationService.getDefaultChatModel as any).mockResolvedValue('db-chat');

    const pm = makeProviderManager();
    const client = new TitleGenerationClient(silentLogger as any, { providerManager: pm });

    await client.generateCompletion({ messages: testMessages });

    expect(pm.createCompletion).toHaveBeenCalledOnce();
    const calledWith = (pm.createCompletion as any).mock.calls[0][0];
    expect(calledWith.model).toBe('db-title-model');
    expect(calledWith.model).not.toBe('env-poisoned-title');
    expect(calledWith.model).not.toBe('env-poisoned-economical');
    expect(calledWith.model).not.toBe('env-poisoned-secondary');
    expect(calledWith.model).not.toBe('env-poisoned-default');
    expect(ModelConfigurationService.getServiceModel).toHaveBeenCalledWith('titleGeneration');
  });

  it('falls through to getDefaultChatModel when service assignment is null', async () => {
    process.env.TITLE_GENERATION_MODEL = 'env-poisoned-title';
    process.env.DEFAULT_MODEL = 'env-poisoned-default';

    (ModelConfigurationService.getServiceModel as any).mockResolvedValue(null);
    (ModelConfigurationService.getDefaultChatModel as any).mockResolvedValue('db-chat');

    const pm = makeProviderManager();
    const client = new TitleGenerationClient(silentLogger as any, { providerManager: pm });

    await client.generateCompletion({ messages: testMessages });

    expect(pm.createCompletion).toHaveBeenCalledOnce();
    const calledWith = (pm.createCompletion as any).mock.calls[0][0];
    expect(calledWith.model).toBe('db-chat');
    expect(calledWith.model).not.toBe('env-poisoned-title');
    expect(calledWith.model).not.toBe('env-poisoned-default');
    expect(ModelConfigurationService.getDefaultChatModel).toHaveBeenCalled();
  });

  it('falls through to providerManager.listModels when both DB calls reject', async () => {
    process.env.TITLE_GENERATION_MODEL = 'env-poisoned-title';

    (ModelConfigurationService.getServiceModel as any).mockRejectedValue(new Error('DB down'));
    (ModelConfigurationService.getDefaultChatModel as any).mockRejectedValue(new Error('DB down'));

    const pm = makeProviderManager('provider-model-from-list');
    const client = new TitleGenerationClient(silentLogger as any, { providerManager: pm });

    await client.generateCompletion({ messages: testMessages });

    // Falls through to providerManager.listModels() heuristic
    expect(pm.listModels).toHaveBeenCalled();
    const calledWith = (pm.createCompletion as any).mock.calls[0][0];
    // Should use a model from listModels, not env
    expect(calledWith.model).not.toBe('env-poisoned-title');
    expect(calledWith.model).toBe('provider-model-from-list');
  });
});
