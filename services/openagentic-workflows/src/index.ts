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
 * OpenAgentic Workflow Execution Service
 *
 * Standalone Fastify service for workflow execution.
 * Separates heavy workflow processing from the main API to prevent
 * event loop blocking and enable independent scaling.
 *
 * Endpoints:
 *   POST /execute          — Execute a workflow (SSE stream)
 *   POST /execute-sync     — Execute a workflow (JSON response)
 *   GET  /health           — Health check
 *   GET  /metrics          — Basic execution metrics
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import * as promClient from 'prom-client';
import { loggers } from './utils/logger.js';
import { prisma } from './utils/prisma.js';
import { getRedis, closeRedis } from './utils/redis.js';
import { executeWorkflow, ExecutionEvent } from './services/WorkflowExecutionEngine.js';
import { WorkflowCompiler } from './services/WorkflowCompiler.js';
import { startWorkflowScheduler } from './services/WorkflowScheduler.js';

const logger = loggers.server;
const PORT = parseInt(process.env.PORT || '3400', 10);
const HOST = process.env.HOST || '0.0.0.0';

const compiler = new WorkflowCompiler();

// Prometheus metrics
const promRegister = new promClient.Registry();
promClient.collectDefaultMetrics({ register: promRegister });

const workflowExecutionsTotal = new promClient.Counter({
  name: 'workflow_executions_total',
  help: 'Total workflow executions',
  labelNames: ['status'] as const,
  registers: [promRegister],
});

const workflowActiveExecutions = new promClient.Gauge({
  name: 'workflow_active_executions',
  help: 'Currently running workflow executions',
  registers: [promRegister],
});

const workflowExecutionDuration = new promClient.Histogram({
  name: 'workflow_execution_duration_seconds',
  help: 'Workflow execution duration in seconds',
  buckets: [1, 5, 10, 30, 60, 120, 300, 600],
  registers: [promRegister],
});

const workflowNodeDuration = new promClient.Histogram({
  name: 'workflow_node_duration_seconds',
  help: 'Individual node execution duration in seconds',
  labelNames: ['node_type'] as const,
  buckets: [0.1, 0.5, 1, 5, 10, 30, 60],
  registers: [promRegister],
});

const workflowNodeErrors = new promClient.Counter({
  name: 'workflow_node_errors_total',
  help: 'Total node execution errors',
  labelNames: ['node_type', 'error_code'] as const,
  registers: [promRegister],
});

// Track execution metrics (for JSON endpoint)
const metrics = {
  totalExecutions: 0,
  activeExecutions: 0,
  successfulExecutions: 0,
  failedExecutions: 0,
  startTime: Date.now(),
};

