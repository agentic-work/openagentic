/**
 * 2026-06-20 — HIGH-severity approval-gate bypass fix.
 *
 * The workflow engine runs as a SEPARATE service (openagentic-workflows) and its
 * `mcp_tool` node executor previously called the mcp-proxy DIRECTLY — so a Flow
 * that invoked a MUTATING tool (e.g. kubernetes_delete_pod, aws_*_modify)
 * executed with NO human approval and NO audit row, while chat + orchestrate
 * audit/gate every tool call via `runAuditAndGate`. The highest-blast-radius
 * surface was ungoverned.
 *
 * This route is the cross-service seam that closes that gap: the workflow
 * engine POSTs here BEFORE it reaches the proxy, and the api runs the SAME
 * `runAuditAndGate` (origin 'subagent') the chat/orchestrate paths use. The api
 * owns the audit row (it has the ToolCallAuditLog table + the in-memory
 * ApprovalRegistry; the workflows service has neither), so this returns only the
 * decision; the engine's executor blocks the proxy call when allowed===false.
 *
 * Route: POST /api/internal/mcp/exec
 *   headers  x-internal-secret: <INTERNAL_SERVICE_SECRET>
 *   body     { toolName: string, serverName?: string, args?: object,
 *              userId?: string, sessionId?: string }
 *   200      { allowed: boolean, blockReason?: string,
 *              classification: 'READ'|'MUTATING', auditId?: string }
 *   400      toolName missing / invalid body
 *   401      missing / wrong x-internal-secret (fail-closed when env empty)
 *
 * NOTE — naming: the body carries `exec` semantics (the engine is about to
 * execute), but the api does NOT proxy the tool here. It is a decision +
 * audit + (when gated) human-approval-await endpoint. Approval is awaited
 * server-side via `runAuditAndGate` → ApprovalRegistry; a non-SSE caller has
 * no `emit`, so a MUTATING call with the gate ON blocks until approved via the
 * normal approve/deny route or times out (fail-safe deny).
 *
 * Auth contract mirrors `tool-search.ts` / `embed.ts`: `x-internal-secret`
 * validated against INTERNAL_SERVICE_SECRET. Empty server-side secret is
 * fail-closed (rejects all).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { runAuditAndGate } from '../../services/approval/auditAndGate.js';

export interface InternalMcpGateRouteDeps {
  /** Server-side shared secret. Empty = fail-closed (rejects all). */
  internalSecret: string;
  /**
   * Injectable gate worker (defaults to the real `runAuditAndGate`). Lets tests
   * drive the route without standing up the DB / ApprovalRegistry.
   */
  runGate?: typeof runAuditAndGate;
}

interface McpGateBody {
  toolName?: string;
  serverName?: string;
  args?: Record<string, unknown>;
  userId?: string;
  sessionId?: string;
  messageId?: string;
}

const REQUEST_SCHEMA = {
  type: 'object',
  required: ['toolName'],
  properties: {
    toolName: { type: 'string', minLength: 1 },
    serverName: { type: 'string' },
    args: { type: 'object', additionalProperties: true },
    userId: { type: 'string' },
    sessionId: { type: 'string' },
    messageId: { type: 'string' },
  },
  additionalProperties: true,
};

/**
 * Register the route. Intentionally NOT a plugin (no `fp()` wrap) — matches the
 * `registerInternalEmbedRoute` / `registerInternalToolSearchRoute` pattern.
 */
export function registerInternalMcpGateRoute(
  fastify: FastifyInstance,
  deps: InternalMcpGateRouteDeps,
): void {
  const { internalSecret } = deps;
  const runGate = deps.runGate ?? runAuditAndGate;

  fastify.post(
    '/api/internal/mcp/exec',
    {
      schema: { body: REQUEST_SCHEMA },
      attachValidation: true,
    },
    async (request: FastifyRequest<{ Body: McpGateBody }>, reply: FastifyReply) => {
      if (!internalSecret) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      const provided =
        (request.headers['x-internal-secret'] as string | undefined) ?? '';
      if (provided !== internalSecret) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      if (request.validationError) {
        return reply
          .code(400)
          .send({ error: 'invalid_request', detail: request.validationError.message });
      }

      const body = request.body ?? {};
      const toolName = typeof body.toolName === 'string' ? body.toolName : '';
      if (!toolName) {
        return reply
          .code(400)
          .send({ error: 'invalid_request', detail: 'toolName is required' });
      }

      // X-User-Id / X-User-Email headers (set by the engine's
      // getInternalAuthHeaders) carry the run-as user; body fields override.
      const headerUserId = request.headers['x-user-id'] as string | undefined;

      try {
        const result = await runGate({
          toolName,
          serverName: body.serverName,
          args: (body.args ?? {}) as Record<string, unknown>,
          userId: body.userId ?? headerUserId,
          sessionId: body.sessionId,
          messageId: body.messageId,
          // The workflow engine is a sub-agent-class caller; tag the audit row
          // accordingly (do NOT add a new origin enum).
          origin: 'subagent',
          // No SSE/emit on this internal route: a MUTATING call with the gate
          // ON blocks on ApprovalRegistry.waitFor until approved via the
          // approve/deny route, or times out → deny (fail safe).
          logger: request.log,
        });

        return reply.code(200).send({
          allowed: result.allowed,
          blockReason: result.blockReason,
          classification: result.classification,
          auditId: result.auditId,
        });
      } catch (err) {
        // runAuditAndGate is designed to never throw, but if it somehow does,
        // FAIL SAFE: deny. The engine executor treats a non-200 / thrown call
        // as a fail-safe block for mutating tools.
        request.log.error(
          { err: (err as Error).message, toolName },
          '[mcp-gate] gate evaluation failed — denying (fail-safe)',
        );
        return reply.code(200).send({
          allowed: false,
          blockReason: 'Approval gate evaluation failed; tool call blocked',
          classification: 'MUTATING',
        });
      }
    },
  );
}
