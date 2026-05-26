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
    // Background indexing promise fires verifyToolSearch on its .then chain —
    // let it settle so it doesn't leak into the next test's beforeEach reset.
    await new Promise((r) => setTimeout(r, 20));
  });

  it('#1059: step 08 must NOT throw when Milvus connect fails on all retries — api boots on pgvector', async () => {
    // CLAUDE.md user direction 2026-05-22: "api starting up perfectly every time
    // is PRETTY fucking important". Step 07 (mcp-index) populates the PostgreSQL
    // pgvector source-of-truth before this step runs. If Milvus is unreachable,
    // the api MUST still come Ready and serve tool search via pgvector. The
    // throw at the end of the retry loop was the smoke gun for CrashLoopBackOff
    // on cold helm-install — fail-closed on a fallback service is wrong.
    const origSetTimeout = globalThis.setTimeout;
    (globalThis as any).setTimeout = (fn: () => void, _delay: number) => {
      fn();
      return 0 as any;
    };
    mockToolCacheInitialize.mockRejectedValue(new Error('cache unavailable'));
    const ctx = makeCtx();
    await expect(INIT_TOOL_CACHE.run(stubDeps(ctx))).resolves.toBeUndefined();
    expect(ctx.toolSemanticCacheInitialized).toBe(false);
    (globalThis as any).setTimeout = origSetTimeout;
  }, 15000);

  it('#1058: autoIndexToolsWhenReady runs in BACKGROUND — step.run() resolves even when indexing never finishes', async () => {
    // The actual hang on cold install: Milvus reports 0 rows post-insert and the indexer
    // re-enters auto-index forever. api stays 0/1 Ready until the runtime k8s probe
    // budget is exhausted. Step 08 must NEVER block on indexing.
    let resolveIndex: (() => void) | undefined;
    const neverResolves = new Promise<void>((resolve) => { resolveIndex = resolve; });
    mockAutoIndexToolsWhenReady.mockReturnValue(neverResolves);

    const ctx = makeCtx();
    // If step still awaits indexing, this test hits the 2s timeout below and fails.
    await INIT_TOOL_CACHE.run(stubDeps(ctx));

    expect(ctx.toolSemanticCache).toBeDefined();
    expect(ctx.toolSemanticCacheInitialized).toBe(true);
    // Indexing IS invoked — just not awaited.
    expect(mockAutoIndexToolsWhenReady).toHaveBeenCalled();

    // Release the hanging promise so the test process exits cleanly.
    resolveIndex?.();
  }, 2000);

  it('#1058: background-indexing rejection must NOT propagate — step.run() resolves cleanly', async () => {
    // If indexing rejects (Milvus unhealthy, MCP-proxy down, etc) the api still
    // becomes Ready. Tool search falls back to ToolPgvectorSearchService (pgvector).
    mockAutoIndexToolsWhenReady.mockRejectedValue(new Error('indexing failed'));
    const ctx = makeCtx();
    await expect(INIT_TOOL_CACHE.run(stubDeps(ctx))).resolves.toBeUndefined();
    expect(ctx.toolSemanticCacheInitialized).toBe(true);
    // Give the background promise a tick to settle so unhandled-rejection warning doesn't leak.
    await new Promise((r) => setTimeout(r, 10));
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

    it('#1058: with TOOL_INDEX_VERIFY_REQUIRED=true, verification failure logs but does NOT block startup', async () => {
      // Verification runs in the SAME background promise chain as indexing. Step 08
      // must return immediately. A hard-fail mode for verification is no longer
      // appropriate now that indexing is background — the api MUST come up so the
      // operator can investigate via the live system instead of crash-looping.
      process.env.TOOL_INDEX_VERIFY_REQUIRED = 'true';

      const { verifyToolSearch } = await import('../../services/startup-helpers/verifyToolSearch.js');
      (verifyToolSearch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        reason: 'no results returned',
        sampleToolNames: [],
      });

      const ctx = makeCtx();
      await expect(INIT_TOOL_CACHE.run(stubDeps(ctx))).resolves.toBeUndefined();
      expect(exitSpy).not.toHaveBeenCalled();
      // Let the background promise settle so its log lands before vi.clearAllMocks.
      await new Promise((r) => setTimeout(r, 10));
    });
  });
});