async function start() {
  const fastify = Fastify({
    logger: false, // We use our own pino logger
    bodyLimit: 10 * 1024 * 1024, // 10MB for large workflow definitions
    requestTimeout: 300000, // 5 min for long-running workflows
  });

  await fastify.register(cors, { origin: true });

  // =========================================================================
  // Health Check
  // =========================================================================
  fastify.get('/health', async () => ({
    status: 'ok',
    service: 'openagentic-workflows',
    uptime: Math.floor((Date.now() - metrics.startTime) / 1000),
    activeExecutions: metrics.activeExecutions,
    totalExecutions: metrics.totalExecutions,
  }));

  // =========================================================================
  // Metrics (Prometheus format)
  // =========================================================================
  fastify.get('/metrics', async (_request, reply) => {
    reply.header('Content-Type', promRegister.contentType);
    return promRegister.metrics();
  });

  // JSON metrics (for internal use)
  fastify.get('/metrics/json', async () => ({
    ...metrics,
    uptimeSeconds: Math.floor((Date.now() - metrics.startTime) / 1000),
  }));

  // =========================================================================
  // POST /execute — SSE streaming execution
  // =========================================================================
  fastify.post<{
    Body: {
      workflowId: string;
      executionId: string;
      definition: { nodes: any[]; edges: any[] };
      input: Record<string, any>;
      userId: string;
      authToken?: string;
      idToken?: string;
      userEmail?: string;
    };
  }>('/execute', async (request, reply): Promise<void> => {
    const { workflowId, executionId, definition, input, userId, authToken, idToken, userEmail } = request.body;

    logger.info({ workflowId, executionId, nodeCount: definition?.nodes?.length }, 'Workflow execution request received');

    // Validate
    if (!definition?.nodes?.length) {
      reply.code(400).send({ error: 'No nodes in workflow definition' });
      return;
    }

    // Compile and validate
    const compilationResult = compiler.compile({
      nodes: definition.nodes,
      edges: definition.edges || [],
    });

    if (!compilationResult.valid) {
      reply.code(400).send({
        error: 'Workflow compilation failed',
        errors: compilationResult.errors,
      });
      return;
    }

    // SSE streaming
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    });
    reply.raw.socket?.setNoDelay(true);
    // Send initial comment to prevent stream errors on slow connections
    reply.raw.write(': connected\n\n');

    const sendSSE = (event: ExecutionEvent) => {
      if (!reply.raw.writableEnded) {
        reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        // Flush immediately so events stream in real-time
        if (typeof (reply.raw as any).flush === 'function') {
          (reply.raw as any).flush();
        }
      }
    };

    metrics.activeExecutions++;
    metrics.totalExecutions++;
    workflowActiveExecutions.inc();
    const execTimer = workflowExecutionDuration.startTimer();

    try {
      const result = await executeWorkflow(
        workflowId,
        executionId,
        definition,
        input || {},
        userId,
        authToken,
        (event) => {
          sendSSE(event);
          // Track node-level metrics from events
          if (event.type === 'node_complete' && event.data?.executionTimeMs) {
            workflowNodeDuration.observe({ node_type: event.data.nodeType || 'unknown' }, event.data.executionTimeMs / 1000);
          }
          if (event.type === 'node_error') {
            workflowNodeErrors.inc({ node_type: event.data?.nodeType || 'unknown', error_code: 'execution_failed' });
          }
        },
        { userEmail, idToken }
      );

      if (result.success) {
        metrics.successfulExecutions++;
        workflowExecutionsTotal.inc({ status: 'success' });
      } else {
        metrics.failedExecutions++;
        workflowExecutionsTotal.inc({ status: 'failed' });
      }

      // Update workflow stats in DB
      try {
        await prisma.workflow.update({
          where: { id: workflowId },
          data: {
            total_executions: { increment: 1 },
            successful_executions: result.success ? { increment: 1 } : undefined,
            failed_executions: !result.success ? { increment: 1 } : undefined,
          },
        });
      } catch (dbErr: any) {
        logger.warn({ error: dbErr.message }, 'Failed to update workflow stats');
      }

    } catch (execError: any) {
      metrics.failedExecutions++;
      workflowExecutionsTotal.inc({ status: 'error' });
      logger.error({ error: execError.message, workflowId, executionId }, 'Workflow execution failed');

      sendSSE({
        type: 'execution_error',
        executionId,
        timestamp: new Date().toISOString(),
        data: { error: execError.message },
      });

      // Update failure stats
      try {
        await prisma.workflow.update({
          where: { id: workflowId },
          data: {
            total_executions: { increment: 1 },
            failed_executions: { increment: 1 },
          },
        });
      } catch {}
    } finally {
      metrics.activeExecutions--;
      workflowActiveExecutions.dec();
      execTimer();
      if (!reply.raw.writableEnded) {
        reply.raw.end();
      }
    }
  });

  // =========================================================================
  // POST /execute-sync — JSON response execution (for internal calls)
  // =========================================================================
  fastify.post<{
    Body: {
      workflowId: string;
      executionId: string;
      definition: { nodes: any[]; edges: any[] };
      input: Record<string, any>;
      userId: string;
      authToken?: string;
      idToken?: string;
      userEmail?: string;
    };
  }>('/execute-sync', async (request, reply) => {
    const { workflowId, executionId, definition, input, userId, authToken, idToken, userEmail } = request.body;

    const compilationResult = compiler.compile({
      nodes: definition.nodes || [],
      edges: definition.edges || [],
    });

    if (!compilationResult.valid) {
      return reply.code(400).send({
        error: 'Workflow compilation failed',
        errors: compilationResult.errors,
      });
    }

    const events: ExecutionEvent[] = [];
    metrics.activeExecutions++;
    metrics.totalExecutions++;

    try {
      const result = await executeWorkflow(
        workflowId,
        executionId,
        definition,
        input || {},
        userId,
        authToken,
        (event) => events.push(event),
        { userEmail, idToken }
      );

      if (result.success) metrics.successfulExecutions++;
      else metrics.failedExecutions++;

      return { success: result.success, output: result.output, events };
    } catch (err: any) {
      metrics.failedExecutions++;
      return reply.code(500).send({ error: err.message, events });
    } finally {
      metrics.activeExecutions--;
    }
  });

  // =========================================================================
  // POST /compile — Validate workflow definition without executing
  // =========================================================================
  fastify.post<{
    Body: {
      definition: { nodes: any[]; edges: any[] };
    };
  }>('/compile', async (request, reply) => {
    const { definition } = request.body;

    if (!definition?.nodes) {
      return reply.code(400).send({ valid: false, errors: [{ code: 'NO_NODES', message: 'No nodes in definition' }] });
    }

    const compilationResult = compiler.compile({
      nodes: definition.nodes || [],
      edges: definition.edges || [],
    });

    return {
      valid: compilationResult.valid,
      errors: compilationResult.errors || [],
      warnings: compilationResult.warnings || [],
      nodeCount: definition.nodes.length,
      edgeCount: (definition.edges || []).length,
    };
  });

  // =========================================================================
  // Start server
  // =========================================================================

  // Verify DB connectivity
  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info('Database connection verified');
  } catch (err: any) {
    logger.error({ error: err.message }, 'Database connection failed');
    process.exit(1);
  }

  // Connect Redis (optional — won't crash if unavailable)
  try {
    const redis = getRedis();
    await redis.connect();
    await redis.ping();
    logger.info('Redis connection verified');
  } catch (err: any) {
    logger.warn({ error: err.message }, 'Redis connection failed — continuing without Redis');
  }

  // Start workflow scheduler
  try {
    await startWorkflowScheduler();
    logger.info('Workflow scheduler started');
  } catch (err: any) {
    logger.warn({ error: err.message }, 'Workflow scheduler failed to start');
  }

  await fastify.listen({ port: PORT, host: HOST });
  logger.info({
    port: PORT,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
  }, `openagentic-workflows service started on port ${PORT}`);
}

start().catch((err) => {
  logger.error({ error: err }, 'Failed to start workflow service');
  process.exit(1);
});
