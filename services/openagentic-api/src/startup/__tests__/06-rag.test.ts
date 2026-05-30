/**
 * Step 06 — rag-init
 * RED-first: step file does not exist yet.
 *
 * Phase 2 quality cleanup (BLOCKER-4): UserMemoryService must be initialized
 * with ctx.milvusClient (set by step 05), NOT (global as any).milvusClient
 * (which is never set by any step, always null).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppContext } from '../../context/AppContext.js';
import { createLoggerMock } from '../../test/mocks/logger.js';

vi.mock('../../services/RAGService.js', () => ({
  RAGService: vi.fn().mockImplementation(() => ({
    initializeCollection: vi.fn().mockResolvedValue({ success: true }),
    syncAllTemplates: vi.fn().mockResolvedValue({ synced: 0 }),
  })),
}));

vi.mock('../../services/RAGInitService.js', () => ({
  ragInitService: {
    initialize: vi.fn().mockResolvedValue(true),
    getHealthStatus: vi.fn().mockReturnValue({
      healthy: true,
      components: {
        embeddings: { provider: 'test', model: 'test-model' },
        milvus: { healthy: true },
      },
    }),
    getInitializationError: vi.fn().mockReturnValue(null),
  },
}));

vi.mock('../../services/DocumentIndexingService.js', () => ({
  DocumentIndexingService: vi.fn().mockImplementation(() => ({
    initializeCollection: vi.fn().mockResolvedValue(undefined),
  })),
}));

const mockInitUserMemoryService = vi.fn();
vi.mock('../../services/UserMemoryService.js', () => ({
  initUserMemoryService: mockInitUserMemoryService,
}));

vi.mock('../../services/UserProfileService.js', () => ({
  initUserProfileService: vi.fn(),
}));

vi.mock('../../services/FeedbackLearningService.js', () => ({
  initFeedbackLearningService: vi.fn(),
}));

vi.mock('../../utils/redis-client.js', () => ({
  getRedisClient: vi.fn().mockReturnValue({
    isConnected: vi.fn().mockReturnValue(false),
  }),
}));

vi.mock('../../utils/prisma.js', () => ({
  prisma: {},
}));

vi.mock('../../utils/logger.js', () => createLoggerMock());

import { INIT_RAG } from '../06-rag.js';
import type { BootstrapDeps } from '../types.js';

function makeCtx(milvusClient: any = { checkHealth: vi.fn() }) {
  const ctx = new AppContext({ prisma: {} as any, logger: {} as any });
  ctx.milvusClient = milvusClient;
  return ctx;
}

const stubDeps = (ctx = makeCtx()): BootstrapDeps => ({
  server: {} as any,
  ctx,
});

describe('INIT_RAG step', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has correct name and critical=false', () => {
    expect(INIT_RAG.name).toBe('rag-init');
    expect(INIT_RAG.critical).toBe(false);
  });

  it('sets ctx.ragService after run', async () => {
    const ctx = makeCtx();
    await INIT_RAG.run(stubDeps(ctx));
    expect(ctx.ragService).toBeDefined();
  });

  it('does NOT throw when RAGService fails (non-critical)', async () => {
    const { RAGService } = await import('../../services/RAGService.js');
    (RAGService as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      initializeCollection: vi.fn().mockRejectedValue(new Error('rag down')),
      syncAllTemplates: vi.fn(),
    }));
    await expect(INIT_RAG.run(stubDeps())).resolves.toBeUndefined();
  });

  describe('BLOCKER-4: UserMemoryService initialized with ctx.milvusClient, not global.milvusClient', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      // Ensure global.milvusClient is NOT set (so if step reads global it gets undefined)
      delete (global as any).milvusClient;
    });

    it('passes ctx.milvusClient (not null) to initUserMemoryService when milvusClient is in ctx', async () => {
      const mockMilvusClient = { checkHealth: vi.fn(), marker: 'from-ctx' };
      const ctx = makeCtx(mockMilvusClient);

      await INIT_RAG.run(stubDeps(ctx));

      // initUserMemoryService should have been called with the milvus client from ctx
      expect(mockInitUserMemoryService).toHaveBeenCalled();
      const callArgs = mockInitUserMemoryService.mock.calls[0];
      // 4th argument is milvusClient (prisma, redis, logger, milvusClient, embeddingService)
      expect(callArgs[3]).toBe(mockMilvusClient);
    });

    it('passes null to initUserMemoryService when ctx.milvusClient is null', async () => {
      const ctx = makeCtx(null);

      await INIT_RAG.run(stubDeps(ctx));

      expect(mockInitUserMemoryService).toHaveBeenCalled();
      const callArgs = mockInitUserMemoryService.mock.calls[0];
      expect(callArgs[3]).toBeNull();
    });
  });
});
