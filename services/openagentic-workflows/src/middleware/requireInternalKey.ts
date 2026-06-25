/**
 * requireInternalKey — Fastify pre-handler that enforces a shared
 * internal-key on the Authorization header.
 *
 * Returns `{ ok: true }` when the request is authorized, or
 * `{ ok: false }` after writing a 401/503 reply. Callers should bail
 * (`return`) immediately on `ok: false` so Fastify ships the prepared
 * error response without invoking the route handler.
 *
 * Comparison is constant-time (timingSafeEqual on equal-length buffers)
 * to avoid leaking key bytes via response timing. A length mismatch is
 * rejected before the constant-time compare to avoid the throw timingSafeEqual
 * raises on differing-length inputs.
 */

import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { getInternalKey } from '../utils/internalKeyReader.js';

export type AuthOutcome = { ok: true } | { ok: false };

export async function requireInternalKey(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthOutcome> {
  const expected = getInternalKey();
  if (!expected) {
    reply.code(503).send({
      error: 'Service auth not configured — INTERNAL_KEY file missing and no fallback env var set',
    });
    return { ok: false };
  }

  const header = (request.headers['authorization'] as string | undefined) || '';
  if (!header.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'Unauthorized: missing bearer token' });
    return { ok: false };
  }

  const provided = header.slice(7).trim();
  if (provided.length !== expected.length) {
    reply.code(401).send({ error: 'Unauthorized: invalid bearer token' });
    return { ok: false };
  }

  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (!timingSafeEqual(a, b)) {
    reply.code(401).send({ error: 'Unauthorized: invalid bearer token' });
    return { ok: false };
  }

  return { ok: true };
}
