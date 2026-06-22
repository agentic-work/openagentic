/**
 * Red-green lock for SoT fix in ModelHealthCheck (plan task 6a, File 1).
 *
 * Pre-fix (lines 78-81):
 *   const model = process.env.VERTEX_AI_MODEL ||
 *                 process.env.AZURE_OPENAI_MODEL ||
 *                 process.env.BEDROCK_MODEL ||
 *                 process.env.DEFAULT_MODEL;
 *
 * Fix:
 *   const model = await ModelConfigurationService.getDefaultChatModel().catch(() => '');
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

import { ModelConfigurationService } from '../ModelConfigurationService.js';
import { ModelHealthCheckService } from '../ModelHealthCheck.js';

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}

function makeProviderManager(content = 'UUID: test-uuid\nsome verse\nline three\nline four') {
  return {
    createCompletion: vi.fn().mockResolvedValue({
      choices: [{ message: { content } }],
    }),
  };
}

describe('ModelHealthCheckService — DB is SoT for chat model', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    (ModelConfigurationService.getDefaultChatModel as any).mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it('DB chat model wins over poisoned env vars', async () => {
    process.env.VERTEX_AI_MODEL = 'env-poisoned-vertex';
    process.env.AZURE_OPENAI_MODEL = 'env-poisoned-azure';
    process.env.BEDROCK_MODEL = 'env-poisoned-bedrock';
    process.env.DEFAULT_MODEL = 'env-poisoned-default';

    (ModelConfigurationService.getDefaultChatModel as any).mockResolvedValue('db-chat');

    const svc = new ModelHealthCheckService(makeLogger() as any, makeProviderManager() as any);
    const result = await svc.checkModelHealth(true);

    expect(result.model).toBe('db-chat');
    expect(result.model).not.toBe('env-poisoned-vertex');
    expect(result.model).not.toBe('env-poisoned-azure');
    expect(result.model).not.toBe('env-poisoned-bedrock');
    expect(result.model).not.toBe('env-poisoned-default');
    expect(ModelConfigurationService.getDefaultChatModel).toHaveBeenCalled();
  });

  it('DB fails → empty string fallback, not env value', async () => {
    process.env.VERTEX_AI_MODEL = 'env-poisoned-vertex';
    process.env.DEFAULT_MODEL = 'env-poisoned-default';

    (ModelConfigurationService.getDefaultChatModel as any).mockRejectedValue(new Error('DB down'));

    const svc = new ModelHealthCheckService(makeLogger() as any, makeProviderManager() as any);
    const result = await svc.checkModelHealth(true);

    // When DB fails, model resolves to '' → health check still runs (with empty model string)
    // or fails with a different error — key assertion: not an env value
    expect(result.model).not.toBe('env-poisoned-vertex');
    expect(result.model).not.toBe('env-poisoned-default');
    expect(ModelConfigurationService.getDefaultChatModel).toHaveBeenCalled();
  });
});
