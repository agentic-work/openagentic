/**
 * Session ownership check for /api/chat/stream — L2-1 five-layer audit fix.
 *
 * Replaces the prior try/catch block (where catch logged a warn + proceeded) at
 * `stream.handler.ts:567-583` whose comment read "Non-blocking: if check fails
 * (e.g., DB error), proceed with request" — that defeated the security control
 * because a DB hiccup let Alice POST messages to Bob's session.
 *
 * Contract:
 *   - matching row    → resolves void
 *   - no matching row → throws SessionNotOwnedError (handler maps to 403)
 *   - DB rejects      → throws SessionLookupFailedError (handler maps to 500)
 *
 * The handler MUST NOT swallow either error.
 */

export class SessionNotOwnedError extends Error {
  readonly sessionId: string;
  readonly userId: string;
  constructor(sessionId: string, userId: string) {
    super(`session ${sessionId} not owned by user ${userId}`);
    this.name = 'SessionNotOwnedError';
    this.sessionId = sessionId;
    this.userId = userId;
  }
}

export class SessionLookupFailedError extends Error {
  readonly sessionId: string;
  readonly userId: string;
  override readonly cause: unknown;
  constructor(sessionId: string, userId: string, cause: unknown) {
    super(`session-ownership lookup failed for ${sessionId}: ${(cause as Error)?.message ?? String(cause)}`);
    this.name = 'SessionLookupFailedError';
    this.sessionId = sessionId;
    this.userId = userId;
    this.cause = cause;
  }
}

interface PrismaSessionLookup {
  chatSession: {
    findFirst: (args: {
      where: { id: string; user_id: string };
      select: { id: true };
    }) => Promise<{ id: string } | null>;
  };
}

export async function assertSessionOwnership(
  prisma: PrismaSessionLookup,
  sessionId: string,
  userId: string,
): Promise<void> {
  let row: { id: string } | null;
  try {
    row = await prisma.chatSession.findFirst({
      where: { id: sessionId, user_id: userId },
      select: { id: true },
    });
  } catch (cause) {
    throw new SessionLookupFailedError(sessionId, userId, cause);
  }

  if (!row) {
    throw new SessionNotOwnedError(sessionId, userId);
  }
}
