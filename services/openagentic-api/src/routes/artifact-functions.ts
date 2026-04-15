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

/**
 * Artifact Function Routes
 *
 * API endpoints for registering, executing, and approving OAT-backed functions.
 * Functions are created by the oat_function_builder agent via openagentic-proxy,
 * auto-approved for low/medium risk, and require HITM approval for high/critical.
 *
 * - POST /api/artifact-functions        — Register a new OAT function
 * - GET  /api/artifact-functions/:id     — Get function details
 * - POST /api/artifact-functions/:id/execute — Execute a registered function
 * - POST /api/agent-executions/:executionId/approve — HITM approval response
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma.js';
import { authMiddleware } from '../middleware/unifiedAuth.js';
import { loggers } from '../utils/logger.js';
import axios from 'axios';
import { createClient } from 'redis';

const logger = loggers.routes?.child?.({ module: 'artifact-functions' }) || loggers.routes || loggers;

const SYNTH_EXECUTOR_URL = process.env.SYNTH_EXECUTOR_URL || 'http://openagentic-openagentic-synth:8090';

/**
 * Capability translation map: semantic names → OpenAgentic Synth capability names.
 */
const CAPABILITY_MAP: Record<string, string[]> = {
  'data_processing': ['file_processing'],
  'visualization': ['file_processing'],
  'network': ['http'],
  'cloud_api_aws': ['aws'],
  'cloud_api_azure': ['azure'],
  'cloud_api_gcp': ['gcp'],
  // json, datetime, file_processing map 1:1
};

/**
 * Translate semantic capabilities to OpenAgentic Synth capabilities.
 */
function translateCapabilities(capabilities: string[]): string[] {
  const translated = new Set<string>();
  for (const cap of capabilities) {
    const mapped = CAPABILITY_MAP[cap];
    if (mapped) {
      for (const m of mapped) translated.add(m);
    } else {
      // Pass through 1:1 (json, datetime, file_processing, etc.)
      translated.add(cap);
    }
  }
  return Array.from(translated);
}

/**
 * Fire-and-forget audit event logging.
 */
async function logAuditEvent(
  eventType: string,
  executionId: string,
  sessionId: string,
  userId: string,
  payload: Record<string, any>
): Promise<void> {
  try {
    await prisma.agentAuditEvent.create({
      data: {
        executionId,
        sessionId,
        userId,
        agentId: payload.agentId || 'oat_function_builder',
        agentRole: 'tool_builder',
        eventType,
        eventPayload: payload,
        parentAgentId: null,
        modelId: null,
        source: 'artifact-functions',
        riskLevel: payload.riskLevel || null,
        durationMs: payload.durationMs || null,
      },
    });
  } catch (err: any) {
    logger.warn({ err: err.message, eventType }, '[ArtifactFunctions] Failed to log audit event');
  }
}

/**
 * Create a Redis client for pub/sub publish operations.
 */
async function getPublisher() {
  const redisUrl = process.env.REDIS_URL ||
    `redis://${process.env.REDIS_HOST || 'openagentic-redis'}:${process.env.REDIS_PORT || '6379'}`;
  const client = createClient({ url: redisUrl });
  await client.connect();
  return client;
}

const artifactFunctionRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {

  // All routes require authentication
  fastify.addHook('onRequest', authMiddleware);

  // ─── POST / — Register a new OAT function ──────────────────────────

  fastify.post<{
    Body: {
      executionId: string;
      sessionId: string;
      name: string;
      description: string;
      pythonCode: string;
      capabilities: string[];
      riskLevel: 'low' | 'medium' | 'high' | 'critical';
      riskReasons: string[];
      maxMemoryMb?: number;
      maxTimeoutS?: number;
    };
  }>('/', async (request, reply) => {
    const user = (request as any).user;
    if (!user?.id) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    const {
      executionId,
      sessionId,
      name,
      description,
      pythonCode,
      capabilities,
      riskLevel,
      riskReasons,
      maxMemoryMb,
      maxTimeoutS,
    } = request.body;

    if (!executionId || !sessionId || !name || !pythonCode || !riskLevel) {
      return reply.code(400).send({ error: 'Missing required fields: executionId, sessionId, name, pythonCode, riskLevel' });
    }

    const validRiskLevels = ['low', 'medium', 'high', 'critical'];
    if (!validRiskLevels.includes(riskLevel)) {
      return reply.code(400).send({ error: `Invalid riskLevel. Must be one of: ${validRiskLevels.join(', ')}` });
    }

    try {
      // Auto-approve low/medium risk functions
      const autoApprove = riskLevel === 'low' || riskLevel === 'medium';
      const approvalStatus = autoApprove ? 'auto_approved' : 'pending';

      const fn = await prisma.artifactFunction.create({
        data: {
          executionId,
          sessionId,
          userId: user.id,
          name,
          description: description || '',
          pythonCode,
          capabilities: capabilities || [],
          riskLevel,
          riskReasons: riskReasons || [],
          approvalStatus,
          maxMemoryMb: maxMemoryMb || 256,
          maxTimeoutS: maxTimeoutS || 30,
        },
      });

      // Audit log
      const auditEventType = autoApprove ? 'oat_function_auto_approve' : 'oat_function_create';
      logAuditEvent(auditEventType, executionId, sessionId, user.id, {
        functionId: fn.id,
        name,
        riskLevel,
        riskReasons,
        approvalStatus,
        capabilities,
      });

      logger.info({
        functionId: fn.id,
        name,
        riskLevel,
        approvalStatus,
        userId: user.id,
      }, '[ArtifactFunctions] Function registered');

      return reply.code(201).send(fn);
    } catch (err: any) {
      logger.error({ err: err.message }, '[ArtifactFunctions] Failed to register function');
      return reply.code(500).send({ error: 'Failed to register artifact function' });
    }
  });

  // ─── GET /:id — Get function details ────────────────────────────────

  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const user = (request as any).user;
    if (!user?.id) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    const { id } = request.params;

    try {
      const fn = await prisma.artifactFunction.findUnique({ where: { id } });

      if (!fn) {
        return reply.code(404).send({ error: 'Artifact function not found' });
      }

      if (fn.userId !== user.id) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      return reply.send(fn);
    } catch (err: any) {
      logger.error({ err: err.message, functionId: id }, '[ArtifactFunctions] Failed to get function');
      return reply.code(500).send({ error: 'Failed to retrieve artifact function' });
    }
  });

  // ─── POST /:id/execute — Execute a registered function ──────────────

  fastify.post<{
    Params: { id: string };
    Body: {
      args?: Record<string, any>;
      input_data?: any;
    };
  }>('/:id/execute', async (request, reply) => {
    const user = (request as any).user;
    if (!user?.id) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    const { id } = request.params;

    try {
      const fn = await prisma.artifactFunction.findUnique({ where: { id } });

      if (!fn) {
        return reply.code(404).send({ error: 'Artifact function not found' });
      }

      if (fn.userId !== user.id) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      if (fn.approvalStatus !== 'approved' && fn.approvalStatus !== 'auto_approved') {
        return reply.code(403).send({
          error: 'Function not approved for execution',
          approvalStatus: fn.approvalStatus,
        });
      }

      // Increment call count and update lastCalledAt
      await prisma.artifactFunction.update({
        where: { id },
        data: {
          callCount: { increment: 1 },
          lastCalledAt: new Date(),
        },
      });

      // Translate capabilities for the OpenAgentic Synth
      const executorCapabilities = translateCapabilities(fn.capabilities);

      // Forward to OpenAgentic Synth
      const startTime = Date.now();
      const executorResponse = await axios.post(`${SYNTH_EXECUTOR_URL}/execute`, {
        code: fn.pythonCode,
        capabilities: executorCapabilities,
        max_memory_mb: fn.maxMemoryMb,
        max_timeout_s: fn.maxTimeoutS,
        args: request.body?.args || {},
        input_data: request.body?.input_data,
      }, {
        timeout: (fn.maxTimeoutS + 10) * 1000, // Add buffer beyond function timeout
        headers: { 'Content-Type': 'application/json' },
      });
      const durationMs = Date.now() - startTime;

      // Audit log
      logAuditEvent('oat_function_execute', fn.executionId, fn.sessionId, user.id, {
        functionId: fn.id,
        name: fn.name,
        riskLevel: fn.riskLevel,
        durationMs,
        capabilities: executorCapabilities,
        success: true,
      });

      logger.info({
        functionId: fn.id,
        name: fn.name,
        durationMs,
        userId: user.id,
      }, '[ArtifactFunctions] Function executed');

      return reply.send({
        functionId: fn.id,
        name: fn.name,
        result: executorResponse.data,
        durationMs,
      });
    } catch (err: any) {
      // Log execution failure audit event
      if (err?.response) {
        // OpenAgentic Synth returned an error response
        logger.error({
          functionId: id,
          status: err.response.status,
          data: err.response.data,
        }, '[ArtifactFunctions] OpenAgentic Synth returned error');

        return reply.code(502).send({
          error: 'OpenAgentic Synth error',
          details: err.response.data,
        });
      }

      logger.error({ err: err.message, functionId: id }, '[ArtifactFunctions] Failed to execute function');
      return reply.code(500).send({ error: 'Failed to execute artifact function' });
    }
  });
};

