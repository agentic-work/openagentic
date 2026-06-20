/**
 * Phase 8 — V3 pre-loop compaction trigger (TDD RED first).
 *
 * the design notes
 *
 * `runChat` must consult `contextManagementService.getContextUsage()` BEFORE
 * invoking chatLoop. When `usagePercentage >= 65` (soft threshold), it must
 * call `compactContext(sessionId, model)` so the next provider call sees a
 * smaller buffer.
 *
 * Tests use a `contextMgmt` deps-injected stub so we don't need to bootstrap
 * Prisma. The implementation defaults to the singleton when deps.contextMgmt
 * is omitted.
 *
 * Compaction failure is non-fatal — the loop continues and the user's turn
 * still runs. The compaction is best-effort.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runChat } from '../runChat.js';

beforeEach(() => {
  // Module under test caches state between calls; nothing to reset here
  // (each test instantiates its own deps).
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeCtx(sessionId = 'sess-compact-1') {
  return {
    emit: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    sessionId,
    userId: 'user-compact',
    user: { isAdmin: false, id: 'user-compact', email: 'u@test' },
  };
}

function makeProviderManagerStub() {
  return {
    getStreamFormatForModel: () => 'openai',
    createCompletion: vi.fn(async () => {
      async function* gen() {
        yield {
          id: 'cmpl-1',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' } }],
        };
        yield {
          id: 'cmpl-1',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        };
      }
      return gen();
    }),
  };
}

describe('runChat — pre-loop compaction trigger', () => {
  it('calls compactContext when usagePercentage >= 65% before chatLoop starts', async () => {
    const ctx = makeCtx('sess-1');
    const providerManager = makeProviderManagerStub();
    const ctxMgmt = {
      getContextUsage: vi.fn().mockResolvedValue({
        sessionId: 'sess-1',
        currentTokens: 7000,
        maxTokens: 10000,
        usagePercentage: 70,
        messagesCount: 80,
        needsCompaction: true,
        compactionLevel: 'light',
      }),
      compactContext: vi.fn().mockResolvedValue({
        sessionId: 'sess-1',
        messagesRemoved: 20,
        messagesSummarized: 5,
        tokensFreed: 3500,
        newTokenCount: 3500,
        compactionLevel: 'light',
        timestamp: new Date(),
      }),
    };

    const deps: any = {
      providerManager,
      listAgents: async () => [],
      executeMcpTool: vi.fn(),
      prismaLike: undefined,
      contextMgmt: ctxMgmt,
    };

    const input: any = {
      userMessage: 'hello',
      priorMessages: [],
      model: 'configured-chat-model',
      attachments: [],
      mcpTools: [],
      maxTurns: 12,
    };

    await runChat(ctx as any, input, deps);

    expect(ctxMgmt.getContextUsage).toHaveBeenCalledWith('sess-1', 'configured-chat-model');
    expect(ctxMgmt.compactContext).toHaveBeenCalledWith('sess-1', 'configured-chat-model');
  });

  it('does NOT call compactContext when usagePercentage < 65%', async () => {
    const ctx = makeCtx('sess-2');
    const providerManager = makeProviderManagerStub();
    const ctxMgmt = {
      getContextUsage: vi.fn().mockResolvedValue({
        sessionId: 'sess-2',
        currentTokens: 3000,
        maxTokens: 10000,
        usagePercentage: 30,
        messagesCount: 20,
        needsCompaction: false,
        compactionLevel: 'none',
      }),
      compactContext: vi.fn(),
    };
    const deps: any = {
      providerManager,
      listAgents: async () => [],
      executeMcpTool: vi.fn(),
      prismaLike: undefined,
      contextMgmt: ctxMgmt,
    };
    const input: any = {
      userMessage: 'hi',
      priorMessages: [],
      model: 'm',
      attachments: [],
      mcpTools: [],
      maxTurns: 12,
    };

    await runChat(ctx as any, input, deps);

    expect(ctxMgmt.getContextUsage).toHaveBeenCalled();
    expect(ctxMgmt.compactContext).not.toHaveBeenCalled();
  });

  it('threshold is exactly 65% (boundary at 64% does not trigger; 65% does)', async () => {
    // 64% — should NOT trigger
    {
      const ctx = makeCtx('sess-64');
      const providerManager = makeProviderManagerStub();
      const ctxMgmt = {
        getContextUsage: vi.fn().mockResolvedValue({
          sessionId: 'sess-64',
          currentTokens: 6400,
          maxTokens: 10000,
          usagePercentage: 64,
          messagesCount: 50,
          needsCompaction: false,
          compactionLevel: 'none',
        }),
        compactContext: vi.fn(),
      };
      const deps: any = {
        providerManager,
        listAgents: async () => [],
        executeMcpTool: vi.fn(),
        prismaLike: undefined,
        contextMgmt: ctxMgmt,
      };
      await runChat(
        ctx as any,
        { userMessage: 'x', priorMessages: [], model: 'm', attachments: [], mcpTools: [], maxTurns: 12 } as any,
        deps,
      );
      expect(ctxMgmt.compactContext).not.toHaveBeenCalled();
    }

    // 65% — SHOULD trigger
    {
      const ctx = makeCtx('sess-65');
      const providerManager = makeProviderManagerStub();
      const ctxMgmt = {
        getContextUsage: vi.fn().mockResolvedValue({
          sessionId: 'sess-65',
          currentTokens: 6500,
          maxTokens: 10000,
          usagePercentage: 65,
          messagesCount: 50,
          // Phase 8 contract — V3 uses the percentage directly, not needsCompaction.
          // ContextManagementService's needsCompaction goes true at 70 (light) /
          // 85 (medium) / 95 (aggressive). V3's pre-loop fires SOFT at 65 — earlier
          // than the service's lightest level — so the percentage check is the gate.
          needsCompaction: false,
          compactionLevel: 'none',
        }),
        compactContext: vi.fn().mockResolvedValue(null),
      };
      const deps: any = {
        providerManager,
        listAgents: async () => [],
        executeMcpTool: vi.fn(),
        prismaLike: undefined,
        contextMgmt: ctxMgmt,
      };
      await runChat(
        ctx as any,
        { userMessage: 'x', priorMessages: [], model: 'm', attachments: [], mcpTools: [], maxTurns: 12 } as any,
        deps,
      );
      expect(ctxMgmt.compactContext).toHaveBeenCalled();
    }
  });

  it('compaction failure does NOT throw (logs + continues)', async () => {
    const ctx = makeCtx('sess-fail');
    const providerManager = makeProviderManagerStub();
    const ctxMgmt = {
      getContextUsage: vi.fn().mockResolvedValue({
        sessionId: 'sess-fail',
        currentTokens: 7000,
        maxTokens: 10000,
        usagePercentage: 70,
        messagesCount: 80,
        needsCompaction: true,
        compactionLevel: 'light',
      }),
      compactContext: vi.fn().mockRejectedValue(new Error('compaction failed')),
    };
    const deps: any = {
      providerManager,
      listAgents: async () => [],
      executeMcpTool: vi.fn(),
      prismaLike: undefined,
      contextMgmt: ctxMgmt,
    };
    const input: any = {
      userMessage: 'hi',
      priorMessages: [],
      model: 'm',
      attachments: [],
      mcpTools: [],
      maxTurns: 12,
    };

    // Must NOT throw — chatLoop continues even when compaction errors.
    const result = await runChat(ctx as any, input, deps);

    // Provider was still invoked → loop ran.
    expect(providerManager.createCompletion).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    // Warn log fired so the operator sees the degradation.
    expect(ctx.logger.warn).toHaveBeenCalled();
  });

  it('skips compaction silently when sessionId is missing (no-op for stateless calls)', async () => {
    const ctx = {
      emit: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      sessionId: undefined,
      userId: 'u',
      user: {},
    };
    const providerManager = makeProviderManagerStub();
    const ctxMgmt = {
      getContextUsage: vi.fn(),
      compactContext: vi.fn(),
    };
    const deps: any = {
      providerManager,
      listAgents: async () => [],
      executeMcpTool: vi.fn(),
      prismaLike: undefined,
      contextMgmt: ctxMgmt,
    };
    await runChat(
      ctx as any,
      { userMessage: 'x', priorMessages: [], model: 'm', attachments: [], mcpTools: [], maxTurns: 12 } as any,
      deps,
    );
    // No sessionId → don't even check usage.
    expect(ctxMgmt.getContextUsage).not.toHaveBeenCalled();
    expect(ctxMgmt.compactContext).not.toHaveBeenCalled();
  });
});
