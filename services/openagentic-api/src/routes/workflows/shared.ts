/**
 * Shared infrastructure for the workflow route sub-modules.
 *
 * Single owner for: the s2s header builder, the WORKFLOW_SERVICE_URL constant
 * (+ its one-time load warn), the WorkflowCompiler singleton, and the pure
 * transform/tagging helpers. Imported by every workflows/*.routes.ts module so
 * there is exactly one instance of each.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { loggers } from '../../utils/logger.js';
import { getInternalKey } from '../../utils/internalKeyReader.js';
import { WorkflowCompiler } from '../../services/WorkflowCompiler.js';
import type { FlowDefinition, FlowEdge, FlowNode, RequestUser } from './types.js';

/**
 * Build the s2s headers used when this api proxies to the workflows-service.
 * The workflows-service rejects calls without a valid internal-key (P0a fix).
 */
export function workflowServiceHeaders(
  extra: Record<string, string | undefined> = {},
): Record<string, string> {
  const internalKey = getInternalKey();
  const out: Record<string, string> = {};
  if (internalKey) out['Authorization'] = `Bearer ${internalKey}`;
  for (const [k, v] of Object.entries(extra)) {
    if (typeof v === 'string' && v.length > 0) out[k] = v;
  }
  return out;
}

// Workflow execution service URL — when available, execution is proxied to the dedicated service.
// Phase A: when unset, log a loud warn at module load so the misconfig is
// surfaced (a deployed-but-unrouted workflows pod would otherwise sit idle
// without anyone noticing). Phase B will fail-fast.
export const WORKFLOW_SERVICE_URL = process.env.WORKFLOW_SERVICE_URL || '';
if (!WORKFLOW_SERVICE_URL) {
  loggers.server.warn(
    {},
    '[Workflows] WORKFLOW_SERVICE_URL is not set — every workflow execution will fall back to the in-process engine. Set WORKFLOW_SERVICE_URL=http://openagentic-workflows:3400 (or equivalent) to route to the dedicated pod. Phase B of the decoupling will turn this into a startup error.',
  );
}

/** Single WorkflowCompiler instance shared across the authoring + execution routes. */
export const workflowCompiler = new WorkflowCompiler();

/**
 * Narrow `request.user` to the workflow-handler view (adds the optional
 * `tenantId` some handlers read). Same property access at runtime as the old
 * `(request as any).user`.
 */
export function getReqUser(request: FastifyRequest): RequestUser | undefined {
  return request.user as RequestUser | undefined;
}

/**
 * Flush the underlying Node response immediately so streamed NDJSON frames
 * reach the client before the next event. Node's `ServerResponse` gains a
 * `flush()` when compression is wired; it is otherwise absent.
 */
export function flushReply(reply: FastifyReply): void {
  const raw = reply.raw as unknown as { flush?: () => void };
  if (typeof raw.flush === 'function') {
    raw.flush();
  }
}

/** Cast an opaque JSON value to a record for property reads (post-guard). */
export function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

/** Cast a value to a Prisma JSON-write input at a persistence boundary. */
export function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

/**
 * The subset of a Workflow DB row that {@link transformWorkflow} reads. Every
 * caller passes a Prisma `workflow` row (full row, a `select` projection, or a
 * `create` result) — all carry at least `id`; the rest are read defensively.
 */
export interface WorkflowRowLike {
  id: string;
  created_by?: string | null;
  name?: string | null;
  description?: string | null;
  definition?: unknown;
  settings?: unknown;
  is_active?: boolean | null;
  is_public?: boolean | null;
  is_template?: boolean | null;
  tags?: string[] | null;
  category?: string | null;
  icon?: string | null;
  color?: string | null;
  total_executions?: number | null;
  last_executed_at?: Date | null;
  created_at?: Date;
  updated_at?: Date;
}

// Helper to transform workflow from DB schema to API response format.
// 2026-04-19 (task #144) — strip legacy `intelligenceLevel` and
// `sliderPosition` / `sliderOverride` fields from node data on the way
// out. Existing flows were saved with these; the UI no longer renders
// them and the executor ignores them, but we drop them from the wire
// so old saved-flows look clean in the editor without a DB migration.
export function stripLegacySliderFields(nodes: FlowNode[]): FlowNode[] {
  if (!Array.isArray(nodes)) return nodes;
  return nodes.map((n) => {
    if (!n?.data) return n;
    const { intelligenceLevel, sliderPosition, sliderOverride, ...cleanData } = n.data;
    return { ...n, data: cleanData };
  });
}

export function transformWorkflow(workflow: WorkflowRowLike) {
  const definition: FlowDefinition = (workflow.definition as FlowDefinition | null) || {};
  // settings.meta carries the human-readable template legend block
  // authored in seed/templates/*.json (purpose / how_it_works /
  // expected_output / useful_when / tools_used / version / tags).
  // Surface it as a top-level `meta` so UI gallery cards + canvas-side
  // 'About this workflow' panel can render it without digging into
  // settings.
  const settings = (workflow.settings as Record<string, unknown> | null | undefined) || {};
  const meta = (settings.meta ?? null) as Record<string, unknown> | null;
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
export function computeAutoTags(definition: { nodes?: FlowNode[]; edges?: FlowEdge[] }): string[] {
  const tags = new Set<string>();
  const nodes = definition?.nodes || [];

  for (const node of nodes) {
    const type = node.type || node.data?.type || '';
    const config: Record<string, unknown> = node.data?.config || node.data || {};
    const toolName = String(config.tool_name || config.toolName || '').toLowerCase();
    const label = String(node.data?.label || config.label || '').toLowerCase();

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
  if (nodes.filter((n) => (n.type || n.data?.type) === 'agent_single' || (n.type || n.data?.type) === 'agent_supervisor').length > 1) tags.add('multi-agent');

  return Array.from(tags);
}
