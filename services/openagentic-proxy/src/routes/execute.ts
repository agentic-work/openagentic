import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { AgentOrchestrator, type ExecuteRequest } from '../services/AgentOrchestrator';
import { authMiddleware } from '../middleware/auth';
import { logger } from '../utils/logger';

export async function executeRoutes(app: FastifyInstance, orchestrator: AgentOrchestrator): Promise<void> {
  // Async execution — returns executionId immediately, stream results via SSE
  app.post('/api/agents/execute', {
    preHandler: authMiddleware,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as ExecuteRequest;
    const user = (request as any).user;

    if (!body.agents || !Array.isArray(body.agents) || body.agents.length === 0) {
      return reply.status(400).send({ error: 'agents array is required and must not be empty' });
    }

    // Override identity fields from validated token (never trust POST body),
    // EXCEPT when the caller is the internal service-to-service handshake
    // (auth.ts sets user.id='system' for that path). In that case the api
    // has already authoritatively populated body.userId with the REAL end
    // user — trust it. Otherwise V1.1 flow_tool injection (and any other
    // per-user downstream lookup) gets a 'system' id that matches no rows.
    const isInternalCallerAsync = user.id === 'system' && user.authMethod === 'internal';
    if (!isInternalCallerAsync || !body.userId) {
      body.userId = user.id;
      body.isAdmin = user.isAdmin;
      body.userGroups = user.groups;
      body.authMethod = user.authMethod;
    }

    // Forward the user's auth token so sub-agents can make LLM calls.
    // Same fix as /execute-sync — only fall back to the Authorization header
    // when the chat dispatcher did NOT supply a userToken in the body.
    if (!body.userToken) {
      const authHeader = request.headers['authorization'];
      if (authHeader?.startsWith('Bearer ')) {
        body.userToken = authHeader.substring(7);
      }
    }

    try {
      const result = await orchestrator.execute(body);
      return reply.send(result);
    } catch (error: any) {
      logger.error({ error: error.message }, 'Execute failed');
      return reply.status(500).send({ error: error.message });
    }
  });

  // Synchronous execution — waits for all agents to complete
  app.post('/api/agents/execute-sync', {
    preHandler: authMiddleware,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as ExecuteRequest;
    const user = (request as any).user;

    if (!body.agents || !Array.isArray(body.agents) || body.agents.length === 0) {
      return reply.status(400).send({ error: 'agents array is required and must not be empty' });
    }

    // Override identity fields from validated token, EXCEPT when the caller
    // is the internal service-to-service path (auth.ts sets user.id='system'
    // for the Bearer-internal-key handshake). In that case the api has
    // already filled in body.userId with the REAL end-user, so trust it.
    // Overwriting with 'system' loses user identity and breaks downstream
    // per-user lookups (e.g. V1.1 flow_tool `/agent-tools` filter).
    const isInternalCaller = user.id === 'system' && user.authMethod === 'internal';
    if (!isInternalCaller || !body.userId) {
      body.userId = user.id;
      body.isAdmin = user.isAdmin;
      body.userGroups = user.groups;
      body.authMethod = user.authMethod;
    }

    // Forward the user's auth token so sub-agents can make LLM calls.
    // CRITICAL: only fall back to the Authorization header when the chat dispatcher
    // did NOT supply a userToken in the body. The Authorization header on this
    // request is the OPENAGENTIC_PROXY_INTERNAL_KEY (service-to-service auth between API
    // and openagentic-proxy) — NOT the end user's Azure access token. If we always
    // overwrite body.userToken with the header, sub-agents end up calling Azure as
    // the platform service principal (which has no rights), MCP returns 401
    // "primary access token invalid", and the chain collapses to admin@openagentic.io.
    // The chat dispatcher already sets body.userToken to context.user.accessToken
    // (the user's Azure-AD token, audience https://management.azure.com), so trust
    // that and only fall back when it's missing.
    //
    // Workflow callers (multi_agent / agent_pool / agent_supervisor nodes) come
    // in WITHOUT a body.userToken. They auth with OPENAGENTIC_PROXY_INTERNAL_KEY in
    // the Authorization header. That key is NOT a user token — forwarding it
    // downstream to MCP poisoned mcpBridge.listTools() with a 401 because
    // mcp-proxy validates the user-token path and the service-key path
    // separately. Detect workflow callers via X-Workflow-Execution and skip
    // the authorization-header fallback so AgentOrchestrator falls through
    // to process.env.OPENAGENTIC_PROXY_API_KEY (= mcp-proxy's API_INTERNAL_KEY).
    // Caught 2026-04-26.
    const isWorkflowCaller = !!request.headers['x-workflow-execution'];
    if (!body.userToken && !isWorkflowCaller) {
      const authHeaderSync = request.headers['authorization'];
      if (authHeaderSync?.startsWith('Bearer ')) {
        body.userToken = authHeaderSync.substring(7);
      }
    }

    try {
      const result = await orchestrator.executeSync(body);
      return reply.send(result);
    } catch (error: any) {
      logger.error({ error: error.message }, 'Execute-sync failed');
      return reply.status(500).send({ error: error.message });
    }
  });

  // Get execution status (with ownership check)
  app.get<{ Params: { id: string } }>('/api/agents/executions/:id', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const user = (request as any).user;
    const execution = orchestrator.getExecution(request.params.id);
    if (!execution) {
      return reply.status(404).send({ error: 'Execution not found' });
    }
    // Ownership check: only the owner or admins can view execution status
    if (execution.userId && execution.userId !== user.id && !user.isAdmin) {
      return reply.status(403).send({ error: 'Forbidden: not your execution' });
    }
    return reply.send(execution);
  });

  // Cancel execution (with ownership check)
  app.post<{ Params: { id: string } }>('/api/agents/executions/:id/cancel', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const user = (request as any).user;
    const execution = orchestrator.getExecution(request.params.id);
    if (execution && execution.userId && execution.userId !== user.id && !user.isAdmin) {
      return reply.status(403).send({ error: 'Forbidden: not your execution' });
    }
    const cancelled = orchestrator.cancelExecution(request.params.id);
    return reply.send({ cancelled });
  });
}
