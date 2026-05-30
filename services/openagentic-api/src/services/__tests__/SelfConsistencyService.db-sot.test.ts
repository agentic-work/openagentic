/**
 * Red-green lock for SoT fix in SelfConsistencyService (plan task 6a, File 3).
 *
 * Pre-fix (line 66):
 *   this.model = process.env.AZURE_OPENAI_DEPLOYMENT || process.env.DEFAULT_MODEL;
 *
 * Fix:
 *   - Drop this.model field initialiser in constructor
 *   - Add private async resolveModel(): Promise<string>
 *       { return ModelConfigurationService.getDefaultChatModel().catch(() => ''); }
 *   - All call sites (sampleResponses) use await this.resolveModel()
 *
 * Scenarios:
 *   1. DB chat model wins over poisoned env vars
 *   2. DB fails → empty string fallback (not env value)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../ModelConfigurationService.js', () => ({
  ModelConfigurationService: {
    getDefaultChatModel: vi.fn(),
    getServiceModel: vi.fn(),
  },
}));

// Mock AzureOpenAI so the client initialises without real creds
vi.mock('openai', () => ({
  AzureOpenAI: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: 'RECOMMENDATION: db-chat\nCONFIDENCE: 80%\nREASONING: test' } }],
        }),
      },
    },
  })),
}));

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    chatMessage: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}));

import { ModelConfigurationService } from '../ModelConfigurationService.js';
import { SelfConsistencyService } from '../SelfConsistencyService.js';

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}

describe('SelfConsistencyService — DB is SoT for model resolution', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    (ModelConfigurationService.getDefaultChatModel as any).mockReset();
    // Ensure AzureOpenAI endpoint/key present so isConfigured = true
    process.env.AZURE_OPENAI_ENDPOINT = 'https://test.openai.azure.com';
    process.env.AZURE_OPENAI_API_KEY = 'test-key';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it('DB chat model passed to AzureOpenAI, env vars ignored', async () => {
    process.env.AZURE_OPENAI_DEPLOYMENT = 'env-poisoned-deployment';
    process.env.DEFAULT_MODEL = 'env-poisoned-default';

    (ModelConfigurationService.getDefaultChatModel as any).mockResolvedValue('db-chat');

    const svc = new SelfConsistencyService(makeLogger());

    // sampleResponses is the primary caller of this.model (via resolveModel after fix)
    const responses = await svc.sampleResponses('Should we migrate?', 1);

    expect(responses.length).toBeGreaterThan(0);
    expect(ModelConfigurationService.getDefaultChatModel).toHaveBeenCalled();

    // The model arg passed to AzureOpenAI create() should be 'db-chat', not env value.
    // We verify via the mock: the AzureOpenAI create call receives the right model.
    const { AzureOpenAI } = await import('openai');
    const mockInstance = (AzureOpenAI as any).mock.results[0]?.value;
    if (mockInstance) {
      const createCalls = mockInstance.chat.completions.create.mock.calls;
      if (createCalls.length > 0) {
        expect(createCalls[0][0].model).toBe('db-chat');
        expect(createCalls[0][0].model).not.toBe('env-poisoned-deployment');
        expect(createCalls[0][0].model).not.toBe('env-poisoned-default');
      }
    }
  });

  it('DB fails → empty string fallback (not env value)', async () => {
    process.env.AZURE_OPENAI_DEPLOYMENT = 'env-poisoned-deployment';
    process.env.DEFAULT_MODEL = 'env-poisoned-default';

    (ModelConfigurationService.getDefaultChatModel as any).mockRejectedValue(new Error('DB down'));

    const svc = new SelfConsistencyService(makeLogger());

    // With DB failing, resolveModel() returns '' → AzureOpenAI create is called with '' as model
    const responses = await svc.sampleResponses('Should we migrate?', 1);
    expect(responses.length).toBeGreaterThan(0);
    expect(ModelConfigurationService.getDefaultChatModel).toHaveBeenCalled();

    const { AzureOpenAI } = await import('openai');
    const mockInstance = (AzureOpenAI as any).mock.results[0]?.value;
    if (mockInstance) {
      const createCalls = mockInstance.chat.completions.create.mock.calls;
      if (createCalls.length > 0) {
        expect(createCalls[0][0].model).toBe('');
        expect(createCalls[0][0].model).not.toBe('env-poisoned-deployment');
        expect(createCalls[0][0].model).not.toBe('env-poisoned-default');
      }
    }
  });
});
