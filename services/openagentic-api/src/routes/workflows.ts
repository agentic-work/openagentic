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
import { getInternalKey } from '../utils/internalKeyReader.js';
import { reportLocalEngineFallback } from '../services/workflowServiceUrlGuard.js';

/**
 * Build the s2s headers used when this api proxies to the workflows-service.
 * The workflows-service rejects calls without a valid internal-key (P0a fix).
 */
function workflowServiceHeaders(extra: Record<string, string | undefined> = {}): Record<string, string> {
  const internalKey = getInternalKey();
  const out: Record<string, string> = {};
  if (internalKey) out['Authorization'] = `Bearer ${internalKey}`;
  for (const [k, v] of Object.entries(extra)) {
    if (typeof v === 'string' && v.length > 0) out[k] = v;
  }
  return out;
}
// Phase B (#15): the in-process executeWorkflow + ExecutionEvent are
// being retired. Proxy goes to workflows-svc; ExecutionEvent type comes
// from the shared package. abortWorkflowExecution stays for now — a
// /abort endpoint on workflows-svc is follow-up work; today the local-
// fallback else branches are the only callers that resolve to a
// local-engine instance to abort.
import { executeViaWorkflowsService as executeWorkflow } from '../services/executeViaWorkflowsService.js';
import { submitDataRequestViaWorkflowsService } from '../services/resumeViaWorkflowsService.js';
import { fireWorkflowFinishedSubscribers } from '../services/workflowFinishedSubscriptions.js';
import { resolveExecuteTenantId } from './helpers/resolveExecuteTenantId.js';
import { abortWorkflowExecution } from '../services/WorkflowExecutionEngine.js';
import type { ExecutionEvent } from '@openagentic/workflow-engine';
import { deriveFlowToolSchema } from '@openagentic/workflow-engine';
import { subscribeAgentProgressForFlowsStream } from '../services/workflowAgentProgressBridge.js';
import { WorkflowCompiler } from '../services/WorkflowCompiler.js';
import { randomUUID, createHash, randomBytes } from 'crypto';
import bcrypt from 'bcrypt';
import axios from 'axios';
import { getRedisClient } from '../utils/redis-client.js';
import { ndjsonHeaders, writeNDJSON, createSSEToNDJSONTranslator } from '../infra/ndjson.js';
import { getNodeSchemasProxyService } from '../services/NodeSchemasProxyService.js';
import { featureFlags } from '../config/featureFlags.js';

const workflowCompiler = new WorkflowCompiler();

// Workflow execution service URL — when available, execution is proxied to the dedicated service.
// Phase A: when unset, log a loud warn at module load so the misconfig is
// surfaced (a deployed-but-unrouted workflows pod would otherwise sit idle
// without anyone noticing). Phase B will fail-fast.
const WORKFLOW_SERVICE_URL = process.env.WORKFLOW_SERVICE_URL || '';
if (!WORKFLOW_SERVICE_URL) {
  loggers.server.warn(
    {},
    '[Workflows] WORKFLOW_SERVICE_URL is not set — every workflow execution will fall back to the in-process engine. Set WORKFLOW_SERVICE_URL=http://openagentic-workflows:3400 (or equivalent) to route to the dedicated pod. Phase B of the decoupling will turn this into a startup error.',
  );
}

// Enterprise template definitions removed (OSS edition ships general-purpose
// templates only; cloud/aiops template packs are enterprise-only).

// Helper to transform workflow from DB schema to API response format.
// 2026-04-19 (task #144) — strip legacy `intelligenceLevel` and
// `sliderPosition` / `sliderOverride` fields from node data on the way
// out. Existing flows were saved with these; the UI no longer renders
// them and the executor ignores them, but we drop them from the wire
// so old saved-flows look clean in the editor without a DB migration.
function stripLegacySliderFields(nodes: any[]): any[] {
  if (!Array.isArray(nodes)) return nodes;
  return nodes.map((n) => {
    if (!n?.data) return n;
    const { intelligenceLevel, sliderPosition, sliderOverride, ...cleanData } = n.data;
    return { ...n, data: cleanData };
  });
}

