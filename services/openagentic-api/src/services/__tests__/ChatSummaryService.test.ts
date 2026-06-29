/**
 * Bug 3 (2026-05-18): chat_sessions.summary + structured_summary are never
 * populated by the chat pipeline. Symptom: admin sessions view + memory
 * retrieval over old sessions has no summary text to anchor on.
 *
 * Fix: ChatSummaryService.maybeRefreshSummary(sessionId) — call after
 * each assistant message is persisted. Skips for sessions with <5
 * messages; otherwise loads the message tail, runs the existing
 * CompactionEngine.generateHeuristicSummary (no LLM call — fast,
 * idempotent), and writes both columns via Prisma typed client.
 *
 * NOT using raw SQL — addresses prior user feedback that admin-mcp's
 * raw psql was the wrong layer. This is the TypeScript api layer
 * where Prisma is canonical.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatSummaryService } from '../ChatSummaryService.js';

const silentLogger = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  child: () => silentLogger,
} as any;

function makePrismaStub(opts: {
  messageCount: number;
  messages?: Array<{ role: string; content: string; tool_calls?: any[] }>;
}) {
  const updates: any[] = [];
  return {
    updates,
    prisma: {
      chatSession: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'sess-1',
          message_count: opts.messageCount,
          summary: null,
          structured_summary: null,
        }),
        update: vi.fn().mockImplementation(async (arg: any) => {
          updates.push(arg);
          return { id: 'sess-1' };
        }),
      },
      chatMessage: {
        findMany: vi.fn().mockResolvedValue(opts.messages ?? []),
      },
    } as any,
  };
}

describe('ChatSummaryService.maybeRefreshSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips when session has fewer than 5 messages', async () => {
    const { prisma, updates } = makePrismaStub({ messageCount: 3 });
    const svc = new ChatSummaryService(prisma, silentLogger);

    await svc.maybeRefreshSummary('sess-1');

    expect(updates).toHaveLength(0);
  });

  it('writes summary + structured_summary when session has 5+ messages', async () => {
    const { prisma, updates } = makePrismaStub({
      messageCount: 5,
      messages: [
        { role: 'user', content: 'How do I deploy to AWS?' },
        { role: 'assistant', content: 'Use the aws_deploy tool.', tool_calls: [{ function: { name: 'aws_deploy' } }] },
        { role: 'user', content: 'Now show me my Azure subs' },
        { role: 'assistant', content: 'Listing.', tool_calls: [{ function: { name: 'azure_list_subscriptions' } }] },
        { role: 'user', content: 'thanks' },
      ],
    });
    const svc = new ChatSummaryService(prisma, silentLogger);

    await svc.maybeRefreshSummary('sess-1');

    expect(updates).toHaveLength(1);
    const updateArg = updates[0];
    expect(updateArg.where).toEqual({ id: 'sess-1' });
    expect(typeof updateArg.data.summary).toBe('string');
    expect(updateArg.data.summary.length).toBeGreaterThan(0);
    expect(updateArg.data.structured_summary).toMatchObject({
      text: expect.any(String),
      topics: expect.any(Array),
      toolsUsed: expect.any(Array),
    });
    // Tools used should include both tools we wired in.
    expect(updateArg.data.structured_summary.toolsUsed).toEqual(
      expect.arrayContaining(['aws_deploy', 'azure_list_subscriptions']),
    );
  });

  it('does not throw when session not found — logs and returns', async () => {
    const prisma = {
      chatSession: {
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
      chatMessage: { findMany: vi.fn() },
    } as any;
    const svc = new ChatSummaryService(prisma, silentLogger);

    await expect(svc.maybeRefreshSummary('missing')).resolves.toBeUndefined();
    expect(prisma.chatSession.update).not.toHaveBeenCalled();
  });

  it('does not rethrow when DB write fails — summary is non-blocking', async () => {
    const { prisma } = makePrismaStub({
      messageCount: 6,
      messages: [{ role: 'user', content: 'x' }],
    });
    prisma.chatSession.update = vi.fn().mockRejectedValue(new Error('DB down'));
    const svc = new ChatSummaryService(prisma, silentLogger);

    await expect(svc.maybeRefreshSummary('sess-1')).resolves.toBeUndefined();
  });
});
