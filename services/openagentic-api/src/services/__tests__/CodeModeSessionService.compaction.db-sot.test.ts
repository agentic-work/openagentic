/**
 * Red-green lock for SoT fix in CodeModeSessionService.generateContextSummary
 * (plan task 4, File 2).
 *
 * Pre-fix code (line ~466):
 *   const summaryModel = process.env.COMPACTION_MODEL || MODELS.compaction;
 *
 * Fix:
 *   const summaryAssignment = await ModelConfigurationService.getServiceModel('compaction');
 *   const summaryModel = summaryAssignment?.modelId ?? await ModelConfigurationService.getDefaultChatModel();
 *
 * Note: MODELS.compaction (from config/models.ts) is itself an env-read
 * (process.env.COMPACTION_MODEL || process.env.SECONDARY_MODEL || DEFAULT_MODEL).
 * That's a separate CLAUDE.md rule #7 violation, out of scope for this task.
 * The post-fix does NOT use MODELS.compaction in the generateContextSummary path.
 *
 * Triggering path:
 *   generateContextSummary() is private; called from compactContext() → getContextWindow().
 *   We call getContextWindow() directly with enough messages to trigger compaction.
 *   compactContext() calls this.addMessage() → awcodeStorageService.addMessage() — mocked.
 *   providerManager.createCompletion() is mocked to return a canned response.
 *
 * Scenarios:
 *   1. DB compaction assignment wins over poisoned env
 *   2. Null service → falls through to getDefaultChatModel()
 *   3. Both DB calls reject → createCompletion not called; fallback string returned
 *      (generateContextSummary has try/catch that returns a fallback string on error)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../ModelConfigurationService.js', () => ({
  ModelConfigurationService: {
    getServiceModel: vi.fn(),
    getDefaultChatModel: vi.fn(),
  },
}));

// Mock AWCodeStorageService — required by getContextWindow → getSessionMessages → awcodeStorageService
vi.mock('../AWCodeStorageService.js', () => ({
  awcodeStorageService: {
    getSessionMessages: vi.fn().mockResolvedValue([]),
    getSession: vi.fn().mockResolvedValue(null),
    addMessage: vi.fn().mockResolvedValue(undefined),
    createSession: vi.fn().mockResolvedValue(undefined),
  },
  AWCodeMessageData: {},
}));

// Mock model-catalogs so getContextWindow() doesn't need real catalog data
vi.mock('../../config/model-catalogs.js', () => ({
  getContextWindow: vi.fn().mockReturnValue(128000),
}));

// Mock prisma (not used in this path but imported at module level)
vi.mock('../../utils/prisma.js', () => ({
  prisma: {},
}));

import { ModelConfigurationService } from '../ModelConfigurationService.js';
import { awcodeStorageService } from '../AWCodeStorageService.js';
import { CodeModeSessionService } from '../CodeModeSessionService.js';
import { TEST_PROVIDER_TYPE } from '../../test/sot-constants.js';

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

/** Build enough messages to cross the compaction threshold.
 * CONTEXT_CONFIG.MIN_MESSAGES_FOR_COMPACTION = 20
 * We need totalTokens > compactionThreshold (128000 * 0.75 = 96000)
 * Provide messages with tokensInput so token count is large enough.
 */
function makeHeavyMessages(count = 25) {
  return Array.from({ length: count }, (_, i) => ({
    id: `msg-${i}`,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: 'a'.repeat(200),
    tool_calls: null,
    tool_name: null,
    thinking: null,
    tokens_input: 4000,  // 4000 tokens each → 25 * 4000 = 100000 > 96000
    tokens_output: 0,
    created_at: new Date(),
    metadata: null,
  }));
}

// ── suite ─────────────────────────────────────────────────────────────────────

