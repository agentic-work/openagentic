/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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

    // Override identity fields from validated token (never trust POST body)
    body.userId = user.id;
    body.isAdmin = user.isAdmin;
    body.userGroups = user.groups;
    body.authMethod = user.authMethod;

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

    // Override identity fields from validated token
    body.userId = user.id;
    body.isAdmin = user.isAdmin;
    body.userGroups = user.groups;
    body.authMethod = user.authMethod;

    // Forward the user's auth token so sub-agents can make LLM calls.
    // CRITICAL: only fall back to the Authorization header when the chat dispatcher
    // did NOT supply a userToken in the body. The Authorization header on this
    // request is the OPENAGENTIC_PROXY_INTERNAL_KEY (service-to-service auth between API
    // and openagentic-proxy) — NOT the end user's Azure access token. If we always
    // overwrite body.userToken with the header, sub-agents end up calling Azure as
    // the platform service principal (which has no rights), MCP returns 401
    // "primary access token invalid", and the chain collapses to admin@openagentics.io.
    // The chat dispatcher already sets body.userToken to context.user.accessToken
    // (the user's Azure-AD token, audience https://management.azure.com), so trust
    // that and only fall back when it's missing (e.g. direct internal callers).
    if (!body.userToken) {
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
