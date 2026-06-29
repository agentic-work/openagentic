/**
 * Phase 9 — V3 memory injection at turn start (TDD RED first).
 *
 * the design notes
 *
 * Asserts that runChat calls AgentMemoryService.recall on turn 1 and,
 * when hits are returned, prepends a `<memories>` block ABOVE the
 * `<session-facts>` block ABOVE the user's actual message:
 *
 *   <memories>
 *     - {key}: {value}
 *     - ...
 *   </memories>
 *
 *   <session-facts>...</session-facts>
 *
 *   {original user message}
 *
 * Empty-recall returns NO `<memories>` block. Subsequent loop iterations
 * within the same chatLoop invocation must NOT re-inject (Phase 7 contract
 * extended to memory).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runChat } from '../runChat.js';

vi.mock('../../../../../services/AgentMemoryService.js', () => ({
  getAgentMemoryService: vi.fn(),
}));
import { getAgentMemoryService } from '../../../../../services/AgentMemoryService.js';

let capturedRequests: any[] = [];

beforeEach(() => {
  capturedRequests = [];
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeCtx() {
  return {
    emit: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    sessionId: 'sess-mem-1',
    userId: 'user-mem-1',
    user: { isAdmin: false, id: 'user-mem-1' },
  };
}

function makeProviderManagerStub() {
  return {
    getStreamFormatForModel: () => 'openai',
    createCompletion: vi.fn(async (oaiRequest: any) => {
      capturedRequests.push(oaiRequest);
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

describe('runChat — memory injection (Phase 9)', () => {
  it('prepends <memories> block when AgentMemoryService.recall returns hits', async () => {
    const recallMock = vi.fn(async () => [
      { id: 'm1', category: 'user', key: 'preferred_cloud', value: 'azure', confidence: 1.0 },
      { id: 'm2', category: 'user', key: 'project_name', value: 'foo-svc', confidence: 0.9 },
    ]);
    (getAgentMemoryService as any).mockReturnValue({ recall: recallMock });

    const ctx = makeCtx();
    const providerManager = makeProviderManagerStub();
    const deps: any = {
      providerManager,
      listAgents: async () => [],
      executeMcpTool: vi.fn(),
      prismaLike: undefined,
    };
    const input: any = {
      userMessage: 'what is my preferred cloud?',
      priorMessages: [],
      model: 'm',
      attachments: [],
      mcpTools: [],
      maxTurns: 12,
    };

    await runChat(ctx as any, input, deps);

    expect(recallMock).toHaveBeenCalled();
    const firstReq = capturedRequests[0];
    const messages = firstReq.messages ?? [];
    const firstUser = messages.find((m: any) => m.role === 'user');
    const c =
      typeof firstUser.content === 'string' ? firstUser.content : JSON.stringify(firstUser.content);
    expect(c).toContain('<memories>');
    expect(c).toContain('</memories>');
    expect(c).toContain('preferred_cloud');
    expect(c).toContain('azure');
    expect(c).toContain('foo-svc');
  });

  it('does NOT inject <memories> block when recall returns empty array', async () => {
    const recallMock = vi.fn(async () => []);
    (getAgentMemoryService as any).mockReturnValue({ recall: recallMock });

    const ctx = makeCtx();
    const providerManager = makeProviderManagerStub();
    const deps: any = {
      providerManager,
      listAgents: async () => [],
      executeMcpTool: vi.fn(),
      prismaLike: undefined,
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

    const firstReq = capturedRequests[0];
    const messages = firstReq.messages ?? [];
    const firstUser = messages.find((m: any) => m.role === 'user');
    const c =
      typeof firstUser.content === 'string' ? firstUser.content : JSON.stringify(firstUser.content);
    expect(c).not.toContain('<memories>');
  });

  it('memory block injected at most ONCE across all loop iterations', async () => {
    const recallMock = vi.fn(async () => [
      { id: 'm1', category: 'user', key: 'k', value: 'v', confidence: 1.0 },
    ]);
    (getAgentMemoryService as any).mockReturnValue({ recall: recallMock });

    const ctx = makeCtx();
    const providerManager = makeProviderManagerStub();
    const deps: any = {
      providerManager,
      listAgents: async () => [],
      executeMcpTool: vi.fn(),
      prismaLike: undefined,
    };
    const input: any = {
      userMessage: 'x',
      priorMessages: [],
      model: 'm',
      attachments: [],
      mcpTools: [],
      maxTurns: 12,
    };
    await runChat(ctx as any, input, deps);

    for (const req of capturedRequests) {
      const messages = req.messages ?? [];
      const memCount = messages.filter((m: any) => {
        const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        return c.includes('<memories>');
      }).length;
      expect(memCount).toBeLessThanOrEqual(1);
    }
  });

  it('escapes HTML special chars (& < > ") in memory content', async () => {
    const recallMock = vi.fn(async () => [
      { id: 'm1', category: 'user', key: 'tag', value: 'hello & <world> "quoted"', confidence: 1.0 },
    ]);
    (getAgentMemoryService as any).mockReturnValue({ recall: recallMock });

    const ctx = makeCtx();
    const providerManager = makeProviderManagerStub();
    const deps: any = {
      providerManager,
      listAgents: async () => [],
      executeMcpTool: vi.fn(),
      prismaLike: undefined,
    };
    const input: any = {
      userMessage: 'recall',
      priorMessages: [],
      model: 'm',
      attachments: [],
      mcpTools: [],
      maxTurns: 12,
    };
    await runChat(ctx as any, input, deps);

    const firstReq = capturedRequests[0];
    const messages = firstReq.messages ?? [];
    const firstUser = messages.find((m: any) => m.role === 'user');
    const c =
      typeof firstUser.content === 'string' ? firstUser.content : JSON.stringify(firstUser.content);
    // Original chars MUST NOT appear unescaped inside the memory block
    // (we look for the escaped forms instead)
    expect(c).toContain('&amp;');
    expect(c).toContain('&lt;');
    expect(c).toContain('&gt;');
    expect(c).toContain('&quot;');
  });
});
