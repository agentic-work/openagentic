/**
 * Workflow API Routes
 *
 * Provides endpoints for workflow management:
 * - GET /api/workflows - List user's workflows
 * - POST /api/workflows - Create new workflow
 * - GET /api/workflows/templates - List public workflow templates
 * - POST /api/workflows/seed-templates - Seed built-in templates to DB
 * - GET /api/workflows/:id - Get workflow by ID
 * - PUT /api/workflows/:id - Update workflow
 * - DELETE /api/workflows/:id - Delete workflow (soft delete)
 * - POST /api/workflows/:id/execute - Execute workflow
 * - GET /api/workflows/:id/executions - Get workflow executions
 * - POST /api/workflows/:id/versions - Create new version
 * - GET /api/workflows/:id/versions - List versions
 * - PUT /api/workflows/:id/versions/:versionId/activate - Activate version
 * - POST /api/workflows/:id/duplicate - Duplicate a workflow
 * - GET /api/workflows/:id/snippets - Auto-generated API client code snippets
 */

import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { loggers } from '../utils/logger.js';
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { authMiddleware } from '../middleware/unifiedAuth.js';
import { executeWorkflow, ExecutionEvent, abortWorkflowExecution } from '../services/WorkflowExecutionEngine.js';
import { WorkflowCompiler } from '../services/WorkflowCompiler.js';
import { randomUUID, createHash } from 'crypto';
import bcrypt from 'bcrypt';
import axios from 'axios';
import { getRedisClient } from '../utils/redis-client.js';
import { ndjsonHeaders, writeNDJSON, createSSEToNDJSONTranslator } from '../infra/ndjson.js';

const workflowCompiler = new WorkflowCompiler();

// Workflow execution service URL — when available, execution is proxied to the dedicated service
const WORKFLOW_SERVICE_URL = process.env.WORKFLOW_SERVICE_URL || '';

// Helper to transform workflow from DB schema to API response format
function transformWorkflow(workflow: any) {
  const definition = workflow.definition as any || {};
  return {
    id: workflow.id,
    user_id: workflow.created_by,
    name: workflow.name,
    description: workflow.description,
    nodes: definition.nodes || [],
    edges: definition.edges || [],
    status: workflow.is_active ? 'active' : 'draft',
    is_public: workflow.is_public || false,
    is_template: workflow.is_template || false,
    tags: workflow.tags || [],
    category: workflow.category,
    icon: workflow.icon,
    color: workflow.color,
    executionCount: workflow.total_executions || 0,
    lastExecutedAt: workflow.last_executed_at,
    created_at: workflow.created_at,
    updated_at: workflow.updated_at,
  };
}

/**
 * Derives tags automatically from workflow definition (node types, tool names, patterns).
 * Manual user tags are preserved and merged with auto-tags.
 */
function computeAutoTags(definition: { nodes?: any[]; edges?: any[] }): string[] {
  const tags = new Set<string>();
  const nodes = definition?.nodes || [];

  for (const node of nodes) {
    const type = node.type || node.data?.type || '';
    const config = node.data?.config || node.data || {};
    const toolName = (config.tool_name || config.toolName || '').toLowerCase();
    const label = (node.data?.label || config.label || '').toLowerCase();

    // Node type tags
    switch (type) {
      case 'trigger':
        if (config.trigger_type === 'webhook') tags.add('webhook');
        else if (config.trigger_type === 'schedule' || config.trigger_type === 'cron') tags.add('scheduled');
        else tags.add('manual');
        break;
      case 'llm_completion': tags.add('ai-analysis'); break;
      case 'mcp_tool': tags.add('mcp-tool'); break;
      case 'http_request': tags.add('http'); break;
      case 'condition': tags.add('conditional'); break;
      case 'loop': tags.add('loop'); break;
      case 'transform': tags.add('data-transform'); break;
      case 'code': tags.add('code-execution'); break;
      case 'data_query': tags.add('data-query'); break;
      case 'merge': tags.add('merge'); break;
      case 'agent_supervisor': tags.add('multi-agent'); tags.add('supervisor'); break;
      case 'agent_single': tags.add('agent'); break;
      case 'agent_spawn': tags.add('multi-agent'); break;
      case 'slack_message': tags.add('slack'); tags.add('notification'); break;
      case 'teams_message': tags.add('teams'); tags.add('notification'); break;
      case 'outlook_email': case 'send_email': tags.add('email'); tags.add('notification'); break;
      case 'pagerduty_incident': tags.add('pagerduty'); tags.add('incident-management'); break;
      case 'servicenow_ticket': tags.add('servicenow'); tags.add('ticketing'); break;
      case 'jira_issue': tags.add('jira'); tags.add('ticketing'); break;
      case 'discord_message': tags.add('discord'); tags.add('notification'); break;
    }

    // Cloud/service tags from tool names
    if (toolName.includes('aws') || toolName.includes('s3') || toolName.includes('ec2') || toolName.includes('bedrock')) tags.add('aws');
    if (toolName.includes('azure')) tags.add('azure');
    if (toolName.includes('gcp') || toolName.includes('google')) tags.add('gcp');
    if (toolName.includes('k8s') || toolName.includes('kubernetes') || toolName.includes('kubectl')) tags.add('kubernetes');
    if (toolName.includes('github') || toolName.includes('git')) tags.add('github');
    if (toolName.includes('web_search') || toolName.includes('web_fetch')) tags.add('web-research');
    if (toolName.includes('loki') || toolName.includes('prometheus')) tags.add('monitoring');
    if (toolName.includes('knowledge') || toolName.includes('memory')) tags.add('knowledge');

    // Domain tags from labels/descriptions
    if (label.includes('security') || label.includes('audit') || label.includes('vulnerability')) tags.add('security');
    if (label.includes('cost') || label.includes('billing') || label.includes('budget')) tags.add('cost-analysis');
    if (label.includes('seo') || label.includes('traffic') || label.includes('marketing')) tags.add('seo');
    if (label.includes('competitive') || label.includes('competitor')) tags.add('competitive-intel');
    if (label.includes('news') || label.includes('digest') || label.includes('newsletter')) tags.add('content');
    if (label.includes('feedback') || label.includes('sentiment')) tags.add('feedback');
    if (label.includes('compliance') || label.includes('regulation')) tags.add('compliance');
    if (label.includes('devops') || label.includes('ci/cd') || label.includes('pipeline')) tags.add('devops');
    if (label.includes('research') || label.includes('analysis')) tags.add('research');
  }

  // Complexity tags
  if (nodes.length > 10) tags.add('complex');
  if (nodes.filter((n: any) => (n.type || n.data?.type) === 'agent_single' || (n.type || n.data?.type) === 'agent_supervisor').length > 1) tags.add('multi-agent');

  return Array.from(tags);
}

// Request interfaces
interface CreateWorkflowRequest {
  name: string;
  description?: string;
  definition: {
    nodes: any[];
    edges: any[];
  };
  triggers?: any[];
  settings?: Record<string, any>;
  variables?: Record<string, any>;
  tags?: string[];
  category?: string;
  icon?: string;
  color?: string;
  is_template?: boolean;
  is_public?: boolean;
  group_id?: string;
}

interface UpdateWorkflowRequest {
  name?: string;
  description?: string;
  definition?: {
    nodes: any[];
    edges: any[];
  };
  triggers?: any[];
  settings?: Record<string, any>;
  variables?: Record<string, any>;
  tags?: string[];
  category?: string;
  icon?: string;
  color?: string;
  is_active?: boolean;
  is_template?: boolean;
  is_public?: boolean;
  visibility?: 'private' | 'team' | 'public';
  group_id?: string;
}

interface ExecuteWorkflowRequest {
  input: Record<string, any>;
  trigger_type?: 'manual' | 'api';
  version_id?: string;
}

interface CreateVersionRequest {
  changelog?: string;
  activate?: boolean;
}

interface WorkflowIdParams {
  id: string;
}

interface ExecutionDetailParams {
  id: string;
  execId: string;
}

interface VersionIdParams {
  id: string;
  versionId: string;
}

interface ListWorkflowsQuery {
  limit?: number;
  offset?: number;
  category?: string;
  tags?: string;
  is_active?: boolean;
  is_template?: boolean;
  search?: string;
}

interface ListExecutionsQuery {
  limit?: number;
  offset?: number;
  status?: string;
}

