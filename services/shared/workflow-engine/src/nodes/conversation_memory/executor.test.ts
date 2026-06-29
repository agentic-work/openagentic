/**
 * conversation_memory — executor unit tests (RED first per TDD).
 *
 * Verifies the four operations (read | write | clear | summarize) over the
 * conversationMemory hook the engine wires onto NodeExecutionContext. The
 * hook is the service boundary — the executor never touches Prisma
 * directly; that keeps it pure + testable + swappable.
 *
 * Tenant isolation is enforced by the hook (which the engine threads
 * `ctx.tenantId` into), so the executor test only asserts the call shape.
 */

import { describe, it, expect, vi } from 'vitest';
import { execute } from './executor.js';
import type { NodeExecutionContext } from '../types.js';

interface MockMemoryHook {
  read: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  summarize: ReturnType<typeof vi.fn>;
  search: ReturnType<typeof vi.fn>;
}

function makeCtx(hook?: Partial<MockMemoryHook>, tenantId = 'tenant-a'): NodeExecutionContext {
  const ctrl = new AbortController();
  const memoryHook: MockMemoryHook = {
    read: hook?.read ?? vi.fn(async () => ({ messages: [], count: 0 })),
    write: hook?.write ?? vi.fn(async () => ({ written: true, total: 1 })),
    clear: hook?.clear ?? vi.fn(async () => ({ cleared: true })),
    summarize: hook?.summarize ?? vi.fn(async () => ({ summary: '…', messagesSummarized: 0 })),
    search: hook?.search ?? vi.fn(async () => ({ matches: [], count: 0 })),
  };
  return {
    signal: ctrl.signal,
    executionId: 'exec-cm-1',
    tenantId,
    apiUrl: 'http://api',
    interpolateTemplate: (t: string, input: unknown) => {
      const root = input as Record<string, unknown> | null;
      return String(t).replace(/\{\{\s*input\.([\w.]+)\s*\}\}/g, (_, path) => {
        const segments = String(path).split('.');
        let cursor: unknown = root;
        for (const seg of segments) {
          if (cursor && typeof cursor === 'object' && seg in (cursor as Record<string, unknown>)) {
            cursor = (cursor as Record<string, unknown>)[seg];
          } else {
            return '';
          }
        }
        return typeof cursor === 'string' ? cursor : JSON.stringify(cursor ?? '');
      });
    },
    getInternalAuthHeaders: () => ({}),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    conversationMemory: memoryHook,
  } as unknown as NodeExecutionContext;
}

const mk = (data: Record<string, unknown>) => ({
  id: 'n_mem',
  type: 'conversation_memory',
  data,
});

