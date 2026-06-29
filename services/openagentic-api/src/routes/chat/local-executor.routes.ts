import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ndjsonHeaders, writeNDJSON } from '../../infra/ndjson.js';
import {
  getLocalExecutorRegistry,
  type ExecutorToolDef,
} from '../../services/local-executor/LocalExecutorRegistry.js';

/**
 * Local-executor routes — the platform-side companion to the VS Code "local
 * executor" extension.
 *
 *   POST /api/chat/local-executor/subscribe     (long-lived NDJSON stream)
 *   POST /api/chat/local-executor/tool-result   (client posts results back)
 *
 * subscribe: the external client registers its `workspace_*` tools and holds an
 * open NDJSON stream; when the chat agent calls one of those tools the dispatch
 * arm pushes a `tool_executing` frame down this stream. tool-result: the client
 * POSTs the canonical result, which resolves the awaiting dispatch.
 *
 * Registered under /api/chat with authMiddleware (see chat.plugin.ts) — the
 * authenticated userId scopes the connection. Mirrors stream-tail.route.ts for
 * the raw-stream lifecycle and approval-gate.routes.ts for the resolve pattern.
 */
function userIdOf(request: FastifyRequest): string | null {
  const u = (request as any).user;
  return u?.id ?? u?.userId ?? null;
}

const KEEPALIVE_MS = 25_000;

export async function localExecutorRoutes(fastify: FastifyInstance) {
  // --- subscribe: open the dispatch stream + register the client's tools ---
  fastify.post<{ Body: { tools?: ExecutorToolDef[] } }>(
    '/local-executor/subscribe',
    async (request: FastifyRequest<{ Body: { tools?: ExecutorToolDef[] } }>, reply: FastifyReply) => {
      const userId = userIdOf(request);
      if (!userId) return reply.status(401).send({ error: 'unauthenticated' });

      const tools = Array.isArray(request.body?.tools) ? request.body!.tools : [];
      const safeTools = tools.filter(
        (t): t is ExecutorToolDef => !!t && typeof t.name === 'string' && t.name.startsWith('workspace_'),
      );

      if (typeof (reply as any).hijack === 'function') (reply as any).hijack();
      reply.raw.writeHead(200, ndjsonHeaders());
      writeNDJSON(reply, 'connected', { data: { ok: true, tools: safeTools.map((t) => t.name) } });

      const disconnect = getLocalExecutorRegistry().connect(userId, safeTools, (frame) => {
        writeNDJSON(reply, 'tool_executing', { data: frame });
      });

      const keepalive = setInterval(() => writeNDJSON(reply, 'ping', {}), KEEPALIVE_MS);
      if (typeof keepalive.unref === 'function') keepalive.unref();

      request.raw.on('close', () => {
        clearInterval(keepalive);
        disconnect();
        try {
          reply.raw.end();
        } catch {
          /* socket already gone */
        }
      });
      return reply;
    },
  );

  // --- tool-result: resolve the awaiting dispatch with the client's result ---
  fastify.post<{ Body: { tool_use_id?: string; content?: unknown; is_error?: boolean; name?: string } }>(
    '/local-executor/tool-result',
    async (
      request: FastifyRequest<{ Body: { tool_use_id?: string; content?: unknown; is_error?: boolean } }>,
      reply: FastifyReply,
    ) => {
      const userId = userIdOf(request);
      if (!userId) return reply.status(401).send({ error: 'unauthenticated' });

      const body = request.body ?? {};
      const toolUseId = typeof body.tool_use_id === 'string' ? body.tool_use_id : '';
      if (!toolUseId) return reply.status(400).send({ error: 'tool_use_id required' });

      const content = typeof body.content === 'string' ? body.content : JSON.stringify(body.content ?? null);
      const resolved = getLocalExecutorRegistry().submitResult(toolUseId, {
        content,
        isError: body.is_error === true,
      });

      if (!resolved) {
        return reply.status(404).send({ ok: false, error: 'no pending call for tool_use_id (expired or unknown)' });
      }
      return reply.send({ ok: true, tool_use_id: toolUseId, resolved });
    },
  );
}
