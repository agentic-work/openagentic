/**
 * GET /api/chat/stream/:sessionId/tail
 * ====================================
 *
 * Durable-stream resume endpoint (task #154). A client whose chat
 * stream terminates mid-turn (network blip, mobile radio handoff,
 * proxy timeout) reconnects here with the last `_seq` it saw and the
 * turnId emitted in the `stream_start` frame. The server:
 *
 *   1. Validates session ownership (RLS, same guard as /stream).
 *   2. Reads the ring buffer for `(sessionId, turnId)` and emits every
 *      frame with `_seq > after` as NDJSON. Frames replay in order.
 *   3. If the turn is still live (registered in the tail registry),
 *      subscribes to ongoing frames and forwards them until the turn
 *      finalizes.
 *   4. If the ring buffer doesn't have anything newer AND the turn is
 *      NOT live, emits a `{type:"resume_exhausted"}` frame and closes.
 *      Happens when the 5-min TTL expired or the turn completed before
 *      the client reconnected.
 *
 * Query params:
 *   turnId  (required) — the `_runId` / `turnId` from the original stream.
 *   after   (optional) — last _seq the client received. 0 / omitted
 *                         returns the full retained buffer.
 *
 * Security:
 *   - Same auth middleware as /stream (JWT / API key).
 *   - Session ownership check matches the /stream handler.
 *
 * Known limitations (documented, not blockers):
 *   - In-memory `activeTurns` is per-pod. Cross-pod live resume needs
 *     Redis pub/sub (v0.8 follow-up). Ring-buffer replay works either
 *     way because the buffer is in Redis.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AuthenticatedRequest } from '../../middleware/unifiedAuth.js';
import { ndjsonHeaders, writeNDJSON } from '../../infra/ndjson.js';
import { getStreamRingBuffer } from '../../services/StreamRingBuffer.js';
import {
  isTurnActive,
  subscribeToTurn,
} from './handlers/stream-tail.registry.js';

// ---------------------------------------------------------------------------
// Route request shape
// ---------------------------------------------------------------------------

interface TailRequest extends AuthenticatedRequest {
  params: { sessionId: string };
  query: { turnId?: string; after?: string };
}

/**
 * Register the tail route on a Fastify instance. Call this from the
 * chat plugin AFTER the auth middleware is installed so the preHandler
 * runs.
 */
