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

import { FastifyPluginAsync, FastifyInstance } from 'fastify';
import { authMiddleware, adminMiddleware } from '../middleware/unifiedAuth.js';
import { loggers } from '../utils/logger.js';
import { randomUUID } from 'crypto';

interface AgentSchedule {
  id: string;
  agentId: string;
  agentName: string;
  cronExpression: string;
  cronDescription: string;
  targetWorkflowId?: string;
  targetWorkflowName?: string;
  inputTemplate?: Record<string, any>;
  maxConcurrentRuns: number;
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
  runCount: number;
}

// In-memory store (no DB table yet)
const schedules: AgentSchedule[] = [];

export const adminAgentScheduleRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const logger = loggers.routes || loggers;

  fastify.addHook('preHandler', authMiddleware);
  fastify.addHook('preHandler', adminMiddleware);

  /**
   * GET /api/admin/agent-schedules - List all schedules
   */
  fastify.get('/', async (_request, reply) => {
    return reply.send({ schedules, total: schedules.length });
  });

  /**
   * POST /api/admin/agent-schedules - Create a schedule
   */
  fastify.post('/', async (request, reply) => {
    const body = request.body as any;

    const schedule: AgentSchedule = {
      id: randomUUID(),
      agentId: body.agentId || '',
      agentName: body.agentName || body.agentId || 'Unknown Agent',
      cronExpression: body.cronExpression || '0 * * * *',
      cronDescription: body.cronDescription || '',
      targetWorkflowId: body.targetWorkflowId,
      targetWorkflowName: body.targetWorkflowName,
      inputTemplate: body.inputTemplate || {},
      maxConcurrentRuns: body.maxConcurrentRuns || 1,
      enabled: body.enabled !== undefined ? body.enabled : true,
      runCount: 0,
    };

    schedules.push(schedule);
    logger.info({ scheduleId: schedule.id, agentId: schedule.agentId }, '[AgentSchedules] Created schedule');

    return reply.code(201).send({ message: 'Schedule created', schedule });
  });

  /**
   * PATCH /api/admin/agent-schedules/:id - Update a schedule (e.g. toggle enabled)
   */
  fastify.patch<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params;
    const body = request.body as any;
    const idx = schedules.findIndex(s => s.id === id);

    if (idx === -1) {
      return reply.code(404).send({ error: 'Schedule not found' });
    }

    if (body.enabled !== undefined) schedules[idx].enabled = body.enabled;
    if (body.cronExpression) schedules[idx].cronExpression = body.cronExpression;
    if (body.maxConcurrentRuns !== undefined) schedules[idx].maxConcurrentRuns = body.maxConcurrentRuns;

    return reply.send({ message: 'Schedule updated', schedule: schedules[idx] });
  });

  /**
   * DELETE /api/admin/agent-schedules/:id - Delete a schedule
   */
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params;
    const idx = schedules.findIndex(s => s.id === id);

    if (idx === -1) {
      return reply.code(404).send({ error: 'Schedule not found' });
    }

    schedules.splice(idx, 1);
    logger.info({ scheduleId: id }, '[AgentSchedules] Deleted schedule');

    return reply.send({ message: 'Schedule deleted' });
  });

  /**
   * POST /api/admin/agent-schedules/:id/run - Trigger immediate run
   */
  fastify.post<{ Params: { id: string } }>('/:id/run', async (request, reply) => {
    const { id } = request.params;
    const idx = schedules.findIndex(s => s.id === id);

    if (idx === -1) {
      return reply.code(404).send({ error: 'Schedule not found' });
    }

    schedules[idx].runCount += 1;
    schedules[idx].lastRun = new Date().toISOString();
    logger.info({ scheduleId: id }, '[AgentSchedules] Manual run triggered');

    return reply.send({ message: 'Run triggered', schedule: schedules[idx] });
  });
};
