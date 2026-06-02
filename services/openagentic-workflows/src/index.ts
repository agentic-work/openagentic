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
import { getAllSchemas, generateAiPromptFragment } from './nodes/registry.js';
import { findIdempotencyKey, storeIdempotencyKey } from './services/IdempotencyService.js';
import { requireInternalKey } from './middleware/requireInternalKey.js';
import { validateTenantId } from './middleware/validateTenantId.js';
import { resumeExecutionHandler, type ResumeExecutionInput } from './services/resumeExecutionHandler.js';
import { submitDataRequest, isDataRequestSubmission } from './services/dataRequestSubmissionHandler.js';
import { seedTemplatesOnBoot } from './services/templateSeeder.js';
import { withTenant } from './utils/tenantPrismaExtension.js';

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
      triggerType?: string;
      userPermissions?: string[];
      /**
       * Caller's tenant id (Task 1.3 / V3 Enterprise Chatmode S5). REQUIRED
       * — validated to non-empty string before any handler logic runs.
       * Task 1.4 will use this to wrap the handler in `withTenant()`.
       */
      tenantId: string;
      /** Phase B #17: optional test-mode mocks. Forwarded to engine. */
      mocks?: import('@openagentic/workflow-engine').TestMocks;
    };
  }>('/execute', async (request, reply): Promise<void> => {
    const auth = await requireInternalKey(request, reply);
    if (!auth.ok) return;
    // Task 1.3 (V3 Enterprise Chatmode S5): receive-side tenant gate.
    if (!validateTenantId(request.body, reply)) return;
    const { tenantId, workflowId, executionId, definition, input, userId, authToken, idToken, userEmail, triggerType, userPermissions, mocks } = request.body;
    // Task 1.4 (V3 Enterprise Chatmode S5): every Prisma op below — direct
    // (`prisma.workflow.update`), Idempotency service, and the entire
    // `executeWorkflow` delegation tree — must run inside the
    // tenant-scoped AsyncLocalStorage frame established by `withTenant`.
    return withTenant({ tenantId }, async () => {
      const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

      logger.info({ workflowId, executionId, nodeCount: definition?.nodes?.length }, 'Workflow execution request received');

      // Idempotency: for SSE endpoint, replay returns a JSON 200 (I1/I3)
      if (idempotencyKey) {
        const existing = await findIdempotencyKey(idempotencyKey);
        if (existing) {
          reply.header('Idempotent-Replay', 'true');
          reply.code(200).send(existing.result);
          return;
        }
      }

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
      // fastify 5: hijack the connection so fastify's response flow
      // doesn't race our own writeHead/write calls on reply.raw.
      reply.hijack();
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
          { userEmail, idToken, triggerType, userPermissions, testMocks: mocks }
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

        // Store idempotency key after SSE execution completes (I2)
        if (idempotencyKey) {
          await storeIdempotencyKey(idempotencyKey, executionId, { success: result.success, output: result.output });
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
      triggerType?: string;
      userPermissions?: string[];
      /**
       * Caller's tenant id (Task 1.3 / V3 Enterprise Chatmode S5). REQUIRED
       * — validated to non-empty string before any handler logic runs.
       * Task 1.4 will use this to wrap the handler in `withTenant()`.
       */
      tenantId: string;
      /** Phase B #17: optional test-mode mocks. Forwarded to engine. */
      mocks?: import('@openagentic/workflow-engine').TestMocks;
    };
  }>('/execute-sync', async (request, reply) => {
    const auth = await requireInternalKey(request, reply);
    if (!auth.ok) return;
    // Task 1.3 (V3 Enterprise Chatmode S5): receive-side tenant gate.
    if (!validateTenantId(request.body, reply)) return;
    const { tenantId, workflowId, executionId, definition, input, userId, authToken, idToken, userEmail, triggerType, userPermissions, mocks } = request.body;
    // Task 1.4 (V3 Enterprise Chatmode S5): every Prisma op below
    // (Idempotency service + executeWorkflow delegation tree) must run
    // inside the tenant-scoped AsyncLocalStorage frame.
    return withTenant({ tenantId }, async () => {
      const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

      // Idempotency: replay stored result for duplicate requests within 24h (I1/I3)
      if (idempotencyKey) {
        const existing = await findIdempotencyKey(idempotencyKey);
        if (existing) {
          reply.header('Idempotent-Replay', 'true');
          return existing.result;
        }
      }

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
          { userEmail, idToken, triggerType, userPermissions, testMocks: mocks }
        );

        if (result.success) metrics.successfulExecutions++;
        else metrics.failedExecutions++;

        const responseBody = { success: result.success, output: result.output, events };

        // Store result for idempotency replay (I2)
        if (idempotencyKey) {
          await storeIdempotencyKey(idempotencyKey, executionId, responseBody);
        }

        return responseBody;
      } catch (err: any) {
        metrics.failedExecutions++;
        return reply.code(500).send({ error: err.message, events });
      } finally {
        metrics.activeExecutions--;
      }
    });
  });

  // =========================================================================
  // POST /resume-execution — Resume a paused workflow (HITL approval re-entry)
  //
  // Phase B blocker (#16): the api's workflow-approvals.ts used to
  // construct WorkflowExecutionEngine in-process to resume after HITL
  // approval. This endpoint exposes the same operation here so the api
  // can proxy via internal-key auth and the api-side engine class can
  // be retired.
  //
  // Request body shape:
  //   {
  //     workflowId, executionId, definition, fromNodeId, resumeInput,
  //     state: { input, variables, nodeResults, startTimeMs },
  //     userId, authToken?, idToken?, userEmail?, triggerType?,
  //     userPermissions?, userGroups?, tenantId?
  //   }
  //
  // Streams ExecutionEvent frames as SSE — same shape as POST /execute.
  // =========================================================================
  fastify.post<{
    Body: ResumeExecutionInput;
  }>('/resume-execution', async (request, reply): Promise<void> => {
    const auth = await requireInternalKey(request, reply);
    if (!auth.ok) return;
    // Task 1.3 (V3 Enterprise Chatmode S5): receive-side tenant gate.
    // ResumeExecutionInput types tenantId as `string | null | undefined` for
    // back-compat at the type layer; the runtime contract is now strict
    // non-empty string, enforced here.
    if (!validateTenantId(request.body, reply)) return;

    const payload = request.body;
    // After validateTenantId, payload.tenantId is guaranteed non-empty string.
    const tenantId = payload.tenantId as string;

    // ── HITL human_input / request_data SUBMIT branch ──────────────────────
    // A data-request submission carries { requestId, values } (+ optional
    // executionId/providedBy/providedAt) but NONE of the approval-resume's
    // definition/fromNodeId/state — the workflows-svc looks those up from the
    // persisted WorkflowDataRequest + WorkflowExecution rows. Discriminated by
    // `kind:'data_request'` or by `requestId` with no inline state/definition.
    // The approval path below is left untouched (kind:'approval' or no kind +
    // definition/state present).
    if (isDataRequestSubmission(request.body as any)) {
      return withTenant({ tenantId }, async () => {
        const body = request.body as any;
        // SSE streaming — same envelope as the approval path so api-side
        // resumeViaWorkflowsService can replay events[] uniformly.
        reply.hijack();
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
          'X-Content-Type-Options': 'nosniff',
        });
        reply.raw.socket?.setNoDelay(true);
        reply.raw.write(': connected\n\n');

        const sendDR = (event: ExecutionEvent) => {
          if (!reply.raw.writableEnded) {
            reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
            if (typeof (reply.raw as any).flush === 'function') (reply.raw as any).flush();
          }
        };

        metrics.activeExecutions++;
        workflowActiveExecutions.inc();
        try {
          const result = await submitDataRequest(
            {
              executionId: body.executionId,
              requestId: body.requestId,
              values: body.values,
              providedBy: body.providedBy,
              providedAt: body.providedAt,
            },
            { prisma: prisma as any },
            sendDR,
          );
          sendDR({
            type: result.success ? 'execution_complete' : 'execution_error',
            executionId: body.executionId || '',
            timestamp: new Date().toISOString(),
            data: {
              success: result.success,
              output: result.output,
              error: result.error,
              notFound: result.notFound,
              invalid: result.invalid,
            },
          } as ExecutionEvent);
        } catch (err: any) {
          logger.error({ err: err.message, requestId: body.requestId }, 'Data-request resume failed unexpectedly');
          sendDR({
            type: 'execution_error',
            executionId: body.executionId || '',
            timestamp: new Date().toISOString(),
            data: { error: err.message },
          } as ExecutionEvent);
        } finally {
          metrics.activeExecutions--;
          workflowActiveExecutions.dec();
          if (!reply.raw.writableEnded) reply.raw.end();
        }
      });
    }

    if (!payload?.definition?.nodes?.length) {
      reply.code(400).send({ error: 'No nodes in workflow definition' });
      return;
    }
    if (!payload.fromNodeId) {
      reply.code(400).send({ error: 'fromNodeId is required' });
      return;
    }
    if (!payload.state) {
      reply.code(400).send({ error: 'state is required (input, variables, nodeResults, startTimeMs)' });
      return;
    }

    // Task 1.4 (V3 Enterprise Chatmode S5): the resumeExecutionHandler
    // delegates into the workflow execution engine + Prisma reads/writes
    // on tenanted models — wrap the entire dispatch in a tenant-scoped
    // AsyncLocalStorage frame. Transport plumbing (hijack/writeHead/end)
    // doesn't touch Prisma but stays inside the wrap for simplicity and
    // so any future Prisma-touching pre/post hooks inherit context.
    return withTenant({ tenantId }, async () => {
      // SSE streaming — same pattern as POST /execute.
      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'X-Content-Type-Options': 'nosniff',
      });
      reply.raw.socket?.setNoDelay(true);
      reply.raw.write(': connected\n\n');

      const sendSSE = (event: ExecutionEvent) => {
        if (!reply.raw.writableEnded) {
          reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
          if (typeof (reply.raw as any).flush === 'function') {
            (reply.raw as any).flush();
          }
        }
      };

      metrics.activeExecutions++;
      workflowActiveExecutions.inc();

      try {
        const result = await resumeExecutionHandler(payload, sendSSE);
        // Final summary frame so consumers don't have to derive completion from event types.
        sendSSE({
          type: result.success ? 'execution_complete' : 'execution_error',
          executionId: payload.executionId,
          timestamp: new Date().toISOString(),
          data: { success: result.success, output: result.output, error: result.error },
        });
      } catch (err: any) {
        logger.error({ err: err.message, executionId: payload.executionId }, 'Resume failed unexpectedly');
        sendSSE({
          type: 'execution_error',
          executionId: payload.executionId,
          timestamp: new Date().toISOString(),
          data: { error: err.message },
        });
      } finally {
        metrics.activeExecutions--;
        workflowActiveExecutions.dec();
        if (!reply.raw.writableEnded) {
          reply.raw.end();
        }
      }
    });
  });

  // =========================================================================
  // POST /compile — Validate workflow definition without executing
  // =========================================================================
  fastify.post<{
    Body: {
      definition: { nodes: any[]; edges: any[] };
    };
  }>('/compile', async (request, reply) => {
    const auth = await requireInternalKey(request, reply);
    if (!auth.ok) return;
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
  // GET /node-schemas — schema-driven node registry contents
  //
  // Returns every migrated node's schema.json (drives palette + AI Flow
  // Builder system prompt). The other 50+ legacy nodes still live in the
  // hand-maintained nodeConfigs.ts on the frontend until they're migrated.
  // =========================================================================
  fastify.get('/node-schemas', async (request, reply) => {
    const auth = await requireInternalKey(request, reply);
    if (!auth.ok) return;
    const schemas = getAllSchemas();
    return {
      schemas,
      count: schemas.length,
      // Mirror the typical "palette" shape so the UI doesn't need extra
      // transformation later.
      types: schemas.map(s => s.type),
      // AI Flow Builder system-prompt fragment generated from the schema
      // `ai` blocks — replaces the hand-maintained list in useAIFlowChat.ts.
      aiPromptFragment: generateAiPromptFragment(),
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

  // Permanent template seeding (idempotent upsert from /app/templates/*.json).
  // Non-fatal: any failure is logged and start() continues so a bad seed JSON
  // cannot gate the API. New tenants automatically see these templates via the
  // `is_template + is_public` OR-predicate in workflow read paths.
  try {
    const seedResults = await seedTemplatesOnBoot();
    logger.info(
      {
        templates: seedResults.length,
        creates: seedResults.filter((r) => r.action === 'create').length,
        updates: seedResults.filter((r) => r.action === 'update').length,
        errors: seedResults.filter((r) => r.action === 'error').length,
      },
      'Permanent template seeding complete',
    );
  } catch (err: any) {
    logger.warn({ error: err.message }, 'Template seeder failed — continuing without templates');
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
