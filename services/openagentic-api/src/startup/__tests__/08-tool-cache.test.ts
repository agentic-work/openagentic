/**
 * Step 08 — tool-cache-init
 * RED-first: step file does not exist yet.
 *
 * Phase 2 follow-up: asserts critical=true + fail-fast behaviour that matches
 * pre-Phase-2 server.ts (commit 28be96f6 lines 2595, 2605 called process.exit(1)).
 *
 * Phase 2 quality cleanup (BLOCKER-2): step body must THROW instead of calling
 * process.exit(1) directly. Orchestrator owns the single exit point.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AppContext } from '../../context/AppContext.js';
import { createLoggerMock } from '../../test/mocks/logger.js';

const mockToolCacheInitialize = vi.fn().mockResolvedValue(undefined);
const mockAutoIndexToolsWhenReady = vi.fn().mockResolvedValue(undefined);
const MockToolSemanticCacheService = vi.fn().mockImplementation(() => ({
  initialize: mockToolCacheInitialize,
  autoIndexToolsWhenReady: mockAutoIndexToolsWhenReady,
  getCacheStats: vi.fn().mockResolvedValue({ totalTools: 5 }),
}));

vi.mock('../../services/ToolSemanticCacheService.js', () => ({
  default: MockToolSemanticCacheService,
  setToolSemanticCache: vi.fn(),
  getToolSemanticCache: vi.fn().mockReturnValue(null),
}));

vi.mock('../../services/ToolPgvectorSearchService.js', () => ({
  ToolPgvectorSearchService: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn().mockReturnValue(true),
  })),
  setToolPgvectorSearchService: vi.fn(),
}));

vi.mock('../../services/UniversalEmbeddingService.js', () => ({
  UniversalEmbeddingService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../services/startup-helpers/verifyToolSearch.js', () => ({
  verifyToolSearch: vi.fn().mockResolvedValue({ ok: true, sampleToolNames: ['tool1'] }),
}));

vi.mock('../../utils/prisma.js', () => ({
  prisma: {},
}));

vi.mock('../../utils/logger.js', () => createLoggerMock());

import { INIT_TOOL_CACHE } from '../08-tool-cache.js';
import type { BootstrapDeps } from '../types.js';

function makeCtx() {
  return new AppContext({ prisma: {} as any, logger: {} as any });
}

const stubDeps = (ctx = makeCtx()): BootstrapDeps => ({
  server: {} as any,
  ctx,
});

describe('INIT_TOOL_CACHE step', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mocks to default success path
    mockToolCacheInitialize.mockResolvedValue(undefined);
    mockAutoIndexToolsWhenReady.mockResolvedValue(undefined);
  });

  it('has correct name and critical=true (pre-Phase-2 process.exit(1) behaviour)', () => {
    expect(INIT_TOOL_CACHE.name).toBe('tool-cache-init');
    expect(INIT_TOOL_CACHE.critical).toBe(true);
  });

  it('sets ctx.toolSemanticCache and ctx.toolSemanticCacheInitialized after success', async () => {
    const ctx = makeCtx();
    await INIT_TOOL_CACHE.run(stubDeps(ctx));
    expect(ctx.toolSemanticCache).toBeDefined();
    expect(ctx.toolSemanticCacheInitialized).toBe(true);
  });

  it('THROWS (rejects) when ToolSemanticCacheService.initialize fails on all retries — orchestrator calls process.exit(1) for critical steps', async () => {
    // Make all 10 retry attempts fail instantly (stub setTimeout to no-op)
    const origSetTimeout = globalThis.setTimeout;
    (globalThis as any).setTimeout = (fn: () => void, _delay: number) => {
      fn();
      return 0 as any;
    };
    mockToolCacheInitialize.mockRejectedValue(new Error('cache unavailable'));
    const ctx = makeCtx();
    await expect(INIT_TOOL_CACHE.run(stubDeps(ctx))).rejects.toThrow('Cannot connect to Milvus after 10 attempts');
    (globalThis as any).setTimeout = origSetTimeout;
  }, 15000);

  it('THROWS (rejects) when autoIndexToolsWhenReady fails — orchestrator calls process.exit(1) for critical steps', async () => {
    mockAutoIndexToolsWhenReady.mockRejectedValue(new Error('indexing failed'));
    const ctx = makeCtx();
    await expect(INIT_TOOL_CACHE.run(stubDeps(ctx))).rejects.toThrow('indexing failed');
  });

  describe('BLOCKER-2: TOOL_INDEX_VERIFY_REQUIRED=true must THROW, not process.exit(1)', () => {
    let exitSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: any) => {
        throw new Error('process.exit was called (orchestrator contract violation)');
      });
    });

    afterEach(() => {
      exitSpy.mockRestore();
      delete process.env.TOOL_INDEX_VERIFY_REQUIRED;
    });

    it('rejects with an Error (not via process.exit) when verification fails and TOOL_INDEX_VERIFY_REQUIRED=true', async () => {
      process.env.TOOL_INDEX_VERIFY_REQUIRED = 'true';

      // Override the verifyToolSearch mock to return failed verification
      const { verifyToolSearch } = await import('../../services/startup-helpers/verifyToolSearch.js');
      (verifyToolSearch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        reason: 'no results returned',
        sampleToolNames: [],
      });

      const ctx = makeCtx();
      // Must reject via thrown Error, not via process.exit
      await expect(INIT_TOOL_CACHE.run(stubDeps(ctx))).rejects.toThrow(
        'Post-indexing verification did not pass'
      );

      // process.exit must NOT have been called (would have thrown a different error)
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });
});