function transformWorkflow(workflow: any) {
  const definition = workflow.definition as any || {};
  // settings.meta carries the human-readable template legend block
  // authored in seed/templates/*.json (purpose / how_it_works /
  // expected_output / useful_when / tools_used / version / tags).
  // Surface it as a top-level `meta` so UI gallery cards + canvas-side
  // 'About this workflow' panel can render it without digging into
  // settings.
  const settings = (workflow.settings as Record<string, any> | null | undefined) || {};
  const meta = settings.meta ?? null;
  // Slug lives at meta.slug per the templateSeeder contract (the seeder
  // copies tpl.slug from seed/templates/<slug>.json into settings.meta.slug).
  // Surface it as a top-level field so the UI can deep-link by slug.
  const slug = meta && typeof meta.slug === 'string' ? meta.slug : null;
  return {
    id: workflow.id,
    user_id: workflow.created_by,
    name: workflow.name,
    slug,
    description: workflow.description,
    nodes: stripLegacySliderFields(definition.nodes || []),
    edges: definition.edges || [],
    status: workflow.is_active ? 'active' : 'draft',
    is_public: workflow.is_public || false,
    is_template: workflow.is_template || false,
    tags: workflow.tags || [],
    category: workflow.category,
    icon: workflow.icon,
    color: workflow.color,
    meta,
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
   * GET /api/workflows/internal/node-schemas
   *
   * Proxy to the openagentic-workflows service GET /node-schemas endpoint.
   * Returns the schema-driven node registry: { schemas, aiPromptFragment }.
   * Response is cached in-memory for 60 s (registry is static at boot).
   * Falls back to { schemas: [], aiPromptFragment: '' } when the workflows
   * service is unreachable or WORKFLOW_SERVICE_URL is unset.
   *
   * Auth: any logged-in user (auth guard applied via preHandler hook above).
   */
  fastify.get('/internal/node-schemas', async (request, reply) => {
    try {
      const svc = getNodeSchemasProxyService();
      const payload = await svc.getNodeSchemas();
      return reply.send(payload);
    } catch (err: unknown) {
      const error = err as Error;
      logger.error({ error: error.message }, '[Workflows] /internal/node-schemas handler threw unexpectedly');
      return reply.code(500).send({ error: 'Failed to fetch node schemas', message: error.message });
    }
  });

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
              settings: true,
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

        // SEV-0 Flows-fix-A1: persist tenant_id on creation so the execute
        // path's defense-in-depth fallback (request.tenantId → row tenant_id)
        // actually has a row tenant to fall back to. Pre-fix every Workflow
        // row had tenant_id:null, which made the fallback chain dead-end at
        // null and shipped tenantId:null to workflows-svc.
        const creatorTenantId = (request as any).tenantId
          ?? (request as any).user?.tenantId
          ?? null;

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
            group_id,
            tenant_id: creatorTenantId,
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
   * GET /api/workflows/:id/as-tool-schema
   * V1.1 flow_tool: project a saved Workflow into the agent-tool catalog
   * shape `{ flowId, name, description, input_schema }`. Used by openagentic-proxy
   * to inject the user's saved flows as dynamic tools per turn.
   */
  fastify.get<{ Params: WorkflowIdParams }>(
    '/:id/as-tool-schema',
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
              { is_public: true },
              { is_template: true },
            ],
          },
        });

        if (!workflow) {
          return reply.code(404).send({
            error: 'Not found',
            message: `Workflow with ID '${id}' not found`,
          });
        }

        const schema = deriveFlowToolSchema({
          id: workflow.id,
          name: workflow.name,
          description: workflow.description,
          definition: workflow.definition,
          settings: workflow.settings as Record<string, unknown> | null | undefined,
        });

        return reply.send({ tool: schema });
      } catch (error: any) {
        logger.error({ error }, '[Workflows] Failed to derive tool schema');
        return reply.code(500).send({
          error: 'Failed to derive tool schema',
          message: error.message,
        });
      }
    },
  );

  /**
   * GET /api/workflows/agent-tools
   * V1.1 flow_tool: return every workflow the caller owns that is tagged
   * `agent-tool`, projected into the agent-tool catalog shape. Bulk endpoint
   * so openagentic-proxy can populate its per-turn tools[] in one round-trip.
   */
  fastify.get(
    '/agent-tools',
    async (request, reply) => {
      try {
        const user = (request as any).user;
        const userId = user?.userId || user?.id;

        const workflows = await prisma.workflow.findMany({
          where: {
            created_by: userId,
            deleted_at: null,
            is_active: true,
            tags: { has: 'agent-tool' },
          },
          orderBy: { updated_at: 'desc' },
          take: 50,
        });

        const tools = workflows.map((wf) =>
          deriveFlowToolSchema({
            id: wf.id,
            name: wf.name,
            description: wf.description,
            definition: wf.definition,
            settings: wf.settings as Record<string, unknown> | null | undefined,
          }),
        );

        return reply.send({ tools });
      } catch (error: any) {
        logger.error({ error }, '[Workflows] Failed to list agent-tools');
        return reply.code(500).send({
          error: 'Failed to list agent-tools',
          message: error.message,
        });
      }
    },
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
          ((request as any).tenantId as string | null | undefined)
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
            if (typeof (reply.raw as any).flush === 'function') {
              (reply.raw as any).flush();
            }
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
            reportLocalEngineFallback({ workflowId: 'test', executionId: testExecutionId, logger });
            const testAuthToken = request.headers.authorization
              || (user?.accessToken ? `Bearer ${user.accessToken}` : undefined);
            await executeWorkflow(
              'test',
              testExecutionId,
              { nodes, edges: edges || [] },
              input,
              userId,
              testAuthToken,
              sendEvent,
              { tenantId } // Task 1.3 (V3 Enterprise Chatmode S5).
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
        // Task 1.3 (V3 Enterprise Chatmode S5).
        // 2026-05-14 bug-fix: same preHandler-ordering issue as /test —
        // global mirror runs before plugin-scoped authMiddleware so
        // request.tenantId is stale; fall back to user.tenantId.
        const tenantId =
          ((request as any).tenantId as string | null | undefined)
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
          } catch (svcErr: any) {
            logger.warn({ svcErr: svcErr.message }, '[Workflows] Workflow service unavailable for test-node, falling back to local');
          }
        }

        // Fallback: run locally if workflow service unavailable
        reportLocalEngineFallback({ workflowId: 'test-node', executionId: testExecId, logger });
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
          },
          { tenantId } // Task 1.3 (V3 Enterprise Chatmode S5).
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
          const svcRes = await axios.post(`${WORKFLOW_SERVICE_URL}/compile`, { definition }, { timeout: 10000, headers: workflowServiceHeaders() });
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
   * POST /api/workflows/validate (#1270)
   * Design-time validation of an UNSAVED nodes/edges definition via the SoT
   * contract-aware validateFlow against the LIVE node registry. Resolves
   * configuredSecrets by scope + triggerInputs from the run dialog so the UI
   * can surface per-node issues + required run inputs + required secrets before
   * the flow is ever saved. Node-type-agnostic (no synth/oat/agenticode code).
   */
  fastify.post<{
    Body: {
      nodes?: any[];
      edges?: any[];
      input?: Record<string, any>;
      secrets?: string[];
    };
  }>(
    '/validate',
    async (request, reply) => {
      try {
        const user = (request as any).user;
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
        const nodeSchemaOf = (type: string) => registry.get(type)?.schema as any;
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
          } catch (secErr: any) {
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
          { nodes, edges: Array.isArray(edges) ? edges : [] },
          { nodeSchemaOf, nodePrimaryOf, configuredSecrets, triggerInputs },
        );

        return reply.send(result);
      } catch (error: any) {
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
        // SEV-0 Flows-fix-A1 (audit 2026-05-13): derive the request tenant
        // from BOTH (a) `request.tenantId` (set by tenantContextPlugin if
        // registered) and (b) `request.user.tenantId` (set by unifiedAuth's
        // buildRequestUser from the validated UserContext). The (b) source
        // is more reliable because tenantContextPlugin is currently NOT
        // registered in server.ts startup, which is why every execute call
        // pre-fix shipped tenantId:null on the wire.
        const requestTenantId =
          ((request as any).tenantId as string | null | undefined)
          ?? (user?.tenantId as string | null | undefined)
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
          workflowTenantId: (workflow as any).tenant_id,
        });
        if (tenantResolution.ok !== true) {
          const reason = (tenantResolution as { ok: false; error: string }).error;
          logger.warn({
            workflowId: id,
            userId,
            requestTenantId,
            workflowTenantId: (workflow as any).tenant_id,
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
                  { nodes: definition.nodes || [], edges: definition.edges || [] },
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
                sourceWorkflowSlug: ((workflow as any).settings as any)?.meta?.slug,
                sourceExecutionId: execution.id,
                sourceStatus: 'completed',
                sourceOutput: undefined,
                tenantId,
                userId,
              }).catch(() => { /* fire-and-forget */ });
            } catch (execError: any) {
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
                sourceWorkflowSlug: ((workflow as any).settings as any)?.meta?.slug,
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
            if (typeof (reply.raw as any).flush === 'function') {
              (reply.raw as any).flush();
            }
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
              { nodes: definition.nodes || [], edges: definition.edges || [] },
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
        const user = (request as any).user;
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
        const tenantId = ((request as any).tenantId as string | null | undefined)
          || (originalExecution as any).tenant_id
          || (originalExecution.workflow as any)?.tenant_id
          || null;

        // Gather upstream node outputs: all nodes that completed successfully
        // (i.e., not the failed node and not nodes that came after it)
        const nodeOutputs = (originalExecution.node_outputs as Record<string, any>) || {};
        const upstreamOutputs: Record<string, any> = {};
        for (const [nId, nodeData] of Object.entries(nodeOutputs)) {
          if (nId !== nodeId && (nodeData as any)?.status === 'completed') {
            upstreamOutputs[nId] = (nodeData as any)?.output;
          }
        }

        // Create a new execution record with resume state
        const newExecution = await prisma.workflowExecution.create({
          data: {
            workflow_id: workflowId,
            started_by: userId,
            status: 'pending',
            trigger_type: 'retry',
            input: (originalExecution.input as any) ?? {},
            state: {
              resume_from_node: nodeId,
              upstream_outputs: upstreamOutputs,
              original_execution_id: executionId,
            } as any,
          },
        });

        // Fire the workflow execution asynchronously
        const definition = (originalExecution.workflow?.definition as any) || { nodes: [], edges: [] };
        const authToken = request.headers.authorization
          || (user?.accessToken ? `Bearer ${user.accessToken}` : undefined);

        // Kick off the execution (non-blocking — update DB status on completion)
        executeWorkflow(
          workflowId,
          newExecution.id,
          definition,
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
      } catch (error: any) {
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
        const user = (request as any).user;
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
      } catch (error: any) {
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
        const user = (request as any).user;
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
      } catch (error: any) {
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
        const user = (request as any).user;
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
      } catch (error: any) {
        logger.error({ error }, '[Workflows] Failed to cancel execution');
        return reply.code(500).send({ error: 'Failed to cancel execution', message: error.message });
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
            settings: true,
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
   * GET /api/workflows/cost-rates
   * Active per-million-token rates for the cost-preview feature in the
   * Flows toolbar. Returns the LLMCostRate rows that are currently in
   * effect (effective_from <= now < effective_to OR effective_to NULL).
   * Cached client-side; cheap server query (single SELECT, no joins).
   */
  fastify.get(
    '/cost-rates',
    async (_request, reply) => {
      try {
        const now = new Date();
        const rows = await (prisma as any).lLMCostRate.findMany({
          where: {
            effective_from: { lte: now },
            OR: [{ effective_to: null }, { effective_to: { gte: now } }],
          },
          select: {
            provider_type: true,
            model: true,
            model_variant: true,
            input_cost_per_1m: true,
            output_cost_per_1m: true,
            cached_input_cost_per_1m: true,
          },
          orderBy: [{ provider_type: 'asc' }, { model: 'asc' }],
        });
        // Decimal columns serialise as strings in JSON; coerce to number
        // so the client doesn't have to parse.
        const rates = rows.map((r: any) => ({
          providerType: r.provider_type,
          model: r.model,
          modelVariant: r.model_variant ?? null,
          inputCostPer1m: Number(r.input_cost_per_1m),
          outputCostPer1m: Number(r.output_cost_per_1m),
          cachedInputCostPer1m:
            r.cached_input_cost_per_1m == null ? null : Number(r.cached_input_cost_per_1m),
        }));
        return reply.send({ rates, fetchedAt: now.toISOString() });
      } catch (error: any) {
        logger.warn({ error: error.message }, '[Workflows] cost-rates query failed, returning empty');
        return reply.send({ rates: [], fetchedAt: new Date().toISOString() });
      }
    }
  );

  /**
   * GET /api/workflows/agents — DEPRECATED 2026-04-26.
   *
   * Originally hit openagentic-proxy only and skipped prisma.agent (the SOT).
   * Now collapsed onto listAgentsFromSOT — same merge as /api/admin/agents
   * but with sensitive prompt/tool fields redacted. Kept as a pass-through
   * so any external caller still works; UI no longer calls it.
   */
  fastify.get(
    '/agents',
    async (request, reply) => {
      try {
        logger.info(
          { ua: request.headers['user-agent'] },
          '[Workflows] DEPRECATED /api/workflows/agents — use /api/admin/agents'
        );
        const { listAgentsFromSOT } = await import('../services/listAgentsFromSOT.js');
        const agents = await listAgentsFromSOT({ redactSensitive: true });
        return reply.send({ agents });
      } catch (error: any) {
        logger.warn({ error: error.message }, '[Workflows] /agents failed, returning empty');
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

        const apiUrl = process.env.PUBLIC_URL || 'https://chat.example.com';
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

        // Generate a secure API key: "oa_" + base64url(32 random bytes) (URL-safe, no padding).
        const prefix = 'oa_';
        const rawKey = prefix + randomBytes(32).toString('base64url');
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
   * Enterprise-only: secrets management is gated (runtime {{secret:name}} resolution is unaffected).
   */
  fastify.get(
    '/secrets',    async (request, reply) => {
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
   * Enterprise-only management route.
   */
  fastify.get(
    '/data/collections',    async (request, reply) => {
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
   * Enterprise-only management route.
   */
  fastify.post(
    '/data/upload',    async (request, reply) => {
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
        const milvusSvc = fastify.app?.milvusVectorService;
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

        // Determine artifact type from extension (lazy-load ArtifactType to avoid eager Milvus SDK import)
        const { ArtifactType: AType } = await import('../services/MilvusVectorService.js');
        const artifactType = ['json', 'csv'].includes(ext) ? AType.DOCUMENT : ext === 'md' ? AType.DOCUMENT : AType.FILE;

        const artifactId = await milvusSvc.storeArtifact(userId, {
          type: artifactType,
          title: filename,
          content: text,
          mimeType: mimetype,
          metadata: {
            source: 'file_upload',
            description: `Uploaded file: ${filename}`,
            fileSize: buffer.length,
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
   * Enterprise-only management route.
   */
  fastify.post(
    '/data/collections',    async (request, reply) => {
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
   * Enterprise-only management route.
   */
  fastify.delete(
    '/data/collections/:name',    async (request, reply) => {
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

        // Materialize inline ghost agents into prisma.agent SOT before persistence.
        const { materializeTemplateAgents } = await import('../services/materializeTemplateAgents.js');

        for (const rawTemplate of SEED_WORKFLOW_TEMPLATES) {
          try {
            const template = await materializeTemplateAgents(rawTemplate);

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
            results.details.push(`Error seeding "${rawTemplate.name}": ${templateError.message}`);
            logger.error({ error: templateError, templateName: rawTemplate.name }, '[Workflows] Failed to seed template');
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
        const user = (request as any).user;
        const userId = user?.userId || user?.id;

        if (!userId) {
          return reply.code(401).send({ error: 'Authentication required' });
        }

        const { content, title, format, nodeId, workflowId } = request.body || {};

        if (!content || !title) {
          return reply.code(400).send({ error: 'content and title are required' });
        }

        // Use the AppContext MilvusVectorService instance to store the artifact
        const { ArtifactType } = await import('../services/MilvusVectorService.js');
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
        }) as any;

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
          (dataRequest.execution as any)?.tenant_id ||
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
      } catch (error: any) {
        logger.error({ error: error.message }, '[Workflows] Failed to submit data request');
        return reply.code(500).send({ error: 'Failed to submit data request', message: error.message });
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

  // Materialize inline ghost agents into prisma.agent SOT first.
  const { materializeTemplateAgents } = await import('../services/materializeTemplateAgents.js');

  for (const rawTemplate of SEED_WORKFLOW_TEMPLATES) {
    try {
      // Replace inline { role, taskDescription } with { agentId } references
      // by upserting a Template__<slug>__<role> agent in the SOT.
      const template = await materializeTemplateAgents(rawTemplate);

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
      loggers.routes.warn({ err: err.message, template: rawTemplate.name }, '[Workflows] autoSeed template failed');
    }
  }

  // ── RECONCILE: prune stale system-seeded templates not in the kept set ────
  // Two seeders have historically written templates: this function (using ownerId,
  // the first admin user) and the workflows-service templateSeeder.ts (using the
  // fixed SYSTEM_SEED_USER constant). Both must be scoped here so enterprise
  // templates removed from source are also removed from the live DB on next boot.
  //
  // SAFETY: the created_by filter ensures we NEVER touch user-owned templates.
  // The allowlist is derived from the current SEED_WORKFLOW_TEMPLATES names plus
  // the one kept JSON template ("Research and Publish") from the workflows-service.
  // Any template NOT in this list and owned by a known seeder id will be pruned.
  try {
    // Fixed seeder id used by services/openagentic-workflows templateSeeder.ts.
    const SYSTEM_SEED_USER = 'system-00000000-0000-0000-0000-000000000000';

    // Build the allowlist: inline api templates + kept JSON templates from
    // the workflows-service. Read the exact name from the JSON at boot time
    // (templateSeeder.ts sets created_by=SYSTEM_SEED_USER for these rows).
    const keptJsonTemplateNames: string[] = ['Research and Publish'];
    const allowlist = [
      ...SEED_WORKFLOW_TEMPLATES.map((t) => t.name),
      ...keptJsonTemplateNames,
    ];

    // Scope to known seeder-owned rows only. We use OR so both the
    // api-seeder-owned rows (ownerId) and the workflows-service-seeder-owned
    // rows (SYSTEM_SEED_USER) are covered.
    const pruned = await prisma.workflow.deleteMany({
      where: {
        is_template: true,
        created_by: { in: [ownerId, SYSTEM_SEED_USER] },
        name: { notIn: allowlist },
      },
    });

    if (pruned.count > 0) {
      loggers.routes.info(
        { pruned: pruned.count, allowlist },
        '[Workflows] autoSeed reconcile: pruned stale system-seeded templates',
      );
    } else {
      loggers.routes.info(
        { allowlist },
        '[Workflows] autoSeed reconcile: no stale system templates to prune',
      );
    }
  } catch (err: any) {
    // Non-fatal: a prune failure must never break boot.
    loggers.routes.warn(
      { err: err.message },
      '[Workflows] autoSeed reconcile: prune step failed (non-fatal)',
    );
  }

  return result;
}

export const SEED_WORKFLOW_TEMPLATES: SeedTemplate[] = [
  // ══════════════════════════════════════════════════════════════════════════
  // 1. Multi-Agent Research Team (grounded)
  // Uses: trigger, mcp_tool(web_search_and_read), multi_agent, merge,
  //       openagentic_llm, grounding_check
  //
  // Grounding-first design: a real web_search fires BEFORE the agents so they
  // analyze actually-fetched sources, then grounding_check verifies the report
  // against those sources. The trigger declares ONE required input (`topic`).
  // ══════════════════════════════════════════════════════════════════════════
  {
    name: 'Multi-Agent Research Team',
    description: 'Runs a real web search, then three specialized agents (researcher, analyst, critic) analyze the actually-fetched sources, synthesize a report with verifiable links, and a grounding check verifies every claim against the real sources — no fabrication.',
    icon: 'Bot',
    category: 'ai-analysis',
    tags: ['multi-agent', 'research', 'ai-analysis'],
    color: '#7c3aed',
    definition: {
      nodes: [
        {
          id: 'trigger-1',
          type: 'trigger',
          position: { x: 0, y: Y },
          data: {
            label: 'Research Topic',
            triggerType: 'manual',
            icon: 'Play',
            color: '#ff9800',
            inputs: [
              {
                name: 'topic',
                label: 'Research Topic',
                type: 'string',
                required: true,
                placeholder: 'e.g., Post-quantum cryptography readiness for enterprises',
                description: 'What should the research team investigate? Be specific.',
              },
            ],
          },
        },
        {
          // DETERMINISTIC grounding: a real web search fires BEFORE the agents,
          // so they analyze actually-fetched sources instead of fabricating.
          // The old design only *told* the agents to search (they never did —
          // multi_agent ships them no tools), so reports were 100% invented.
          id: 'search',
          type: 'mcp_tool',
          position: { x: X * 0.6, y: Y },
          data: {
            label: 'Web Search (real sources)',
            icon: 'Globe',
            color: '#06b6d4',
            toolName: 'web_search_and_read',
            toolServer: 'openagentic_web',
            arguments: { query: '{{trigger.topic}}', num_results: 4 },
          },
        },
        {
          id: 'multi-research',
          type: 'multi_agent',
          position: { x: X, y: Y },
          data: {
            label: 'Research Team (grounded)',
            icon: 'Users',
            color: '#7c3aed',
            pattern: 'parallel',
            agents: [
              {
                role: 'researcher',
                taskDescription:
                  'You are the RESEARCHER. Below are REAL web search results (titles, URLs, and fetched page content) for the topic. Extract the key verifiable facts. Every fact MUST be traceable to one of these sources — quote the exact URL after each fact. If the sources do not answer something, say "not found in sources" — do NOT use prior knowledge or invent anything.\n\nTOPIC: {{trigger.topic}}\n\nREAL SOURCES:\n{{steps.search.output}}',
              },
              {
                role: 'analyst',
                taskDescription:
                  'You are the ANALYST. Using ONLY the REAL web sources below, identify trends, comparisons, and what the evidence supports. Cite the exact URL for every claim. Flag anything the sources disagree on. Never use outside knowledge.\n\nTOPIC: {{trigger.topic}}\n\nREAL SOURCES:\n{{steps.search.output}}',
              },
              {
                role: 'critic',
                taskDescription:
                  'You are the CRITIC/FACT-CHECKER. For each notable claim derivable from the REAL sources below, state whether it is well-supported, weakly supported, or unsupported BY THESE SOURCES, with the URL. Explicitly call out anything that would be a hallucination if asserted (not present in the sources).\n\nTOPIC: {{trigger.topic}}\n\nREAL SOURCES:\n{{steps.search.output}}',
              },
            ],
            strategy: 'parallel',
          },
        },
        {
          id: 'merge-findings',
          type: 'merge',
          position: { x: X * 2, y: Y },
          data: { label: 'Merge Findings', icon: 'GitMerge', color: '#9c27b0', strategy: 'combine' },
        },
        {
          id: 'llm-synthesize',
          type: 'openagentic_llm',
          position: { x: X * 3, y: Y },
          data: {
            label: 'Synthesize Report',
            icon: 'Brain',
            color: '#7c4dff',
            prompt:
              'Write a research report on "{{trigger.topic}}" using ONLY the grounded agent findings below. Every claim must cite a real source URL drawn from the findings. Include: Executive Summary, Key Findings (each with its source URL), Analysis, and Open Questions. If the sources are insufficient, say so plainly — do NOT fabricate.\n\nGROUNDED FINDINGS:\n{{steps.merge-findings.output}}',
          },
        },
        {
          // REAL grounding: verify the synthesized report against the
          // actually-fetched web content (not another LLM output). Flags any
          // entity/claim that appears in the report but not in the sources.
          id: 'ground',
          type: 'grounding_check',
          position: { x: X * 4, y: Y },
          data: {
            label: 'Grounding Check (vs real sources)',
            icon: 'ShieldCheck',
            color: '#16a34a',
            claim: '{{steps.llm-synthesize.output}}',
            groundTruth: '{{steps.search.output}}',
          },
        },
        {
          id: 'llm-finalize',
          type: 'openagentic_llm',
          position: { x: X * 5, y: Y },
          data: {
            label: 'Final Report + Sources',
            icon: 'FileCheck',
            color: '#7c4dff',
            prompt:
              'Produce the FINAL Markdown report from:\n{{steps.llm-synthesize.output}}\n\nGrounding analysis: {{steps.ground.output}}\n\nAppend a "## Sources" section listing every real URL cited (from the search results), and a "## Grounding" section stating the score and that all claims were checked against the actually-fetched web sources. If grounding flagged unfounded items, list them as caveats.',
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger-1', target: 'search', animated: true },
        { id: 'e2', source: 'search', target: 'multi-research', animated: true },
        { id: 'e3', source: 'multi-research', target: 'merge-findings', animated: true },
        { id: 'e4', source: 'merge-findings', target: 'llm-synthesize', animated: true },
        { id: 'e5', source: 'llm-synthesize', target: 'ground', animated: true },
        { id: 'e6', source: 'ground', target: 'llm-finalize', animated: true },
      ],
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 2. RAG Knowledge Pipeline
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
        { id: 'trigger-1', type: 'trigger', position: { x: 0, y: Y }, data: { label: 'User Question', triggerType: 'manual', icon: 'Play', color: '#ff9800', inputs: [{ name: 'question', label: 'Your question', type: 'string', required: true, placeholder: 'e.g., How does the smart router pick a model?', description: 'A question to answer from the indexed knowledge base (docs collection).' }] } },
        { id: 'llm-queries', type: 'openagentic_llm', position: { x: X, y: Y }, data: { label: 'Generate Queries', icon: 'Brain', color: '#7c4dff', prompt: 'Given the user question below, generate 3 diverse search queries that would help retrieve relevant information. Output them as a JSON array of strings.\n\nQuestion: {{trigger.question}}' } },
        { id: 'rag-search', type: 'rag_query', position: { x: X * 2, y: Y }, data: { label: 'Vector Search', icon: 'Database', color: '#2196f3', collection: 'docs', query: '{{steps.llm-queries.output}}', topK: 10, minScore: 0.5, filter: { file_extensions: ['md', 'mdx'] } } },
        { id: 'llm-answer', type: 'openagentic_llm', position: { x: X * 3, y: Y }, data: { label: 'Synthesize Answer', icon: 'Brain', color: '#7c4dff', prompt: 'Answer the user question using ONLY the retrieved context below. Cite specific sources. If the context is insufficient, say so.\n\nQuestion: {{trigger.question}}\n\nRetrieved Context:\n{{steps.rag-search.output}}' } },
      ],
      edges: [
        { id: 'e1', source: 'trigger-1', target: 'llm-queries', animated: true },
        { id: 'e2', source: 'llm-queries', target: 'rag-search', animated: true },
        { id: 'e3', source: 'rag-search', target: 'llm-answer', animated: true },
      ],
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 3. Web Page → Structured Brief (grounded)
  // Uses: trigger(inputs:url), mcp_tool(web_search_and_read), openagentic_llm,
  //       grounding_check. Reads a real page/topic and briefs it WITHOUT
  //       fabrication — replaces the old "Smart Router Showcase" demo.
  // ══════════════════════════════════════════════════════════════════════════
  {
    name: 'Web Page → Structured Brief',
    description: 'Reads a web page (or searches a topic and reads the top results), then writes a structured brief — TL;DR, key points each with their source URL, entities, and open questions — grounded against the actually-fetched content. No fabrication.',
    icon: 'Globe',
    category: 'research',
    tags: ['web', 'summarize', 'research', 'grounded'],
    color: '#06b6d4',
    definition: {
      nodes: [
        {
          id: 'trigger-1',
          type: 'trigger',
          position: { x: 0, y: Y },
          data: {
            label: 'Page or Topic',
            triggerType: 'manual',
            icon: 'Play',
            color: '#ff9800',
            inputs: [
              {
                name: 'url',
                label: 'Page URL or search topic',
                type: 'string',
                required: true,
                placeholder: 'https://example.com/article   — or —   latest on post-quantum cryptography',
                description: 'A URL to read, or a topic to search the web for and read.',
              },
            ],
          },
        },
        {
          id: 'fetch',
          type: 'mcp_tool',
          position: { x: X, y: Y },
          data: {
            label: 'Read the web (real content)',
            icon: 'Globe',
            color: '#06b6d4',
            toolName: 'web_search_and_read',
            toolServer: 'openagentic_web',
            arguments: { query: '{{trigger.url}}', num_results: 3 },
          },
        },
        {
          id: 'brief',
          type: 'openagentic_llm',
          position: { x: X * 2, y: Y },
          data: {
            label: 'Structured Brief',
            icon: 'Brain',
            color: '#7c4dff',
            prompt:
              'Produce a STRUCTURED BRIEF using ONLY the fetched web content below. Markdown sections:\n"## TL;DR" — 3 sentences.\n"## Key Points" — bullets, each ending with its source URL.\n"## Entities" — people / orgs / products named in the content.\n"## Open Questions".\nUse ONLY facts present in the content; do not add outside knowledge. If the content is thin or off-topic, say so plainly.\n\nFETCHED CONTENT:\n{{steps.fetch.output}}',
          },
        },
        {
          id: 'ground',
          type: 'grounding_check',
          position: { x: X * 3, y: Y },
          data: {
            label: 'Grounding Check (vs fetched content)',
            icon: 'ShieldCheck',
            color: '#16a34a',
            claim: '{{steps.brief.output}}',
            groundTruth: '{{steps.fetch.output}}',
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger-1', target: 'fetch', animated: true },
        { id: 'e2', source: 'fetch', target: 'brief', animated: true },
        { id: 'e3', source: 'brief', target: 'ground', animated: true },
      ],
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 4. Code Review Agent
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
        { id: 'trigger-1', type: 'trigger', position: { x: 0, y: Y }, data: { label: 'Submit Code', triggerType: 'manual', icon: 'Play', color: '#ff9800', inputs: [{ name: 'code', label: 'Code to review', type: 'text', required: true, placeholder: 'Paste the code (any language) to review…', description: 'The source to analyze for bugs, security, and quality.' }] } },
        { id: 'llm-analyze', type: 'openagentic_llm', position: { x: X, y: Y }, data: { label: 'Analyze Code', icon: 'Brain', color: '#7c4dff', prompt: 'Review the following code for bugs, security vulnerabilities, and quality issues. Classify the overall severity as "critical" (must fix before merge), "warning" (should fix), or "clean" (ready to merge).\n\nRespond with a JSON object: { "severity": "critical|warning|clean", "issues": [...], "suggestions": [...] }\n\nCode:\n{{trigger.code}}' } },
        { id: 'cond-severity', type: 'condition', position: { x: X * 2, y: Y }, data: { label: 'Critical Issues?', icon: 'GitBranch', color: '#2196f3', expression: '{{steps.llm-analyze.output}}.includes("critical")' } },
        { id: 'agent-fix', type: 'agent_single', position: { x: X * 3, y: 0 }, data: { label: 'Auto-Fix Agent', icon: 'Wrench', color: '#f44336', agentType: 'coder', task: 'Fix the critical issues identified in this code review:\n\nReview:\n{{steps.llm-analyze.output}}\n\nOriginal Code:\n{{trigger.code}}\n\nReturn the corrected code with comments explaining each fix.' } },
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
  // 5. Data Transform Pipeline
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
        { id: 'trigger-1', type: 'trigger', position: { x: 0, y: Y }, data: { label: 'Start', triggerType: 'manual', icon: 'Play', color: '#ff9800', inputs: [{ name: 'url', label: 'JSON API URL', type: 'string', required: true, placeholder: 'https://api.example.com/data.json', description: 'A URL returning JSON to fetch, transform, and analyze.' }] } },
        { id: 'http-fetch', type: 'http_request', position: { x: X, y: Y }, data: { label: 'Fetch Data', icon: 'Globe', color: '#06b6d4', url: '{{trigger.url}}', method: 'GET' } },
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
  // 6. Contract Risk Flagging
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
        { id: 'trigger-1', type: 'trigger', position: { x: 0, y: Y }, data: { label: 'Submit Contract', triggerType: 'manual', icon: 'Play', color: '#ff9800', inputs: [{ name: 'contract', label: 'Contract text', type: 'text', required: true, placeholder: 'Paste the contract / agreement text…', description: 'The full contract to extract clauses from and risk-score.' }] } },
        { id: 'llm-extract', type: 'openagentic_llm', position: { x: X, y: Y }, data: { label: 'Extract Clauses', icon: 'Brain', color: '#7c4dff', prompt: 'Extract all distinct clauses from the following contract. Return them as a JSON array of objects: [{ "id": 1, "title": "...", "text": "..." }, ...]\n\nContract:\n{{trigger.contract}}' } },
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
  // 7. Topic Watch → Briefing (grounded, human-approved publish)
  // Uses: trigger(inputs:topic,focus), mcp_tool(web_search_and_read),
  //       openagentic_llm, grounding_check, human_approval. Searches the LIVE web
  //       and writes a dated briefing from real sources, then a human approves
  //       before it's finalized — replaces the old "Approval Gate Demo".
  // ══════════════════════════════════════════════════════════════════════════
  {
    name: 'Topic Watch → Briefing',
    description: 'Searches the live web for the latest on a topic, writes a dated briefing (What\'s New / Why It Matters / Watch List / Sources) grounded against the real search results, then pauses for human approval before finalizing.',
    icon: 'Newspaper',
    category: 'research',
    tags: ['monitoring', 'briefing', 'research', 'grounded', 'human-in-the-loop'],
    color: '#0ea5e9',
    definition: {
      nodes: [
        {
          id: 'trigger-1',
          type: 'trigger',
          position: { x: 0, y: Y },
          data: {
            label: 'Watch Topic',
            triggerType: 'manual',
            icon: 'Play',
            color: '#ff9800',
            inputs: [
              {
                name: 'topic',
                label: 'Topic to brief',
                type: 'string',
                required: true,
                placeholder: 'e.g., Kubernetes security advisories',
                description: 'What should we get the latest grounded briefing on?',
              },
              {
                name: 'focus',
                label: 'Focus (optional)',
                type: 'string',
                required: false,
                placeholder: 'e.g., enterprise impact, last 30 days',
                description: 'Optional angle to emphasize in the briefing.',
              },
            ],
          },
        },
        {
          id: 'search',
          type: 'mcp_tool',
          position: { x: X, y: Y },
          data: {
            label: 'Live Web Search',
            icon: 'Globe',
            color: '#06b6d4',
            toolName: 'web_search_and_read',
            toolServer: 'openagentic_web',
            arguments: { query: 'latest {{trigger.topic}} {{trigger.focus}}', num_results: 5 },
          },
        },
        {
          id: 'brief',
          type: 'openagentic_llm',
          position: { x: X * 2, y: Y },
          data: {
            label: 'Write Briefing',
            icon: 'Brain',
            color: '#7c4dff',
            prompt:
              'Write a BRIEFING on "{{trigger.topic}}" using ONLY the live search results below. Markdown:\n"## What\'s New" — bullets, each with its source URL (and date if present).\n"## Why It Matters".\n"## Watch List" — what to track next.\n"## Sources" — every URL used.\nUse ONLY facts present in the results; if something is unclear or unsupported, say so. No fabrication.\n\nLIVE RESULTS:\n{{steps.search.output}}',
          },
        },
        {
          id: 'ground',
          type: 'grounding_check',
          position: { x: X * 3, y: Y },
          data: {
            label: 'Grounding Check (vs live results)',
            icon: 'ShieldCheck',
            color: '#16a34a',
            claim: '{{steps.brief.output}}',
            groundTruth: '{{steps.search.output}}',
          },
        },
        {
          id: 'approve',
          type: 'human_approval',
          position: { x: X * 4, y: Y },
          data: {
            label: 'Approve to Publish',
            icon: 'UserCheck',
            color: '#8b5cf6',
            message: 'Review the grounded briefing (and grounding result) below, then approve or reject before it is finalized.',
            timeout: 3600,
          },
        },
        {
          id: 'finalize',
          type: 'openagentic_llm',
          position: { x: X * 5, y: Y },
          data: {
            label: 'Finalize Briefing',
            icon: 'FileCheck',
            color: '#4caf50',
            prompt:
              'Produce the FINAL briefing from the approved draft below. Keep all source URLs. Add a one-line "_Grounding:_" footer noting it was fact-checked against the live sources.\n\nDRAFT:\n{{steps.brief.output}}\n\nGROUNDING:\n{{steps.ground.output}}\n\nAPPROVAL:\n{{steps.approve.output}}',
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger-1', target: 'search', animated: true },
        { id: 'e2', source: 'search', target: 'brief', animated: true },
        { id: 'e3', source: 'brief', target: 'ground', animated: true },
        { id: 'e4', source: 'ground', target: 'approve', animated: true },
        { id: 'e5', source: 'approve', target: 'finalize', animated: true },
      ],
    },
  },

];

export default workflowRoutes;