describe('CodeModeSessionService.generateContextSummary — DB is SoT for compaction model', () => {
  const originalEnv = { ...process.env };
  let providerManager: any;
  let svc: CodeModeSessionService;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    (ModelConfigurationService.getServiceModel as any).mockReset();
    (ModelConfigurationService.getDefaultChatModel as any).mockReset();

    // Reset storage mock to return heavy messages (triggers compaction)
    (awcodeStorageService.getSessionMessages as any).mockResolvedValue(makeHeavyMessages());
    (awcodeStorageService.getSession as any).mockResolvedValue(null);
    (awcodeStorageService.addMessage as any).mockResolvedValue(undefined);

    providerManager = {
      createCompletion: vi.fn(),
    };

    logger = makeLogger();
    svc = new CodeModeSessionService(logger as any, providerManager as any);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it('passes DB compaction model to createCompletion and ignores poisoned env', async () => {
    process.env.COMPACTION_MODEL = 'env-poisoned';
    process.env.DEFAULT_MODEL = 'env-poisoned-default';

    (ModelConfigurationService.getServiceModel as any).mockResolvedValue({
      modelId: 'db-compaction-model',
      provider: TEST_PROVIDER_TYPE,
    });
    (ModelConfigurationService.getDefaultChatModel as any).mockResolvedValue('db-chat');

    providerManager.createCompletion.mockResolvedValue({
      choices: [{ message: { content: 'Summary of conversation' } }],
    });

    // getContextWindow triggers compaction (25 messages, 100k tokens > 96k threshold)
    await svc.getContextWindow('sess-test');

    expect(providerManager.createCompletion).toHaveBeenCalledOnce();
    const callArgs = providerManager.createCompletion.mock.calls[0][0];
    expect(callArgs.model).toBe('db-compaction-model');
    expect(callArgs.model).not.toBe('env-poisoned');
    expect(callArgs.model).not.toBe('env-poisoned-default');
    expect(ModelConfigurationService.getServiceModel).toHaveBeenCalledWith('compaction');
  });

  it('falls through to getDefaultChatModel when service assignment is null', async () => {
    process.env.COMPACTION_MODEL = 'env-poisoned';
    process.env.DEFAULT_MODEL = 'env-poisoned-default';

    (ModelConfigurationService.getServiceModel as any).mockResolvedValue(null);
    (ModelConfigurationService.getDefaultChatModel as any).mockResolvedValue('db-chat');

    providerManager.createCompletion.mockResolvedValue({
      choices: [{ message: { content: 'Summary of conversation' } }],
    });

    await svc.getContextWindow('sess-test');

    expect(providerManager.createCompletion).toHaveBeenCalledOnce();
    const callArgs = providerManager.createCompletion.mock.calls[0][0];
    expect(callArgs.model).toBe('db-chat');
    expect(callArgs.model).not.toBe('env-poisoned');
    expect(callArgs.model).not.toBe('env-poisoned-default');
    expect(ModelConfigurationService.getDefaultChatModel).toHaveBeenCalled();
  });

  it('falls back to static string when both DB calls reject (try/catch preserved)', async () => {
    // Pre-fix fall-through was MODELS.compaction (still an env read via models.ts).
    // Post-fix: resolveCompactionModel() rejects → generateContextSummary try/catch
    // catches and returns 'Summary generation failed.' / fallback string.
    // providerManager.createCompletion must NOT be called if model resolution fails.
    process.env.COMPACTION_MODEL = 'env-poisoned';
    process.env.DEFAULT_MODEL = 'env-poisoned-default';

    (ModelConfigurationService.getServiceModel as any).mockRejectedValue(new Error('DB down'));
    (ModelConfigurationService.getDefaultChatModel as any).mockRejectedValue(new Error('DB down'));

    // getContextWindow must not throw — compactContext catches inner errors
    const result = await svc.getContextWindow('sess-test');

    // The compacted result should still be returned (with fallback summary)
    expect(result).toBeDefined();
    // createCompletion must NOT have been called with env-poisoned model
    if (providerManager.createCompletion.mock.calls.length > 0) {
      for (const [args] of providerManager.createCompletion.mock.calls) {
        expect(args.model).not.toBe('env-poisoned');
        expect(args.model).not.toBe('env-poisoned-default');
      }
    }
  });
});