describe('conversation_memory/executor', () => {
  it('write — calls hook.write with resolved memoryId/role/content and returns {written, total}', async () => {
    const write = vi.fn(async () => ({ written: true, total: 3 }));
    const ctx = makeCtx({ write });
    const out = await execute(
      mk({
        operation: 'write',
        memoryId: '{{input.sessionId}}',
        role: 'user',
        content: '{{input.message}}',
      }),
      { sessionId: 'sess-xyz', message: 'Hello there.' },
      ctx,
    );
    expect(write).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      memoryId: 'sess-xyz',
      role: 'user',
      content: 'Hello there.',
      metadata: undefined,
    });
    expect(out).toEqual({ written: true, total: 3, operation: 'write' });
  });

  it('read — calls hook.read with limit and returns {messages, count}', async () => {
    const read = vi.fn(async () => ({
      messages: [
        { role: 'user', content: 'Hi', timestamp: '2026-05-14T17:00:00Z' },
        { role: 'assistant', content: 'Hello!', timestamp: '2026-05-14T17:00:01Z' },
      ],
      count: 2,
    }));
    const ctx = makeCtx({ read });
    const out = await execute(
      mk({
        operation: 'read',
        memoryId: '{{input.sessionId}}',
        limit: 5,
      }),
      { sessionId: 'sess-xyz' },
      ctx,
    );
    expect(read).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      memoryId: 'sess-xyz',
      limit: 5,
    });
    const o = out as { messages: unknown[]; count: number; operation: string };
    expect(o.messages).toHaveLength(2);
    expect(o.count).toBe(2);
    expect(o.operation).toBe('read');
  });

  it('clear — calls hook.clear and returns {cleared, operation}', async () => {
    const clear = vi.fn(async () => ({ cleared: true, removedCount: 7 }));
    const ctx = makeCtx({ clear });
    const out = await execute(
      mk({ operation: 'clear', memoryId: 'sess-xyz' }),
      {},
      ctx,
    );
    expect(clear).toHaveBeenCalledWith({ tenantId: 'tenant-a', memoryId: 'sess-xyz' });
    expect(out).toMatchObject({ cleared: true, operation: 'clear', removedCount: 7 });
  });

  it('summarize — calls hook.summarize and returns {summary, messagesSummarized}', async () => {
    const summarize = vi.fn(async () => ({
      summary: 'User asked about pods, assistant explained.',
      messagesSummarized: 4,
    }));
    const ctx = makeCtx({ summarize });
    const out = await execute(
      mk({
        operation: 'summarize',
        memoryId: 'sess-xyz',
        summaryPrompt: 'Summarize prior conversation:',
      }),
      {},
      ctx,
    );
    expect(summarize).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      memoryId: 'sess-xyz',
      summarizerModel: 'auto',
      summaryPrompt: 'Summarize prior conversation:',
    });
    const o = out as { summary: string; messagesSummarized: number; operation: string };
    expect(o.summary).toMatch(/asked about pods/);
    expect(o.messagesSummarized).toBe(4);
    expect(o.operation).toBe('summarize');
  });

  it('search — calls hook.search with resolved query/limit and returns {matches, count}', async () => {
    const search = vi.fn(async () => ({
      matches: [
        { role: 'user', content: 'How do I restart a pod?', timestamp: '2026-05-14T17:00:00Z', score: 0.94 },
        { role: 'assistant', content: 'Use kubectl rollout restart…', timestamp: '2026-05-14T17:00:01Z', score: 0.87 },
      ],
      count: 2,
    }));
    const ctx = makeCtx({ search });
    const out = await execute(
      mk({
        operation: 'search',
        memoryId: '{{input.sessionId}}',
        query: '{{input.question}}',
        limit: 5,
      }),
      { sessionId: 'sess-xyz', question: 'how to restart pod' },
      ctx,
    );
    expect(search).toHaveBeenCalledOnce();
    expect(search).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      memoryId: 'sess-xyz',
      query: 'how to restart pod',
      limit: 5,
    });
    const o = out as { matches: unknown[]; count: number; operation: string };
    expect(o.matches).toHaveLength(2);
    expect(o.count).toBe(2);
    expect(o.operation).toBe('search');
  });

  it('search — rejects empty query', async () => {
    await expect(
      execute(
        mk({ operation: 'search', memoryId: 'sess-xyz', query: '' }),
        {},
        makeCtx(),
      ),
    ).rejects.toThrow(/query|required/i);
  });

  it('search — defaults limit to a reasonable value when omitted', async () => {
    const search = vi.fn(async () => ({ matches: [], count: 0 }));
    const ctx = makeCtx({ search });
    await execute(
      mk({ operation: 'search', memoryId: 'sess-xyz', query: 'anything' }),
      {},
      ctx,
    );
    const call = search.mock.calls[0][0];
    expect(call.limit).toBeGreaterThan(0);
    expect(call.limit).toBeLessThanOrEqual(50);
  });

  it('rejects unknown operation', async () => {
    await expect(
      execute(
        mk({ operation: 'evict', memoryId: 'sess-xyz' }),
        {},
        makeCtx(),
      ),
    ).rejects.toThrow(/operation|evict|read.*write.*clear.*summarize/i);
  });

  it('rejects empty memoryId', async () => {
    await expect(
      execute(mk({ operation: 'read', memoryId: '' }), {}, makeCtx()),
    ).rejects.toThrow(/memoryId|required/i);
  });

  it('write rejects empty content', async () => {
    await expect(
      execute(
        mk({ operation: 'write', memoryId: 'sess-xyz', role: 'user', content: '' }),
        {},
        makeCtx(),
      ),
    ).rejects.toThrow(/content|required/i);
  });

  it('write rejects invalid role', async () => {
    await expect(
      execute(
        mk({ operation: 'write', memoryId: 'sess-xyz', role: 'narrator', content: 'x' }),
        {},
        makeCtx(),
      ),
    ).rejects.toThrow(/role/i);
  });

  it('read on empty memoryId returns {messages: [], count: 0} (no error) when hook returns empty', async () => {
    const read = vi.fn(async () => ({ messages: [], count: 0 }));
    const ctx = makeCtx({ read });
    const out = await execute(
      mk({ operation: 'read', memoryId: 'fresh-sess', limit: 10 }),
      {},
      ctx,
    );
    expect(out).toMatchObject({ messages: [], count: 0, operation: 'read' });
  });

  it('hook absent → emits a clear engine-wiring error', async () => {
    const ctrl = new AbortController();
    const ctx = {
      signal: ctrl.signal,
      executionId: 'exec-cm-no-hook',
      tenantId: 'tenant-a',
      apiUrl: 'http://api',
      interpolateTemplate: (t: string) => t,
      getInternalAuthHeaders: () => ({}),
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      // no conversationMemory hook
    } as unknown as NodeExecutionContext;
    await expect(
      execute(mk({ operation: 'read', memoryId: 'sess-xyz' }), {}, ctx),
    ).rejects.toThrow(/conversationMemory|engine.*hook|not.*wired/i);
  });
});
