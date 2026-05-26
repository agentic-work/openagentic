/**
 * Red-green lock for SoT fix in AgenticCodeService (plan task 5, File 1).
 *
 * Pre-fix code (line ~116):
 *   this.defaultModel = config?.defaultModel || process.env.DEFAULT_CODE_MODEL || process.env.DEFAULT_MODEL || '';
 *
 * Fix:
 *   private configuredDefaultModel: string | undefined — stores only explicit config?.defaultModel
 *   private async resolveDefaultModel(): Promise<string> — reads DB via getDefaultChatModel()
 *   getAWCodeSettings() awaits resolveDefaultModel() instead of using this.defaultModel
 *
 * Triggering path:
 *   getAWCodeSettings() is private, called by createSession() (public).
 *   createSession() uses dbSettings.defaultModel to set the effective model.
 *   When model arg is not provided, effectiveModel = dbSettings.defaultModel.
 *   We mock axios (code-manager call), prisma.codeSession, and systemConfiguration.
 *
 * Scenarios:
 *   1. DB default chat model wins over poisoned env vars
 *   2. Explicit config.defaultModel takes precedence over DB
 *   3. DB fails → empty string fallback (preserved pre-fix behavior)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../ModelConfigurationService.js', () => ({
  ModelConfigurationService: {
    getDefaultChatModel: vi.fn(),
    getServiceModel: vi.fn(),
  },
}));

// Mock axios so code-manager HTTP calls don't fail
vi.mock('axios', () => {
  const mockAxios = {
    get: vi.fn(),
    post: vi.fn(),
    create: vi.fn().mockReturnThis(),
  };
  return { default: mockAxios };
});

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    systemConfiguration: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    codeSession: {
      findFirst: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({ id: 'sess-new', user_id: 'user-1', model: 'db-chat' }),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock('../GitHubCredentialService.js', () => ({
  getGitHubCredentialService: vi.fn().mockReturnValue({
    getValidTokenString: vi.fn().mockResolvedValue(null),
  }),
}));

import axios from 'axios';
import { ModelConfigurationService } from '../ModelConfigurationService.js';
import { prisma } from '../../utils/prisma.js';
import { AgenticCodeService } from '../AgenticCodeService.js';

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
    getDefaultModel: vi.fn().mockReturnValue('pm-default'),
  };
}

/** Set up axios mocks to simulate code-manager creating a new session */
function setupAxiosMocks(model: string) {
  // GET /sessions/:id → 404 (no existing session running)
  (axios.get as any).mockRejectedValue({ response: { status: 404 } });
  // POST /sessions → created session
  (axios.post as any).mockResolvedValue({
    data: {
      status: 'created',
      sessionId: 'mgr-sess-1',
      session: { id: 'mgr-sess-1', model, workspacePath: '/workspaces/user-1' },
    },
  });
}

// ── suite ─────────────────────────────────────────────────────────────────────

describe('AgenticCodeService — DB is SoT for default model', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    (ModelConfigurationService.getDefaultChatModel as any).mockReset();
    (prisma.systemConfiguration.findMany as any).mockResolvedValue([]);
    (prisma.codeSession.findFirst as any).mockResolvedValue(null);
    (prisma.codeSession.upsert as any).mockResolvedValue({
      id: 'sess-new',
      user_id: 'user-1',
      model: 'placeholder',
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it('DB default chat model wins over poisoned env vars', async () => {
    process.env.DEFAULT_CODE_MODEL = 'env-poisoned-code';
    process.env.DEFAULT_MODEL = 'env-poisoned-default';

    (ModelConfigurationService.getDefaultChatModel as any).mockResolvedValue('db-chat');
    setupAxiosMocks('db-chat');

    const svc = new AgenticCodeService(makeLogger() as any, makeProviderManager() as any);

    // createSession with no model arg → uses dbSettings.defaultModel
    const session = await svc.createSession('user-1');

    // effectiveModel is used in the POST to manager; the session returned uses
    // sessionData.model || effectiveModel. With our mock, sessionData.model = 'db-chat'.
    expect(session.model).toBe('db-chat');
    expect(session.model).not.toBe('env-poisoned-code');
    expect(session.model).not.toBe('env-poisoned-default');
    expect(ModelConfigurationService.getDefaultChatModel).toHaveBeenCalled();
  });

  it('explicit config.defaultModel takes precedence over DB', async () => {
    process.env.DEFAULT_CODE_MODEL = 'env-poisoned-code';
    (ModelConfigurationService.getDefaultChatModel as any).mockResolvedValue('db-chat');
    setupAxiosMocks('config-pinned');

    const svc = new AgenticCodeService(makeLogger() as any, makeProviderManager() as any, {
      defaultModel: 'config-pinned',
    });

    const session = await svc.createSession('user-2');

    expect(session.model).toBe('config-pinned');
    expect(session.model).not.toBe('db-chat');
    expect(session.model).not.toBe('env-poisoned-code');
    // DB not needed when explicit config wins
  });

  it('DB fails → empty string fallback (preserves pre-fix behavior)', async () => {
    process.env.DEFAULT_CODE_MODEL = 'env-poisoned-code';
    process.env.DEFAULT_MODEL = 'env-poisoned-default';

    (ModelConfigurationService.getDefaultChatModel as any).mockRejectedValue(new Error('DB down'));
    setupAxiosMocks('');

    const svc = new AgenticCodeService(makeLogger() as any, makeProviderManager() as any);

    const session = await svc.createSession('user-3');

    // When DB fails, resolveDefaultModel() returns '' → effectiveModel = ''
    // sessionData.model from mock is '' → session.model = '' || '' = ''
    expect(session.model).toBe('');
    expect(session.model).not.toBe('env-poisoned-code');
    expect(session.model).not.toBe('env-poisoned-default');
  });
});
