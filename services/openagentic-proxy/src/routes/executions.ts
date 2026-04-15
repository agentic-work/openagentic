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

import type { FastifyInstance } from 'fastify';
import type { AgentOrchestrator } from '../services/AgentOrchestrator';

export async function executionRoutes(app: FastifyInstance, orchestrator: AgentOrchestrator): Promise<void> {
  /**
   * GET /api/agents/executions/live - List currently running executions
   */
  app.get('/api/agents/executions/live', async (_request, reply) => {
    try {
      const executions = await orchestrator.getLiveExecutions();
      return reply.send({ executions });
    } catch {
      return reply.send({ executions: [] });
    }
  });

  /**
   * GET /api/agents/stats - Aggregate stats (active count, totals)
   */
  app.get('/api/agents/stats', async (_request, reply) => {
    try {
      const stats = await orchestrator.getStats();
      return reply.send(stats);
    } catch {
      return reply.send({ activeCount: 0, totalCompleted: 0, totalFailed: 0 });
    }
  });

  /**
   * POST /api/agents/executions/:id/kill - Kill a running execution
   */
  app.post<{ Params: { id: string } }>('/api/agents/executions/:id/kill', async (request, reply) => {
    try {
      const { id } = request.params;
      const killed = orchestrator.cancelExecution(id);
      return reply.send({ killed });
    } catch (error: any) {
      return reply.code(500).send({ error: error.message, killed: false });
    }
  });
}
