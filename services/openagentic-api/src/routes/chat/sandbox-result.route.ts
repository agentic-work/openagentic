/**
 * Task #158 — browser-sandbox result receiver.
 *
 * POST /api/chat/sandbox-result
 *
 * Surface between the UI's `sandboxManager.execute()` and the server-side
 * chat pipeline. The flow is:
 *
 *   1. Model emits a `browser_exec_request` NDJSON frame via the chat
 *      stream (see `ChatPipeline` — the request originates when the
 *      model calls the `browser_exec` pseudo-tool defined in the prompt
 *      manifest).
 *   2. `useChatStream` sees the request, dispatches to
 *      `sandboxManager.execute()`, awaits the result, and POSTs the
 *      `BrowserExecResult` envelope here.
 *   3. This route stores the result in a shared `SandboxResultStore` so
 *      the currently-running turn's tool-execution helper can pull it
 *      and inject it as a `tool_result` message for the model's next
 *      inner turn.
 *
 * NDJSON is one-directional (server → client) by contract, so the
 * result has to come back over an out-of-band HTTP POST. This route is
 * deliberately thin — it validates the envelope, stamps a timestamp,
 * resolves the pending promise in the store, and lets the pipeline
 * take over. That keeps sandbox lifetime coupled to the turn: if the
 * turn is cancelled / fails, the pending promise rejects and the
 * model never sees a stale sandbox result.
 *
 * Auth: normal chat JWT — same `unifiedAuth` preHandler as the rest of
 * the `/api/chat/*` tree. Sandbox results are per-user by their
 * requestId so there's no cross-tenant risk.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getSandboxResultStore } from '../../services/SandboxResultStore.js';

// Narrow subset of the BrowserExecResult shape — see the UI side's
// `src/sandbox/types.ts` for the canonical definition. We validate the
// fields the pipeline cares about and accept unknown extras.
interface SandboxResultBody {
  requestId: string;
  ok: boolean;
  stdout?: string;
  stderr?: string;
  returnValue?: string;
  images?: Array<{ mime: string; base64: string }>;
  timedOut?: boolean;
  durationMs?: number;
  errorCode?: string;
  sessionId?: string;
  messageId?: string;
}

export async function sandboxResultRoute(fastify: FastifyInstance) {
  fastify.post<{ Body: SandboxResultBody }>(
    '/sandbox-result',
    async (
      request: FastifyRequest<{ Body: SandboxResultBody }>,
      reply: FastifyReply,
    ) => {
      const body = request.body;

      if (!body || typeof body !== 'object') {
        return reply
          .status(400)
          .send({ error: 'invalid body', code: 'INVALID_BODY' });
      }
      if (typeof body.requestId !== 'string' || body.requestId.length === 0) {
        return reply
          .status(400)
          .send({ error: 'requestId required', code: 'MISSING_REQUEST_ID' });
      }
      if (typeof body.ok !== 'boolean') {
        return reply
          .status(400)
          .send({ error: 'ok required', code: 'MISSING_OK' });
      }

      // Cap payload sizes server-side too so a misbehaving / malicious
      // client can't RPUSH multi-MB blobs onto the store.
      const stdout = truncate(body.stdout ?? '', 32_000);
      const stderr = truncate(body.stderr ?? '', 8_000);
      const images = capImages(body.images ?? [], 2 * 1024 * 1024);

      const envelope = {
        requestId: body.requestId,
        ok: body.ok,
        stdout,
        stderr,
        returnValue: body.returnValue,
        images,
        timedOut: body.timedOut ?? false,
        durationMs: Math.max(0, Math.floor(body.durationMs ?? 0)),
        errorCode: body.errorCode,
        sessionId: body.sessionId,
        messageId: body.messageId,
        receivedAt: Date.now(),
      };

      const store = getSandboxResultStore();
      const resolved = store.resolve(body.requestId, envelope);

      if (!resolved) {
        // No pending tool call waited on this id. Still 200 — the UI
        // doesn't need to know whether the server-side turn was still
        // alive; re-posting an orphan result is a no-op.
        request.log.debug(
          { requestId: body.requestId },
          '[sandbox-result] orphan result (no pending turn)',
        );
      }

      return reply.send({
        ok: true,
        requestId: body.requestId,
        injected: resolved,
      });
    },
  );
}

function truncate(s: string, cap: number): string {
  if (typeof s !== 'string') return '';
  return s.length <= cap ? s : s.slice(-cap);
}

function capImages(
  images: Array<{ mime: string; base64: string }>,
  cap: number,
): Array<{ mime: string; base64: string }> {
  if (!Array.isArray(images)) return [];
  let total = 0;
  const out: Array<{ mime: string; base64: string }> = [];
  for (const img of images) {
    if (
      !img ||
      typeof img.base64 !== 'string' ||
      typeof img.mime !== 'string'
    )
      continue;
    const size = img.base64.length;
    if (total + size > cap) break;
    out.push({ mime: img.mime, base64: img.base64 });
    total += size;
  }
  return out;
}