export function registerStreamTailRoute(
  fastify: FastifyInstance,
  options: { authMiddleware: any; logger: any },
): void {
  const { authMiddleware, logger } = options;

  fastify.get(
    '/stream/:sessionId/tail',
    {
      onRequest: authMiddleware,
      schema: {
        tags: ['Chat'],
        summary: 'Resume a chat stream after disconnect',
        description:
          'Replays buffered NDJSON frames whose _seq is greater than the supplied `after` cursor. ' +
          'If the underlying turn is still live, continues forwarding new frames until it finalizes. ' +
          'Emits `{type:"resume_exhausted"}` and closes if there are no new frames and the turn is no longer live.',
        params: {
          type: 'object',
          required: ['sessionId'],
          properties: { sessionId: { type: 'string' } },
        },
        querystring: {
          type: 'object',
          required: ['turnId'],
          properties: {
            turnId: { type: 'string', description: 'turnId from the original `stream_start` frame' },
            after: { type: 'string', description: 'last _seq the client received (default 0 = full retained buffer)' },
          },
        },
        security: [{ bearerAuth: [] }, { apiKey: [] }],
      },
    },
    async (request: TailRequest, reply: FastifyReply) => handleTail(request, reply, logger),
  );
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function handleTail(
  request: TailRequest,
  reply: FastifyReply,
  logger: any,
): Promise<void> {
  const sessionId = request.params?.sessionId?.trim();
  const turnId = request.query?.turnId?.trim();
  const afterRaw = request.query?.after;
  const after = afterRaw ? Number.parseInt(String(afterRaw), 10) : 0;
  const userId = request.user?.id;

  if (!userId) {
    return reply
      .code(401)
      .send({ error: { code: 'AUTHENTICATION_REQUIRED', message: 'Authentication required' } });
  }
  if (!sessionId) {
    return reply
      .code(400)
      .send({ error: { code: 'INVALID_SESSION', message: 'sessionId path param required' } });
  }
  if (!turnId) {
    return reply
      .code(400)
      .send({ error: { code: 'INVALID_TURN', message: 'turnId query param required' } });
  }
  if (!Number.isFinite(after) || after < 0) {
    return reply
      .code(400)
      .send({ error: { code: 'INVALID_AFTER', message: '`after` must be a non-negative integer' } });
  }

  // Session ownership check — same pattern as streamHandler. A user
  // MUST own the session to replay its frames.
  try {
    const { prisma: db } = await import('../../utils/prisma.js');
    const session = await db.chatSession.findFirst({
      where: { id: sessionId, user_id: userId },
      select: { id: true },
    });
    if (!session) {
      logger.warn({ userId, sessionId }, '[STREAM-TAIL] Session ownership check failed');
      return reply
        .code(403)
        .send({ error: { code: 'SESSION_NOT_OWNED', message: 'Session does not belong to this user' } });
    }
  } catch (err) {
    // Non-blocking: if check fails (DB error, session was deleted mid-
    // flight), allow the tail read to proceed so we don't turn a
    // transient DB blip into a user-visible error. Worst case the
    // ring buffer returns zero frames.
    logger.warn({ err, userId, sessionId }, '[STREAM-TAIL] Session ownership check error — proceeding');
  }

  // Tell Fastify we're taking over the raw response — otherwise
  // Fastify tries to send its own JSON after the handler returns and
  // `fastify.inject()` won't see our streamed body (it waits for
  // Fastify's reply lifecycle to complete).
  if (typeof (reply as any).hijack === 'function') {
    (reply as any).hijack();
  }

  // Open NDJSON stream. Same headers as /stream so proxy behavior is
  // consistent (nginx buffering off, chunked transfer, CORS).
  reply.raw.writeHead(200, ndjsonHeaders());
  if (reply.raw.socket) {
    reply.raw.socket.setNoDelay(true);
    if (typeof reply.raw.socket.uncork === 'function') {
      reply.raw.socket.uncork();
    }
  }
  if (typeof reply.raw.flushHeaders === 'function') {
    reply.raw.flushHeaders();
  }

  // 1. Replay buffered frames from Redis. Order is preserved by the
  //    list's RPUSH insertion order.
  const buffer = getStreamRingBuffer(logger);
  const replayed = await buffer.readAfter(sessionId, turnId, after);

  let maxSeqEmitted = after;
  for (const frame of replayed) {
    // Frames are stored as the exact NDJSON line that was written on
    // the wire (no trailing newline). Re-emit verbatim so clients see
    // identical payloads — ordering + _seq metadata carry over.
    try {
      reply.raw.write(frame.line + '\n');
      if (typeof frame.seq === 'number' && frame.seq > maxSeqEmitted) {
        maxSeqEmitted = frame.seq;
      }
    } catch {
      // Socket already closed — give up quietly.
      return;
    }
  }

  // 2. Is the turn still live on THIS pod? If yes, attach a listener
  //    and forward future frames until finalized.
  const turnLive = isTurnActive(sessionId, turnId);

  if (!turnLive) {
    // 3a. Not live anymore AND we've replayed whatever the buffer had.
    //     Tell the client the stream is done and close.
    writeNDJSON(reply, 'resume_exhausted', {
      sessionId,
      turnId,
      lastSeq: maxSeqEmitted,
      replayed: replayed.length,
      timestamp: new Date().toISOString(),
    });
    try { reply.raw.end(); } catch { /* ignored */ }
    return;
  }

  // 3b. Turn is still live. Subscribe and forward.
  //
  // We need to gate new-frame forwarding on `_seq` so we don't
  // double-emit frames we already replayed from the buffer. Listeners
  // receive the raw NDJSON line; we parse `_seq` with the same fast
  // regex the buffer uses.
  let closed = false;
  let unsubscribe: () => void = () => { /* replaced below */ };

  const onClose = () => {
    closed = true;
    unsubscribe();
    try { reply.raw.end(); } catch { /* ignored */ }
  };
  request.raw.on('close', onClose);

  unsubscribe = subscribeToTurn(sessionId, turnId, (line) => {
    if (closed) return;
    // Sentinel emitted by the registry when the turn finalizes.
    if (line.startsWith('{"type":"__turn_finalized"')) {
      writeNDJSON(reply, 'resume_exhausted', {
        sessionId,
        turnId,
        lastSeq: maxSeqEmitted,
        replayed: replayed.length,
        timestamp: new Date().toISOString(),
        reason: 'turn_completed',
      });
      try { reply.raw.end(); } catch { /* ignored */ }
      closed = true;
      unsubscribe();
      return;
    }

    // De-dup: skip frames with seq <= the highest we've already replayed.
    const m = line.match(/"_seq"\s*:\s*(\d+)/);
    if (m) {
      const s = Number.parseInt(m[1], 10);
      if (Number.isFinite(s) && s <= maxSeqEmitted) return;
      if (Number.isFinite(s)) maxSeqEmitted = s;
    }

    try {
      reply.raw.write(line + '\n');
    } catch {
      closed = true;
      unsubscribe();
    }
  });

  // Keepalive ping every 10s while attached. Lower rate than the main
  // stream's 3s because tail clients are already mid-session — the
  // extra idle tolerance reduces proxy-buffered `ping` churn.
  const keepalive = setInterval(() => {
    if (closed) {
      clearInterval(keepalive);
      return;
    }
    try {
      writeNDJSON(reply, 'ping', { timestamp: new Date().toISOString(), surface: 'tail' });
    } catch {
      closed = true;
      clearInterval(keepalive);
    }
  }, 10_000);

  // Hard cap — if the turn somehow never finalizes, close the tail
  // connection after 10 minutes to prevent zombie subscribers.
  const hardCap = setTimeout(() => {
    if (closed) return;
    writeNDJSON(reply, 'resume_exhausted', {
      sessionId,
      turnId,
      lastSeq: maxSeqEmitted,
      replayed: replayed.length,
      timestamp: new Date().toISOString(),
      reason: 'tail_timeout',
    });
    try { reply.raw.end(); } catch { /* ignored */ }
    closed = true;
    unsubscribe();
    clearInterval(keepalive);
  }, 10 * 60_000);

  // Chain cleanup.
  request.raw.on('close', () => {
    clearInterval(keepalive);
    clearTimeout(hardCap);
  });
}
