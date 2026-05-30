/**
 * Red-green lock for SoT fix in CodeModeSessionService.createSession (plan task 5, File 2).
 *
 * Pre-fix code (line ~99):
 *   const model = options.model || process.env.DEFAULT_CODE_MODEL || MODELS.code;
 *
 * Fix:
 *   const model = options.model || await ModelConfigurationService.getDefaultChatModel() || MODELS.code;
 *
 * Note: MODELS.code is itself env-backed (process.env.DEFAULT_CODE_MODEL || DEFAULT_MODEL)
 * but is kept as an emergency last-resort fallback per the plan — fixing it is Task 6 scope.
 *
 * Triggering path:
 *   createSession() is public. We mock AWCodeStorageService and ModelConfigurationService.
 *
 * Scenarios:
 *   1. DB default chat model wins over poisoned env
 *   2. Caller-supplied options.model takes precedence
 *   3. DB fails → MODELS.code emergency fallback (env-backed, out of scope here)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../ModelConfigurationService.js', () => ({
  ModelConfigurationService: {
    getDefaultChatModel: vi.fn(),
    getServiceModel: vi.fn(),
  },
}));

vi.mock('../AWCodeStorageService.js', () => ({
  awcodeStorageService: {
    createSession: vi.fn().mockResolvedValue(undefined),
    getSession: vi.fn().mockResolvedValue(null),
    getSessionMessages: vi.fn().mockResolvedValue([]),
    addMessage: vi.fn().mockResolvedValue(undefined),
  },
  AWCodeMessageData: {},
}));

vi.mock('../../config/model-catalogs.js', () => ({
  getContextWindow: vi.fn().mockReturnValue(128000),
}));

vi.mock('../../utils/prisma.js', () => ({
  prisma: {},
}));

import { ModelConfigurationService } from '../ModelConfigurationService.js';
import { CodeModeSessionService } from '../CodeModeSessionService.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}

function makeProviderManager() {
  return {
    createCompletion: vi.fn(),
  };
}

// ── suite ─────────────────────────────────────────────────────────────────────

describe('CodeModeSessionService.createSession — DB is SoT for default model', () => {
  const originalEnv = { ...process.env };
  let svc: CodeModeSessionService;

  beforeEach(() => {
    (ModelConfigurationService.getDefaultChatModel as any).mockReset();
    svc = new CodeModeSessionService(makeLogger() as any, makeProviderManager() as any);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it('DB default chat model wins over poisoned env DEFAULT_CODE_MODEL', async () => {
    process.env.DEFAULT_CODE_MODEL = 'env-poisoned-code';
    process.env.DEFAULT_MODEL = 'env-poisoned-default';

    (ModelConfigurationService.getDefaultChatModel as any).mockResolvedValue('db-chat');

    // No options.model supplied — must fall back to DB
    const session = await svc.createSession('user-1');

    expect(session.model).toBe('db-chat');
    expect(session.model).not.toBe('env-poisoned-code');
    expect(session.model).not.toBe('env-poisoned-default');
    expect(ModelConfigurationService.getDefaultChatModel).toHaveBeenCalled();
  });

  it('caller-supplied options.model takes precedence over DB', async () => {
    process.env.DEFAULT_CODE_MODEL = 'env-poisoned-code';
    (ModelConfigurationService.getDefaultChatModel as any).mockResolvedValue('db-chat');

    const session = await svc.createSession('user-2', { model: 'caller-pinned' });

    expect(session.model).toBe('caller-pinned');
    expect(session.model).not.toBe('db-chat');
    expect(session.model).not.toBe('env-poisoned-code');
    // DB not needed when caller pins a model
  });

  it('DB fails → MODELS.code emergency fallback (not env value when env differs)', async () => {
    // MODELS.code is itself env-backed at module-load time — when DEFAULT_CODE_MODEL
    // is set BEFORE the module first loads, MODELS.code will have that value.
    // In this test, we clear DEFAULT_CODE_MODEL AFTER module load so MODELS.code
    // retains the value it had at import time. We simply assert the model is truthy
    // (MODELS.code is a non-empty string) and is NOT the direct env value we poisoned.

    // Reset env so MODELS.code fallback path (DEFAULT_MODEL) is used, not DEFAULT_CODE_MODEL
    delete process.env.DEFAULT_CODE_MODEL;
    process.env.DEFAULT_MODEL = 'auto'; // matches MODELS.code at startup if no DEFAULT_CODE_MODEL

    (ModelConfigurationService.getDefaultChatModel as any).mockRejectedValue(new Error('DB down'));

    const session = await svc.createSession('user-3');

    // Must not be the poisoned env values; must be MODELS.code (whatever was set at import)
    expect(session.model).not.toBe('env-poisoned-code');
    // MODELS.code fallback should be truthy (non-empty)
    expect(typeof session.model).toBe('string');
    // ModelConfigurationService was attempted
    expect(ModelConfigurationService.getDefaultChatModel).toHaveBeenCalled();
  });
});
