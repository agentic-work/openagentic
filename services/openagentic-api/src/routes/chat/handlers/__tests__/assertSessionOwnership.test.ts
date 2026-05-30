/**
 * Five-layer audit L2-1 — session ownership must NOT silently swallow DB errors.
 *
 * Why this test exists
 * --------------------
 * `stream.handler.ts:567-583` originally wrapped the ownership lookup in a
 * `try/catch` whose catch arm logged a warn and *proceeded with the request*
 * (comment: "Non-blocking: if check fails (e.g., DB error), proceed with request").
 *
 * That defeats the security control. A DB hiccup → user-to-user session leak:
 * Alice's POST /api/chat/stream with `sessionId: <Bob's session>` would
 * succeed and persist messages on Bob's session.
 *
 * Fix: extract the check into a pure helper that throws a typed error per
 * branch so the handler can map to 403 (not owned) vs 500 (lookup failed) —
 * never proceed on failure.
 *
 * Pinned behavior:
 *   - found row             → resolves void (caller proceeds)
 *   - found nothing (null)  → throws SessionNotOwnedError (handler → 403)
 *   - DB rejects            → throws SessionLookupFailedError (handler → 500)
 */
import { describe, it, expect, vi } from 'vitest';
import {
  assertSessionOwnership,
  SessionNotOwnedError,
  SessionLookupFailedError,
} from '../assertSessionOwnership.js';

function makePrisma(findFirstReturn: any, rejectWith?: Error) {
  return {
    chatSession: {
      findFirst: vi.fn().mockImplementation(() =>
        rejectWith ? Promise.reject(rejectWith) : Promise.resolve(findFirstReturn),
      ),
    },
  };
}

describe('assertSessionOwnership — L2-1 hard-block on DB failure', () => {
  it('resolves when prisma returns a matching session row', async () => {
    const prisma = makePrisma({ id: 'sess-1' });
    await expect(
      assertSessionOwnership(prisma as any, 'sess-1', 'user-1'),
    ).resolves.toBeUndefined();
    expect(prisma.chatSession.findFirst).toHaveBeenCalledWith({
      where: { id: 'sess-1', user_id: 'user-1' },
      select: { id: true },
    });
  });

  it('throws SessionNotOwnedError when prisma returns null', async () => {
    const prisma = makePrisma(null);
    await expect(
      assertSessionOwnership(prisma as any, 'sess-other', 'user-1'),
    ).rejects.toBeInstanceOf(SessionNotOwnedError);
  });

  it('throws SessionLookupFailedError when prisma rejects (DB outage / timeout)', async () => {
    const prisma = makePrisma(null, new Error('connect ECONNREFUSED'));
    const err = await assertSessionOwnership(prisma as any, 'sess-1', 'user-1').catch((e) => e);
    expect(err).toBeInstanceOf(SessionLookupFailedError);
    expect((err as SessionLookupFailedError).cause).toBeInstanceOf(Error);
    expect(((err as SessionLookupFailedError).cause as Error).message).toContain('ECONNREFUSED');
  });

  it('SessionNotOwnedError and SessionLookupFailedError are distinct types (handler maps differently)', async () => {
    const notOwned = new SessionNotOwnedError('sess-1', 'user-1');
    const lookupFailed = new SessionLookupFailedError('sess-1', 'user-1', new Error('x'));
    expect(notOwned).not.toBeInstanceOf(SessionLookupFailedError);
    expect(lookupFailed).not.toBeInstanceOf(SessionNotOwnedError);
  });
});