// ─── Agent Execution Approval Routes ──────────────────────────────────

export const agentExecutionApprovalRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {

  // All routes require authentication
  fastify.addHook('onRequest', authMiddleware);

  // ─── POST /:executionId/approve — HITM approval response ───────────

  fastify.post<{
    Params: { executionId: string };
    Body: {
      agentId: string;
      functionId: string;
      decision: 'approved' | 'denied';
      reason?: string;
    };
  }>('/:executionId/approve', async (request, reply) => {
    const user = (request as any).user;
    if (!user?.id) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    const { executionId } = request.params;
    const { agentId, functionId, decision, reason } = request.body;

    if (!agentId || !functionId || !decision) {
      return reply.code(400).send({ error: 'Missing required fields: agentId, functionId, decision' });
    }

    if (decision !== 'approved' && decision !== 'denied') {
      return reply.code(400).send({ error: 'Invalid decision. Must be "approved" or "denied"' });
    }

    try {
      // Update the artifact function approval status
      const fn = await prisma.artifactFunction.findUnique({ where: { id: functionId } });

      if (!fn) {
        return reply.code(404).send({ error: 'Artifact function not found' });
      }

      if (fn.approvalStatus !== 'pending') {
        return reply.code(409).send({
          error: 'Function is not pending approval',
          currentStatus: fn.approvalStatus,
        });
      }

      const updatedFn = await prisma.artifactFunction.update({
        where: { id: functionId },
        data: {
          approvalStatus: decision,
          approvedBy: user.id,
          approvedAt: new Date(),
        },
      });

      // Publish approval decision to Redis pub/sub for waiting agents
      let publishSuccess = false;
      try {
        const publisher = await getPublisher();
        const channel = `approval:${executionId}:${agentId}`;
        await publisher.publish(channel, JSON.stringify({
          functionId,
          decision,
          reason: reason || null,
          approvedBy: user.id,
          approvedAt: updatedFn.approvedAt,
        }));
        await publisher.disconnect();
        publishSuccess = true;
      } catch (redisErr: any) {
        logger.warn({ err: redisErr.message, executionId, agentId }, '[ArtifactFunctions] Failed to publish approval to Redis');
      }

      // Audit log
      const auditEventType = decision === 'approved' ? 'oat_function_approve' : 'oat_function_deny';
      logAuditEvent(auditEventType, executionId, fn.sessionId, user.id, {
        functionId,
        agentId,
        decision,
        reason: reason || null,
        name: fn.name,
        riskLevel: fn.riskLevel,
      });

      logger.info({
        functionId,
        executionId,
        agentId,
        decision,
        approvedBy: user.id,
      }, '[ArtifactFunctions] Approval decision recorded');

      return reply.send({
        functionId,
        decision,
        approvalStatus: updatedFn.approvalStatus,
        publishedToRedis: publishSuccess,
      });
    } catch (err: any) {
      logger.error({ err: err.message, executionId, functionId }, '[ArtifactFunctions] Failed to process approval');
      return reply.code(500).send({ error: 'Failed to process approval' });
    }
  });
};

export default artifactFunctionRoutes;
