/**
 * conversation_memory — Flows harness test.
 *
 * Verifies read / write / clear / summarize through the full
 * WorkflowExecutionEngine path. The harness mocks prisma globally
 * (test/harness/setup.ts); this test installs per-operation mocks
 * on prisma.conversationMemory so the engine's hook layer + the
 * ConversationMemoryService it lazy-imports + the executor all run
 * for real, with a deterministic backing store.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { runFlow } from '../runFlow.js';
import { prisma } from '../../../src/utils/prisma.js';

const TENANT = 't-harness-cm';

describe('conversation_memory node — stateful chat memory', () => {
  beforeEach(() => {
    // Reset the proxy-table call state between cases so accumulated
    // history doesn't leak across "fresh" assertions.
    Object.values(prisma as any).forEach((t: any) => {
      if (t && typeof t.create?.mockReset === 'function') t.create.mockReset();
      if (t && typeof t.count?.mockReset === 'function') t.count.mockReset();
      if (t && typeof t.findMany?.mockReset === 'function') t.findMany.mockReset();
      if (t && typeof t.deleteMany?.mockReset === 'function') t.deleteMany.mockReset();
    });
  });

  it('write operation persists a message and returns {written, total}', async () => {
    vi.mocked((prisma as any).conversationMemory.create).mockResolvedValue({} as any);
    vi.mocked((prisma as any).conversationMemory.count).mockResolvedValue(1 as any);

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'cm1',
            type: 'conversation_memory',
            data: {
              operation: 'write',
              memoryId: '{{trigger.body.sessionId}}',
              role: 'user',
              content: '{{trigger.body.message}}',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'cm1' }],
      },
      tenantId: TENANT,
      input: { body: { sessionId: 'sess-1', message: 'Hello there.' } },
    });
    expect(result.status).toBe('completed');
    const out = result.outputs.cm1 as { written: boolean; total: number; operation: string };
    expect(out.written).toBe(true);
    expect(out.total).toBe(1);
    expect(out.operation).toBe('write');

    // Verify the Prisma call shape: tenant_id was threaded through.
    const calls = vi.mocked((prisma as any).conversationMemory.create).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0][0].data).toMatchObject({
      memory_id: 'sess-1',
      tenant_id: TENANT,
      role: 'user',
      content: 'Hello there.',
    });
  });

  it('read operation returns prior messages in chronological order', async () => {
    vi.mocked((prisma as any).conversationMemory.findMany).mockResolvedValue([
      // Service queries `orderBy timestamp desc` then reverses — supply newest-first.
      { role: 'assistant', content: 'Hello!', timestamp: new Date('2026-05-14T17:00:02Z') },
      { role: 'user', content: 'Hi', timestamp: new Date('2026-05-14T17:00:01Z') },
    ] as any);

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'cm1',
            type: 'conversation_memory',
            data: {
              operation: 'read',
              memoryId: '{{trigger.body.sessionId}}',
              limit: 5,
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'cm1' }],
      },
      tenantId: TENANT,
      input: { body: { sessionId: 'sess-1' } },
    });
    expect(result.status).toBe('completed');
    const out = result.outputs.cm1 as {
      messages: Array<{ role: string; content: string }>;
      count: number;
      operation: string;
    };
    expect(out.operation).toBe('read');
    expect(out.count).toBe(2);
    expect(out.messages[0].role).toBe('user');
    expect(out.messages[0].content).toBe('Hi');
    expect(out.messages[1].role).toBe('assistant');
  });

  it('clear operation deletes all rows for memoryId+tenant', async () => {
    vi.mocked((prisma as any).conversationMemory.deleteMany).mockResolvedValue({ count: 4 } as any);

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'cm1',
            type: 'conversation_memory',
            data: { operation: 'clear', memoryId: 'sess-stale' },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'cm1' }],
      },
      tenantId: TENANT,
      input: {},
    });
    expect(result.status).toBe('completed');
    const out = result.outputs.cm1 as { cleared: boolean; removedCount: number; operation: string };
    expect(out.cleared).toBe(true);
    expect(out.removedCount).toBe(4);
    expect(out.operation).toBe('clear');

    const calls = vi.mocked((prisma as any).conversationMemory.deleteMany).mock.calls;
    expect(calls[0][0].where).toMatchObject({ memory_id: 'sess-stale', tenant_id: TENANT });
  });

  it('rejects empty memoryId via runtime guard', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'cm1',
            type: 'conversation_memory',
            data: { operation: 'read', memoryId: '' },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'cm1' }],
      },
      tenantId: TENANT,
      input: {},
    });
    expect(result.status).toBe('failed');
    expect(result.error?.message).toMatch(/memoryId|required/i);
  });

  it('write rejects unknown role', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'cm1',
            type: 'conversation_memory',
            data: { operation: 'write', memoryId: 'sess-1', role: 'narrator', content: 'x' },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'cm1' }],
      },
      tenantId: TENANT,
      input: {},
    });
    expect(result.status).toBe('failed');
    expect(result.error?.message).toMatch(/role/i);
  });

  it('read on empty memory returns {messages: [], count: 0} (not an error)', async () => {
    vi.mocked((prisma as any).conversationMemory.findMany).mockResolvedValue([] as any);
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'cm1',
            type: 'conversation_memory',
            data: { operation: 'read', memoryId: 'fresh-sess', limit: 10 },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'cm1' }],
      },
      tenantId: TENANT,
      input: {},
    });
    expect(result.status).toBe('completed');
    const out = result.outputs.cm1 as { messages: unknown[]; count: number };
    expect(out.messages).toEqual([]);
    expect(out.count).toBe(0);
  });
});
