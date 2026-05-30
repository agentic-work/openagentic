/**
 * FeedbackService — TDD spec.
 *
 * Thin write-side wrapper around prisma.responseFeedback. The model carries an
 * `intent` column for per-(intent, model) advisory aggregation. Phase E.7
 * (2026-05-10) ripped the legacy `audience` column.
 *
 * Coverage:
 *  1. record() upserts a positive signal with intent+model preserved.
 *  2. record() upserts a negative signal with optional reason preserved.
 *  3. record() returns the row id.
 *  4. listForUser() filters by since (date) and limit (number).
 *  5. record() rejects unknown signal values.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FeedbackService } from '../FeedbackService.js';

interface FakeRow {
  id: string;
  message_id: string;
  user_id: string;
  session_id: string;
  feedback_type: string;
  comment: string | null;
  intent: string | null;
  model: string | null;
  created_at: Date;
}

function makePrismaLike(initial: FakeRow[] = []) {
  const rows: FakeRow[] = [...initial];
  return {
    rows,
    responseFeedback: {
      upsert: vi.fn(async (args: any) => {
        const created: FakeRow = {
          id: args.create.id ?? `id-${rows.length + 1}`,
          message_id: args.create.message_id,
          user_id: args.create.user_id,
          session_id: args.create.session_id,
          feedback_type: args.create.feedback_type,
          comment: args.create.comment ?? null,
          intent: args.create.intent ?? null,
          model: args.create.model ?? null,
          created_at: new Date(),
        };
        rows.push(created);
        return created;
      }),
      findMany: vi.fn(async (args: any) => {
        const where = args?.where ?? {};
        let out = rows.filter((r) => {
          if (where.user_id && r.user_id !== where.user_id) return false;
          if (where.created_at?.gte && r.created_at < where.created_at.gte) return false;
          return true;
        });
        if (typeof args?.take === 'number') out = out.slice(0, args.take);
        return out;
      }),
    },
  };
}

describe('FeedbackService.record', () => {
  let prismaLike: ReturnType<typeof makePrismaLike>;
  let svc: FeedbackService;

  beforeEach(() => {
    prismaLike = makePrismaLike();
    svc = new FeedbackService(prismaLike as any);
  });

  it('upserts a positive feedback row with intent+model preserved', async () => {
    const out = await svc.record({
      messageId: 'msg-1',
      sessionId: 'sess-1',
      userId: 'user-1',
      signal: 'positive',
      intent: 'cloud_list',
      model: 'gpt-oss:20b',
    });
    expect(out.id).toBeTruthy();
    expect(prismaLike.responseFeedback.upsert).toHaveBeenCalledTimes(1);
    const args = (prismaLike.responseFeedback.upsert as any).mock.calls[0][0];
    expect(args.create.feedback_type).toBe('thumbs_up');
    expect(args.create.intent).toBe('cloud_list');
    expect(args.create.model).toBe('gpt-oss:20b');
    // Phase E.7 — audience column ripped; nothing should write to it.
    expect(args.create.audience).toBeUndefined();
  });

  it('upserts a negative feedback row with optional reason preserved as comment', async () => {
    await svc.record({
      messageId: 'msg-2',
      sessionId: 'sess-2',
      userId: 'user-1',
      signal: 'negative',
      reason: 'wrong answer',
      intent: 'tool_invoke',
      model: 'claude-sonnet',
    });
    const args = (prismaLike.responseFeedback.upsert as any).mock.calls[0][0];
    expect(args.create.feedback_type).toBe('thumbs_down');
    expect(args.create.comment).toBe('wrong answer');
    expect(args.create.intent).toBe('tool_invoke');
  });

  it('rejects unknown signal values', async () => {
    await expect(
      svc.record({
        messageId: 'msg-x',
        sessionId: 'sess-x',
        userId: 'user-1',
        signal: 'meh' as any,
      } as any),
    ).rejects.toThrow(/signal/i);
  });
});

describe('FeedbackService.listForUser', () => {
  it('returns rows for the user filtered by since + limit', async () => {
    const now = Date.now();
    const yesterday = new Date(now - 24 * 3600 * 1000);
    const lastWeek = new Date(now - 7 * 24 * 3600 * 1000);
    const prismaLike = makePrismaLike([
      {
        id: 'a',
        message_id: 'm1',
        user_id: 'user-1',
        session_id: 's1',
        feedback_type: 'thumbs_up',
        comment: null,
        intent: 'chat',
        model: 'a',
        created_at: yesterday,
      },
      {
        id: 'b',
        message_id: 'm2',
        user_id: 'user-1',
        session_id: 's1',
        feedback_type: 'thumbs_down',
        comment: null,
        intent: 'chat',
        model: 'a',
        created_at: lastWeek,
      },
      {
        id: 'c',
        message_id: 'm3',
        user_id: 'user-2',
        session_id: 's1',
        feedback_type: 'thumbs_up',
        comment: null,
        intent: 'chat',
        model: 'a',
        created_at: yesterday,
      },
    ]);
    const svc = new FeedbackService(prismaLike as any);
    const since = new Date(now - 2 * 24 * 3600 * 1000);
    const out = await svc.listForUser('user-1', { since, limit: 10 });
    expect(out.length).toBe(1);
    expect(out[0].id).toBe('a');
  });
});
