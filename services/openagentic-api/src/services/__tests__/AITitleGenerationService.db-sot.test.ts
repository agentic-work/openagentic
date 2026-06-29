/**
 * Red-green lock for SoT fix at AITitleGenerationService.generateAITitle (plan task 3).
 *
 * Pre-fix code read:
 *   model: process.env.TITLE_GENERATION_MODEL ||
 *          process.env.ECONOMICAL_MODEL ||
 *          process.env.SECONDARY_MODEL ||
 *          process.env.DEFAULT_MODEL,
 * in the generateAITitle() private async method passed to titleClient.generateCompletion().
 *
 * Fix: resolve from ModelConfigurationService.getServiceModel('titleGeneration')
 * with getDefaultChatModel() fall-through — no env reads on the live path.
 *
 * Scenarios:
 *   1. DB service assignment wins over poisoned env vars
 *   2. Null service assignment falls through to getDefaultChatModel()
 *   3. Both DB calls reject → generateAITitle throws, outer generateTitle()
 *      catches and falls through to smart extraction (returns non-empty title)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../ModelConfigurationService.js', () => ({
  ModelConfigurationService: {
    getServiceModel: vi.fn(),
    getDefaultChatModel: vi.fn(),
  },
}));

import { ModelConfigurationService } from '../ModelConfigurationService.js';
import { AITitleGenerationService } from '../AITitleGenerationService.js';
import { TEST_PROVIDER_TYPE } from '../../test/sot-constants.js';

const silentLogger = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
};

const testMessages = [
  { role: 'user' as const, content: 'Explain neural networks to me' },
  { role: 'assistant' as const, content: 'Neural networks are...' },
];

describe('AITitleGenerationService.generateAITitle — DB is SoT for title model', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    (ModelConfigurationService.getServiceModel as any).mockReset();
    (ModelConfigurationService.getDefaultChatModel as any).mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it('passes DB service model to titleClient and ignores all poisoned env vars', async () => {
    process.env.TITLE_GENERATION_MODEL = 'env-poisoned-title';
    process.env.ECONOMICAL_MODEL = 'env-poisoned-economical';
    process.env.SECONDARY_MODEL = 'env-poisoned-secondary';
    process.env.DEFAULT_MODEL = 'env-poisoned-default';

    (ModelConfigurationService.getServiceModel as any).mockResolvedValue({
      modelId: 'db-title-model',
      provider: TEST_PROVIDER_TYPE,
    });
    (ModelConfigurationService.getDefaultChatModel as any).mockResolvedValue('db-chat');

    const capturedCalls: any[] = [];
    const titleClient = {
      generateCompletion: vi.fn().mockImplementation((params) => {
        capturedCalls.push(params);
        return Promise.resolve({ content: 'Neural Network Explanation' });
      }),
    };

    const svc = new AITitleGenerationService(silentLogger as any, { useLLM: true }, titleClient);
    const title = await svc.generateTitle(testMessages);

    expect(titleClient.generateCompletion).toHaveBeenCalledOnce();
    const passedModel = capturedCalls[0].model;
    expect(passedModel).toBe('db-title-model');
    expect(passedModel).not.toBe('env-poisoned-title');
    expect(passedModel).not.toBe('env-poisoned-economical');
    expect(passedModel).not.toBe('env-poisoned-secondary');
    expect(passedModel).not.toBe('env-poisoned-default');
    expect(ModelConfigurationService.getServiceModel).toHaveBeenCalledWith('titleGeneration');
    expect(title).toBeTruthy();
  });

  it('falls through to getDefaultChatModel when service assignment is null', async () => {
    process.env.TITLE_GENERATION_MODEL = 'env-poisoned-title';
    process.env.DEFAULT_MODEL = 'env-poisoned-default';

    (ModelConfigurationService.getServiceModel as any).mockResolvedValue(null);
    (ModelConfigurationService.getDefaultChatModel as any).mockResolvedValue('db-chat');

    const capturedCalls: any[] = [];
    const titleClient = {
      generateCompletion: vi.fn().mockImplementation((params) => {
        capturedCalls.push(params);
        return Promise.resolve({ content: 'Neural Network Explanation' });
      }),
    };

    const svc = new AITitleGenerationService(silentLogger as any, { useLLM: true }, titleClient);
    await svc.generateTitle(testMessages);

    expect(titleClient.generateCompletion).toHaveBeenCalledOnce();
    const passedModel = capturedCalls[0].model;
    expect(passedModel).toBe('db-chat');
    expect(passedModel).not.toBe('env-poisoned-title');
    expect(passedModel).not.toBe('env-poisoned-default');
    expect(ModelConfigurationService.getDefaultChatModel).toHaveBeenCalled();
  });

  it('falls back to smart extraction when DB calls reject (no crash)', async () => {
    process.env.TITLE_GENERATION_MODEL = 'env-poisoned-title';

    (ModelConfigurationService.getServiceModel as any).mockRejectedValue(new Error('DB down'));
    (ModelConfigurationService.getDefaultChatModel as any).mockRejectedValue(new Error('DB down'));

    const titleClient = {
      generateCompletion: vi.fn(),
    };

    const svc = new AITitleGenerationService(silentLogger as any, { useLLM: true }, titleClient);
    const title = await svc.generateTitle(testMessages);

    // generateAITitle throws → outer generateTitle falls back to smartExtractTitle
    // smart extraction should produce a non-empty title from the test messages
    expect(title).toBeTruthy();
    expect(title.length).toBeGreaterThan(0);
    // titleClient must NOT have been called (DB failure prevented reaching the call)
    expect(titleClient.generateCompletion).not.toHaveBeenCalled();
  });
});
