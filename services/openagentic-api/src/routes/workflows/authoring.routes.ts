/**
 * Workflow authoring routes — design-time test / compile / validate.
 *
 *   POST /test
 *   POST /test-node
 *   POST /compile
 *   POST /validate
 *   POST /:id/validate
 *
 * Sub-plugin of workflowRoutes; auth applied by the parent preHandler hook.
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import axios from 'axios';
import { randomUUID } from 'crypto';
import type { ExecutionEvent, WorkflowDefinition } from '@openagentic/workflow-engine';
import { loggers } from '../../utils/logger.js';
import { prisma } from '../../utils/prisma.js';
import { executeViaWorkflowsService as executeWorkflow } from '../../services/executeViaWorkflowsService.js';
import { reportLocalEngineFallback } from '../../services/workflowServiceUrlGuard.js';
import { subscribeAgentProgressForFlowsStream } from '../../services/workflowAgentProgressBridge.js';
import { ndjsonHeaders, writeNDJSON, createSSEToNDJSONTranslator } from '../../infra/ndjson.js';
import {
  WORKFLOW_SERVICE_URL,
  flushReply,
  getReqUser,
  workflowCompiler,
  workflowServiceHeaders,
} from './shared.js';
import type { FlowDefinition, WorkflowIdParams } from './types.js';

export const authoringRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const logger = loggers.routes;

  /**
   * POST /api/workflows/test
   * Test a workflow definition without saving (streams SSE events)
   */
  fastify.post<{ Body: { nodes: unknown[]; edges: unknown[]; input?: Record<string, unknown> } }>(
    '/test',
    async (request, reply): Promise<void> => {
      try {
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;
        const { nodes, edges, input = {} } = request.body;
        // Task 1.3 (V3 Enterprise Chatmode S5): derive tenantId from the
        // tenantContextPlugin-populated request.tenantId (azure_tenant_id JWT
        // claim or user.tenantId fallback). The downstream wrapper
        // executeViaWorkflowsService fails-CLOSED if this is null/empty.
        //
        // BUG-FIX 2026-05-14: the global preHandler in server.ts that mirrors
        // user.tenantId onto request.tenantId is registered BEFORE
        // workflows.ts:315's plugin-scoped authMiddleware. Fastify runs
        // preHandler hooks in registration order, so at the time the mirror
        // runs, `request.user` is still null and `request.tenantId` stays
        // unset — shipping tenantId:undefined to workflows-svc which then
        // 400s on `missing_tenant_id`. Fix in two places (test + test-node)
        // by reading `user.tenantId` as a defense-in-depth fallback. The
        // properly ordered fix is to move the tenant mirror to a
        // route-level preHandler that runs AFTER auth, but the unblocking
        // shipped here keeps live Flows working today.
        const tenantId =
          request.tenantId
          ?? user?.tenantId
          ?? null;

        if (!nodes || !Array.isArray(nodes) || nodes.length === 0) {
          reply.code(400).send({
            error: 'Validation error',
            message: 'nodes array is required and must not be empty'
          });
          return;
        }

        const testExecutionId = `test-${randomUUID()}`;

        logger.info({
          executionId: testExecutionId,
          nodeCount: nodes.length,
          edgeCount: edges?.length || 0
        }, '[Workflows] Test execution started');

        // NDJSON streaming (v0.6.7 — SSE removed from flows, Phase C).
        reply.raw.writeHead(200, ndjsonHeaders());
        reply.raw.socket?.setNoDelay(true);
        writeNDJSON(reply, 'connected', { executionId: testExecutionId });

        // Keepalive ping every 15s to prevent proxy/load balancer timeout.
        const keepaliveInterval = setInterval(() => {
          if (!reply.raw.writableEnded) {
            writeNDJSON(reply, 'keepalive', { ts: new Date().toISOString() });
          } else {
            clearInterval(keepaliveInterval);
          }
        }, 15000);

        const sendEvent = (event: ExecutionEvent) => {
          if (!reply.raw.writableEnded) {
            writeNDJSON(reply, event.type, event as unknown as Record<string, unknown>);
            // Flush immediately so UI receives node_start before node_complete.
            flushReply(reply);
          }
        };

        // Phase C.4: subscribe to AgentEventStore so sub-agent progress
        // (published by openagentic-proxy's Phase C HTTP callback) surfaces as
        // flat `agent_progress` NDJSON frames — parity with chat's
        // stream.handler. Unsubscribe on stream close to avoid leaks.
        const unsubscribeAgentProgress = subscribeAgentProgressForFlowsStream(
          testExecutionId,
          (frame) => {
            if (!reply.raw.writableEnded) {
              writeNDJSON(reply, 'agent_progress', frame as unknown as Record<string, unknown>);
            }
          },
        );
        reply.raw.on('close', unsubscribeAgentProgress);

        try {
          if (WORKFLOW_SERVICE_URL) {
            // Proxy to workflow service. Downstream still emits SSE until
            // its own NDJSON migration lands — bridge at our boundary so
            // UI only ever sees NDJSON.
            const proxyResponse = await axios.post(
              `${WORKFLOW_SERVICE_URL}/execute`,
              {
                workflowId: 'test',
                executionId: testExecutionId,
                definition: { nodes, edges: edges || [] },
                input,
                userId,
                authToken: request.headers.authorization,
                // Task 1.3 (V3 Enterprise Chatmode S5).
                tenantId,
              },
              { responseType: 'stream', timeout: 300000, headers: workflowServiceHeaders({ Accept: 'text/event-stream' }) }
            );
            const bridge = createSSEToNDJSONTranslator();
            await new Promise<void>((resolve, reject) => {
              proxyResponse.data.on('data', (chunk: Buffer) => {
                if (!reply.raw.writableEnded) {
                  const ndjson = bridge.translate(chunk);
                  if (ndjson) {
                    reply.raw.write(ndjson);
                    flushReply(reply);
                  }
                }
              });
              proxyResponse.data.on('end', () => {
                const tail = bridge.flush();
                if (tail && !reply.raw.writableEnded) reply.raw.write(tail);
                resolve();
              });
              proxyResponse.data.on('error', (err: Error) => reject(err));
            });
          } else {
            reportLocalEngineFallback({ workflowId: 'test', executionId: testExecutionId, logger });
            const testAuthToken = request.headers.authorization
              || (user?.accessToken ? `Bearer ${user.accessToken}` : undefined);
            await executeWorkflow(
              'test',
              testExecutionId,
              { nodes, edges: edges || [] } as unknown as WorkflowDefinition,
              input,
              userId,
              testAuthToken,
              sendEvent,
              { tenantId } // Task 1.3 (V3 Enterprise Chatmode S5).
            );
          }
        } catch (execError) {
          logger.error({ error: execError }, '[Workflows] Test execution failed');
          if (!reply.raw.writableEnded) {
            sendEvent({
              type: 'execution_error',
              executionId: testExecutionId,
              data: { error: execError.message },
              timestamp: new Date().toISOString(),
            });
          }
        } finally {
          clearInterval(keepaliveInterval);
          if (!reply.raw.writableEnded) {
            reply.raw.end();
          }
        }

        return;
      } catch (error) {
        logger.error({ error }, '[Workflows] Failed to start test execution');
        if (!reply.sent) {
          reply.code(500).send({
            error: 'Failed to test workflow',
            message: error.message
          });
        }
      }
    }
  );

  /**
   * POST /api/workflows/test-node
   * Test a single node in isolation — executes one node with provided input,
   * without creating a full workflow execution record.
   */
  fastify.post<{ Body: { node: { type: string; data: Record<string, unknown> }; input?: Record<string, unknown> } }>(
    '/test-node',
    async (request, reply) => {
      try {
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;
        // Task 1.3 (V3 Enterprise Chatmode S5).
        // 2026-05-14 bug-fix: same preHandler-ordering issue as /test —
        // global mirror runs before plugin-scoped authMiddleware so
        // request.tenantId is stale; fall back to user.tenantId.
        const tenantId =
          request.tenantId
          ?? user?.tenantId
          ?? null;
        const { node, input = {} } = request.body;

        if (!node || !node.type) {
          return reply.code(400).send({ error: 'Node definition with type is required' });
        }

        const testNodeId = `test-node-${Date.now()}`;
        const testExecId = `test-exec-${randomUUID()}`;

        // Build a minimal single-node workflow: trigger → test node
        const definition = {
          nodes: [
            { id: 'trigger-0', type: 'trigger', position: { x: 0, y: 0 }, data: { label: 'Trigger', triggerType: 'manual' } },
            { id: testNodeId, type: node.type, position: { x: 0, y: 100 }, data: { ...node.data, label: node.data?.label || 'Test Node' } },
          ],
          edges: [
            { id: 'edge-0', source: 'trigger-0', target: testNodeId },
          ],
        };

        const startTime = Date.now();

        const authToken = request.headers.authorization
          || (user?.accessToken ? `Bearer ${user.accessToken}` : undefined);

        // Route through workflow service for full node type support
        if (WORKFLOW_SERVICE_URL) {
          try {
            const svcResponse = await axios.post(
              `${WORKFLOW_SERVICE_URL}/execute-sync`,
              {
                workflowId: 'test-node',
                executionId: testExecId,
                definition,
                input,
                userId,
                authToken,
                // Task 1.3 (V3 Enterprise Chatmode S5).
                tenantId,
              },
              { timeout: 60000, validateStatus: () => true, headers: workflowServiceHeaders() }
            );

            const duration = Date.now() - startTime;
            const svcData = svcResponse.data;
            const hasError = svcResponse.status >= 400 || svcData?.success === false;
            const errorMsg = hasError ? (svcData?.error || svcData?.errors?.[0]?.message || 'execution failed') : 'none';
            return { output: svcData?.output ?? {}, duration, error: errorMsg };
          } catch (svcErr) {
            logger.warn({ svcErr: svcErr.message }, '[Workflows] Workflow service unavailable for test-node, falling back to local');
          }
        }

        // Fallback: run locally if workflow service unavailable
        reportLocalEngineFallback({ workflowId: 'test-node', executionId: testExecId, logger });
        let nodeOutput: unknown = null;
        let nodeError: string | undefined;
        const result = await executeWorkflow(
          'test-node',
          testExecId,
          definition as unknown as WorkflowDefinition,
          input,
          userId,
          authToken,
          (event: ExecutionEvent) => {
            if (event.nodeId === testNodeId) {
              if (event.type === 'node_complete') {
                nodeOutput = (event as { output?: unknown }).output;
              } else if (event.type === 'node_error') {
                nodeError = (event as { error?: string }).error;
              }
            }
          },
          { tenantId } // Task 1.3 (V3 Enterprise Chatmode S5).
        );

        const duration = Date.now() - startTime;
        const finalOutput = nodeOutput ?? result?.output ?? {};
        return { output: finalOutput, duration, error: nodeError || result?.error || 'none' };
      } catch (error) {
        logger.error({ error }, '[Workflows] Test node failed');
        return reply.code(500).send({
          error: 'Failed to test node',
          message: error.message,
        });
      }
    }
  );

  /**
   * POST /api/workflows/compile
   * Validate a workflow definition without executing it.
   * Proxies to the workflow service compiler for cycle detection, syntax checks, etc.
   */
  fastify.post<{ Body: { definition: { nodes: unknown[]; edges: unknown[] } } }>(
    '/compile',
    async (request, reply) => {
      const { definition } = request.body;
      if (!definition?.nodes) {
        return reply.code(400).send({ valid: false, errors: [{ code: 'NO_NODES', message: 'No nodes in definition' }] });
      }

      // Route to workflow service if available
      if (WORKFLOW_SERVICE_URL) {
        try {
          const svcRes = await axios.post(`${WORKFLOW_SERVICE_URL}/compile`, { definition }, { timeout: 10000, headers: workflowServiceHeaders() });
          return svcRes.data;
        } catch (err) {
          // If workflow service returns 400 with validation errors, forward them
          if (err.response?.status === 400 && err.response?.data) {
            return err.response.data;
          }
          logger.warn({ err: err.message }, '[Workflows] Workflow service compile unavailable, using local');
        }
      }

      // Fallback: local compilation (limited compared to workflow service)
      try {
        const { WorkflowCompiler } = await import('../../services/WorkflowCompiler.js');
        const compiler = new WorkflowCompiler();
        const result = compiler.compile({ nodes: definition.nodes, edges: definition.edges || [] } as unknown as WorkflowDefinition);
        return { valid: result.valid, errors: result.errors || [], warnings: result.warnings || [] };
      } catch {
        return { valid: true, errors: [], warnings: [] };
      }
    }
  );

  /**
   * POST /api/workflows/validate (#1270)
   * Design-time validation of an UNSAVED nodes/edges definition via the SoT
   * contract-aware validateFlow against the LIVE node registry. Resolves
   * configuredSecrets by scope + triggerInputs from the run dialog so the UI
   * can surface per-node issues + required run inputs + required secrets before
   * the flow is ever saved. Node-type-agnostic (no synth/oat/agenticode code).
   */
  fastify.post<{
    Body: {
      nodes?: unknown[];
      edges?: unknown[];
      input?: Record<string, unknown>;
      secrets?: string[];
    };
  }>(
    '/validate',
    async (request, reply) => {
      try {
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;
        const { nodes, edges, input, secrets } = request.body || {};

        if (!Array.isArray(nodes)) {
          return reply.code(400).send({
            valid: false,
            error: 'nodes array is required',
          });
        }

        // Wire the validator ctx to the LIVE node registry (same SoT the engine
        // executes against). Lazy import keeps the heavy registry off the
        // module-parse path. validateFlow lives on the './graph' subpath.
        const { validateFlow } = await import('@openagentic/workflow-engine/graph');
        const { registry } = await import('@openagentic/workflow-engine/nodes/registry');
        const nodeSchemaOf = (type: string) => registry.get(type)?.schema;
        const nodePrimaryOf = (type: string) => registry.get(type)?.schema.primary;

        // configuredSecrets: explicit override > resolved-by-scope. The
        // {{secret:X}} branch is NEVER a hard error; this only flips the
        // `configured` flag so the UI can prompt for the missing ones.
        let configuredSecrets: string[] | undefined;
        if (Array.isArray(secrets)) {
          configuredSecrets = secrets.filter((s) => typeof s === 'string');
        } else if (userId) {
          try {
            const userGroups = await prisma.userGroupMembership
              .findMany({ where: { user_id: userId }, select: { group_id: true } })
              .catch(() => [] as { group_id: string }[]);
            const userGroupIds = userGroups.map((g) => g.group_id);
            const userWorkflows = await prisma.workflow.findMany({
              where: { created_by: userId, deleted_at: null },
              select: { id: true },
            });
            const userWorkflowIds = userWorkflows.map((w) => w.id);
            const rows = await prisma.workflowSecret.findMany({
              where: {
                OR: [
                  { scope: 'global' },
                  ...(userGroupIds.length > 0
                    ? [{ scope: 'group', group_id: { in: userGroupIds } }]
                    : []),
                  ...(userWorkflowIds.length > 0
                    ? [{ scope: 'workflow', workflow_id: { in: userWorkflowIds } }]
                    : []),
                ],
              },
              select: { name: true },
            });
            configuredSecrets = rows.map((r) => r.name);
          } catch (secErr) {
            logger.warn(
              { err: secErr?.message },
              '[Workflows] /validate could not resolve configured secrets; treating all as unconfigured',
            );
          }
        }

        // triggerInputs: the keys the run dialog supplied (so a {{input.Y}} ref
        // the user already answered is `declared:true`).
        const triggerInputs =
          input && typeof input === 'object' ? Object.keys(input) : undefined;

        const result = validateFlow(
          { nodes, edges: Array.isArray(edges) ? edges : [] } as Parameters<typeof validateFlow>[0],
          { nodeSchemaOf, nodePrimaryOf, configuredSecrets, triggerInputs } as unknown as Parameters<typeof validateFlow>[1],
        );

        return reply.send(result);
      } catch (error) {
        logger.error(
          { error: error?.message, stack: error?.stack },
          '[Workflows] /validate handler threw unexpectedly',
        );
        return reply.code(500).send({
          valid: false,
          error: 'Validation failed',
          message: error?.message,
        });
      }
    },
  );

  /**
   * POST /api/workflows/:id/validate
   * Runtime readiness validation — checks that all node dependencies
   * (secrets, models, MCP tools, URLs, etc.) are properly configured
   * before execution. Returns actionable issues per node.
   */
  fastify.post<{ Params: WorkflowIdParams }>(
    '/:id/validate',
    async (request, reply) => {
      try {
        const { id } = request.params;
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;

        const workflow = await prisma.workflow.findFirst({
          where: {
            id,
            deleted_at: null,
            OR: [{ created_by: userId }, { is_public: true }]
          },
          include: {
            versions: {
              where: { is_active: true },
              take: 1
            }
          }
        });

        if (!workflow) {
          return reply.code(404).send({ error: 'Not found' });
        }

        const version = workflow.versions[0];
        const definition: FlowDefinition = version
          ? (version.definition as unknown as FlowDefinition)
          : (workflow.definition as unknown as FlowDefinition);

        if (!definition || !definition.nodes?.length) {
          return reply.send({
            ready: false,
            compilation: { valid: false, errors: [{ code: 'EMPTY_WORKFLOW', message: 'Workflow has no nodes' }] },
            runtime: { ready: false, issues: [] }
          });
        }

        // 1. Structural validation (cycles, types, edges)
        const compilation = workflowCompiler.compile({
          nodes: definition.nodes || [],
          edges: definition.edges || [],
        } as unknown as WorkflowDefinition);

        // 2. Runtime readiness (secrets, tools, models, credentials)
        let mcpToolList: string[] | undefined;
        let mcpToolSchemas: Record<string, { inputSchema?: { required?: string[] } }> | undefined;
        try {
          const MCP_PROXY_URL = process.env.MCP_PROXY_URL || 'http://openagentic-mcp-proxy:8080';
          const toolsRes = await axios.get(`${MCP_PROXY_URL}/tools`, { timeout: 5000 });
          const tools = (toolsRes.data?.tools || []) as Array<{ name: string; inputSchema?: { required?: string[] } }>;
          mcpToolList = tools.map((t) => t.name);
          mcpToolSchemas = {};
          for (const t of tools) {
            if (t.inputSchema) {
              mcpToolSchemas[t.name] = { inputSchema: t.inputSchema };
            }
          }
        } catch {
          // MCP tools check unavailable
        }

        // Get available models for validation
        let availableModels: string[] | undefined;
        try {
          const providers = await prisma.lLMProvider.findMany({
            where: { enabled: true },
            select: { provider_config: true, display_name: true }
          });
          availableModels = providers.flatMap((p) => {
            const config = p.provider_config as { models?: unknown[]; modelId?: string; deployment?: string } | null;
            if (!config) return [];
            // Models can be in config.models array, config.modelId, or config.deployment
            if (Array.isArray(config.models)) return config.models.map((m) => typeof m === 'string' ? m : (m as { id?: string; name?: string }).id || (m as { id?: string; name?: string }).name).filter(Boolean) as string[];
            if (config.modelId) return [config.modelId];
            if (config.deployment) return [config.deployment];
            return [];
          });
        } catch {
          // Model list unavailable
        }

        const runtime = await workflowCompiler.validateRuntime(
          { nodes: definition.nodes || [], edges: definition.edges || [] } as unknown as WorkflowDefinition,
          { mcpToolList, mcpToolSchemas, availableModels, workflowId: id }
        );

        return reply.send({
          ready: compilation.valid && runtime.ready,
          compilation: {
            valid: compilation.valid,
            errors: compilation.errors,
            warnings: compilation.warnings,
            metadata: compilation.metadata,
          },
          runtime,
        });
      } catch (error) {
        logger.error({ error }, '[Workflows] Validation failed');
        return reply.code(500).send({
          error: 'Validation failed',
          message: error.message
        });
      }
    }
  );
};

export default authoringRoutes;
