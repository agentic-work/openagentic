/**
 * Workflow execution + lifecycle routes.
 *
 *   POST /:id/execute
 *   GET  /executions/:executionId/stream
 *   POST /executions/:executionId/stop
 *   POST /:id/retry-node
 *   POST /executions/:executionId/pause
 *   POST /executions/:executionId/resume
 *   POST /executions/:executionId/cancel
 *   POST /executions/:executionId/artifacts
 *   POST /executions/:executionId/data-requests/:requestId
 *
 * Sub-plugin of workflowRoutes; auth applied by the parent preHandler hook.
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import axios from 'axios';
import type { ExecutionEvent, WorkflowDefinition } from '@openagentic/workflow-engine';
import { loggers } from '../../utils/logger.js';
import { prisma } from '../../utils/prisma.js';
import { executeViaWorkflowsService as executeWorkflow } from '../../services/executeViaWorkflowsService.js';
import { submitDataRequestViaWorkflowsService } from '../../services/resumeViaWorkflowsService.js';
import { fireWorkflowFinishedSubscribers } from '../../services/workflowFinishedSubscriptions.js';
import { resolveExecuteTenantId } from '../helpers/resolveExecuteTenantId.js';
import { abortWorkflowExecution } from '../../services/WorkflowExecutionEngine.js';
import { reportLocalEngineFallback } from '../../services/workflowServiceUrlGuard.js';
import { subscribeAgentProgressForFlowsStream } from '../../services/workflowAgentProgressBridge.js';
import { getRedisClient } from '../../utils/redis-client.js';
import { ndjsonHeaders, writeNDJSON, createSSEToNDJSONTranslator } from '../../infra/ndjson.js';
import {
  WORKFLOW_SERVICE_URL,
  asJson,
  flushReply,
  getReqUser,
  workflowCompiler,
  workflowServiceHeaders,
} from './shared.js';
import type { ExecuteWorkflowRequest, FlowDefinition, WorkflowIdParams } from './types.js';

export const executionRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const logger = loggers.routes;

  /**
   * POST /api/workflows/:id/execute
   * Execute workflow
   */
  fastify.post<{ Params: WorkflowIdParams; Body: ExecuteWorkflowRequest; Querystring: { dryRun?: string; async?: string } }>(
    '/:id/execute',
    async (request, reply): Promise<void> => {
      try {
        const { id } = request.params;
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;
        // SEV-0 Flows-fix-A1 (audit 2026-05-13): derive the request tenant
        // from BOTH (a) `request.tenantId` (set by tenantContextPlugin if
        // registered) and (b) `request.user.tenantId` (set by unifiedAuth's
        // buildRequestUser from the validated UserContext). The (b) source
        // is more reliable because tenantContextPlugin is currently NOT
        // registered in server.ts startup, which is why every execute call
        // pre-fix shipped tenantId:null on the wire.
        const requestTenantId =
          request.tenantId
          ?? user?.tenantId
          ?? null;
        const { input = {}, trigger_type = 'manual', version_id } = request.body;
        const isDryRun = request.query.dryRun === 'true';
        const isAsync = request.query.async === 'true';

        // Get workflow (creators can execute drafts, others need active+public)
        const workflow = await prisma.workflow.findFirst({
          where: {
            id,
            deleted_at: null,
            OR: [
              { created_by: userId },
              { is_public: true, is_active: true }
            ]
          },
          include: {
            versions: {
              where: version_id ? { id: version_id } : { is_active: true },
              take: 1
            }
          }
        });

        if (!workflow) {
          reply.code(404).send({
            error: 'Not found',
            message: `Workflow with ID '${id}' not found, inactive, or you don't have permission`
          });
          return;
        }

        // SEV-0 Flows-fix-A1 (audit 2026-05-13): resolve the wire tenantId
        // via the fail-CLOSED helper. Pre-fix the streaming execute path
        // used raw axios.post and shipped tenantId:null when both sources
        // were unset — workflows-svc 400-rejected every call (41h, 0 execs).
        const tenantResolution = resolveExecuteTenantId({
          requestTenantId,
          workflowTenantId: workflow.tenant_id,
        });
        if (tenantResolution.ok !== true) {
          const reason = (tenantResolution as { ok: false; error: string }).error;
          logger.warn({
            workflowId: id,
            userId,
            requestTenantId,
            workflowTenantId: workflow.tenant_id,
            reason,
          }, '[Workflows] execute fail-CLOSED: no resolvable tenantId');
          reply.code(400).send({
            error: 'Tenant required',
            message: reason,
            code: 'TENANT_REQUIRED',
          });
          return;
        }
        const tenantId: string = tenantResolution.tenantId;

        const version = workflow.versions[0];
        // Prefer version definition if it has nodes, otherwise fall back to workflow's own definition
        const versionDef = version?.definition as unknown as FlowDefinition | undefined;
        const rawDefinition = (versionDef?.nodes?.length > 0)
          ? versionDef
          : (workflow.definition as unknown as FlowDefinition);

        // Filter out non-executable nodes (e.g. text annotations from AI Builder)
        const definition = rawDefinition ? {
          ...rawDefinition,
          nodes: (rawDefinition.nodes || []).filter((n) => n.type !== 'text'),
        } : rawDefinition;

        if (!definition || (!definition.nodes?.length)) {
          reply.code(400).send({
            error: 'No definition',
            message: 'This workflow has no definition to execute (no nodes found)'
          });
          return;
        }

        // Create execution record
        const totalNodes = definition?.nodes?.length || 0;

        const execution = await prisma.workflowExecution.create({
          data: {
            workflow_id: id,
            version_id: version?.id || null,
            trigger_type,
            trigger_data: { source: 'api', user_id: userId },
            status: 'pending',
            input: asJson(input),
            total_nodes: totalNodes,
            started_by: userId,
            started_at: new Date()
          }
        });

        logger.info({
          workflowId: id,
          executionId: execution.id,
          trigger_type
        }, '[Workflows] Workflow execution started');

        // Compile and validate workflow before execution
        const compilationResult = workflowCompiler.compile({
          nodes: definition.nodes || [],
          edges: definition.edges || [],
        } as unknown as WorkflowDefinition);

        if (!compilationResult.valid) {
          await prisma.workflowExecution.update({
            where: { id: execution.id },
            data: { status: 'failed', error: `Compilation failed: ${compilationResult.errors.map(e => e.message).join('; ')}` }
          });
          return reply.status(400).send({
            error: 'Workflow compilation failed',
            errors: compilationResult.errors,
            warnings: compilationResult.warnings,
          });
        }

        if (compilationResult.warnings.length > 0) {
          logger.warn({
            workflowId: id,
            warnings: compilationResult.warnings
          }, '[Workflows] Workflow compiled with warnings');
        }

        // Dry-run mode: compile + validate only, don't execute
        if (isDryRun) {
          // Clean up the execution record we created (dry-run shouldn't persist)
          await prisma.workflowExecution.delete({ where: { id: execution.id } }).catch(() => {});
          // Per-node readiness check
          const nodeChecks: Record<string, { ready: boolean; errors: string[]; warnings: string[] }> = {};
          for (const node of (definition.nodes || [])) {
            const errors: string[] = [];
            const warnings: string[] = [];
            const nodeType = node.type || node.data?.type;
            const nodeData: Record<string, unknown> = node.data || {};
            // Check required fields per node type
            if (nodeType === 'mcp_tool' && !nodeData.toolName) errors.push('Tool name is required');
            if ((nodeType === 'llm_completion' || nodeType === 'openagentic_llm') && !nodeData.prompt && !nodeData.systemPrompt) errors.push('Prompt is required');
            if (nodeType === 'code' && !nodeData.code) errors.push('Code is required');
            if (nodeType === 'http_request' && !nodeData.url) errors.push('URL is required');
            if (nodeType === 'condition' && !nodeData.condition) errors.push('Condition expression is required');
            // Agent nodes need at minimum instructions or a name
            if (['agent_spawn', 'agent_single', 'agent_pool', 'agent_supervisor', 'multi_agent'].includes(nodeType)) {
              if (!nodeData.agentName && !nodeData.instructions && !nodeData.agents) {
                warnings.push('Agent node has no name, instructions, or agent list configured');
              }
            }
            nodeChecks[node.id] = { ready: errors.length === 0, errors, warnings };
          }
          const allReady = Object.values(nodeChecks).every(nc => nc.ready);
          return reply.send({
            valid: compilationResult.valid && allReady,
            nodeChecks,
            compilation: {
              valid: compilationResult.valid,
              errors: compilationResult.errors,
            },
          });
        }

        // Async mode: return executionId immediately, run in background via Redis pub/sub
        if (isAsync) {
          reply.send({ executionId: execution.id, status: 'running' });

          // Fire-and-forget execution in background
          (async () => {
            // Brief delay to let the frontend's EventSource connect before we start publishing events
            await new Promise(r => setTimeout(r, 500));

            const execChannel = `workflow:exec:${execution.id}`;
            const redisPublisher = getRedisClient();
            // Publish one NDJSON line per event. The GET /stream handler
            // (Redis subscriber) writes these verbatim to its clients.
            const sendEvent = (event: ExecutionEvent) => {
              const line = JSON.stringify({ ...(event as unknown as Record<string, unknown>), type: event.type }) + '\n';
              redisPublisher.publish(execChannel, line).catch(() => {});
            };

            // Phase C.4: subscribe to AgentEventStore and publish
            // agent_progress frames to the exec channel so GET /stream
            // subscribers see sub-agent progress. Unsubscribe when the
            // inner execution finishes (in finally below).
            const unsubscribeAgentProgress = subscribeAgentProgressForFlowsStream(
              execution.id,
              (frame) => {
                const line = JSON.stringify({ type: 'agent_progress', ...frame }) + '\n';
                redisPublisher.publish(execChannel, line).catch(() => {});
              },
            );

            // Send execution_start so the frontend timeline initializes
            sendEvent({ type: 'execution_start', executionId: execution.id, data: { workflowId: id }, timestamp: new Date().toISOString() });

            try {
              // CSP MCP tools invoked by the flow authenticate to the cloud via
              // their own service-principal / static-keypair / ADC creds. The
              // inbound bearer is forwarded for inter-service auth only.
              const effectiveAuthToken = request.headers.authorization
                || (user?.accessToken ? `Bearer ${user.accessToken}` : undefined);

              let userEmail: string | undefined;
              try {
                const dbUser = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
                userEmail = dbUser?.email || user?.email;
              } catch {}

              if (WORKFLOW_SERVICE_URL) {
                const proxyResponse = await axios.post(
                  `${WORKFLOW_SERVICE_URL}/execute`,
                  {
                    workflowId: id, executionId: execution.id,
                    definition: { nodes: definition.nodes || [], edges: definition.edges || [] },
                    input: input || {}, userId,
                    authToken: effectiveAuthToken, userEmail,
                    // Task 1.3 (V3 Enterprise Chatmode S5).
                    tenantId,
                  },
                  { responseType: 'stream', timeout: 300000, headers: workflowServiceHeaders({ Accept: 'text/event-stream' }) }
                );
                // Bridge downstream SSE → NDJSON before publishing to Redis
                // so both direct and pub/sub consumers see the same format.
                const bridge = createSSEToNDJSONTranslator();
                await new Promise<void>((resolve, reject) => {
                  proxyResponse.data.on('data', (chunk: Buffer) => {
                    const ndjson = bridge.translate(chunk);
                    if (ndjson) {
                      redisPublisher.publish(execChannel, ndjson).catch(() => {});
                    }
                  });
                  proxyResponse.data.on('end', () => {
                    const tail = bridge.flush();
                    if (tail) redisPublisher.publish(execChannel, tail).catch(() => {});
                    resolve();
                  });
                  proxyResponse.data.on('error', (err: Error) => reject(err));
                });
              } else {
                reportLocalEngineFallback({ workflowId: id, executionId: execution.id, logger });
                await executeWorkflow(id, execution.id,
                  { nodes: definition.nodes || [], edges: definition.edges || [] } as unknown as WorkflowDefinition,
                  input || {}, userId, effectiveAuthToken, sendEvent,
                  // Task 1.3 (V3 Enterprise Chatmode S5).
                  { userEmail, tenantId }
                );
              }

              await prisma.workflow.update({
                where: { id },
                data: { total_executions: { increment: 1 }, successful_executions: { increment: 1 } },
              }).catch(() => {});

              // P1.19 — workflow_finished trigger fan-out (success path).
              // Fire-and-forget: subscriber failure must NEVER block source
              // completion. Discovery + fire isolated in
              // workflowFinishedSubscriptions.ts; tests pin the discovery
              // logic independently of this hook.
              fireWorkflowFinishedSubscribers({
                prisma,
                logger,
                sourceWorkflowId: id,
                sourceWorkflowSlug: (workflow.settings as unknown as { meta?: { slug?: string } })?.meta?.slug,
                sourceExecutionId: execution.id,
                sourceStatus: 'completed',
                sourceOutput: undefined,
                tenantId,
                userId,
              }).catch(() => { /* fire-and-forget */ });
            } catch (execError) {
              logger.error({ error: execError }, '[Workflows] Async execution failed');
              sendEvent({ type: 'execution_error', executionId: execution.id, data: { error: execError.message }, timestamp: new Date().toISOString() });
              await prisma.workflow.update({
                where: { id },
                data: { total_executions: { increment: 1 }, failed_executions: { increment: 1 } },
              }).catch(() => {});

              // P1.19 — workflow_finished trigger fan-out (failed path).
              fireWorkflowFinishedSubscribers({
                prisma,
                logger,
                sourceWorkflowId: id,
                sourceWorkflowSlug: (workflow.settings as unknown as { meta?: { slug?: string } })?.meta?.slug,
                sourceExecutionId: execution.id,
                sourceStatus: 'failed',
                sourceOutput: { error: execError.message },
                tenantId,
                userId,
              }).catch(() => { /* fire-and-forget */ });
            } finally {
              // Phase C.4: release the AgentEventStore subscriber when
              // the background execution finishes (success or failure),
              // otherwise listeners accumulate per concurrent workflow.
              unsubscribeAgentProgress();
            }
          })();

          return;
        }

        // NDJSON streaming (v0.6.7 — SSE removed from flows, Phase C).
        reply.raw.writeHead(200, ndjsonHeaders());
        reply.raw.socket?.setNoDelay(true);

        // Keepalive ping every 15s to prevent proxy/LB timeout.
        const execKeepalive = setInterval(() => {
          if (!reply.raw.writableEnded) {
            writeNDJSON(reply, 'keepalive', { ts: new Date().toISOString() });
          } else {
            clearInterval(execKeepalive);
          }
        }, 15000);
        writeNDJSON(reply, 'connected', { executionId: execution.id });

        // Redis channel for GET /stream subscribers.
        const execChannel = `workflow:exec:${execution.id}`;
        const redisPublisher = getRedisClient();

        const sendEvent = (event: ExecutionEvent) => {
          const line = JSON.stringify({ ...(event as unknown as Record<string, unknown>), type: event.type }) + '\n';
          // Write to direct POST response.
          if (!reply.raw.writableEnded) {
            reply.raw.write(line);
            // Flush immediately so UI receives node_start before node_complete.
            flushReply(reply);
          }
          // Publish to Redis for GET /stream subscribers.
          redisPublisher.publish(execChannel, line).catch(() => {});
        };

        // Phase C.4: subscribe to AgentEventStore so sub-agent progress
        // (posted by openagentic-proxy's HTTP callback) surfaces as flat
        // `agent_progress` NDJSON frames on both the direct POST stream
        // and the Redis exec channel. Parity with chat's stream.handler.
        const unsubscribeAgentProgress = subscribeAgentProgressForFlowsStream(
          execution.id,
          (frame) => {
            const line = JSON.stringify({ type: 'agent_progress', ...frame }) + '\n';
            if (!reply.raw.writableEnded) {
              reply.raw.write(line);
            }
            redisPublisher.publish(execChannel, line).catch(() => {});
          },
        );
        reply.raw.on('close', unsubscribeAgentProgress);

        try {
          // CSP MCP tools invoked by the flow authenticate to the cloud via
          // their own service-principal / static-keypair / ADC creds. The
          // inbound bearer is forwarded for inter-service auth only.
          const effectiveAuthToken = request.headers.authorization
            || (user?.accessToken ? `Bearer ${user.accessToken}` : undefined);

          if (WORKFLOW_SERVICE_URL) {
            // ── Proxy to dedicated workflow service ──
            logger.info({ workflowId: id, executionId: execution.id, serviceUrl: WORKFLOW_SERVICE_URL }, '[Workflows] Proxying execution to workflow service');

            // Resolve user email for MCP workspace isolation
            let userEmail: string | undefined;
            try {
              const dbUser = await prisma.user.findUnique({
                where: { id: userId },
                select: { email: true }
              });
              userEmail = dbUser?.email || user?.email;
            } catch {}

            const proxyResponse = await axios.post(
              `${WORKFLOW_SERVICE_URL}/execute`,
              {
                workflowId: id,
                executionId: execution.id,
                definition: { nodes: definition.nodes || [], edges: definition.edges || [] },
                input: input || {},
                userId,
                authToken: effectiveAuthToken,
                userEmail,
                // Task 1.3 (V3 Enterprise Chatmode S5).
                tenantId,
              },
              {
                responseType: 'stream',
                timeout: 300000, // 5 min
                headers: workflowServiceHeaders({ Accept: 'text/event-stream' }),
              }
            );

            // Bridge downstream SSE → NDJSON at the proxy boundary so both
            // the direct-POST consumer and the Redis subscribers see the
            // same line-delimited JSON. Flush after every chunk so events
            // reach the browser immediately — Node's response stream
            // buffers otherwise and the UI shows no progress.
            const bridge = createSSEToNDJSONTranslator();
            await new Promise<void>((resolve, reject) => {
              proxyResponse.data.on('data', (chunk: Buffer) => {
                const ndjson = bridge.translate(chunk);
                if (!ndjson) return;
                if (!reply.raw.writableEnded) {
                  reply.raw.write(ndjson);
                  flushReply(reply);
                }
                redisPublisher.publish(execChannel, ndjson).catch(() => {});
              });
              proxyResponse.data.on('end', () => {
                const tail = bridge.flush();
                if (tail) {
                  if (!reply.raw.writableEnded) reply.raw.write(tail);
                  redisPublisher.publish(execChannel, tail).catch(() => {});
                }
                resolve();
              });
              proxyResponse.data.on('error', (err: Error) => reject(err));
            });

          } else {
            // ── Local execution (fallback — Phase B will rip this entire branch) ──
            reportLocalEngineFallback({ workflowId: id, executionId: execution.id, logger });
            let userEmail: string | undefined;
            try {
              const dbUser = await prisma.user.findUnique({
                where: { id: userId },
                select: { email: true }
              });
              userEmail = dbUser?.email || user?.email;
            } catch {}

            const result = await executeWorkflow(
              id,
              execution.id,
              { nodes: definition.nodes || [], edges: definition.edges || [] } as unknown as WorkflowDefinition,
              input || {},
              userId,
              effectiveAuthToken,
              sendEvent,
              // Task 1.3 (V3 Enterprise Chatmode S5).
              { userEmail, tenantId }
            );

            // Update workflow stats
            await prisma.workflow.update({
              where: { id },
              data: {
                total_executions: { increment: 1 },
                successful_executions: result.success ? { increment: 1 } : undefined,
                failed_executions: !result.success ? { increment: 1 } : undefined,
              },
            });
          }

        } catch (execError) {
          logger.error({ error: execError }, '[Workflows] Workflow execution failed');

          // Update workflow failure stats
          try {
            await prisma.workflow.update({
              where: { id },
              data: {
                total_executions: { increment: 1 },
                failed_executions: { increment: 1 },
              },
            });
          } catch (statsError) {
            logger.error({ statsError }, '[Workflows] Failed to update workflow stats');
          }

          // Send error event if stream still writable
          if (!reply.raw.writableEnded) {
            sendEvent({
              type: 'execution_error',
              executionId: execution.id,
              data: { error: execError.message },
              timestamp: new Date().toISOString(),
            });
          }
        } finally {
          clearInterval(execKeepalive);
          if (!reply.raw.writableEnded) {
            reply.raw.end();
          }
        }

        return;
      } catch (error) {
        logger.error({ error }, '[Workflows] Failed to execute workflow');
        if (!reply.sent) {
          reply.code(500).send({
            error: 'Failed to execute workflow',
            message: error.message
          });
        }
      }
    }
  );

  /**
   * GET /api/workflows/executions/:executionId/stream
   * EventSource-compatible SSE stream for a running execution
   */
  fastify.get<{ Params: { executionId: string } }>(
    '/executions/:executionId/stream',
    async (request, reply): Promise<void> => {
      const { executionId } = request.params;

      const execution = await prisma.workflowExecution.findFirst({
        where: { id: executionId },
      });

      if (!execution) {
        return reply.code(404).send({ error: 'Execution not found' });
      }

      reply.raw.writeHead(200, ndjsonHeaders());
      reply.raw.socket?.setNoDelay(true);
      writeNDJSON(reply, 'connected', { executionId });

      // If already completed, send final state and close.
      if (['completed', 'failed', 'completed_with_errors'].includes(execution.status)) {
        writeNDJSON(reply, 'execution_complete', { executionId, status: execution.status });
        reply.raw.end();
        return;
      }

      // Subscribe to Redis pub/sub for live events. The publisher side
      // (POST /execute + POST /test) writes NDJSON lines directly to the
      // channel, so we pipe them verbatim — zero translation here.
      try {
        const redis = getRedisClient();
        const subscriber = await redis.duplicate();

        const channel = `workflow:exec:${executionId}`;
        await subscriber.subscribe(channel, (message: string) => {
          if (!reply.raw.writableEnded) {
            reply.raw.write(message);
            flushReply(reply);
          }
        });

        request.raw.on('close', () => {
          subscriber.unsubscribe(channel).catch(() => {});
          subscriber.disconnect().catch(() => {});
        });

        const timeout = setTimeout(() => {
          if (!reply.raw.writableEnded) {
            writeNDJSON(reply, 'timeout', { executionId });
            reply.raw.end();
          }
          subscriber.unsubscribe(channel).catch(() => {});
          subscriber.disconnect().catch(() => {});
        }, 300000);

        request.raw.on('close', () => clearTimeout(timeout));
      } catch (err) {
        logger.warn({ error: err.message }, '[Workflows] Redis subscription failed for NDJSON stream');
        writeNDJSON(reply, 'error', { code: 'STREAM_UNAVAILABLE', message: 'Streaming unavailable' });
        reply.raw.end();
      }
    }
  );

  /**
   * POST /api/workflows/executions/:executionId/stop
   * Abort a running workflow execution
   */
  fastify.post<{ Params: { executionId: string } }>(
    '/executions/:executionId/stop',
    async (request, reply) => {
      try {
        const { executionId } = request.params;
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;

        // Verify execution belongs to user
        const execution = await prisma.workflowExecution.findFirst({
          where: { id: executionId },
          include: { workflow: { select: { created_by: true } } }
        });

        if (!execution) {
          return reply.code(404).send({ error: 'Execution not found' });
        }

        if (execution.workflow?.created_by !== userId && !user?.isAdmin) {
          return reply.code(403).send({ error: 'Not authorized to stop this execution' });
        }

        // Try to abort in-memory engine
        const aborted = abortWorkflowExecution(executionId, 'Stopped by user');

        // Update DB status regardless (engine may have already completed)
        await prisma.workflowExecution.update({
          where: { id: executionId },
          data: {
            status: 'cancelled',
            completed_at: new Date(),
            error: 'Stopped by user',
          }
        });

        logger.info({ executionId, userId, engineAborted: aborted }, '[Workflows] Execution stopped');

        return reply.send({
          success: true,
          executionId,
          engineAborted: aborted,
          message: aborted ? 'Execution aborted' : 'Execution marked as cancelled (may have already completed)',
        });
      } catch (error) {
        logger.error({ error }, '[Workflows] Failed to stop execution');
        return reply.code(500).send({ error: 'Failed to stop execution', message: error.message });
      }
    }
  );

  /**
   * POST /api/workflows/:id/retry-node
   * Retry a specific failed node from a completed execution.
   *
   * Body: { executionId, nodeId }
   * Looks up the original WorkflowExecution, collects upstream node outputs
   * (all nodes except the failed one), creates a new WorkflowExecution with
   * { resume_from_node: nodeId, upstream_outputs: {...} } in state, then
   * fires executeWorkflow with that resume state.
   * Returns: { newExecutionId }
   */
  fastify.post<{ Params: WorkflowIdParams; Body: { executionId?: string; nodeId?: string } }>(
    '/:id/retry-node',
    async (request, reply) => {
      try {
        const { id: workflowId } = request.params;
        const { executionId, nodeId } = request.body || {};
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;

        if (!executionId || !nodeId) {
          return reply.code(400).send({ error: 'executionId and nodeId are required in request body' });
        }

        // Look up the original execution
        const originalExecution = await prisma.workflowExecution.findFirst({
          where: { id: executionId },
          include: { workflow: { select: { created_by: true, definition: true, tenant_id: true } } },
        });

        if (!originalExecution) {
          return reply.code(404).send({ error: 'Execution not found', executionId });
        }

        if (originalExecution.workflow?.created_by !== userId && !user?.isAdmin) {
          return reply.code(403).send({ error: 'Not authorized to retry this execution' });
        }

        // Task 1.3 (V3 Enterprise Chatmode S5): tenant from request, falling
        // back to the execution's persisted tenant_id (or workflow row).
        const tenantId = request.tenantId
          || (originalExecution as { tenant_id?: string | null }).tenant_id
          || originalExecution.workflow?.tenant_id
          || null;

        // Gather upstream node outputs: all nodes that completed successfully
        // (i.e., not the failed node and not nodes that came after it)
        const nodeOutputs = (originalExecution.node_outputs as unknown as Record<string, unknown>) || {};
        const upstreamOutputs: Record<string, unknown> = {};
        for (const [nId, nodeData] of Object.entries(nodeOutputs)) {
          if (nId !== nodeId && (nodeData as { status?: string })?.status === 'completed') {
            upstreamOutputs[nId] = (nodeData as { output?: unknown })?.output;
          }
        }

        // Create a new execution record with resume state
        const newExecution = await prisma.workflowExecution.create({
          data: {
            workflow_id: workflowId,
            started_by: userId,
            status: 'pending',
            trigger_type: 'retry',
            input: asJson(originalExecution.input ?? {}),
            state: asJson({
              resume_from_node: nodeId,
              upstream_outputs: upstreamOutputs,
              original_execution_id: executionId,
            }),
          },
        });

        // Fire the workflow execution asynchronously
        const definition = (originalExecution.workflow?.definition as unknown as FlowDefinition) || { nodes: [], edges: [] };
        const authToken = request.headers.authorization
          || (user?.accessToken ? `Bearer ${user.accessToken}` : undefined);

        // Kick off the execution (non-blocking — update DB status on completion)
        executeWorkflow(
          workflowId,
          newExecution.id,
          definition as unknown as WorkflowDefinition,
          {},
          userId,
          authToken,
          (_event: ExecutionEvent) => { /* fire-and-forget; client can subscribe to stream */ },
          // Task 1.3 (V3 Enterprise Chatmode S5).
          { tenantId }
        ).then(async () => {
          await prisma.workflowExecution.update({
            where: { id: newExecution.id },
            data: { status: 'completed', completed_at: new Date() },
          }).catch(() => { /* ignore — execution may have already updated status */ });
        }).catch(async (err: Error) => {
          await prisma.workflowExecution.update({
            where: { id: newExecution.id },
            data: { status: 'failed', error: err.message, completed_at: new Date() },
          }).catch(() => {});
        });

        logger.info({ workflowId, nodeId, executionId, newExecutionId: newExecution.id, userId }, '[Workflows] Retry-node execution started');

        return reply.send({ newExecutionId: newExecution.id });
      } catch (error) {
        logger.error({ error }, '[Workflows] Failed to retry node');
        return reply.code(500).send({ error: 'Failed to retry node', message: error.message });
      }
    }
  );

  /**
   * POST /api/workflows/executions/:executionId/pause
   * Pause a running workflow execution (marks as paused in DB).
   */
  fastify.post<{ Params: { executionId: string } }>(
    '/executions/:executionId/pause',
    async (request, reply) => {
      try {
        const { executionId } = request.params;
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;

        const execution = await prisma.workflowExecution.findFirst({
          where: { id: executionId },
          include: { workflow: { select: { created_by: true } } },
        });

        if (!execution) {
          return reply.code(404).send({ error: 'Execution not found' });
        }
        if (execution.workflow?.created_by !== userId && !user?.isAdmin) {
          return reply.code(403).send({ error: 'Not authorized to pause this execution' });
        }

        await prisma.workflowExecution.update({
          where: { id: executionId },
          data: { status: 'paused', paused_at: new Date() },
        });

        logger.info({ executionId, userId }, '[Workflows] Execution paused');
        return reply.send({ success: true, executionId, status: 'paused' });
      } catch (error) {
        logger.error({ error }, '[Workflows] Failed to pause execution');
        return reply.code(500).send({ error: 'Failed to pause execution', message: error.message });
      }
    }
  );

  /**
   * POST /api/workflows/executions/:executionId/resume
   * Resume a paused workflow execution.
   */
  fastify.post<{ Params: { executionId: string } }>(
    '/executions/:executionId/resume',
    async (request, reply) => {
      try {
        const { executionId } = request.params;
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;

        const execution = await prisma.workflowExecution.findFirst({
          where: { id: executionId },
          include: { workflow: { select: { created_by: true } } },
        });

        if (!execution) {
          return reply.code(404).send({ error: 'Execution not found' });
        }
        if (execution.workflow?.created_by !== userId && !user?.isAdmin) {
          return reply.code(403).send({ error: 'Not authorized to resume this execution' });
        }

        await prisma.workflowExecution.update({
          where: { id: executionId },
          data: { status: 'running', paused_at: null },
        });

        logger.info({ executionId, userId }, '[Workflows] Execution resumed');
        return reply.send({ success: true, executionId, status: 'running' });
      } catch (error) {
        logger.error({ error }, '[Workflows] Failed to resume execution');
        return reply.code(500).send({ error: 'Failed to resume execution', message: error.message });
      }
    }
  );

  /**
   * POST /api/workflows/executions/:executionId/cancel
   * Cancel a running or paused execution. Calls abortWorkflowExecution in-memory
   * and marks the DB row as cancelled.
   */
  fastify.post<{ Params: { executionId: string } }>(
    '/executions/:executionId/cancel',
    async (request, reply) => {
      try {
        const { executionId } = request.params;
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;

        const execution = await prisma.workflowExecution.findFirst({
          where: { id: executionId },
          include: { workflow: { select: { created_by: true } } },
        });

        if (!execution) {
          return reply.code(404).send({ error: 'Execution not found' });
        }
        if (execution.workflow?.created_by !== userId && !user?.isAdmin) {
          return reply.code(403).send({ error: 'Not authorized to cancel this execution' });
        }

        const aborted = abortWorkflowExecution(executionId, 'Cancelled by user');
        await prisma.workflowExecution.update({
          where: { id: executionId },
          data: { status: 'cancelled', completed_at: new Date(), error: 'Cancelled by user' },
        });

        logger.info({ executionId, userId, engineAborted: aborted }, '[Workflows] Execution cancelled');
        return reply.send({ success: true, executionId, engineAborted: aborted, status: 'cancelled' });
      } catch (error) {
        logger.error({ error }, '[Workflows] Failed to cancel execution');
        return reply.code(500).send({ error: 'Failed to cancel execution', message: error.message });
      }
    }
  );

  /**
   * POST /api/workflows/executions/:executionId/artifacts
   * Store a workflow execution output as a knowledge artifact in Milvus.
   * Enterprise-only management route. Runtime artifact persistence via the
   * execution engine (persistArtifact) is NOT gated here.
   */
  fastify.post<{
    Params: { executionId: string };
    Body: { content: string; title: string; format?: string; nodeId?: string; workflowId?: string };
  }>(
    '/executions/:executionId/artifacts',    async (request, reply) => {
      try {
        const { executionId } = request.params;
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;

        if (!userId) {
          return reply.code(401).send({ error: 'Authentication required' });
        }

        const { content, title, format, nodeId, workflowId } = request.body || {};

        if (!content || !title) {
          return reply.code(400).send({ error: 'content and title are required' });
        }

        // Use the AppContext MilvusVectorService instance to store the artifact
        const { ArtifactType } = await import('../../services/MilvusVectorService.js');
        const milvus = fastify.app?.milvusVectorService;

        if (!milvus) {
          return reply.code(503).send({ error: 'Knowledge base service is not available' });
        }

        const artifactId = await milvus.storeArtifact(userId, {
          type: ArtifactType.KNOWLEDGE,
          title,
          content,
          metadata: {
            source: 'workflow',
            description: `workflow:${workflowId} execution:${executionId} node:${nodeId} format:${format}`,
          },
        });

        // Update the execution record in PostgreSQL to include the artifactId in the state JSON
        try {
          const execution = await prisma.workflowExecution.findUnique({
            where: { id: executionId },
            select: { state: true },
          });

          const existingState = (execution?.state as unknown as Record<string, unknown>) || {};

          await prisma.workflowExecution.update({
            where: { id: executionId },
            data: {
              state: asJson({
                ...existingState,
                artifactId,
              }),
            },
          });
        } catch (dbError) {
          logger.warn({ error: dbError.message, executionId, artifactId }, '[Workflows] Failed to update execution state with artifactId');
        }

        logger.info({ userId, executionId, artifactId, title }, '[Workflows] Artifact stored from workflow execution');

        return reply.send({ artifactId, executionId });
      } catch (error) {
        logger.error({ error }, '[Workflows] Failed to store artifact');
        return reply.code(500).send({ error: 'Failed to store artifact', message: error.message });
      }
    }
  );

  /**
   * POST /api/workflows/executions/:executionId/data-requests/:requestId
   *
   * HITL human_input / request_data SUBMIT. The flows "human_input" node pauses
   * a run, persists a WorkflowDataRequest row, and emits a `needs_input` NDJSON
   * frame. This is where the user submits their typed `{ values }` to resolve
   * the request and resume the workflow.
   *
   * URL shape is the UI client contract (workflowApi.submitDataRequest →
   * `workflowEndpoint('/workflows/executions/:executionId/data-requests/:requestId')`).
   * We auth-gate, load the row for tenant + authorization, thread the caller as
   * `providedBy`, and proxy to the workflows-svc which validates the values
   * against the stored fields[] and re-enters the engine from the request node.
   */
  fastify.post<{ Params: { executionId: string; requestId: string }; Body: { values: Record<string, unknown> } }>(
    '/executions/:executionId/data-requests/:requestId',
    async (request, reply) => {
      try {
        const { executionId, requestId } = request.params;
        const { values } = request.body || ({} as { values: Record<string, unknown> });
        const user = request.user;
        const userId = user?.userId || user?.id;

        if (!values || typeof values !== 'object' || Array.isArray(values)) {
          return reply.code(400).send({ error: 'A `values` object keyed by field name is required' });
        }

        // Load the request row for tenant scoping + authorization. Full field
        // validation happens server-side in workflows-svc against the persisted
        // fields[]; here we only gate access + derive the tenant.
        const dataRequest = await prisma.workflowDataRequest.findUnique({
          where: { id: requestId },
          include: {
            execution: { include: { workflow: { select: { id: true, name: true, created_by: true } } } },
          },
        }) as unknown as {
          execution_id: string;
          status: string;
          assign_to?: unknown;
          tenant_id?: string | null;
          execution?: {
            started_by?: string | null;
            tenant_id?: string | null;
            workflow?: { created_by?: string | null };
          };
        } | null;

        if (!dataRequest) {
          return reply.code(404).send({ error: `Data request '${requestId}' not found` });
        }
        if (dataRequest.execution_id !== executionId) {
          return reply.code(400).send({ error: `Data request '${requestId}' does not belong to execution '${executionId}'` });
        }
        if (dataRequest.status !== 'pending') {
          return reply.code(400).send({ error: `Data request is already '${dataRequest.status}'` });
        }

        // Authorization: assign_to (user ids / group names) scopes who may
        // answer. Empty assign_to ⇒ the execution owner (or an admin) only.
        const assignTo: string[] = Array.isArray(dataRequest.assign_to) ? dataRequest.assign_to : [];
        const isAssignee = assignTo.length > 0 && assignTo.includes(userId);
        const isOwner =
          dataRequest.execution?.started_by === userId ||
          dataRequest.execution?.workflow?.created_by === userId;
        if (!isAssignee && !isOwner && !user?.isAdmin) {
          return reply.code(403).send({ error: 'You are not authorized to answer this data request' });
        }

        // Tenant derived from the persisted row / execution — the proxy
        // fail-CLOSES on null (no JWT-trust boundary downstream).
        const tenantId =
          dataRequest.tenant_id ||
          dataRequest.execution?.tenant_id ||
          request.tenantId;

        const result = await submitDataRequestViaWorkflowsService({
          executionId,
          requestId,
          values,
          providedBy: userId,
          providedAt: new Date().toISOString(),
          tenantId,
        });

        if (!result.success) {
          // Validation/state rejections surface as 400 (UI re-prompts); engine
          // failures surface as 500.
          const msg = result.error || 'Data request submission failed';
          const isValidation = /required|option|must be|already|does not belong|no fields|not an object/i.test(msg);
          return reply.code(isValidation ? 400 : 500).send({ error: msg });
        }

        logger.info({ requestId, executionId, userId }, '[Workflows] Data request submitted + workflow resumed');
        return reply.send({
          success: true,
          requestId,
          executionId,
          status: 'provided',
          output: result.output,
        });
      } catch (error) {
        logger.error({ error: error.message }, '[Workflows] Failed to submit data request');
        return reply.code(500).send({ error: 'Failed to submit data request', message: error.message });
      }
    }
  );
};

export default executionRoutes;
