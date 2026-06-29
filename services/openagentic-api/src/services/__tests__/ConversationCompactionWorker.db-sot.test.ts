/**
 * Red-green lock for SoT fix in ConversationCompactionWorker (plan task 4).
 *
 * Pre-fix code read:
 *   this.compactionModel = process.env.COMPACTION_MODEL || process.env.DEFAULT_MODEL;
 * and logged that cached value in the start() method.
 *
 * Fix: remove the cached field; resolveCompactionModel() async method re-reads
 * from ModelConfigurationService.getServiceModel('compaction') per call (Pattern A).
 *
 * The three use sites of this.compactionModel are all in logger.info() calls:
 *   - Constructor (line ~77): model field dropped (constructor can't await)
 *   - start() first log (line ~107): resolved via await resolveCompactionModel()
 *   - start() second log (line ~137): resolved via await resolveCompactionModel()
 *
 * Scenarios:
 *   1. DB compaction assignment wins over poisoned env vars
 *   2. Null service assignment falls through to getDefaultChatModel()
 *   3. Both DB calls reject → resolveCompactionModel() propagates / returns ''
 *      (pre-fix: model was process.env.DEFAULT_MODEL, which could be undefined
 *       — same propagation semantics, just via DB path now)
 *
 * Note: ConversationCompactionWorker does NOT make LLM calls directly; it uses
 * CompactionEngine.generateHeuristicSummary() (no network). The model string
 * appears only in logger.info() calls. We spy on the logger to verify resolution.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../ModelConfigurationService.js', () => ({
  ModelConfigurationService: {
    getServiceModel: vi.fn(),
    getDefaultChatModel: vi.fn(),
  },
}));

// CompactionEngine is used inside summarizeConversation — mock so start() can proceed
vi.mock('../context/CompactionEngine.js', () => ({
  CompactionEngine: vi.fn().mockImplementation(() => ({
    generateHeuristicSummary: vi.fn().mockReturnValue({
      text: 'stub summary',
      toolsUsed: [],
      topics: [],
      keyDecisions: [],
    }),
  })),
}));

import { ModelConfigurationService } from '../ModelConfigurationService.js';
import { ConversationCompactionWorker } from '../ConversationCompactionWorker.js';
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

function makeConfig(logger: ReturnType<typeof makeLogger>) {
  return {
    prisma: {} as any,
    redis: {
      duplicate: vi.fn().mockResolvedValue({
        subscribe: vi.fn().mockResolvedValue(undefined),
      }),
      keys: vi.fn().mockResolvedValue([]),
    } as any,
    logger: logger as any,
    enabled: true,
    delayHours: 0,
  };
}

// ── suite ─────────────────────────────────────────────────────────────────────

describe('ConversationCompactionWorker — DB is SoT for compaction model', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    (ModelConfigurationService.getServiceModel as any).mockReset();
    (ModelConfigurationService.getDefaultChatModel as any).mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it('uses DB service assignment and ignores poisoned env vars (logged in start())', async () => {
    process.env.COMPACTION_MODEL = 'env-poisoned';
    process.env.DEFAULT_MODEL = 'env-poisoned-default';

    (ModelConfigurationService.getServiceModel as any).mockResolvedValue({
      modelId: 'db-compaction-model',
      provider: TEST_PROVIDER_TYPE,
    });
    (ModelConfigurationService.getDefaultChatModel as any).mockResolvedValue('db-chat');

    const logger = makeLogger();
    const worker = new ConversationCompactionWorker(makeConfig(logger));
    await worker.start();

    // start() logs model info — all log calls that include a `model` field
    // must carry 'db-compaction-model', never 'env-poisoned' or 'env-poisoned-default'.
    const calls = logger.info.mock.calls;
    const modelCalls = calls.filter(([meta]: any[]) => meta && typeof meta === 'object' && 'model' in meta);

    expect(modelCalls.length).toBeGreaterThan(0);
    for (const [meta] of modelCalls) {
      expect(meta.model).toBe('db-compaction-model');
      expect(meta.model).not.toBe('env-poisoned');
      expect(meta.model).not.toBe('env-poisoned-default');
    }
    expect(ModelConfigurationService.getServiceModel).toHaveBeenCalledWith('compaction');
  });

  it('falls through to getDefaultChatModel when service assignment is null', async () => {
    process.env.COMPACTION_MODEL = 'env-poisoned';
    process.env.DEFAULT_MODEL = 'env-poisoned-default';

    (ModelConfigurationService.getServiceModel as any).mockResolvedValue(null);
    (ModelConfigurationService.getDefaultChatModel as any).mockResolvedValue('db-chat');

    const logger = makeLogger();
    const worker = new ConversationCompactionWorker(makeConfig(logger));
    await worker.start();

    const calls = logger.info.mock.calls;
    const modelCalls = calls.filter(([meta]: any[]) => meta && typeof meta === 'object' && 'model' in meta);

    expect(modelCalls.length).toBeGreaterThan(0);
    for (const [meta] of modelCalls) {
      expect(meta.model).toBe('db-chat');
      expect(meta.model).not.toBe('env-poisoned');
      expect(meta.model).not.toBe('env-poisoned-default');
    }
    expect(ModelConfigurationService.getDefaultChatModel).toHaveBeenCalled();
  });

  it('propagates DB failure gracefully (start() does not crash)', async () => {
    // Pre-fix behaviour when both env vars were unset: this.compactionModel was
    // undefined; logger.info received { model: undefined } — no crash, just a
    // log entry with undefined model. Post-fix: resolveCompactionModel() returns
    // '' (empty string) or rethrows depending on implementation; start() must
    // not throw in either case (it has its own try/catch or the caller handles).
    process.env.COMPACTION_MODEL = 'env-poisoned';
    process.env.DEFAULT_MODEL = 'env-poisoned-default';

    (ModelConfigurationService.getServiceModel as any).mockRejectedValue(new Error('DB down'));
    (ModelConfigurationService.getDefaultChatModel as any).mockRejectedValue(new Error('DB down'));

    const logger = makeLogger();
    const worker = new ConversationCompactionWorker(makeConfig(logger));

    // start() must not throw — any DB error in resolveCompactionModel() should be
    // caught within resolveCompactionModel() itself (returns '' or rethrows and
    // start() wraps appropriately).
    // If this fails with unhandled rejection, the implementation needs a try/catch.
    await expect(worker.start()).resolves.not.toThrow();

    // The env-poisoned values must NOT appear in any log model field
    const calls = logger.info.mock.calls;
    const modelCalls = calls.filter(([meta]: any[]) => meta && typeof meta === 'object' && 'model' in meta);
    for (const [meta] of modelCalls) {
      expect(meta.model).not.toBe('env-poisoned');
      expect(meta.model).not.toBe('env-poisoned-default');
    }
  });
});