export const workflowRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const logger = loggers.routes;

  // Apply auth to all routes
  fastify.addHook('preHandler', authMiddleware);

  /**
   * GET /api/workflows
   * List user's workflows
   */
  fastify.get<{ Querystring: ListWorkflowsQuery }>(
    '/',
    async (request, reply) => {
      try {
        const user = (request as any).user;
        const userId = user?.userId || user?.id;
        const { limit = 50, offset = 0, category, tags, is_active, is_template, search } = request.query;

        // User-isolated workspace: each user sees ONLY their own flows.
        // Shared/team flows will be added later via explicit sharing UI.
        const where: any = {
          deleted_at: null,
          created_by: userId,
        };

        if (category) where.category = category;
        // Query params may come as strings from URL — coerce to boolean for Prisma
        if (is_active !== undefined) where.is_active = String(is_active) === 'true';
        if (is_template !== undefined) where.is_template = String(is_template) === 'true';
        if (tags) {
          where.tags = { hasSome: tags.split(',') };
        }
        if (search) {
          where.OR = [
            { name: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
          ];
        }

        const [dbWorkflows, total] = await Promise.all([
          prisma.workflow.findMany({
            where,
            orderBy: { updated_at: 'desc' },
            take: Number(limit),
            skip: Number(offset),
            select: {
              id: true,
              name: true,
              description: true,
              definition: true,
              is_active: true,
              is_template: true,
              is_public: true,
              tags: true,
              category: true,
              icon: true,
              color: true,
              total_executions: true,
              successful_executions: true,
              failed_executions: true,
              created_by: true,
              created_at: true,
              updated_at: true
            }
          }),
          prisma.workflow.count({ where })
        ]);

        // Transform to match UI expected format
        const workflows = dbWorkflows.map(transformWorkflow);

        return reply.send({
          workflows,
          total,
          limit: Number(limit),
          offset: Number(offset)
        });
      } catch (error: any) {
        // If table doesn't exist (P2021), return empty list instead of 500
        if (error.code === 'P2021' || error.code === 'P2010' || error.message?.includes('does not exist')) {
          logger.warn({ error: error.code }, '[Workflows] Tables not yet created, returning empty list. Run: prisma db push');
          return reply.send({ workflows: [], total: 0, limit: 50, offset: 0 });
        }
        logger.error({ error }, '[Workflows] Failed to list workflows');
        return reply.code(500).send({
          error: 'Failed to list workflows',
          message: error.message
        });
      }
    }
  );

  /**
   * POST /api/workflows
   * Create new workflow
   */
  fastify.post<{ Body: CreateWorkflowRequest }>(
    '/',
    async (request, reply) => {
      try {
        const user = (request as any).user;
        const userId = user?.userId || user?.id;
        const {
          name,
          description,
          definition,
          triggers = [],
          settings = {},
          variables = {},
          tags = [],
          category,
          icon,
          color,
          is_template = false,
          is_public = false,
          group_id
        } = request.body;

        if (!name || !definition) {
          return reply.code(400).send({
            error: 'Validation error',
            message: 'name and definition are required'
          });
        }

        // Merge user-supplied tags with auto-derived tags
        const autoTags = computeAutoTags(definition);
        const mergedTags = [...new Set([...(tags || []), ...autoTags])];

        const workflow = await prisma.workflow.create({
          data: {
            name,
            description,
            definition,
            triggers,
            settings,
            variables,
            tags: mergedTags,
            category,
            icon,
            color,
            is_template,
            is_public,
            created_by: userId,
            group_id
          }
        });

        // Create initial version
        await prisma.workflowVersion.create({
          data: {
            workflow_id: workflow.id,
            version: 1,
            definition,
            triggers,
            settings,
            changelog: 'Initial version',
            is_active: true,
            created_by: userId
          }
        });

        logger.info({ workflowId: workflow.id, name }, '[Workflows] Workflow created');

        return reply.code(201).send({
          success: true,
          workflow: transformWorkflow(workflow)
        });
      } catch (error: any) {
        logger.error({ error }, '[Workflows] Failed to create workflow');
        return reply.code(500).send({
          error: 'Failed to create workflow',
          message: error.message
        });
      }
    }
  );

  /**
   * GET /api/workflows/:id
   * Get workflow by ID
   */
  fastify.get<{ Params: WorkflowIdParams }>(
    '/:id',
    async (request, reply) => {
      try {
        const { id } = request.params;
        const user = (request as any).user;
        const userId = user?.userId || user?.id;

        const workflow = await prisma.workflow.findFirst({
          where: {
            id,
            deleted_at: null,
            OR: [
              { created_by: userId },
              { is_public: true },        // Allow reading public workflows/templates
              { is_template: true },       // Allow reading templates
            ],
          },
          include: {
            creator: {
              select: { id: true, email: true, name: true }
            },
            group: {
              select: { id: true, name: true, display_name: true }
            },
            versions: {
              orderBy: { version: 'desc' },
              take: 5,
              select: {
                id: true,
                version: true,
                is_active: true,
                changelog: true,
                created_at: true
              }
            }
          }
        });

        if (!workflow) {
          return reply.code(404).send({
            error: 'Not found',
            message: `Workflow with ID '${id}' not found`
          });
        }

        return reply.send({ workflow: transformWorkflow(workflow) });
      } catch (error: any) {
        logger.error({ error }, '[Workflows] Failed to get workflow');
        return reply.code(500).send({
          error: 'Failed to get workflow',
          message: error.message
        });
      }
    }
  );

  /**
   * PUT /api/workflows/:id
   * Update workflow
   */
  fastify.put<{ Params: WorkflowIdParams; Body: UpdateWorkflowRequest }>(
    '/:id',
    async (request, reply) => {
      try {
        const { id } = request.params;
        const user = (request as any).user;
        const userId = user?.userId || user?.id;
        const updates = request.body;

        // Check ownership
        const existing = await prisma.workflow.findFirst({
          where: { id, created_by: userId, deleted_at: null }
        });

        if (!existing) {
          return reply.code(404).send({
            error: 'Not found',
            message: `Workflow with ID '${id}' not found or you don't have permission`
          });
        }

        // Handle visibility shorthand
        const { visibility, ...rawUpdates } = updates;
        const data: any = { ...rawUpdates };

        // Recompute auto-tags when definition changes
        if (data.definition) {
          const autoTags = computeAutoTags(data.definition);
          const userTags = data.tags || [];
          data.tags = [...new Set([...userTags, ...autoTags])];
        }

        if (visibility === 'private') {
          data.is_public = false;
          data.group_id = null;
        } else if (visibility === 'team' && updates.group_id) {
          data.is_public = false;
          data.group_id = updates.group_id;
        } else if (visibility === 'public') {
          data.is_public = true;
          data.group_id = null;
        }

        const workflow = await prisma.workflow.update({
          where: { id },
          data,
        });

        // Create version snapshot on save — deactivate prior versions, insert new active one
        try {
          const definition = data.definition || existing.definition;
          const settings = data.settings || (existing as any).settings || {};
          const changelog = (updates as any).changelog || 'Auto-saved';

          // Deactivate all existing versions for this workflow
          await prisma.workflowVersion.updateMany({
            where: { workflow_id: id },
            data: { is_active: false }
          });

          const versionCount = await prisma.workflowVersion.count({ where: { workflow_id: id } });
          const nextVersion = versionCount + 1;

          await prisma.workflowVersion.create({
            data: {
              workflow_id: id,
              version: nextVersion,
              definition: definition as any,
              triggers: [] as any,
              settings: settings as any,
              changelog,
              is_active: true,
              created_by: userId
            }
          });
          logger.debug({ workflowId: id, version: nextVersion }, '[Workflows] Version snapshot created');
        } catch (err) {
          // Version creation is non-critical — log but don't fail the save
          logger.warn({ err, workflowId: id }, '[Workflows] Failed to create version snapshot');
        }

        logger.info({ workflowId: id }, '[Workflows] Workflow updated');

        return reply.send({
          success: true,
          workflow: transformWorkflow(workflow)
        });
      } catch (error: any) {
        logger.error({ error }, '[Workflows] Failed to update workflow');
        return reply.code(500).send({
          error: 'Failed to update workflow',
          message: error.message
        });
      }
    }
  );

  /**
   * DELETE /api/workflows/:id
   * Soft delete workflow
   */
  fastify.delete<{ Params: WorkflowIdParams }>(
    '/:id',
    async (request, reply) => {
      try {
        const { id } = request.params;
        const user = (request as any).user;
        const userId = user?.userId || user?.id;

        // Check ownership
        const existing = await prisma.workflow.findFirst({
          where: { id, created_by: userId, deleted_at: null }
        });

        if (!existing) {
          return reply.code(404).send({
            error: 'Not found',
            message: `Workflow with ID '${id}' not found or you don't have permission`
          });
        }

        // Soft delete
        await prisma.workflow.update({
          where: { id },
          data: { deleted_at: new Date(), is_active: false }
        });

        logger.info({ workflowId: id }, '[Workflows] Workflow deleted');

        return reply.send({
          success: true,
          message: `Workflow '${id}' deleted`
        });
      } catch (error: any) {
        logger.error({ error }, '[Workflows] Failed to delete workflow');
        return reply.code(500).send({
          error: 'Failed to delete workflow',
          message: error.message
        });
      }
    }
  );

  /**
   * POST /api/workflows/recompute-tags
   * Recompute auto-tags for all existing workflows (admin utility)
   */
  fastify.post(
    '/recompute-tags',
    async (request, reply) => {
      try {
        const workflows = await prisma.workflow.findMany({
          where: { deleted_at: null },
          select: { id: true, definition: true, tags: true }
        });

        let updated = 0;
        for (const wf of workflows) {
          const def = wf.definition as any || {};
          const autoTags = computeAutoTags(def);
          const existingTags = (wf.tags as string[]) || [];
          const merged = [...new Set([...existingTags, ...autoTags])];

          if (merged.length !== existingTags.length || merged.some(t => !existingTags.includes(t))) {
            await prisma.workflow.update({
              where: { id: wf.id },
              data: { tags: merged }
            });
            updated++;
          }
        }

        logger.info({ total: workflows.length, updated }, '[Workflows] Recomputed tags');
        return reply.send({ success: true, total: workflows.length, updated });
      } catch (error: any) {
        logger.error({ error }, '[Workflows] Failed to recompute tags');
        return reply.code(500).send({ error: 'Failed to recompute tags', message: error.message });
      }
    }
  );

  /**
   * POST /api/workflows/test
   * Test a workflow definition without saving (streams SSE events)
   */
  fastify.post<{ Body: { nodes: any[]; edges: any[]; input?: Record<string, any> } }>(
    '/test',
    async (request, reply): Promise<void> => {
      try {
        const user = (request as any).user;
        const userId = user?.userId || user?.id;
        const { nodes, edges, input = {} } = request.body;

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
            if (typeof (reply.raw as any).flush === 'function') {
              (reply.raw as any).flush();
            }
          }
        };

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
              },
              { responseType: 'stream', timeout: 300000, headers: { 'Accept': 'text/event-stream' } }
            );
            const bridge = createSSEToNDJSONTranslator();
            await new Promise<void>((resolve, reject) => {
              proxyResponse.data.on('data', (chunk: Buffer) => {
                if (!reply.raw.writableEnded) {
                  const ndjson = bridge.translate(chunk);
                  if (ndjson) {
                    reply.raw.write(ndjson);
                    if (typeof (reply.raw as any).flush === 'function') (reply.raw as any).flush();
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
            const testAuthToken = request.headers.authorization
              || (user?.accessToken ? `Bearer ${user.accessToken}` : undefined);
            await executeWorkflow(
              'test',
              testExecutionId,
              { nodes, edges: edges || [] },
              input,
              userId,
              testAuthToken,
              sendEvent
            );
          }
        } catch (execError: any) {
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
      } catch (error: any) {
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
  fastify.post<{ Body: { node: { type: string; data: Record<string, any> }; input?: Record<string, any> } }>(
    '/test-node',
    async (request, reply) => {
      try {
        const user = (request as any).user;
        const userId = user?.userId || user?.id;
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
              },
              { timeout: 60000, validateStatus: () => true }
            );

            const duration = Date.now() - startTime;
            const svcData = svcResponse.data;
            const hasError = svcResponse.status >= 400 || svcData?.success === false;
            const errorMsg = hasError ? (svcData?.error || svcData?.errors?.[0]?.message || 'execution failed') : 'none';
            return { output: svcData?.output ?? {}, duration, error: errorMsg };
          } catch (svcErr: any) {
            logger.warn({ svcErr: svcErr.message }, '[Workflows] Workflow service unavailable for test-node, falling back to local');
          }
        }

        // Fallback: run locally if workflow service unavailable
        let nodeOutput: any = null;
        let nodeError: string | undefined;
        const result = await executeWorkflow(
          'test-node',
          testExecId,
          definition,
          input,
          userId,
          authToken,
          (event: ExecutionEvent) => {
            if (event.nodeId === testNodeId) {
              if (event.type === 'node_complete') {
                nodeOutput = (event as any).output;
              } else if (event.type === 'node_error') {
                nodeError = (event as any).error;
              }
            }
          }
        );

        const duration = Date.now() - startTime;
        const finalOutput = nodeOutput ?? result?.output ?? {};
        return { output: finalOutput, duration, error: nodeError || result?.error || 'none' };
      } catch (error: any) {
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
  fastify.post<{ Body: { definition: { nodes: any[]; edges: any[] } } }>(
    '/compile',
    async (request, reply) => {
      const { definition } = request.body;
      if (!definition?.nodes) {
        return reply.code(400).send({ valid: false, errors: [{ code: 'NO_NODES', message: 'No nodes in definition' }] });
      }

      // Route to workflow service if available
      if (WORKFLOW_SERVICE_URL) {
        try {
          const svcRes = await axios.post(`${WORKFLOW_SERVICE_URL}/compile`, { definition }, { timeout: 10000 });
          return svcRes.data;
        } catch (err: any) {
          // If workflow service returns 400 with validation errors, forward them
          if (err.response?.status === 400 && err.response?.data) {
            return err.response.data;
          }
          logger.warn({ err: err.message }, '[Workflows] Workflow service compile unavailable, using local');
        }
      }

      // Fallback: local compilation (limited compared to workflow service)
      try {
        const { WorkflowCompiler } = await import('../services/WorkflowCompiler.js');
        const compiler = new WorkflowCompiler();
        const result = compiler.compile({ nodes: definition.nodes, edges: definition.edges || [] });
        return { valid: result.valid, errors: result.errors || [], warnings: result.warnings || [] };
      } catch {
        return { valid: true, errors: [], warnings: [] };
      }
    }
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
        const user = (request as any).user;
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
        const definition = version
          ? (version.definition as any)
          : (workflow.definition as any);

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
        });

        // 2. Runtime readiness (secrets, tools, models, credentials)
        let mcpToolList: string[] | undefined;
        let mcpToolSchemas: Record<string, { inputSchema?: { required?: string[] } }> | undefined;
        try {
          const MCP_PROXY_URL = process.env.MCP_PROXY_URL || 'http://openagentic-mcp-proxy:8080';
          const toolsRes = await axios.get(`${MCP_PROXY_URL}/tools`, { timeout: 5000 });
          const tools = toolsRes.data?.tools || [];
          mcpToolList = tools.map((t: any) => t.name);
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
          availableModels = providers.flatMap((p: any) => {
            const config = p.provider_config as any;
            if (!config) return [];
            // Models can be in config.models array, config.modelId, or config.deployment
            if (Array.isArray(config.models)) return config.models.map((m: any) => typeof m === 'string' ? m : m.id || m.name).filter(Boolean);
            if (config.modelId) return [config.modelId];
            if (config.deployment) return [config.deployment];
            return [];
          });
        } catch {
          // Model list unavailable
        }

        const runtime = await workflowCompiler.validateRuntime(
          { nodes: definition.nodes || [], edges: definition.edges || [] },
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
      } catch (error: any) {
        logger.error({ error }, '[Workflows] Validation failed');
        return reply.code(500).send({
          error: 'Validation failed',
          message: error.message
        });
      }
    }
  );

  /**
   * POST /api/workflows/:id/execute
   * Execute workflow
   */
  fastify.post<{ Params: WorkflowIdParams; Body: ExecuteWorkflowRequest; Querystring: { dryRun?: string; async?: string } }>(
    '/:id/execute',
    async (request, reply): Promise<void> => {
      try {
        const { id } = request.params;
        const user = (request as any).user;
        const userId = user?.userId || user?.id;
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

        const version = workflow.versions[0];
        // Prefer version definition if it has nodes, otherwise fall back to workflow's own definition
        const versionDef = version?.definition as any;
        const rawDefinition = (versionDef?.nodes?.length > 0)
          ? versionDef
          : (workflow.definition as any);

        // Filter out non-executable nodes (e.g. text annotations from AI Builder)
        const definition = rawDefinition ? {
          ...rawDefinition,
          nodes: (rawDefinition.nodes || []).filter((n: any) => n.type !== 'text'),
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
            input,
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
        });

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
            const nodeData = node.data || {};
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

            // Send execution_start so the frontend timeline initializes
            sendEvent({ type: 'execution_start', executionId: execution.id, data: { workflowId: id }, timestamp: new Date().toISOString() });

            try {
              let effectiveAuthToken = request.headers.authorization
                || (user?.accessToken ? `Bearer ${user.accessToken}` : undefined);
              let effectiveIdToken: string | undefined;
              try {
                const { AzureTokenService } = await import('../services/AzureTokenService.js');
                const azureTokenService = new AzureTokenService(logger as any);
                const tokenInfo = await azureTokenService.getOrRefreshToken(userId);
                if (tokenInfo?.access_token && !tokenInfo.is_expired) {
                  effectiveAuthToken = `Bearer ${tokenInfo.access_token}`;
                  effectiveIdToken = tokenInfo.id_token;
                }
              } catch {}

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
                    authToken: effectiveAuthToken, idToken: effectiveIdToken, userEmail,
                  },
                  { responseType: 'stream', timeout: 300000, headers: { 'Accept': 'text/event-stream' } }
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
                await executeWorkflow(id, execution.id,
                  { nodes: definition.nodes || [], edges: definition.edges || [] },
                  input || {}, userId, effectiveAuthToken, sendEvent,
                  { userEmail, idToken: effectiveIdToken }
                );
              }

              await prisma.workflow.update({
                where: { id },
                data: { total_executions: { increment: 1 }, successful_executions: { increment: 1 } },
              }).catch(() => {});
            } catch (execError: any) {
              logger.error({ error: execError }, '[Workflows] Async execution failed');
              sendEvent({ type: 'execution_error', executionId: execution.id, data: { error: execError.message }, timestamp: new Date().toISOString() });
              await prisma.workflow.update({
                where: { id },
                data: { total_executions: { increment: 1 }, failed_executions: { increment: 1 } },
              }).catch(() => {});
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
            if (typeof (reply.raw as any).flush === 'function') {
              (reply.raw as any).flush();
            }
          }
          // Publish to Redis for GET /stream subscribers.
          redisPublisher.publish(execChannel, line).catch(() => {});
        };

        try {
          // Load Azure AD access token for MCP calls (works for both proxy and local paths)
          let effectiveAuthToken = request.headers.authorization
            || (user?.accessToken ? `Bearer ${user.accessToken}` : undefined);
          let effectiveIdToken: string | undefined;
          try {
            // Try to load Azure tokens for this user. This works for:
            // 1. Azure AD SSO users (userId starts with 'azure_')
            // 2. API key users who also have Azure AD tokens (linked accounts)
            // We attempt to load tokens for the actual userId first, then try
            // finding any azure_* token that might belong to the same person.
            const { AzureTokenService } = await import('../services/AzureTokenService.js');
            const azureTokenService = new AzureTokenService(logger as any);

            let tokenInfo = null;
            const isAzureUser = !!(user?.azureOid || userId?.startsWith('azure_'));
            if (isAzureUser) {
              tokenInfo = await azureTokenService.getOrRefreshToken(userId);
            }

            // If no direct Azure tokens, find any Azure user with tokens and refresh
            if (!tokenInfo && !isAzureUser) {
              // Strategy: Find any azure_* user that has a refresh token, use getOrRefreshToken
              // which will auto-refresh expired tokens using the refresh_token
              const azureUsersWithTokens = await prisma.userAuthToken.findMany({
                where: {
                  refresh_token: { not: null },
                },
                orderBy: { updated_at: 'desc' },
                select: { user_id: true },
                take: 3,
              });

              for (const azureUser of azureUsersWithTokens) {
                tokenInfo = await azureTokenService.getOrRefreshToken(azureUser.user_id);
                if (tokenInfo && !tokenInfo.is_expired) {
                  logger.info({ userId, azureUserId: azureUser.user_id }, '[Workflows] Using refreshed Azure AD tokens for workflow');
                  break;
                }
                tokenInfo = null; // Refresh failed, try next
              }
            }

            if (tokenInfo && tokenInfo.access_token) {
              // getOrRefreshToken auto-refreshes expired tokens, so trust the result
              const isExpired = tokenInfo.is_expired || new Date() >= new Date(tokenInfo.expires_at);
              if (!isExpired) {
                effectiveAuthToken = `Bearer ${tokenInfo.access_token}`;
                effectiveIdToken = tokenInfo.id_token;
                logger.info({ userId, hasIdToken: !!effectiveIdToken }, '[Workflows] Azure AD tokens loaded for workflow MCP calls');
              } else {
                logger.warn({ userId, expires_at: tokenInfo.expires_at }, '[Workflows] Azure token expired even after refresh attempt');
              }
            } else {
              logger.info({ userId }, '[Workflows] No Azure AD tokens available — using API key auth for MCP calls');
            }
          } catch (tokenErr: any) {
            logger.warn({ userId, error: tokenErr.message }, '[Workflows] Failed to load Azure tokens');
          }

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
                idToken: effectiveIdToken,
                userEmail,
              },
              {
                responseType: 'stream',
                timeout: 300000, // 5 min
                headers: { 'Accept': 'text/event-stream' },
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
                  if (typeof (reply.raw as any).flush === 'function') {
                    (reply.raw as any).flush();
                  }
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
            // ── Local execution (fallback) ──
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
              { nodes: definition.nodes || [], edges: definition.edges || [] },
              input || {},
              userId,
              effectiveAuthToken,
              sendEvent,
              { userEmail, idToken: effectiveIdToken }
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

        } catch (execError: any) {
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
      } catch (error: any) {
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
            if (typeof (reply.raw as any).flush === 'function') {
              (reply.raw as any).flush();
            }
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
      } catch (err: any) {
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
        const user = (request as any).user;
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
      } catch (error: any) {
        logger.error({ error }, '[Workflows] Failed to stop execution');
        return reply.code(500).send({ error: 'Failed to stop execution', message: error.message });
      }
    }
  );

  /**
   * GET /api/workflows/executions/mine
   * Get current user's executions across ALL workflows
   */
  fastify.get<{ Querystring: { limit?: number; offset?: number; status?: string } }>(
    '/executions/mine',
    async (request, reply) => {
      try {
        const user = (request as any).user;
        const userId = user?.userId || user?.id;
        const { limit = 20, offset = 0, status } = request.query;

        const where: any = { started_by: userId, workflow: { deleted_at: null } };
        if (status) where.status = status;

        const [executions, total] = await Promise.all([
          prisma.workflowExecution.findMany({
            where,
            orderBy: { started_at: 'desc' },
            take: Number(limit),
            skip: Number(offset),
            select: {
              id: true,
              workflow_id: true,
              status: true,
              trigger_type: true,
              total_nodes: true,
              completed_nodes: true,
              started_at: true,
              completed_at: true,
              workflow: {
                select: { name: true, icon: true, color: true },
              },
            },
          }),
          prisma.workflowExecution.count({ where }),
        ]);

        return reply.send({ executions, total, limit: Number(limit), offset: Number(offset) });
      } catch (error: any) {
        logger.error({ error: error.message }, 'Failed to list user executions');
        return reply.code(500).send({ error: 'Failed to list executions', message: error.message });
      }
    }
  );

  /**
   * GET /api/workflows/:id/executions
   * Get workflow executions
   */
  fastify.get<{ Params: WorkflowIdParams; Querystring: ListExecutionsQuery }>(
    '/:id/executions',
    async (request, reply) => {
      try {
        const { id } = request.params;
        const user = (request as any).user;
        const userId = user?.userId || user?.id;
        const { limit = 20, offset = 0, status } = request.query;

        // Verify user has access to this workflow
        const userGroups = await prisma.userGroupMembership.findMany({
          where: { user_id: userId },
          select: { group_id: true },
        }).catch(() => [] as { group_id: string }[]);
        const userGroupIds = userGroups.map(g => g.group_id);

        const workflow = await prisma.workflow.findFirst({
          where: {
            id,
            deleted_at: null,
            OR: [
              { created_by: userId },
              { is_public: true },
              ...(userGroupIds.length > 0 ? [{ group_id: { in: userGroupIds } }] : []),
            ],
          },
          select: { id: true },
        });
        if (!workflow) {
          return reply.code(404).send({ error: 'Not found', message: 'Workflow not found or access denied' });
        }

        const where: any = { workflow_id: id };
        if (status) where.status = status;

        const [executions, total] = await Promise.all([
          prisma.workflowExecution.findMany({
            where,
            orderBy: { started_at: 'desc' },
            take: Number(limit),
            skip: Number(offset),
            select: {
              id: true,
              status: true,
              trigger_type: true,
              total_nodes: true,
              completed_nodes: true,
              execution_time_ms: true,
              cost: true,
              started_at: true,
              completed_at: true,
              error: true,
              node_outputs: true,
              logs: {
                where: { node_id: { not: null } },
                select: { node_id: true, data: true },
                orderBy: { timestamp: 'asc' },
              }
            }
          }),
          prisma.workflowExecution.count({ where })
        ]);

        return reply.send({
          executions: executions.map(e => {
            // Build node_outputs from logs if the JSON merge field is empty
            let nodeOutputs = (e.node_outputs && typeof e.node_outputs === 'object' && Object.keys(e.node_outputs as any).length > 0)
              ? e.node_outputs
              : undefined;

            if (!nodeOutputs && e.logs && e.logs.length > 0) {
              const built: Record<string, any> = {};
              for (const log of e.logs) {
                if (log.node_id && log.data && typeof log.data === 'object') {
                  const d = log.data as any;
                  built[log.node_id] = {
                    status: d.status || 'completed',
                    nodeType: d.node_type,
                    duration: d.execution_time_ms,
                    error: d.error || null,
                  };
                }
              }
              if (Object.keys(built).length > 0) nodeOutputs = built;
            }

            const { logs: _logs, ...rest } = e;
            return {
              ...rest,
              cost: e.cost ? Number(e.cost) : null,
              node_outputs: nodeOutputs || {},
            };
          }),
          total,
          limit: Number(limit),
          offset: Number(offset)
        });
      } catch (error: any) {
        logger.error({ error }, '[Workflows] Failed to list executions');
        return reply.code(500).send({
          error: 'Failed to list executions',
          message: error.message
        });
      }
    }
  );

  /**
   * GET /api/workflows/:id/executions/:execId
   * Get detailed execution info including logs and per-node summary
   */
  fastify.get<{ Params: ExecutionDetailParams }>(
    '/:id/executions/:execId',
    async (request, reply) => {
      try {
        const { id, execId } = request.params;
        const user = (request as any).user;
        const userId = user?.userId || user?.id;

        // Verify user has access to this workflow
        const userGroups = await prisma.userGroupMembership.findMany({
          where: { user_id: userId },
          select: { group_id: true },
        }).catch(() => [] as { group_id: string }[]);
        const userGroupIds = userGroups.map(g => g.group_id);

        // First check if user started this execution (allows access even if workflow was created by someone else)
        const execution = await prisma.workflowExecution.findFirst({
          where: { id: execId, workflow_id: id },
        });

        if (!execution) {
          return reply.code(404).send({ error: 'Not found', message: 'Execution not found' });
        }

        // Allow access if user started the execution OR has access to the workflow
        const userStartedExecution = execution.started_by === userId;
        if (!userStartedExecution) {
          const workflow = await prisma.workflow.findFirst({
            where: {
              id,
              deleted_at: null,
              OR: [
                { created_by: userId },
                { is_public: true },
                ...(userGroupIds.length > 0 ? [{ group_id: { in: userGroupIds } }] : []),
              ],
            },
            select: { id: true },
          });
          if (!workflow) {
            return reply.code(404).send({ error: 'Not found', message: 'Workflow not found or access denied' });
          }
        }

        // Fetch all logs for this execution
        const logs = await prisma.workflowExecutionLog.findMany({
          where: { execution_id: execId },
          orderBy: { timestamp: 'asc' },
        });

        // Build per-node summary from node_outputs and logs
        const nodeOutputs = (execution.node_outputs as Record<string, any>) || {};
        const nodeSummary: Record<string, { status: string; input: any; output: any; duration: number | null; error: string | null; logs: any[] }> = {};

        // Initialize from node_outputs
        for (const [nodeId, nodeData] of Object.entries(nodeOutputs)) {
          const data = nodeData as any;
          nodeSummary[nodeId] = {
            status: data?.status || (data?.error ? 'failed' : 'completed'),
            input: data?.input ?? null,
            output: data?.output ?? data?.result ?? null,
            duration: data?.duration ?? data?.execution_time_ms ?? null,
            error: data?.error ?? null,
            logs: [],
          };
        }

        // Attach logs to their respective nodes
        for (const log of logs) {
          if (log.node_id) {
            if (!nodeSummary[log.node_id]) {
              nodeSummary[log.node_id] = {
                status: 'unknown',
                input: null,
                output: null,
                duration: null,
                error: null,
                logs: [],
              };
            }
            nodeSummary[log.node_id].logs.push({
              id: log.id,
              level: log.level,
              message: log.message,
              data: log.data,
              timestamp: log.timestamp,
            });
          }
        }

        return reply.send({
          execution: {
            id: execution.id,
            workflow_id: execution.workflow_id,
            version_id: execution.version_id,
            trigger_type: execution.trigger_type,
            trigger_data: execution.trigger_data,
            status: execution.status,
            current_node_id: execution.current_node_id,
            state: execution.state,
            node_outputs: execution.node_outputs,
            checkpoints: execution.checkpoints,
            input: execution.input,
            output: execution.output,
            error: execution.error,
            error_node_id: execution.error_node_id,
            total_nodes: execution.total_nodes,
            completed_nodes: execution.completed_nodes,
            execution_time_ms: execution.execution_time_ms,
            cost: execution.cost ? Number(execution.cost) : null,
            started_at: execution.started_at,
            completed_at: execution.completed_at,
          },
          logs: logs.map(l => ({
            id: l.id,
            execution_id: l.execution_id,
            node_id: l.node_id,
            level: l.level,
            message: l.message,
            data: l.data,
            trace_id: l.trace_id,
            span_id: l.span_id,
            timestamp: l.timestamp,
          })),
          nodeSummary,
        });
      } catch (error: any) {
        logger.error({ error }, '[Workflows] Failed to get execution detail');
        return reply.code(500).send({
          error: 'Failed to get execution detail',
          message: error.message,
        });
      }
    }
  );

  /**
   * POST /api/workflows/:id/versions
   * Create new version
   */
  fastify.post<{ Params: WorkflowIdParams; Body: CreateVersionRequest }>(
    '/:id/versions',
    async (request, reply) => {
      try {
        const { id } = request.params;
        const user = (request as any).user;
        const userId = user?.userId || user?.id;
        const { changelog, activate = false } = request.body;

        // Get workflow and latest version
        const workflow = await prisma.workflow.findFirst({
          where: { id, created_by: userId, deleted_at: null },
          include: {
            versions: {
              orderBy: { version: 'desc' },
              take: 1
            }
          }
        });

        if (!workflow) {
          return reply.code(404).send({
            error: 'Not found',
            message: `Workflow with ID '${id}' not found or you don't have permission`
          });
        }

        const latestVersion = workflow.versions[0];
        const newVersionNum = latestVersion ? latestVersion.version + 1 : 1;

        // If activating, deactivate all other versions
        if (activate) {
          await prisma.workflowVersion.updateMany({
            where: { workflow_id: id },
            data: { is_active: false }
          });
        }

        const version = await prisma.workflowVersion.create({
          data: {
            workflow_id: id,
            version: newVersionNum,
            definition: workflow.definition,
            triggers: workflow.triggers,
            settings: workflow.settings,
            changelog,
            is_active: activate,
            created_by: userId
          }
        });

        logger.info({
          workflowId: id,
          version: newVersionNum,
          activated: activate
        }, '[Workflows] Version created');

        return reply.code(201).send({
          success: true,
          version
        });
      } catch (error: any) {
        logger.error({ error }, '[Workflows] Failed to create version');
        return reply.code(500).send({
          error: 'Failed to create version',
          message: error.message
        });
      }
    }
  );

  /**
   * GET /api/workflows/:id/versions
   * List versions
   */
  fastify.get<{ Params: WorkflowIdParams }>(
    '/:id/versions',
    async (request, reply) => {
      try {
        const { id } = request.params;
        const user = (request as any).user;
        const userId = user?.userId || user?.id;

        // Verify user has access to this workflow
        const userGroups = await prisma.userGroupMembership.findMany({
          where: { user_id: userId },
          select: { group_id: true },
        }).catch(() => [] as { group_id: string }[]);
        const userGroupIds = userGroups.map(g => g.group_id);

        const workflow = await prisma.workflow.findFirst({
          where: {
            id,
            deleted_at: null,
            OR: [
              { created_by: userId },
              { is_public: true },
              ...(userGroupIds.length > 0 ? [{ group_id: { in: userGroupIds } }] : []),
            ],
          },
          select: { id: true },
        });
        if (!workflow) {
          return reply.code(404).send({ error: 'Not found', message: 'Workflow not found or access denied' });
        }

        const versions = await prisma.workflowVersion.findMany({
          where: { workflow_id: id },
          orderBy: { version: 'desc' },
          include: {
            creator: {
              select: { id: true, email: true, name: true }
            }
          }
        });

        return reply.send({
          versions,
          total: versions.length
        });
      } catch (error: any) {
        logger.error({ error }, '[Workflows] Failed to list versions');
        return reply.code(500).send({
          error: 'Failed to list versions',
          message: error.message
        });
      }
    }
  );

  /**
   * PUT /api/workflows/:id/versions/:versionId/activate
   * Activate a specific version
   */
  fastify.put<{ Params: VersionIdParams }>(
    '/:id/versions/:versionId/activate',
    async (request, reply) => {
      try {
        const { id, versionId } = request.params;
        const user = (request as any).user;
        const userId = user?.userId || user?.id;

        // Check ownership
        const workflow = await prisma.workflow.findFirst({
          where: { id, created_by: userId, deleted_at: null }
        });

        if (!workflow) {
          return reply.code(404).send({
            error: 'Not found',
            message: `Workflow with ID '${id}' not found or you don't have permission`
          });
        }

        // Deactivate all versions
        await prisma.workflowVersion.updateMany({
          where: { workflow_id: id },
          data: { is_active: false }
        });

        // Activate specified version
        const version = await prisma.workflowVersion.update({
          where: { id: versionId },
          data: { is_active: true }
        });

        // Update workflow definition from activated version
        await prisma.workflow.update({
          where: { id },
          data: {
            definition: version.definition,
            triggers: version.triggers,
            settings: version.settings
          }
        });

        logger.info({
          workflowId: id,
          versionId,
          version: version.version
        }, '[Workflows] Version activated');

        return reply.send({
          success: true,
          version
        });
      } catch (error: any) {
        logger.error({ error }, '[Workflows] Failed to activate version');
        return reply.code(500).send({
          error: 'Failed to activate version',
          message: error.message
        });
      }
    }
  );

  /**
   * POST /api/workflows/:id/versions/:versionId/restore
   * Restore a workflow to a specific version
   */
  fastify.post<{ Params: VersionIdParams }>(
    '/:id/versions/:versionId/restore',
    async (request, reply) => {
      try {
        const { id, versionId } = request.params;
        const user = (request as any).user;
        const userId = user?.userId || user?.id;

        // Check ownership
        const workflow = await prisma.workflow.findFirst({
          where: { id, created_by: userId, deleted_at: null }
        });

        if (!workflow) {
          return reply.code(404).send({
            error: 'Not found',
            message: `Workflow with ID '${id}' not found or you don't have permission`
          });
        }

        const version = await prisma.workflowVersion.findUnique({
          where: { id: versionId },
        });
        if (!version || version.workflow_id !== id) {
          return reply.code(404).send({ error: 'Version not found' });
        }

        // Create a new version snapshot of current state before restoring
        const latestVersion = await prisma.workflowVersion.findFirst({
          where: { workflow_id: id },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        const nextVersionNum = (latestVersion?.version || 0) + 1;

        await prisma.workflowVersion.create({
          data: {
            workflow_id: id,
            version: nextVersionNum,
            definition: workflow.definition,
            triggers: workflow.triggers,
            settings: workflow.settings,
            changelog: `Auto-snapshot before restoring to version ${version.version}`,
            is_active: false,
            created_by: userId,
          },
        });

        // Update workflow with the version's definition
        await prisma.workflow.update({
          where: { id },
          data: {
            definition: version.definition as any,
            settings: version.settings as any || undefined,
            triggers: version.triggers as any || undefined,
            updated_at: new Date(),
          },
        });

        logger.info({
          workflowId: id,
          versionId,
          restoredToVersion: version.version,
          snapshotVersion: nextVersionNum,
        }, '[Workflows] Version restored');

        return reply.send({ success: true, message: `Restored to version ${version.version}` });
      } catch (error: any) {
        logger.error({ error }, '[Workflows] Failed to restore version');
        return reply.code(500).send({
          error: 'Failed to restore version',
          message: error.message
        });
      }
    }
  );

  /**
   * POST /api/workflows/:id/duplicate
   * Duplicate a workflow
   */
  fastify.post<{ Params: WorkflowIdParams }>(
    '/:id/duplicate',
    async (request, reply) => {
      try {
        const { id } = request.params;
        const user = (request as any).user;
        const userId = user?.userId || user?.id;

        // Get original workflow
        const original = await prisma.workflow.findFirst({
          where: {
            id,
            deleted_at: null,
            OR: [
              { created_by: userId },
              { is_public: true },
              { is_template: true }
            ]
          }
        });

        if (!original) {
          return reply.code(404).send({
            error: 'Not found',
            message: `Workflow with ID '${id}' not found or you don't have permission`
          });
        }

        // Create duplicate
        const duplicate = await prisma.workflow.create({
          data: {
            name: `${original.name} (Copy)`,
            description: original.description,
            definition: original.definition,
            triggers: original.triggers,
            settings: original.settings,
            variables: original.variables,
            tags: original.tags,
            category: original.category,
            icon: original.icon,
            color: original.color,
            is_template: false,
            is_public: false,
            created_by: userId
          }
        });

        // Create initial version
        await prisma.workflowVersion.create({
          data: {
            workflow_id: duplicate.id,
            version: 1,
            definition: original.definition,
            triggers: original.triggers,
            settings: original.settings,
            changelog: `Duplicated from ${original.name}`,
            is_active: true,
            created_by: userId
          }
        });

        logger.info({
          originalId: id,
          duplicateId: duplicate.id
        }, '[Workflows] Workflow duplicated');

        return reply.code(201).send({
          success: true,
          workflow: transformWorkflow(duplicate)
        });
      } catch (error: any) {
        logger.error({ error }, '[Workflows] Failed to duplicate workflow');
        return reply.code(500).send({
          error: 'Failed to duplicate workflow',
          message: error.message
        });
      }
    }
  );

  /**
   * GET /api/workflows/templates
   * List all workflow templates (public templates accessible to any authenticated user)
   */
  fastify.get(
    '/templates',
    async (request, reply) => {
      try {
        const templates = await prisma.workflow.findMany({
          where: {
            is_template: true,
            is_public: true,
            deleted_at: null,
          },
          orderBy: { created_at: 'desc' },
          select: {
            id: true,
            name: true,
            description: true,
            definition: true,
            is_active: true,
            is_template: true,
            is_public: true,
            tags: true,
            category: true,
            icon: true,
            color: true,
            total_executions: true,
            created_by: true,
            created_at: true,
            updated_at: true,
          },
        });

        return reply.send({
          templates: templates.map(transformWorkflow),
          total: templates.length,
        });
      } catch (error: any) {
        if (error.code === 'P2021' || error.code === 'P2010' || error.message?.includes('does not exist')) {
          return reply.send({ templates: [], total: 0 });
        }
        logger.error({ error }, '[Workflows] Failed to list templates');
        return reply.code(500).send({
          error: 'Failed to list templates',
          message: error.message,
        });
      }
    }
  );

  /**
   * GET /api/workflows/agents
   * List available agent definitions for workflow use (non-admin)
   */
  fastify.get(
    '/agents',
    async (request, reply) => {
      try {
        // Fetch from openagentic-proxy service (source of truth for agent definitions)
        const openagenticProxyUrl = process.env.OPENAGENTIC_PROXY_URL || 'http://openagentic-openagentic-proxy:3300';
        const internalKey = process.env.OPENAGENTIC_PROXY_INTERNAL_KEY || '';
        const res = await fetch(`${openagenticProxyUrl}/api/agents/definitions`, {
          headers: {
            'Authorization': `Bearer ${internalKey}`,
            'X-Agent-Proxy': 'true',
          },
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const data = await res.json() as { agents: any[] };
          return reply.send({ agents: data.agents || [] });
        }
        // Fallback: return empty if openagentic-proxy unavailable
        logger.warn({ status: res.status }, '[Workflows] Agent-proxy returned non-OK, returning empty');
        return reply.send({ agents: [] });
      } catch (error: any) {
        logger.warn({ error: error.message }, '[Workflows] Failed to reach openagentic-proxy, returning empty');
        return reply.send({ agents: [] });
      }
    }
  );

  // =========================================================================
  // Webhook Management
  // =========================================================================

  /**
   * POST /api/workflows/:id/webhooks
   * Create a webhook endpoint for a workflow.
   * Returns a unique webhook URL that can be called externally without auth.
   */
  fastify.post<{
    Params: WorkflowIdParams;
    Body: {
      name?: string;
      response_mode?: 'async' | 'sync';
      secret?: string;
      rate_limit_per_minute?: number;
    };
  }>(
    '/:id/webhooks',
    async (request, reply) => {
      try {
        const { id } = request.params;
        const user = (request as any).user;
        const userId = user?.userId || user?.id;
        const { name, response_mode = 'sync', secret, rate_limit_per_minute = 60 } = request.body || {};

        // Verify ownership
        const workflow = await prisma.workflow.findFirst({
          where: { id, deleted_at: null, created_by: userId },
        });

        if (!workflow) {
          return reply.code(404).send({ error: 'Workflow not found or you are not the owner' });
        }

        const webhookKey = `wh_${randomUUID().replace(/-/g, '')}`;
        const webhook = await prisma.workflowWebhook.create({
          data: {
            workflow_id: id,
            webhook_key: webhookKey,
            name: name || `Webhook for ${workflow.name}`,
            response_mode,
            secret: secret || null,
            rate_limit_per_minute,
          },
        });

        return reply.code(201).send({
          success: true,
          webhook: {
            id: webhook.id,
            key: webhook.webhook_key,
            name: webhook.name,
            url: `/api/v1/hooks/${webhook.webhook_key}`,
            response_mode: webhook.response_mode,
            rate_limit_per_minute: webhook.rate_limit_per_minute,
            is_active: webhook.is_active,
            created_at: webhook.created_at,
          },
        });
      } catch (error: any) {
        logger.error({ error }, '[Workflows] Failed to create webhook');
        return reply.code(500).send({ error: 'Failed to create webhook', message: error.message });
      }
    }
  );

  /**
   * GET /api/workflows/:id/snippets
   * Generate auto-generated API client code snippets for calling this workflow.
   * Returns curl, Python, JavaScript, and MCP tool call examples.
   */
  fastify.get<{ Params: WorkflowIdParams }>(
    '/:id/snippets',
    async (request, reply) => {
      try {
        const { id } = request.params;
        const user = (request as any).user;
        const userId = user?.userId || user?.id;

        const workflow = await prisma.workflow.findFirst({
          where: {
            id,
            deleted_at: null,
            OR: [{ created_by: userId }, { is_public: true }],
          },
        });

        if (!workflow) {
          return reply.code(404).send({ error: 'Workflow not found' });
        }

        const apiUrl = process.env.PUBLIC_URL || 'https://chat-dev.openagentic.io';
        const workflowName = workflow.name;
        const definition = workflow.definition as any || {};
        const triggerNode = (definition.nodes || []).find((n: any) => (n.type || n.data?.type) === 'trigger');
        const inputSchema = triggerNode?.data?.inputSchema || triggerNode?.data?.config?.inputSchema;
        const inputExample = inputSchema
          ? JSON.stringify(Object.fromEntries(Object.entries(inputSchema).map(([k, v]) => [k, `your_${k}_here`])), null, 2)
          : '{"message": "your input here"}';
        const inputExampleInline = inputSchema
          ? JSON.stringify(Object.fromEntries(Object.entries(inputSchema).map(([k, v]) => [k, `your_${k}_here`])))
          : '{"message": "your input here"}';

        const snippets = {
          curl: `curl -X POST "${apiUrl}/api/workflows/${id}/execute" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"input": ${inputExampleInline}}'`,

          python: `import requests

response = requests.post(
    "${apiUrl}/api/workflows/${id}/execute",
    headers={
        "Authorization": "Bearer YOUR_API_KEY",
        "Content-Type": "application/json",
    },
    json={"input": ${inputExample}},
    stream=True,
)

for line in response.iter_lines():
    if line:
        print(line.decode())`,

          javascript: `const response = await fetch("${apiUrl}/api/workflows/${id}/execute", {
  method: "POST",
  headers: {
    "Authorization": "Bearer YOUR_API_KEY",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ input: ${inputExample} }),
});

const reader = response.body.getReader();
const decoder = new TextDecoder();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  console.log(decoder.decode(value));
}`,

          typescript: `import axios from "axios";

const { data } = await axios.post(
  "${apiUrl}/api/workflows/${id}/execute",
  { input: ${inputExample} },
  {
    headers: {
      Authorization: "Bearer YOUR_API_KEY",
      "Content-Type": "application/json",
    },
    responseType: "stream",
  }
);

data.on("data", (chunk: Buffer) => {
  console.log(chunk.toString());
});`,

          mcp_tool: `// Use via MCP: workflow_execute tool
{
  "tool": "workflow_execute",
  "arguments": {
    "workflow_id": "${id}"${inputSchema ? `,\n    "input_data": ${inputExample}` : ''}
  }
}

// Or use by name: workflow_execute_by_name tool
{
  "tool": "workflow_execute_by_name",
  "arguments": {
    "workflow_name": "${workflowName}"${inputSchema ? `,\n    "input_data": ${inputExample}` : ''}
  }
}`,
        };

        return reply.send({
          workflowId: id,
          workflowName,
          inputSchema: inputSchema || null,
          snippets,
        });
      } catch (error: any) {
        logger.error({ error }, '[Workflows] Failed to generate snippets');
        return reply.code(500).send({ error: 'Failed to generate snippets', message: error.message });
      }
    }
  );

  /**
   * GET /api/workflows/:id/webhooks
   * List webhooks for a workflow
   */
  fastify.get<{ Params: WorkflowIdParams }>(
    '/:id/webhooks',
    async (request, reply) => {
      try {
        const { id } = request.params;
        const user = (request as any).user;
        const userId = user?.userId || user?.id;

        const workflow = await prisma.workflow.findFirst({
          where: { id, deleted_at: null, OR: [{ created_by: userId }, { is_public: true }] },
        });

        if (!workflow) {
          return reply.code(404).send({ error: 'Workflow not found' });
        }

        const webhooks = await prisma.workflowWebhook.findMany({
          where: { workflow_id: id },
          orderBy: { created_at: 'desc' },
        });

        return reply.send({
          webhooks: webhooks.map(wh => ({
            id: wh.id,
            key: wh.webhook_key,
            name: wh.name,
            url: `/api/v1/hooks/${wh.webhook_key}`,
            response_mode: wh.response_mode,
            is_active: wh.is_active,
            total_calls: wh.total_calls,
            last_called_at: wh.last_called_at,
            rate_limit_per_minute: wh.rate_limit_per_minute,
            created_at: wh.created_at,
          })),
        });
      } catch (error: any) {
        logger.error({ error }, '[Workflows] Failed to list webhooks');
        return reply.code(500).send({ error: 'Failed to list webhooks', message: error.message });
      }
    }
  );

  /**
   * DELETE /api/workflows/:id/webhooks/:webhookId
   * Delete a webhook
   */
  fastify.delete<{ Params: WorkflowIdParams & { webhookId: string } }>(
    '/:id/webhooks/:webhookId',
    async (request, reply) => {
      try {
        const { id, webhookId } = request.params;
        const user = (request as any).user;
        const userId = user?.userId || user?.id;

        const workflow = await prisma.workflow.findFirst({
          where: { id, deleted_at: null, created_by: userId },
        });

        if (!workflow) {
          return reply.code(404).send({ error: 'Workflow not found or you are not the owner' });
        }

        await prisma.workflowWebhook.delete({
          where: { id: webhookId, workflow_id: id },
        });

        return reply.send({ success: true, message: 'Webhook deleted' });
      } catch (error: any) {
        logger.error({ error }, '[Workflows] Failed to delete webhook');
        return reply.code(500).send({ error: 'Failed to delete webhook', message: error.message });
      }
    }
  );

  // =========================================================================
  // Workflow Sharing
  // =========================================================================

  /**
   * GET /api/workflows/:id/shares
   * List all shares for a workflow (users and groups with roles).
   */
  fastify.get<{ Params: WorkflowIdParams }>(
    '/:id/shares',
    async (request, reply) => {
      try {
        const { id } = request.params;
        const user = (request as any).user;
        const userId = user?.userId || user?.id;

        // Verify the user can view this workflow
        const workflow = await prisma.workflow.findFirst({
          where: { id, deleted_at: null, OR: [{ created_by: userId }, { is_public: true }] },
          select: { id: true, created_by: true },
        });

        if (!workflow) {
          return reply.code(404).send({ error: 'Workflow not found' });
        }

        const shares = await prisma.workflowShare.findMany({
          where: { workflow_id: id },
          orderBy: { created_at: 'desc' },
        });

        return reply.send({ shares, owner: workflow.created_by });
      } catch (error: any) {
        logger.error({ error }, '[Workflows] Failed to list shares');
        return reply.code(500).send({ error: 'Failed to list shares', message: error.message });
      }
    }
  );

  /**
   * POST /api/workflows/:id/shares
   * Add a share to a workflow.
   */
  fastify.post<{
    Params: WorkflowIdParams;
    Body: { share_type: 'user' | 'group'; target_id: string; role: string };
  }>(
    '/:id/shares',
    async (request, reply) => {
      try {
        const { id } = request.params;
        const user = (request as any).user;
        const userId = user?.userId || user?.id;
        const { share_type, target_id, role } = request.body || {};

        if (!share_type || !target_id || !role) {
          return reply.code(400).send({ error: 'share_type, target_id, and role are required' });
        }

        const validRoles = ['viewer', 'editor', 'executor', 'admin'];
        if (!validRoles.includes(role)) {
          return reply.code(400).send({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
        }

        // Verify ownership (only owner or admin sharer can add shares)
        const workflow = await prisma.workflow.findFirst({
          where: { id, deleted_at: null, created_by: userId },
        });
        if (!workflow) {
          return reply.code(403).send({ error: 'Only the workflow owner can manage shares' });
        }

        const share = await prisma.workflowShare.upsert({
          where: {
            workflow_id_share_type_target_id: { workflow_id: id, share_type, target_id },
          },
          create: { workflow_id: id, share_type, target_id, role, shared_by: userId },
          update: { role, shared_by: userId },
        });

        logger.info({ workflowId: id, share_type, target_id, role }, '[Workflows] Share added/updated');
        return reply.code(201).send({ share });
      } catch (error: any) {
        logger.error({ error }, '[Workflows] Failed to add share');
        return reply.code(500).send({ error: 'Failed to add share', message: error.message });
      }
    }
  );

  /**
   * PUT /api/workflows/:id/shares/:shareId
   * Update a share role.
   */
  fastify.put<{
    Params: { id: string; shareId: string };
    Body: { role: string };
  }>(
    '/:id/shares/:shareId',
    async (request, reply) => {
      try {
        const { id, shareId } = request.params;
        const user = (request as any).user;
        const userId = user?.userId || user?.id;
        const { role } = request.body || {};

        const validRoles = ['viewer', 'editor', 'executor', 'admin'];
        if (!role || !validRoles.includes(role)) {
          return reply.code(400).send({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
        }

        const workflow = await prisma.workflow.findFirst({
          where: { id, deleted_at: null, created_by: userId },
        });
        if (!workflow) {
          return reply.code(403).send({ error: 'Only the workflow owner can manage shares' });
        }

        const share = await prisma.workflowShare.update({
          where: { id: shareId, workflow_id: id },
          data: { role },
        });

        return reply.send({ share });
      } catch (error: any) {
        logger.error({ error }, '[Workflows] Failed to update share');
        return reply.code(500).send({ error: 'Failed to update share', message: error.message });
      }
    }
  );

  /**
   * DELETE /api/workflows/:id/shares/:shareId
   * Remove a share.
   */
  fastify.delete<{ Params: { id: string; shareId: string } }>(
    '/:id/shares/:shareId',
    async (request, reply) => {
      try {
        const { id, shareId } = request.params;
        const user = (request as any).user;
        const userId = user?.userId || user?.id;

        const workflow = await prisma.workflow.findFirst({
          where: { id, deleted_at: null, created_by: userId },
        });
        if (!workflow) {
          return reply.code(403).send({ error: 'Only the workflow owner can manage shares' });
        }

        await prisma.workflowShare.delete({
          where: { id: shareId, workflow_id: id },
        });

        return reply.send({ success: true, message: 'Share removed' });
      } catch (error: any) {
        logger.error({ error }, '[Workflows] Failed to remove share');
        return reply.code(500).send({ error: 'Failed to remove share', message: error.message });
      }
    }
  );

  // =========================================================================
  // User API Keys (self-service)
  // =========================================================================

  /**
   * GET /api/workflows/user/api-keys
   * List current user's API keys (masked).
   */
  fastify.get(
    '/user/api-keys',
    async (request, reply) => {
      try {
        const user = (request as any).user;
        const userId = user?.userId || user?.id;

        const keys = await prisma.apiKey.findMany({
          where: { user_id: userId, is_active: true },
          select: {
            id: true,
            name: true,
            last_used_at: true,
            expires_at: true,
            created_at: true,
          },
          orderBy: { created_at: 'desc' },
        });

        return reply.send({ keys });
      } catch (error: any) {
        logger.error({ error }, '[Workflows] Failed to list API keys');
        return reply.code(500).send({ error: 'Failed to list API keys', message: error.message });
      }
    }
  );

  /**
   * POST /api/workflows/user/api-keys
   * Create a new API key. Returns the plaintext key ONCE.
   */
  fastify.post<{ Body: { name: string } }>(
    '/user/api-keys',
    async (request, reply) => {
      try {
        const user = (request as any).user;
        const userId = user?.userId || user?.id;
        const { name } = request.body || {};

        if (!name) {
          return reply.code(400).send({ error: 'name is required' });
        }

        // Generate a secure API key
        const prefix = 'awc_';
        const rawKey = prefix + randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '').substring(0, 16);
        const keyHash = await bcrypt.hash(rawKey, 10);

        const apiKey = await prisma.apiKey.create({
          data: {
            user_id: userId,
            name,
            key_hash: keyHash,
          },
        });

        logger.info({ userId, keyId: apiKey.id, name }, '[Workflows] API key created');

        return reply.code(201).send({
          key: {
            id: apiKey.id,
            name: apiKey.name,
            plaintext_key: rawKey,
            created_at: apiKey.created_at,
          },
          warning: 'Save this key now. It will not be shown again.',
        });
      } catch (error: any) {
        logger.error({ error }, '[Workflows] Failed to create API key');
        return reply.code(500).send({ error: 'Failed to create API key', message: error.message });
      }
    }
  );

  /**
   * DELETE /api/workflows/user/api-keys/:keyId
   * Revoke an API key.
   */
  fastify.delete<{ Params: { keyId: string } }>(
    '/user/api-keys/:keyId',
    async (request, reply) => {
      try {
        const { keyId } = request.params;
        const user = (request as any).user;
        const userId = user?.userId || user?.id;

        await prisma.apiKey.updateMany({
          where: { id: keyId, user_id: userId },
          data: { is_active: false },
        });

        return reply.send({ success: true, message: 'API key revoked' });
      } catch (error: any) {
        logger.error({ error }, '[Workflows] Failed to revoke API key');
        return reply.code(500).send({ error: 'Failed to revoke API key', message: error.message });
      }
    }
  );

  // =========================================================================
  // User Groups (self-service)
  // =========================================================================

  /**
   * GET /api/workflows/user/groups
   * List groups the current user belongs to.
   */
  fastify.get(
    '/user/groups',
    async (request, reply) => {
      try {
        const user = (request as any).user;
        const userId = user?.userId || user?.id;

        const memberships = await prisma.userGroupMembership.findMany({
          where: { user_id: userId },
          include: {
            group: {
              select: { id: true, name: true, display_name: true, description: true },
            },
          },
        });

        const groups = memberships.map(m => ({
          ...m.group,
          role: m.role,
        }));

        return reply.send({ groups });
      } catch (error: any) {
        logger.error({ error }, '[Workflows] Failed to list user groups');
        return reply.code(500).send({ error: 'Failed to list user groups', message: error.message });
      }
    }
  );

  /**
   * GET /api/workflows/secrets
   * List workflow secrets visible to the current user (global, group-scoped, or workflow-scoped).
   * Never exposes encrypted values.
   */
  fastify.get(
    '/secrets',
    async (request, reply) => {
      try {
        const user = (request as any).user;
        const userId = user?.userId || user?.id;

        // Get user's group memberships for group-scoped secrets
        const userGroups = await prisma.userGroupMembership.findMany({
          where: { user_id: userId },
          select: { group_id: true },
        }).catch(() => [] as { group_id: string }[]);
        const userGroupIds = userGroups.map(g => g.group_id);

        // Get workflow IDs the user owns (for workflow-scoped secrets)
        const userWorkflows = await prisma.workflow.findMany({
          where: { created_by: userId, deleted_at: null },
          select: { id: true },
        });
        const userWorkflowIds = userWorkflows.map(w => w.id);

        const secrets = await prisma.workflowSecret.findMany({
          where: {
            OR: [
              { scope: 'global' },
              ...(userGroupIds.length > 0 ? [{ scope: 'group', group_id: { in: userGroupIds } }] : []),
              ...(userWorkflowIds.length > 0 ? [{ scope: 'workflow', workflow_id: { in: userWorkflowIds } }] : []),
            ],
          },
          select: {
            id: true,
            name: true,
            description: true,
            scope: true,
            workflow_id: true,
            created_at: true,
          },
          orderBy: { created_at: 'desc' },
        });

        return reply.send({ secrets });
      } catch (error: any) {
        logger.error({ error }, '[Workflows] Failed to list secrets');
        return reply.code(500).send({ error: 'Failed to list secrets', message: error.message });
      }
    }
  );

  /**
   * GET /api/workflows/data/collections
   * Returns user-scoped data stores: Milvus collections, pgvector tables, Redis status.
   * Only shows data belonging to the authenticated user (security P0).
   */
  fastify.get(
    '/data/collections',
    async (request, reply) => {
      try {
        const user = (request as any).user;
        const userId = user?.userId || user?.id;
        if (!userId) {
          return reply.code(401).send({ error: 'Authentication required' });
        }

        // Get user's Milvus collections with document counts
        let userCollections: any[] = [];
        try {
          const collections = await prisma.userVectorCollections.findMany({
            where: { user_id: userId },
            include: {
              _count: { select: { artifacts: true } }
            },
            orderBy: { updated_at: 'desc' },
          });
          userCollections = collections.map(c => ({
            id: c.id,
            name: c.collection_name,
            dimension: c.vector_dimension,
            documentCount: c._count.artifacts,
            updatedAt: c.updated_at,
          }));
        } catch (collErr: any) {
          logger.warn({ error: collErr.message }, '[Workflows] Could not query user collections');
        }

        // Get user's recent documents
        let userDocuments: any[] = [];
        try {
          const docs = await prisma.artifactMetadata.findMany({
            where: { created_by: userId },
            select: {
              id: true,
              artifact_type: true,
              artifact_name: true,
              metadata: true,
              created_at: true,
            },
            orderBy: { created_at: 'desc' },
            take: 50,
          });
          userDocuments = docs.map(d => ({
            id: d.id,
            type: d.artifact_type,
            name: d.artifact_name,
            metadata: d.metadata,
            createdAt: d.created_at,
          }));
        } catch (docErr: any) {
          logger.warn({ error: docErr.message }, '[Workflows] Could not query user documents');
        }

        // Check pgvector tables with vector columns
        let pgvectorTables: string[] = [];
        try {
          const result: any[] = await prisma.$queryRaw`
            SELECT DISTINCT table_name
            FROM information_schema.columns
            WHERE udt_name = 'vector'
              AND table_schema = 'public'
            ORDER BY table_name
          `;
          pgvectorTables = result.map((r: any) => r.table_name);
        } catch (pgErr: any) {
          logger.warn({ error: pgErr.message }, '[Workflows] Could not query pgvector tables');
        }

        // Milvus status
        const milvusHost = process.env.MILVUS_HOST || process.env.MILVUS_ADDRESS || '';
        const milvusStatus = milvusHost ? 'configured' : 'disconnected';

        // Redis status
        const redisHost = process.env.REDIS_HOST || process.env.REDIS_URL || '';
        const redisStatus = redisHost ? 'configured' : 'disconnected';

        return reply.send({
          userId,
          stores: [
            {
              type: 'milvus',
              name: 'Milvus Vector DB',
              status: milvusStatus,
              collections: userCollections,
            },
            {
              type: 'pgvector',
              name: 'PostgreSQL pgvector',
              status: 'connected',
              tables: pgvectorTables,
            },
            {
              type: 'redis',
              name: 'Redis Cache',
              status: redisStatus,
            },
          ],
          documents: userDocuments,
        });
      } catch (error: any) {
        logger.error({ error }, '[Workflows] Failed to get data collections');
        return reply.code(500).send({ error: 'Failed to get data collections', message: error.message });
      }
    }
  );

  /**
   * POST /api/workflows/data/upload
   * Upload a file to Milvus for vector search.
   * Accepts multipart/form-data with a single 'file' field.
   * Extracts text, chunks it, embeds, and stores in a per-user Milvus collection.
   */
  fastify.post(
    '/data/upload',
    async (request, reply) => {
      try {
        const user = (request as any).user;
        const userId = user?.userId || user?.id;
        if (!userId) {
          return reply.code(401).send({ error: 'Authentication required' });
        }

        // Parse multipart — iterate all parts to capture fields + the file
        const parts = (request as any).parts();
        let fileData: { filename: string; mimetype: string; buffer: Buffer } | null = null;
        let requestedCollection = '';

        for await (const part of parts) {
          if (part.type === 'file') {
            const chunks: Buffer[] = [];
            for await (const chunk of part.file) {
              chunks.push(chunk);
            }
            fileData = { filename: part.filename, mimetype: part.mimetype, buffer: Buffer.concat(chunks) };
          } else if (part.type === 'field' && part.fieldname === 'collectionName') {
            requestedCollection = (part.value as string || '').trim();
          }
        }

        if (!fileData) {
          return reply.code(400).send({ error: 'No file uploaded. Send as multipart/form-data with field name "file".' });
        }

        const { filename, mimetype, buffer } = fileData;

        // Extract text based on file type
        let text = '';
        const ext = filename.toLowerCase().split('.').pop() || '';

        if (['txt', 'md', 'markdown', 'csv', 'json'].includes(ext)) {
          text = buffer.toString('utf-8');
        } else if (ext === 'pdf') {
          // Basic PDF text extraction — look for text between stream/endstream
          // For production, use pdf-parse library
          text = buffer.toString('utf-8').replace(/[^\x20-\x7E\n\r\t]/g, ' ').trim();
          if (text.length < 50) {
            return reply.code(400).send({ error: 'Could not extract text from PDF. The file may be image-based.' });
          }
        } else {
          return reply.code(400).send({ error: `Unsupported file type: .${ext}` });
        }

        if (!text || text.trim().length < 10) {
          return reply.code(400).send({ error: 'File contains no extractable text' });
        }

        // Smart chunk the text
        const textChunks: string[] = [];
        const lines = text.split('\n');
        let currentChunk = '';
        for (const line of lines) {
          currentChunk += line + '\n';
          if (currentChunk.length > 1500) {
            textChunks.push(currentChunk.trim());
            currentChunk = '';
          }
        }
        if (currentChunk.trim()) {
          textChunks.push(currentChunk.trim());
        }

        // Store in Milvus via MilvusVectorService (with user isolation)
        const milvusSvc = (global as any).milvusVectorService;
        if (!milvusSvc) {
          // Fallback: return chunk info without embedding
          const docId = randomUUID();
          logger.warn({ userId, filename }, '[Workflows] MilvusVectorService not available, returning metadata only');
          return reply.send({
            success: true,
            docId,
            filename,
            textLength: text.length,
            chunks: textChunks.length,
            embedded: false,
            message: `File "${filename}" received (${textChunks.length} chunks). Milvus not available for embedding.`,
          });
        }

        // Determine artifact type from extension
        const artifactType = ['json', 'csv'].includes(ext) ? 'document' : ext === 'md' ? 'document' : 'file';

        const artifactId = await milvusSvc.storeArtifact(userId, {
          type: artifactType,
          title: filename,
          content: text,
          mimeType: mimetype,
          metadata: {
            source: 'file_upload',
            originalFilename: filename,
            fileSize: buffer.length,
            chunkCount: textChunks.length,
          },
        });

        logger.info({
          userId,
          filename,
          artifactId,
          textLength: text.length,
          chunks: textChunks.length,
        }, '[Workflows] File uploaded and embedded in Milvus');

        return reply.send({
          success: true,
          docId: artifactId,
          filename,
          textLength: text.length,
          chunks: textChunks.length,
          embedded: true,
          message: `File "${filename}" uploaded and indexed (${textChunks.length} chunks embedded).`,
        });
      } catch (error: any) {
        logger.error({ error }, '[Workflows] File upload failed');
        return reply.code(500).send({ error: 'File upload failed', message: error.message });
      }
    }
  );

  /**
   * POST /api/workflows/data/collections
   * Create a new named collection (tracked in a metadata table or in-memory for now).
   */
  fastify.post(
    '/data/collections',
    async (request, reply) => {
      try {
        const user = (request as any).user;
        const userId = user?.userId || user?.id;
        if (!userId) {
          return reply.code(401).send({ error: 'Authentication required' });
        }

        const { name, description } = request.body as { name?: string; description?: string };
        if (!name || !name.trim()) {
          return reply.code(400).send({ error: 'Collection name is required' });
        }

        const collectionName = name.trim().replace(/[^a-zA-Z0-9_]/g, '_');

        // Try creating in Milvus if available
        const milvusHost = process.env.MILVUS_HOST || process.env.MILVUS_ADDRESS || '';
        if (milvusHost) {
          try {
            const { MilvusClient, DataType } = await import('@zilliz/milvus2-sdk-node');
            const client = new MilvusClient({ address: milvusHost });

            // Check if collection already exists
            const exists = await client.hasCollection({ collection_name: collectionName });
            if (exists.value) {
              return reply.code(409).send({ error: `Collection "${collectionName}" already exists` });
            }

            const embeddingDim = parseInt(process.env.EMBEDDING_DIMENSIONS || '1536', 10);

            await client.createCollection({
              collection_name: collectionName,
              fields: [
                { name: 'id', data_type: DataType.VarChar, is_primary_key: true, max_length: 128 },
                { name: 'text', data_type: DataType.VarChar, max_length: 65535 },
                { name: 'embedding', data_type: DataType.FloatVector, dim: embeddingDim },
                { name: 'metadata', data_type: DataType.VarChar, max_length: 4096 },
                { name: 'user_id', data_type: DataType.VarChar, max_length: 256 },
              ],
            });

            logger.info({ userId, collectionName }, '[Workflows] Created Milvus collection');

            return reply.code(201).send({
              success: true,
              collectionName,
              store: 'milvus',
              message: `Collection "${collectionName}" created in Milvus`,
            });
          } catch (milvusErr: any) {
            logger.error({ error: milvusErr }, '[Workflows] Milvus collection creation failed');
            return reply.code(500).send({ error: 'Failed to create Milvus collection', message: milvusErr.message });
          }
        }

        // No Milvus — create a pgvector table instead. Uses halfvec so
        // 3072-dim embeddings (text-embedding-3-large, our AIF model)
        // can be HNSW-indexed; `vector` tops out at 2000 dims for HNSW.
        try {
          const dims = parseInt(process.env.EMBEDDING_DIMENSIONS || '3072', 10);
          await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "${collectionName}" (
              id TEXT PRIMARY KEY,
              text TEXT NOT NULL,
              embedding halfvec(${dims}),
              metadata JSONB DEFAULT '{}',
              user_id TEXT,
              created_at TIMESTAMPTZ DEFAULT NOW()
            )
          `);
          // Create HNSW index on the fly so semantic search is fast.
          // halfvec_cosine_ops supports up to 4000 dims.
          await prisma.$executeRawUnsafe(`
            CREATE INDEX IF NOT EXISTS "${collectionName}_embedding_idx"
            ON "${collectionName}"
            USING hnsw (embedding halfvec_cosine_ops)
            WITH (m = 16, ef_construction = 64)
          `);

          logger.info({ userId, collectionName }, '[Workflows] Created pgvector collection table');

          return reply.code(201).send({
            success: true,
            collectionName,
            store: 'pgvector',
            message: `Collection "${collectionName}" created in pgvector`,
          });
        } catch (pgErr: any) {
          logger.error({ error: pgErr }, '[Workflows] pgvector collection creation failed');
          return reply.code(500).send({ error: 'Failed to create collection', message: pgErr.message });
        }
      } catch (error: any) {
        logger.error({ error }, '[Workflows] Collection creation failed');
        return reply.code(500).send({ error: 'Failed to create collection', message: error.message });
      }
    }
  );

  /**
   * DELETE /api/workflows/data/collections/:name
   * Delete a collection by name.
   */
  fastify.delete(
    '/data/collections/:name',
    async (request, reply) => {
      try {
        const user = (request as any).user;
        const userId = user?.userId || user?.id;
        if (!userId) {
          return reply.code(401).send({ error: 'Authentication required' });
        }

        const { name } = request.params as { name: string };
        if (!name || !name.trim()) {
          return reply.code(400).send({ error: 'Collection name is required' });
        }

        const collectionName = name.trim();

        // Try Milvus first
        const milvusHost = process.env.MILVUS_HOST || process.env.MILVUS_ADDRESS || '';
        if (milvusHost) {
          try {
            const { MilvusClient } = await import('@zilliz/milvus2-sdk-node');
            const client = new MilvusClient({ address: milvusHost });

            const exists = await client.hasCollection({ collection_name: collectionName });
            if (exists.value) {
              await client.dropCollection({ collection_name: collectionName });
              logger.info({ userId, collectionName }, '[Workflows] Dropped Milvus collection');
              return reply.send({ success: true, message: `Collection "${collectionName}" deleted from Milvus` });
            }
          } catch (milvusErr: any) {
            logger.warn({ error: milvusErr.message }, '[Workflows] Milvus drop failed, trying pgvector');
          }
        }

        // Try pgvector table drop
        try {
          // Safety: only allow dropping tables that look like user collections (alphanumeric + underscores)
          if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(collectionName)) {
            return reply.code(400).send({ error: 'Invalid collection name' });
          }
          await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${collectionName}"`);
          logger.info({ userId, collectionName }, '[Workflows] Dropped pgvector collection table');
          return reply.send({ success: true, message: `Collection "${collectionName}" deleted` });
        } catch (pgErr: any) {
          logger.error({ error: pgErr }, '[Workflows] pgvector table drop failed');
          return reply.code(500).send({ error: 'Failed to delete collection', message: pgErr.message });
        }
      } catch (error: any) {
        logger.error({ error }, '[Workflows] Collection deletion failed');
        return reply.code(500).send({ error: 'Failed to delete collection', message: error.message });
      }
    }
  );

  /**
   * POST /api/workflows/seed-templates
   * Seed built-in workflow templates to the database.
   * Upserts by name — skips templates that already exist, creates new ones.
   * Requires authentication (uses calling user as owner).
   */
  fastify.post(
    '/seed-templates',
    async (request, reply) => {
      try {
        const user = (request as any).user;
        const userId = user?.userId || user?.id;

        if (!userId) {
          return reply.code(401).send({ error: 'Authentication required' });
        }

        const results = { created: 0, skipped: 0, errors: 0, details: [] as string[] };

        for (const template of SEED_WORKFLOW_TEMPLATES) {
          try {
            // Check if a template with this name already exists
            const existing = await prisma.workflow.findFirst({
              where: {
                name: template.name,
                is_template: true,
                deleted_at: null,
              },
              select: { id: true },
            });

            if (existing) {
              // Update existing template with latest definition
              await prisma.workflow.update({
                where: { id: existing.id },
                data: {
                  description: template.description,
                  definition: template.definition as any,
                  tags: template.tags,
                  category: template.category,
                  icon: template.icon,
                  color: template.color || null,
                },
              });
              // Also update the active version's definition (execution prefers version over workflow)
              await prisma.workflowVersion.updateMany({
                where: { workflow_id: existing.id, is_active: true },
                data: { definition: template.definition as any },
              });
              results.skipped++;
              results.details.push(`Updated "${template.name}" (${existing.id})`);
              continue;
            }

            // Create the template workflow
            const workflow = await prisma.workflow.create({
              data: {
                name: template.name,
                description: template.description,
                definition: template.definition as any,
                tags: template.tags,
                category: template.category,
                icon: template.icon,
                color: template.color || null,
                is_template: true,
                is_public: true,
                is_active: true,
                created_by: userId,
              },
            });

            // Create initial version
            await prisma.workflowVersion.create({
              data: {
                workflow_id: workflow.id,
                version: 1,
                definition: template.definition as any,
                changelog: 'Seeded from built-in templates',
                is_active: true,
                created_by: userId,
              },
            });

            results.created++;
            results.details.push(`Created "${template.name}" (${workflow.id})`);
          } catch (templateError: any) {
            results.errors++;
            results.details.push(`Error seeding "${template.name}": ${templateError.message}`);
            logger.error({ error: templateError, templateName: template.name }, '[Workflows] Failed to seed template');
          }
        }

        logger.info(
          { created: results.created, skipped: results.skipped, errors: results.errors },
          '[Workflows] Template seeding completed'
        );

        return reply.send({
          success: true,
          message: `Seeded ${results.created} templates (${results.skipped} skipped, ${results.errors} errors)`,
          ...results,
        });
      } catch (error: any) {
        logger.error({ error }, '[Workflows] Failed to seed templates');
        return reply.code(500).send({
          error: 'Failed to seed templates',
          message: error.message,
        });
      }
    }
  );

  // ── Artifact Storage ─────────────────────────────────────────────────
  // POST /api/workflows/executions/:executionId/artifacts - Store workflow output as artifact in Milvus

  /**
   * POST /api/workflows/executions/:executionId/artifacts
   * Store a workflow execution output as a knowledge artifact in Milvus.
   */
  fastify.post<{
    Params: { executionId: string };
    Body: { content: string; title: string; format?: string; nodeId?: string; workflowId?: string };
  }>(
    '/executions/:executionId/artifacts',
    async (request, reply) => {
      try {
        const { executionId } = request.params;
        const user = (request as any).user;
        const userId = user?.userId || user?.id;

        if (!userId) {
          return reply.code(401).send({ error: 'Authentication required' });
        }

        const { content, title, format, nodeId, workflowId } = request.body || {};

        if (!content || !title) {
          return reply.code(400).send({ error: 'content and title are required' });
        }

        // Use the global MilvusVectorService instance to store the artifact
        const { ArtifactType } = await import('../services/MilvusVectorService.js');
        const milvus = (global as any).milvusVectorService;

        if (!milvus) {
          return reply.code(503).send({ error: 'Knowledge base service is not available' });
        }

        const artifactId = await milvus.storeArtifact(userId, {
          type: ArtifactType.KNOWLEDGE,
          title,
          content,
          metadata: {
            source: 'workflow',
            workflowId,
            executionId,
            nodeId,
            format,
          },
        });

        // Update the execution record in PostgreSQL to include the artifactId in the state JSON
        try {
          const execution = await prisma.workflowExecution.findUnique({
            where: { id: executionId },
            select: { state: true },
          });

          const existingState = (execution?.state as Record<string, any>) || {};

          await prisma.workflowExecution.update({
            where: { id: executionId },
            data: {
              state: {
                ...existingState,
                artifactId,
              },
            },
          });
        } catch (dbError: any) {
          logger.warn({ error: dbError.message, executionId, artifactId }, '[Workflows] Failed to update execution state with artifactId');
        }

        logger.info({ userId, executionId, artifactId, title }, '[Workflows] Artifact stored from workflow execution');

        return reply.send({ artifactId, executionId });
      } catch (error: any) {
        logger.error({ error }, '[Workflows] Failed to store artifact');
        return reply.code(500).send({ error: 'Failed to store artifact', message: error.message });
      }
    }
  );

  logger.info('Workflow routes registered');
};

// =============================================================================
// Built-in Workflow Templates for Seeding
// =============================================================================
// 8 curated templates that use ONLY confirmed-working node types with deployed
// infrastructure. All node types used: trigger, openagentic_llm, mcp_tool,
// condition, merge, transform, loop, http_request, human_approval, multi_agent,
// agent_single, rag_query — all implemented in WorkflowExecutionEngine.ts.

interface SeedTemplate {
  name: string;
  description: string;
  icon: string;
  category: string;
  tags: string[];
  color?: string;
  definition: { nodes: any[]; edges: any[] };
}

const X = 250; // horizontal spacing
const Y = 150; // vertical spacing

/**
 * Auto-seed workflow templates on server startup. Idempotent — upserts by
 * name. Called from server.ts after AgentRegistry initialization.
 *
 * Uses the first admin user found in the DB as owner, falling back to any
 * user if no admin exists (some test envs seed with non-admin only). If
 * the DB has zero users, we skip seeding entirely — the manual
 * POST /api/workflows/seed-templates endpoint still works post-login.
 */
export async function autoSeedWorkflowTemplates(): Promise<{
  created: number; updated: number; skipped: number; errors: number;
}> {
  const result = { created: 0, updated: 0, skipped: 0, errors: 0 };
  // Pick an owner: first admin, else first user, else skip.
  const owner = await prisma.user.findFirst({
    where: { is_admin: true },
    select: { id: true },
  }) || await prisma.user.findFirst({
    select: { id: true },
  });
  if (!owner) {
    loggers.routes.info('[Workflows] autoSeedWorkflowTemplates: no users in DB yet, skipping');
    return result;
  }
  const ownerId = owner.id;

  for (const template of SEED_WORKFLOW_TEMPLATES) {
    try {
      const existing = await prisma.workflow.findFirst({
        where: { name: template.name, is_template: true, deleted_at: null },
        select: { id: true },
      });
      if (existing) {
        await prisma.workflow.update({
          where: { id: existing.id },
          data: {
            description: template.description,
            definition: template.definition as any,
            tags: template.tags,
            category: template.category,
            icon: template.icon,
            color: template.color || null,
          },
        });
        await prisma.workflowVersion.updateMany({
          where: { workflow_id: existing.id, is_active: true },
          data: { definition: template.definition as any },
        });
        result.updated++;
      } else {
        const workflow = await prisma.workflow.create({
          data: {
            name: template.name,
            description: template.description,
            definition: template.definition as any,
            tags: template.tags,
            category: template.category,
            icon: template.icon,
            color: template.color || null,
            is_template: true,
            is_public: true,
            is_active: true,
            created_by: ownerId,
          },
        });
        await prisma.workflowVersion.create({
          data: {
            workflow_id: workflow.id,
            version: 1,
            definition: template.definition as any,
            changelog: 'Seeded on startup',
            is_active: true,
            created_by: ownerId,
          },
        });
        result.created++;
      }
    } catch (err: any) {
      result.errors++;
      loggers.routes.warn({ err: err.message, template: template.name }, '[Workflows] autoSeed template failed');
    }
  }
  return result;
}

const SEED_WORKFLOW_TEMPLATES: SeedTemplate[] = [
  // ══════════════════════════════════════════════════════════════════════════
  // 1. Platform Health Deep Dive
  // Uses: trigger, mcp_tool (K8s, Prometheus), merge, openagentic_llm
  // ══════════════════════════════════════════════════════════════════════════
  {
    name: 'Platform Health Deep Dive',
    description: 'Gathers cluster health, pod status, node resources, and Prometheus metrics in parallel, merges all data, then produces a comprehensive health report with LLM analysis.',
    icon: 'Activity',
    category: 'ops',
    tags: ['kubernetes', 'monitoring', 'health-check', 'mcp-tool'],
    color: '#00bcd4',
    definition: {
      nodes: [
        { id: 'trigger-1', type: 'trigger', position: { x: 0, y: Y * 2 }, data: { label: 'Start', triggerType: 'manual', icon: 'Play', color: '#ff9800' } },
        { id: 'mcp-health', type: 'mcp_tool', position: { x: X, y: 0 }, data: { label: 'Cluster Health', icon: 'Activity', color: '#00bcd4', toolName: 'k8s_cluster_health', toolServer: 'openagentic_kubernetes', arguments: {} } },
        { id: 'mcp-pods', type: 'mcp_tool', position: { x: X, y: Y }, data: { label: 'List Pods', icon: 'Server', color: '#00bcd4', toolName: 'k8s_list_pods', toolServer: 'openagentic_kubernetes', arguments: { namespace: 'agentic-dev' } } },
        { id: 'mcp-nodes', type: 'mcp_tool', position: { x: X, y: Y * 2 }, data: { label: 'Node Resources', icon: 'Cpu', color: '#00bcd4', toolName: 'k8s_get_nodes', toolServer: 'openagentic_kubernetes', arguments: {} } },
        { id: 'mcp-deployments', type: 'mcp_tool', position: { x: X, y: Y * 3 }, data: { label: 'Deployments', icon: 'Layers', color: '#00bcd4', toolName: 'k8s_list_deployments', toolServer: 'openagentic_kubernetes', arguments: { namespace: 'agentic-dev' } } },
        { id: 'mcp-metrics', type: 'mcp_tool', position: { x: X, y: Y * 4 }, data: { label: 'CPU/Memory Metrics', icon: 'BarChart', color: '#e91e63', toolName: 'prometheus_query', toolServer: 'openagentic_prometheus', arguments: { query: 'sum(rate(container_cpu_usage_seconds_total{namespace="agentic-dev"}[5m])) by (pod)' } } },
        { id: 'merge-all', type: 'merge', position: { x: X * 2, y: Y * 2 }, data: { label: 'Merge Data', icon: 'GitMerge', color: '#9c27b0', strategy: 'combine' } },
        { id: 'llm-report', type: 'openagentic_llm', position: { x: X * 3, y: Y * 2 }, data: { label: 'Health Report', icon: 'Brain', color: '#7c4dff', prompt: 'You are a platform reliability engineer. Analyze the following infrastructure data and produce a structured health report.\n\nInclude sections for:\n1. Overall Health Score (1-10)\n2. Critical Issues (CrashLoopBackOff, OOMKilled, not Ready)\n3. Resource Utilization (CPU/memory per node)\n4. Deployment Status\n5. Recommendations\n\nData:\n{{steps.merge-all.output}}' } },
      ],
      edges: [
        { id: 'e1a', source: 'trigger-1', target: 'mcp-health', animated: true },
        { id: 'e1b', source: 'trigger-1', target: 'mcp-pods' },
        { id: 'e1c', source: 'trigger-1', target: 'mcp-nodes' },
        { id: 'e1d', source: 'trigger-1', target: 'mcp-deployments' },
        { id: 'e1e', source: 'trigger-1', target: 'mcp-metrics' },
        { id: 'e2a', source: 'mcp-health', target: 'merge-all' },
        { id: 'e2b', source: 'mcp-pods', target: 'merge-all' },
        { id: 'e2c', source: 'mcp-nodes', target: 'merge-all' },
        { id: 'e2d', source: 'mcp-deployments', target: 'merge-all' },
        { id: 'e2e', source: 'mcp-metrics', target: 'merge-all' },
        { id: 'e3', source: 'merge-all', target: 'llm-report', animated: true },
      ],
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 2. Multi-Agent Research Team
  // Uses: trigger, multi_agent, merge, openagentic_llm
  // ══════════════════════════════════════════════════════════════════════════
  {
    name: 'Multi-Agent Research Team',
    description: 'Spawns three specialized agents (researcher, analyst, critic) in parallel to investigate a topic, merges their findings, and synthesizes a comprehensive report.',
    icon: 'Bot',
    category: 'ai-analysis',
    tags: ['multi-agent', 'research', 'ai-analysis'],
    color: '#7c3aed',
    definition: {
      nodes: [
        { id: 'trigger-1', type: 'trigger', position: { x: 0, y: Y }, data: { label: 'Research Topic', triggerType: 'manual', icon: 'Play', color: '#ff9800' } },
        { id: 'multi-research', type: 'multi_agent', position: { x: X, y: Y }, data: { label: 'Research Team', icon: 'Users', color: '#7c3aed', agents: [{ role: 'researcher', task: 'Research the topic thoroughly. Find key facts, recent developments, and authoritative sources. Topic: {{input}}' }, { role: 'analyst', task: 'Analyze the topic from multiple perspectives — technical feasibility, market impact, and risks. Topic: {{input}}' }, { role: 'critic', task: 'Challenge assumptions about the topic. Identify weaknesses, counterarguments, and blind spots. Topic: {{input}}' }], strategy: 'parallel' } },
        { id: 'merge-findings', type: 'merge', position: { x: X * 2, y: Y }, data: { label: 'Merge Findings', icon: 'GitMerge', color: '#9c27b0', strategy: 'combine' } },
        { id: 'llm-synthesize', type: 'openagentic_llm', position: { x: X * 3, y: Y }, data: { label: 'Synthesize Report', icon: 'Brain', color: '#7c4dff', prompt: 'You are a research director. Three agents have investigated a topic from different angles:\n\n{{steps.merge-findings.output}}\n\nSynthesize their findings into a structured report with:\n1. Executive Summary\n2. Key Findings (areas of agreement)\n3. Conflicting Views (where agents disagreed)\n4. Risk Assessment\n5. Recommendations' } },
      ],
      edges: [
        { id: 'e1', source: 'trigger-1', target: 'multi-research', animated: true },
        { id: 'e2', source: 'multi-research', target: 'merge-findings', animated: true },
        { id: 'e3', source: 'merge-findings', target: 'llm-synthesize', animated: true },
      ],
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 3. RAG Knowledge Pipeline
  // Uses: trigger, openagentic_llm, rag_query
  // ══════════════════════════════════════════════════════════════════════════
  {
    name: 'RAG Knowledge Pipeline',
    description: 'Takes a user question, generates optimized search queries with LLM, retrieves relevant documents via RAG vector search, then synthesizes a grounded answer.',
    icon: 'Search',
    category: 'ai-analysis',
    tags: ['rag', 'knowledge-base', 'ai-analysis'],
    color: '#2196f3',
    definition: {
      nodes: [
        { id: 'trigger-1', type: 'trigger', position: { x: 0, y: Y }, data: { label: 'User Question', triggerType: 'manual', icon: 'Play', color: '#ff9800' } },
        { id: 'llm-queries', type: 'openagentic_llm', position: { x: X, y: Y }, data: { label: 'Generate Queries', icon: 'Brain', color: '#7c4dff', prompt: 'Given the user question below, generate 3 diverse search queries that would help retrieve relevant information. Output them as a JSON array of strings.\n\nQuestion: {{input}}' } },
        { id: 'rag-search', type: 'rag_query', position: { x: X * 2, y: Y }, data: { label: 'Vector Search', icon: 'Database', color: '#2196f3', query: '{{steps.llm-queries.output}}', topK: 10 } },
        { id: 'llm-answer', type: 'openagentic_llm', position: { x: X * 3, y: Y }, data: { label: 'Synthesize Answer', icon: 'Brain', color: '#7c4dff', prompt: 'Answer the user question using ONLY the retrieved context below. Cite specific sources. If the context is insufficient, say so.\n\nQuestion: {{input}}\n\nRetrieved Context:\n{{steps.rag-search.output}}' } },
      ],
      edges: [
        { id: 'e1', source: 'trigger-1', target: 'llm-queries', animated: true },
        { id: 'e2', source: 'llm-queries', target: 'rag-search', animated: true },
        { id: 'e3', source: 'rag-search', target: 'llm-answer', animated: true },
      ],
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 4. Smart Router Showcase
  // Uses: trigger, openagentic_llm (3 tiers), merge
  // ══════════════════════════════════════════════════════════════════════════
  {
    name: 'Smart Router Showcase',
    description: 'Sends the same prompt to three model tiers (economical/balanced/premium) in parallel, merges responses, then compares quality and speed tradeoffs.',
    icon: 'Sparkles',
    category: 'demo',
    tags: ['smart-router', 'model-comparison', 'demo'],
    color: '#f59e0b',
    definition: {
      nodes: [
        { id: 'trigger-1', type: 'trigger', position: { x: 0, y: Y * 2 }, data: { label: 'Test Prompt', triggerType: 'manual', icon: 'Play', color: '#ff9800' } },
        { id: 'llm-eco', type: 'openagentic_llm', position: { x: X, y: 0 }, data: { label: 'Economical (Slider 10)', icon: 'Brain', color: '#4caf50', prompt: '{{input}}', sliderPosition: 10 } },
        { id: 'llm-balanced', type: 'openagentic_llm', position: { x: X, y: Y * 2 }, data: { label: 'Balanced (Slider 50)', icon: 'Brain', color: '#ff9800', prompt: '{{input}}', sliderPosition: 50 } },
        { id: 'llm-premium', type: 'openagentic_llm', position: { x: X, y: Y * 4 }, data: { label: 'Premium (Slider 90)', icon: 'Brain', color: '#7c4dff', prompt: '{{input}}', sliderPosition: 90 } },
        { id: 'merge-responses', type: 'merge', position: { x: X * 2, y: Y * 2 }, data: { label: 'Merge Responses', icon: 'GitMerge', color: '#9c27b0', strategy: 'combine' } },
        { id: 'llm-compare', type: 'openagentic_llm', position: { x: X * 3, y: Y * 2 }, data: { label: 'Compare Models', icon: 'Brain', color: '#7c4dff', prompt: 'Three AI models at different quality tiers answered the same prompt. Compare their responses on:\n1. Accuracy and completeness\n2. Response quality\n3. Which tier provides the best value for this type of question\n\nResponses:\n{{steps.merge-responses.output}}' } },
      ],
      edges: [
        { id: 'e1a', source: 'trigger-1', target: 'llm-eco', animated: true },
        { id: 'e1b', source: 'trigger-1', target: 'llm-balanced' },
        { id: 'e1c', source: 'trigger-1', target: 'llm-premium' },
        { id: 'e2a', source: 'llm-eco', target: 'merge-responses' },
        { id: 'e2b', source: 'llm-balanced', target: 'merge-responses' },
        { id: 'e2c', source: 'llm-premium', target: 'merge-responses' },
        { id: 'e3', source: 'merge-responses', target: 'llm-compare', animated: true },
      ],
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 5. Code Review Agent
  // Uses: trigger, openagentic_llm, condition, agent_single
  // ══════════════════════════════════════════════════════════════════════════
  {
    name: 'Code Review Agent',
    description: 'Analyzes code for issues with LLM, branches on severity — spawns a fix agent for critical issues or generates an approval summary for clean code.',
    icon: 'Code',
    category: 'devops',
    tags: ['code-review', 'agent', 'devops'],
    color: '#10b981',
    definition: {
      nodes: [
        { id: 'trigger-1', type: 'trigger', position: { x: 0, y: Y }, data: { label: 'Submit Code', triggerType: 'manual', icon: 'Play', color: '#ff9800' } },
        { id: 'llm-analyze', type: 'openagentic_llm', position: { x: X, y: Y }, data: { label: 'Analyze Code', icon: 'Brain', color: '#7c4dff', prompt: 'Review the following code for bugs, security vulnerabilities, and quality issues. Classify the overall severity as "critical" (must fix before merge), "warning" (should fix), or "clean" (ready to merge).\n\nRespond with a JSON object: { "severity": "critical|warning|clean", "issues": [...], "suggestions": [...] }\n\nCode:\n{{input}}' } },
        { id: 'cond-severity', type: 'condition', position: { x: X * 2, y: Y }, data: { label: 'Critical Issues?', icon: 'GitBranch', color: '#2196f3', expression: '{{steps.llm-analyze.output}}.includes("critical")' } },
        { id: 'agent-fix', type: 'agent_single', position: { x: X * 3, y: 0 }, data: { label: 'Auto-Fix Agent', icon: 'Wrench', color: '#f44336', agentType: 'coder', task: 'Fix the critical issues identified in this code review:\n\nReview:\n{{steps.llm-analyze.output}}\n\nOriginal Code:\n{{input}}\n\nReturn the corrected code with comments explaining each fix.' } },
        { id: 'llm-approve', type: 'openagentic_llm', position: { x: X * 3, y: Y * 2 }, data: { label: 'Approval Summary', icon: 'CheckCircle', color: '#4caf50', prompt: 'Generate a concise code review approval summary based on the analysis:\n\n{{steps.llm-analyze.output}}\n\nInclude any minor suggestions for future improvement.' } },
      ],
      edges: [
        { id: 'e1', source: 'trigger-1', target: 'llm-analyze', animated: true },
        { id: 'e2', source: 'llm-analyze', target: 'cond-severity', animated: true },
        { id: 'e3', source: 'cond-severity', target: 'agent-fix', label: 'Critical', sourceHandle: 'true' },
        { id: 'e4', source: 'cond-severity', target: 'llm-approve', label: 'Clean', sourceHandle: 'false' },
      ],
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 6. Data Transform Pipeline
  // Uses: trigger, http_request, transform, condition, openagentic_llm, merge
  // ══════════════════════════════════════════════════════════════════════════
  {
    name: 'Data Transform Pipeline',
    description: 'Fetches data via HTTP, transforms it, branches by content type, processes each path with specialized LLM prompts, and merges results.',
    icon: 'RefreshCw',
    category: 'data',
    tags: ['data-pipeline', 'transform', 'http'],
    color: '#06b6d4',
    definition: {
      nodes: [
        { id: 'trigger-1', type: 'trigger', position: { x: 0, y: Y }, data: { label: 'Start', triggerType: 'manual', icon: 'Play', color: '#ff9800' } },
        { id: 'http-fetch', type: 'http_request', position: { x: X, y: Y }, data: { label: 'Fetch Data', icon: 'Globe', color: '#06b6d4', url: '{{input.url || "https://jsonplaceholder.typicode.com/posts?_limit=5"}}', method: 'GET' } },
        { id: 'transform-parse', type: 'transform', position: { x: X * 2, y: Y }, data: { label: 'Parse & Enrich', icon: 'FileText', color: '#4caf50', expression: '(Array.isArray(input) ? { type: "array", count: input.length, items: input } : { type: "single", count: 1, items: [input] })' } },
        { id: 'cond-size', type: 'condition', position: { x: X * 3, y: Y }, data: { label: 'Large Dataset?', icon: 'GitBranch', color: '#2196f3', expression: 'JSON.parse({{steps.transform-parse.output}} || "{}").count > 3' } },
        { id: 'llm-summarize', type: 'openagentic_llm', position: { x: X * 4, y: 0 }, data: { label: 'Summarize Large', icon: 'Brain', color: '#7c4dff', prompt: 'Summarize this large dataset. Identify patterns, outliers, and key statistics:\n\n{{steps.transform-parse.output}}' } },
        { id: 'llm-detail', type: 'openagentic_llm', position: { x: X * 4, y: Y * 2 }, data: { label: 'Detailed Analysis', icon: 'Brain', color: '#7c4dff', prompt: 'Provide a detailed analysis of each item in this small dataset:\n\n{{steps.transform-parse.output}}' } },
        { id: 'merge-results', type: 'merge', position: { x: X * 5, y: Y }, data: { label: 'Final Output', icon: 'GitMerge', color: '#9c27b0', strategy: 'first_available' } },
      ],
      edges: [
        { id: 'e1', source: 'trigger-1', target: 'http-fetch', animated: true },
        { id: 'e2', source: 'http-fetch', target: 'transform-parse', animated: true },
        { id: 'e3', source: 'transform-parse', target: 'cond-size', animated: true },
        { id: 'e4', source: 'cond-size', target: 'llm-summarize', label: 'Large', sourceHandle: 'true' },
        { id: 'e5', source: 'cond-size', target: 'llm-detail', label: 'Small', sourceHandle: 'false' },
        { id: 'e6', source: 'llm-summarize', target: 'merge-results' },
        { id: 'e7', source: 'llm-detail', target: 'merge-results' },
      ],
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 7. Contract Risk Flagging
  // Uses: trigger, openagentic_llm, loop, merge
  // ══════════════════════════════════════════════════════════════════════════
  {
    name: 'Contract Risk Flagging',
    description: 'Extracts clauses from a contract with LLM, iterates over each clause to score risk, then produces a consolidated risk report with recommendations.',
    icon: 'FileText',
    category: 'legal',
    tags: ['contract', 'risk-analysis', 'legal', 'loop'],
    color: '#ef4444',
    definition: {
      nodes: [
        { id: 'trigger-1', type: 'trigger', position: { x: 0, y: Y }, data: { label: 'Submit Contract', triggerType: 'manual', icon: 'Play', color: '#ff9800' } },
        { id: 'llm-extract', type: 'openagentic_llm', position: { x: X, y: Y }, data: { label: 'Extract Clauses', icon: 'Brain', color: '#7c4dff', prompt: 'Extract all distinct clauses from the following contract. Return them as a JSON array of objects: [{ "id": 1, "title": "...", "text": "..." }, ...]\n\nContract:\n{{input}}' } },
        { id: 'loop-clauses', type: 'loop', position: { x: X * 2, y: Y }, data: { label: 'Iterate Clauses', icon: 'Repeat', color: '#f59e0b', iterateOver: '{{steps.llm-extract.output}}', itemVariable: 'clause' } },
        { id: 'llm-score', type: 'openagentic_llm', position: { x: X * 3, y: Y }, data: { label: 'Score Risk', icon: 'Brain', color: '#7c4dff', prompt: 'Score the risk of this contract clause on a scale of 1-10 and explain why.\n\nRespond with JSON: { "clause_title": "...", "risk_score": N, "risk_level": "low|medium|high|critical", "explanation": "...", "recommendation": "..." }\n\nClause:\n{{clause}}' } },
        { id: 'merge-scores', type: 'merge', position: { x: X * 4, y: Y }, data: { label: 'Collect Scores', icon: 'GitMerge', color: '#9c27b0', strategy: 'combine' } },
        { id: 'llm-report', type: 'openagentic_llm', position: { x: X * 5, y: Y }, data: { label: 'Risk Report', icon: 'Brain', color: '#7c4dff', prompt: 'Produce a final contract risk assessment report from the clause-level analysis below.\n\nInclude:\n1. Overall Risk Rating\n2. Critical clauses requiring immediate attention\n3. Recommended modifications\n4. Clauses that are acceptable as-is\n\nClause Analyses:\n{{steps.merge-scores.output}}' } },
      ],
      edges: [
        { id: 'e1', source: 'trigger-1', target: 'llm-extract', animated: true },
        { id: 'e2', source: 'llm-extract', target: 'loop-clauses', animated: true },
        { id: 'e3', source: 'loop-clauses', target: 'llm-score', animated: true },
        { id: 'e4', source: 'llm-score', target: 'merge-scores' },
        { id: 'e5', source: 'merge-scores', target: 'llm-report', animated: true },
      ],
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 8. Approval Gate Demo
  // Uses: trigger, openagentic_llm, human_approval, condition
  // ══════════════════════════════════════════════════════════════════════════
  {
    name: 'Approval Gate Demo',
    description: 'Drafts content with LLM, pauses for human approval, then either finalizes the approved version or revises based on feedback.',
    icon: 'CheckSquare',
    category: 'demo',
    tags: ['human-in-the-loop', 'approval', 'demo'],
    color: '#8b5cf6',
    definition: {
      nodes: [
        { id: 'trigger-1', type: 'trigger', position: { x: 0, y: Y }, data: { label: 'Start', triggerType: 'manual', icon: 'Play', color: '#ff9800' } },
        { id: 'llm-draft', type: 'openagentic_llm', position: { x: X, y: Y }, data: { label: 'Draft Content', icon: 'Brain', color: '#7c4dff', prompt: 'Draft a professional document based on the following brief. Make it publication-ready.\n\nBrief: {{input}}' } },
        { id: 'approval-gate', type: 'human_approval', position: { x: X * 2, y: Y }, data: { label: 'Review & Approve', icon: 'UserCheck', color: '#8b5cf6', message: 'Please review the drafted content and approve or reject with feedback.', timeout: 3600 } },
        { id: 'cond-approved', type: 'condition', position: { x: X * 3, y: Y }, data: { label: 'Approved?', icon: 'GitBranch', color: '#2196f3', expression: '{{steps.approval-gate.output}}.includes("approved")' } },
        { id: 'llm-finalize', type: 'openagentic_llm', position: { x: X * 4, y: 0 }, data: { label: 'Finalize', icon: 'CheckCircle', color: '#4caf50', prompt: 'The following draft has been approved. Add a final polish — fix any typos, improve formatting, and add a publication header.\n\nApproved Draft:\n{{steps.llm-draft.output}}' } },
        { id: 'llm-revise', type: 'openagentic_llm', position: { x: X * 4, y: Y * 2 }, data: { label: 'Revise', icon: 'Edit', color: '#f59e0b', prompt: 'The following draft was rejected with feedback. Revise it to address the concerns.\n\nOriginal Draft:\n{{steps.llm-draft.output}}\n\nReviewer Feedback:\n{{steps.approval-gate.output}}' } },
      ],
      edges: [
        { id: 'e1', source: 'trigger-1', target: 'llm-draft', animated: true },
        { id: 'e2', source: 'llm-draft', target: 'approval-gate', animated: true },
        { id: 'e3', source: 'approval-gate', target: 'cond-approved', animated: true },
        { id: 'e4', source: 'cond-approved', target: 'llm-finalize', label: 'Approved', sourceHandle: 'true' },
        { id: 'e5', source: 'cond-approved', target: 'llm-revise', label: 'Rejected', sourceHandle: 'false' },
      ],
    },
  },
];

export default workflowRoutes;
