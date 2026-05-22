/**
 * Admin Agent Management Routes
 *
 * CRUD for agent definitions (via Agent table), skills management,
 * execution listing, metrics, and cost breakdown.
 */

import { FastifyPluginAsync, FastifyInstance } from 'fastify';
import { authMiddleware, adminMiddleware } from '../middleware/unifiedAuth.js';
import { loggers } from '../utils/logger.js';
import { prisma } from '../utils/prisma.js';
import { listAgentsFromSOT } from '../services/listAgentsFromSOT.js';

// Lazy import to avoid circular dependency (same pattern as WorkflowExecutionEngine)
async function invalidateRegistryCache() {
  try {
    const { getAgentRegistry } = await import('../services/AgentRegistry.js');
    const registry = getAgentRegistry();
    await registry.refreshCache();
  } catch {
    // Registry may not be initialized yet, safe to ignore
  }
  // Option B (2026-05-13) — also invalidate the chatmode DB-backed agent
  // snapshot so admin-edited rows reach the chatmode Task tool without
  // waiting for the 60s TTL. Mirrors the provider hot-reload pattern in
  // [[feedback_provider_hot_reload_after_write]].
  try {
    const { invalidateAgentsFromDbCache, primeAgentsFromDbCache } = await import(
      '../services/listAgentsFromDb.js'
    );
    invalidateAgentsFromDbCache();
    // Best-effort prime so the next sync read returns the fresh snapshot
    // immediately rather than the now-stale-but-not-yet-refreshed one.
    await primeAgentsFromDbCache();
  } catch {
    // listAgentsFromDb module load failure shouldn't fail the admin write
  }
}

export const adminAgentRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const logger = loggers.routes || loggers;

  fastify.addHook('preHandler', authMiddleware);
  fastify.addHook('preHandler', adminMiddleware);

  // ─── Agent Definitions (Agent table) ──────────────────────────

  /**
   * GET /api/admin/agents — list all agent definitions (full config).
   * Calls the shared listAgentsFromSOT helper. /api/workflows/agents calls
   * the same helper with redactSensitive=true; this is the SOT.
   */
  fastify.get('/', async (request, reply) => {
    try {
      const agents = await listAgentsFromSOT({ redactSensitive: false });
      return reply.send({ agents });
    } catch (error: any) {
      logger.warn({ error: error.message }, '[AdminAgents] Error listing agents');
      return reply.send({ agents: [] });
    }
  });

  /**
   * GET /api/admin/agents/definitions - Alias for openagentic-proxy compatibility
   */
  fastify.get('/definitions', async (request, reply) => {
    try {
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
      return reply.send({ agents: [] });
    } catch (error: any) {
      if (error.code === 'P2021') {
        return reply.send({ agents: [] });
      }
      logger.error({ error }, '[AdminAgents] Failed to list agent definitions');
      return reply.code(500).send({ error: error.message });
    }
  });

  /**
   * GET /api/admin/agents/db - Direct DB query for agent definitions
   * Used by openagentic-proxy to load DB-backed agents without circular proxy calls
   */
  fastify.get('/db', async (_request, reply) => {
    try {
      const agents = await prisma.agent.findMany({
        where: { enabled: true },
        select: {
          id: true, name: true, display_name: true, description: true,
          agent_type: true, category: true, model_config: true, system_prompt: true,
          tools_whitelist: true, tools_deny_list: true, skills: true,
          delegation: true, background: true, triggers: true, icon: true, color: true,
          enabled: true, tags: true,
        },
      });
      return reply.send({ agents });
    } catch (error: any) {
      if (error.code === 'P2021') {
        return reply.send({ agents: [] });
      }
      return reply.send({ agents: [] });
    }
  });

  /**
   * POST /api/admin/agents - Create new agent definition
   */
  fastify.post('/', async (request, reply) => {
    try {
      const body = request.body as any;
      const user = (request as any).user;
      const agent = await prisma.agent.create({
        data: {
          name: body.name,
          display_name: body.displayName || body.display_name || body.name,
          description: body.description,
          agent_type: body.agentType || body.agent_type || 'custom',
          category: body.category || 'custom',
          // M8: empty model_config means "use the registry default at runtime"
          // (resolved via ModelConfigurationService.getDefaultChatModel).
          // Pinning a literal here would shadow the operator's registry choice.
          model_config: body.modelConfig || body.model_config || {},
          system_prompt: body.systemPrompt || body.system_prompt,
          graph_definition: body.graphDefinition || body.graph_definition || {},
          state_schema: body.stateSchema || body.state_schema || {},
          input_schema: body.inputSchema || body.input_schema || {},
          output_schema: body.outputSchema || body.output_schema || {},
          rate_limits: body.rateLimits || body.rate_limits || {},
          cost_limits: body.costLimits || body.cost_limits || {},
          tags: body.tags || [],
          icon: body.icon,
          color: body.color,
          skills: body.skills || [],
          delegation: body.delegation || {},
          background: body.background || null,
          tools_whitelist: body.toolsWhitelist || body.tools_whitelist || [],
          created_by: user?.userId || user?.id,
        },
      });
      await invalidateRegistryCache();
      return reply.code(201).send(agent);
    } catch (error: any) {
      logger.error({ error }, '[AdminAgents] Failed to create agent');
      return reply.code(500).send({ error: error.message });
    }
  });

  /**
   * PUT /api/admin/agents/:id - Update agent definition
   */
  fastify.put<{ Params: { id: string } }>('/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const body = request.body as any;
      const user = (request as any).user;
      const agent = await prisma.agent.update({
        where: { id },
        data: {
          ...(body.name && { name: body.name }),
          ...(body.displayName && { display_name: body.displayName }),
          ...(body.description !== undefined && { description: body.description }),
          ...(body.agentType && { agent_type: body.agentType }),
          ...(body.category && { category: body.category }),
          ...(body.modelConfig && { model_config: body.modelConfig }),
          ...(body.systemPrompt !== undefined && { system_prompt: body.systemPrompt }),
          ...(body.tags && { tags: body.tags }),
          ...(body.icon !== undefined && { icon: body.icon }),
          ...(body.enabled !== undefined && { enabled: body.enabled }),
          ...(body.skills && { skills: body.skills }),
          ...(body.delegation && { delegation: body.delegation }),
          ...(body.background !== undefined && { background: body.background }),
          ...(body.toolsWhitelist && { tools_whitelist: body.toolsWhitelist }),
          updated_by: user?.userId || user?.id,
        },
      });
      await invalidateRegistryCache();
      return reply.send(agent);
    } catch (error: any) {
      logger.error({ error, id: request.params.id }, '[AdminAgents] Failed to update agent');
      return reply.code(500).send({ error: error.message });
    }
  });

  /**
   * DELETE /api/admin/agents/:id - Soft delete (disable) agent
   */
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    try {
      await prisma.agent.update({
        where: { id: request.params.id },
        data: { enabled: false },
      });
      await invalidateRegistryCache();
      return reply.send({ deleted: true });
    } catch (error: any) {
      return reply.code(500).send({ error: error.message });
    }
  });

  /**
   * POST /api/admin/agents/:id/clone - Clone agent definition
   */
  fastify.post<{ Params: { id: string } }>('/:id/clone', async (request, reply) => {
    try {
      const original = await prisma.agent.findUnique({ where: { id: request.params.id } });
      if (!original) return reply.code(404).send({ error: 'Agent not found' });

      const user = (request as any).user;
      const clone = await prisma.agent.create({
        data: {
          name: `${original.name}_copy_${Date.now()}`,
          display_name: `${original.display_name} (Copy)`,
          description: original.description,
          agent_type: original.agent_type,
          category: 'custom',
          model_config: original.model_config as any,
          system_prompt: original.system_prompt,
          graph_definition: original.graph_definition as any,
          state_schema: original.state_schema as any,
          input_schema: original.input_schema as any,
          output_schema: original.output_schema as any,
          rate_limits: original.rate_limits as any,
          cost_limits: original.cost_limits as any,
          tags: original.tags,
          icon: original.icon,
          color: original.color,
          skills: original.skills,
          delegation: original.delegation as any,
          background: original.background as any,
          tools_whitelist: original.tools_whitelist,
          created_by: user?.userId || user?.id,
        },
      });
      return reply.code(201).send(clone);
    } catch (error: any) {
      return reply.code(500).send({ error: error.message });
    }
  });

  // ─── Skills Management ────────────────────────────────────────────

  /**
   * GET /api/admin/agents/skills - List all skills
   */
  fastify.get('/skills', async (_request, reply) => {
    try {
      const skills = await prisma.agentSkill.findMany({
        orderBy: { created_at: 'desc' },
      });
      return reply.send({ skills });
    } catch (error: any) {
      if (error.code === 'P2021') return reply.send({ skills: [] });
      return reply.code(500).send({ error: error.message });
    }
  });

  /**
   * POST /api/admin/agents/skills - Create/import skill
   */
  fastify.post('/skills', async (request, reply) => {
    try {
      const body = request.body as any;
      const user = (request as any).user;
      const skill = await prisma.agentSkill.create({
        data: {
          name: body.name,
          display_name: body.displayName || body.name,
          description: body.description,
          type: body.type || 'prompt_injection',
          definition: body.definition || {},
          source: body.source || 'custom',
          source_url: body.sourceUrl,
          parameters: body.parameters || {},
          required_tools: body.requiredTools || [],
          visibility: body.visibility || 'private',
          created_by: user?.userId || user?.id || 'system',
          tags: body.tags || [],
        },
      });
      return reply.code(201).send(skill);
    } catch (error: any) {
      return reply.code(500).send({ error: error.message });
    }
  });

  /**
   * POST /api/admin/agents/skills/import - Import skill from SKILL.md format
   * Accepts raw markdown with YAML frontmatter (--- delimited) and converts to AgentSkill record.
   * Content-Type: text/markdown or application/json with { markdown: "..." }
   */
  fastify.post('/skills/import', async (request, reply) => {
    try {
      const user = (request as any).user;
      let markdown: string;

      const ct = (request.headers['content-type'] || '').toLowerCase();
      if (ct.includes('text/markdown') || ct.includes('text/plain')) {
        markdown = request.body as string;
      } else {
        const body = request.body as any;
        markdown = body?.markdown;
      }

      if (!markdown || typeof markdown !== 'string') {
        return reply.code(400).send({ error: 'Missing markdown content. Send as text/markdown body or JSON { "markdown": "..." }' });
      }

      // Parse YAML frontmatter
      const fmMatch = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
      if (!fmMatch) {
        return reply.code(400).send({ error: 'Invalid SKILL.md format. Expected YAML frontmatter between --- delimiters.' });
      }

      const frontmatterText = fmMatch[1];
      const bodyContent = fmMatch[2].trim();

      // Simple YAML parser for flat key-value pairs and arrays
      const meta: Record<string, any> = {};
      for (const line of frontmatterText.split('\n')) {
        const kvMatch = line.match(/^(\w[\w_-]*):\s*(.*)$/);
        if (kvMatch) {
          const key = kvMatch[1].trim();
          let val: any = kvMatch[2].trim();
          // Handle YAML arrays like [item1, item2]
          if (val.startsWith('[') && val.endsWith(']')) {
            val = val.slice(1, -1).split(',').map((s: string) => s.trim().replace(/^["']|["']$/g, ''));
          } else if (val === 'true') val = true;
          else if (val === 'false') val = false;
          else if (/^\d+$/.test(val)) val = parseInt(val, 10);
          else val = val.replace(/^["']|["']$/g, '');
          meta[key] = val;
        }
      }

      if (!meta.name) {
        return reply.code(400).send({ error: 'Frontmatter must include a "name" field.' });
      }

      const skill = await prisma.agentSkill.create({
        data: {
          name: meta.name,
          display_name: meta.display_name || meta.displayName || meta.name,
          description: meta.description || bodyContent.substring(0, 200),
          type: meta.type || 'prompt_injection',
          definition: { systemPrompt: bodyContent, ...meta },
          source: 'skill_md_import',
          source_url: meta.source_url || meta.sourceUrl || null,
          parameters: meta.parameters || {},
          required_tools: Array.isArray(meta.required_tools || meta.requiredTools) ? (meta.required_tools || meta.requiredTools) : [],
          visibility: meta.visibility || 'private',
          created_by: user?.userId || user?.id || 'system',
          tags: Array.isArray(meta.tags) ? meta.tags : [],
        },
      });

      return reply.code(201).send({ skill, imported: true });
    } catch (error: any) {
      return reply.code(500).send({ error: error.message });
    }
  });

  /**
   * DELETE /api/admin/agents/skills/:id
   */
  fastify.delete<{ Params: { id: string } }>('/skills/:id', async (request, reply) => {
    try {
      await prisma.agentSkill.delete({ where: { id: request.params.id } });
      return reply.send({ deleted: true });
    } catch (error: any) {
      return reply.code(500).send({ error: error.message });
    }
  });

  /**
   * PATCH /api/admin/agents/skills/:id - Update a skill
   */
  fastify.patch<{ Params: { id: string } }>('/skills/:id', async (request, reply) => {
    try {
      const body = request.body as any;
      const data: any = {};
      if (body.display_name !== undefined) data.display_name = body.display_name;
      if (body.description !== undefined) data.description = body.description;
      if (body.type !== undefined) data.type = body.type;
      if (body.tags !== undefined) data.tags = body.tags;
      if (body.visibility !== undefined) data.visibility = body.visibility;
      if (body.definition !== undefined) data.definition = body.definition;
      if (body.source_url !== undefined) data.source_url = body.source_url;

      const updated = await prisma.agentSkill.update({
        where: { id: request.params.id },
        data,
      });
      return reply.send({ skill: updated });
    } catch (error: any) {
      return reply.code(500).send({ error: error.message });
    }
  });

  // ─── Execution Monitoring ─────────────────────────────────────────

  /**
   * GET /api/admin/agents/executions - List agent executions
   */
  fastify.get('/executions', async (request, reply) => {
    try {
      const query = request.query as any;
      const where: any = {};
      if (query.userId) where.user_id = query.userId;
      if (query.status) where.status = query.status;

      // Use agentRunLog for real execution data
      if (query.status) where.status = query.status;
      const executions = await prisma.agentRunLog.findMany({
        where,
        orderBy: { started_at: 'desc' },
        take: Number(query.limit) || 50,
        skip: Number(query.offset) || 0,
        include: { agent: { select: { agent_type: true, name: true } } },
      });
      return reply.send({ executions });
    } catch (error: any) {
      if (error.code === 'P2021') return reply.send({ executions: [] });
      return reply.code(500).send({ error: error.message });
    }
  });

  /**
   * GET /api/admin/agents/metrics - Aggregated agent metrics
   */
  fastify.get('/metrics', async (_request, reply) => {
    try {
      const [totalAgents, totalExecutions, totalSkills] = await Promise.all([
        prisma.agent.count().catch(() => 0),
        prisma.agentRunLog.count().catch(() => 0),
        prisma.agentSkill.count().catch(() => 0),
      ]);
      return reply.send({ totalAgents, totalExecutions, totalSkills });
    } catch (error: any) {
      return reply.send({ totalAgents: 0, totalExecutions: 0, totalSkills: 0 });
    }
  });

  /**
   * GET /api/admin/agents/costs - Cost breakdown
   */
  fastify.get('/costs', async (request, reply) => {
    try {
      const auditLogs = await prisma.agentAuditLog.findMany({
        where: { cost_cents: { not: null } },
        orderBy: { timestamp: 'desc' },
        take: 100,
        select: {
          agent_id: true,
          user_id: true,
          cost_cents: true,
          tokens_used: true,
          timestamp: true,
        },
      });
      return reply.send({ costs: auditLogs });
    } catch (error: any) {
      if (error.code === 'P2021') return reply.send({ costs: [] });
      return reply.code(500).send({ error: error.message });
    }
  });

  /**
   * POST /api/admin/agents/:id/test - Test an agent with a message
   */
  fastify.post<{ Params: { id: string } }>('/:id/test', async (request, reply) => {
    try {
      // Try UUID first, then fallback to name/agent_type lookup
      let agent = await prisma.agent.findUnique({ where: { id: request.params.id } });
      if (!agent) {
        agent = await prisma.agent.findFirst({
          where: {
            OR: [
              { name: request.params.id },
              { agent_type: request.params.id },
            ],
          },
        });
      }
      if (!agent) return reply.code(404).send({ error: 'Agent not found' });

      const body = request.body as any;
      const message = body.message || body.input || body.task || 'Hello';

      // Route to openagentic-proxy for execution
      const openagenticProxyUrl = process.env.OPENAGENTIC_PROXY_URL || 'http://openagentic-openagentic-proxy:3300';
      const user = (request as any).user;

      // Use internal service key for openagentic-proxy auth (same as list endpoint)
      const internalKey = process.env.OPENAGENTIC_PROXY_INTERNAL_KEY || '';
      const proxyHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${internalKey}`,
        'X-Agent-Proxy': 'true',
        'X-User-Id': user?.userId || user?.id || 'admin',
        'X-Admin-Test': 'true',
      };
      // Also forward user's auth if available (for LLM calls)
      if (request.headers.authorization) {
        proxyHeaders['X-User-Token'] = request.headers.authorization;
      }

      const proxyResponse = await fetch(`${openagenticProxyUrl}/api/agents/execute-sync`, {
        method: 'POST',
        headers: proxyHeaders,
        body: JSON.stringify({
          agents: [{
            role: agent.agent_type || agent.name,
            task: message,
          }],
          userId: user?.userId || user?.id || 'admin-test',
          isAdmin: true,
          orchestration: 'sequential',
          sessionId: `admin-test-${Date.now()}`,
          // Forward user token so agent can make LLM calls
          userToken: user?.token || (request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.substring(7) : '') || internalKey,
        }),
      });

      if (!proxyResponse.ok) {
        const errText = await proxyResponse.text();
        return reply.code(proxyResponse.status).send({
          output: `Agent proxy error (${proxyResponse.status}): ${errText}`,
        });
      }

      const result = await proxyResponse.json() as any;
      // execute-sync returns { results: [{ role, output, status }], total_cost_cents, total_tokens, total_duration_ms }
      const firstResult = result.results?.[0] || {};
      return reply.send({
        output: firstResult.output || result.output || result.response || JSON.stringify(result, null, 2),
        agentId: agent.id,
        agentName: agent.display_name,
        model: (agent.model_config as any)?.primaryModel || 'auto',
        results: result.results,
        metrics: {
          modelUsed: (agent.model_config as any)?.primaryModel || 'auto',
          totalInputTokens: result.total_tokens ? Math.round(result.total_tokens * 0.6) : 0,
          totalOutputTokens: result.total_tokens ? Math.round(result.total_tokens * 0.4) : 0,
          totalDurationMs: result.total_duration_ms || 0,
          totalCostCents: result.total_cost_cents || 0,
        },
      });
    } catch (error: any) {
      logger.error({ error, id: request.params.id }, '[AdminAgents] Test failed');
      return reply.send({ output: `Error: ${error.message}` });
    }
  });

  /**
   * POST /api/admin/agents/executions/:id/cancel - Cancel execution
   */
  fastify.post<{ Params: { id: string } }>('/executions/:id/cancel', async (request, reply) => {
    try {
      await prisma.agentExecution.update({
        where: { id: request.params.id },
        data: { status: 'cancelled' },
      });
      return reply.send({ cancelled: true });
    } catch (error: any) {
      return reply.code(500).send({ error: error.message });
    }
  });

  // ─── Execution Dashboard Endpoints ──────────────────────────────────

  /**
   * GET /api/admin/agents/executions/stats - Aggregate execution metrics
   */
  fastify.get('/executions/stats', async (_request, reply) => {
    try {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Query agentic_loop_executions (AgentRunLog) — where AgentRegistry records real runs
      const [totalToday, totalWeek, successWeek, failedWeek, costData] = await Promise.all([
        prisma.agentRunLog.count({ where: { started_at: { gte: todayStart } } }).catch(() => 0),
        prisma.agentRunLog.count({ where: { started_at: { gte: weekAgo } } }).catch(() => 0),
        prisma.agentRunLog.count({ where: { started_at: { gte: weekAgo }, status: 'completed' } }).catch(() => 0),
        prisma.agentRunLog.count({ where: { started_at: { gte: weekAgo }, status: 'failed' } }).catch(() => 0),
        prisma.agentRunLog.aggregate({
          where: { started_at: { gte: todayStart } },
          _sum: { estimated_cost: true, total_tokens: true },
        }).catch(() => ({ _sum: { estimated_cost: null, total_tokens: null } })),
      ]);

      // Get live agent count from openagentic-proxy
      let activeAgents = 0;
      try {
        const openagenticProxyUrl = process.env.OPENAGENTIC_PROXY_URL || 'http://openagentic-openagentic-proxy:3300';
        const resp = await fetch(`${openagenticProxyUrl}/api/agents/stats`);
        if (resp.ok) {
          const stats = await resp.json() as any;
          activeAgents = stats.activeCount || 0;
        }
      } catch {}

      const successRate = totalWeek > 0 ? Math.round((successWeek / totalWeek) * 100) : 0;

      return reply.send({
        activeAgents,
        totalToday,
        totalWeek,
        successRate,
        failedToday: failedWeek,
        costTodayCents: Number(costData._sum?.estimated_cost || 0),
        tokensToday: costData._sum?.total_tokens || 0,
      });
    } catch (error: any) {
      return reply.send({ activeAgents: 0, totalToday: 0, totalWeek: 0, successRate: 0, failedToday: 0, costTodayCents: 0, tokensToday: 0 });
    }
  });

  /**
   * GET /api/admin/agents/executions/live - Live executions from openagentic-proxy
   */
  fastify.get('/executions/live', async (_request, reply) => {
    try {
      const openagenticProxyUrl = process.env.OPENAGENTIC_PROXY_URL || 'http://openagentic-openagentic-proxy:3300';
      const resp = await fetch(`${openagenticProxyUrl}/api/agents/executions/live`);
      if (!resp.ok) return reply.send({ executions: [] });
      const data = await resp.json() as any;
      return reply.send(data);
    } catch {
      return reply.send({ executions: [] });
    }
  });

  /**
   * DELETE /api/admin/agents/executions/:id - Kill a running execution
   */
  fastify.delete<{ Params: { id: string } }>('/executions/:id', async (request, reply) => {
    try {
      const openagenticProxyUrl = process.env.OPENAGENTIC_PROXY_URL || 'http://openagentic-openagentic-proxy:3300';
      const resp = await fetch(`${openagenticProxyUrl}/api/agents/executions/${request.params.id}/kill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!resp.ok) {
        return reply.code(resp.status).send({ error: 'Failed to kill execution' });
      }
      // Also update DB status
      await prisma.agentExecution.update({
        where: { id: request.params.id },
        data: { status: 'killed' },
      }).catch(() => {});
      return reply.send({ killed: true });
    } catch (error: any) {
      return reply.code(500).send({ error: error.message });
    }
  });

  // ─── Audit Events ─────────────────────────────────────────────────

  /**
   * GET /api/admin/agents/executions/:id/events
   * Returns all AgentAuditEvent rows for a given executionId, ordered by createdAt asc.
   * Used by the admin tree-replay view.
   */
  fastify.get<{ Params: { id: string } }>('/executions/:id/events', async (request, reply) => {
    try {
      const { id } = request.params;
      const events = await prisma.agentAuditEvent.findMany({
        where: { executionId: id },
        orderBy: { createdAt: 'asc' },
      });
      return reply.send({ events });
    } catch (error: any) {
      if (error.code === 'P2021') return reply.send({ events: [] });
      logger.error({ error, id: request.params.id }, '[AdminAgents] Failed to fetch execution events');
      return reply.code(500).send({ error: error.message });
    }
  });

  /**
   * GET /api/admin/agents/audit/export
   * Export AgentAuditEvent rows as CSV or JSON.
   * Query params: format (csv|json), startDate (ISO), endDate (ISO)
   */
  fastify.get('/audit/export', async (request, reply) => {
    try {
      const query = request.query as any;
      const format = (query.format || 'json').toLowerCase();
      const where: any = {};
      if (query.startDate) where.createdAt = { ...where.createdAt, gte: new Date(query.startDate) };
      if (query.endDate)   where.createdAt = { ...where.createdAt, lte: new Date(query.endDate) };
      if (query.userId)    where.userId = query.userId;

      const events = await prisma.agentAuditEvent.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        take: Number(query.limit) || 10000,
      });

      if (format === 'csv') {
        const cols = [
          'id', 'executionId', 'sessionId', 'userId', 'agentId', 'agentRole',
          'eventType', 'source', 'riskLevel', 'modelId', 'durationMs',
          'inputTokens', 'outputTokens', 'costCents', 'createdAt',
        ] as const;

        const escapeCell = (v: any): string => {
          if (v === null || v === undefined) return '';
          const s = String(v).replace(/"/g, '""');
          return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
        };

        const rows: string[] = [cols.join(',')];
        for (const e of events) {
          rows.push(cols.map(c => escapeCell((e as any)[c])).join(','));
        }
        const csv = rows.join('\n');

        return reply
          .header('Content-Type', 'text/csv; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="agent_audit_${Date.now()}.csv"`)
          .send(csv);
      }

      // Default: JSON download
      const json = JSON.stringify(events, null, 2);
      return reply
        .header('Content-Type', 'application/json')
        .header('Content-Disposition', `attachment; filename="agent_audit_${Date.now()}.json"`)
        .send(json);
    } catch (error: any) {
      if (error.code === 'P2021') return reply.send([]);
      logger.error({ error }, '[AdminAgents] Audit export failed');
      return reply.code(500).send({ error: error.message });
    }
  });

  /**
   * GET /api/admin/agents/cost-report - Daily cost breakdown by model
   */
  fastify.get('/cost-report', async (request, reply) => {
    try {
      const query = request.query as any;
      const days = Number(query.days) || 7;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const logs = await prisma.agentAuditLog.findMany({
        where: { timestamp: { gte: since }, cost_cents: { not: null } },
        select: { agent_id: true, cost_cents: true, tokens_used: true, action_detail: true, timestamp: true },
        orderBy: { timestamp: 'asc' },
      });

      // Group by day and model
      const byDay = new Map<string, Map<string, { cost: number; tokens: number; count: number }>>();
      for (const log of logs) {
        const day = log.timestamp.toISOString().split('T')[0];
        const detail = log.action_detail as any;
        const model = detail?.model || detail?.modelUsed || 'unknown';
        if (!byDay.has(day)) byDay.set(day, new Map());
        const dayMap = byDay.get(day)!;
        const entry = dayMap.get(model) || { cost: 0, tokens: 0, count: 0 };
        entry.cost += Number(log.cost_cents) || 0;
        entry.tokens += log.tokens_used || 0;
        entry.count++;
        dayMap.set(model, entry);
      }

      const report = Array.from(byDay.entries()).map(([day, models]) => ({
        day,
        models: Array.from(models.entries()).map(([model, data]) => ({ model, ...data })),
        totalCost: Array.from(models.values()).reduce((s, d) => s + d.cost, 0),
      }));

      return reply.send({ report });
    } catch (error: any) {
      if (error.code === 'P2021') return reply.send({ report: [] });
      return reply.code(500).send({ error: error.message });
    }
  });

  /**
   * POST /api/admin/agents/seed
   * Seed default platform agents into the database.
   * Upserts by name — updates existing, creates new.
   * Makes the database the SOT for all agent configs.
   */
  fastify.post('/seed', async (request, reply) => {
    try {
      const user = (request as any).user;
      const userId = user?.userId || user?.id;

      const CONTINUATION = '\n\nCRITICAL: You MUST keep working until your task is FULLY complete. After each tool result, evaluate if there are more steps needed. If yes, call the next tool immediately. Do NOT present partial results or stop early. Only provide your final response when ALL work is done.';

      // NOTE: cloud_operations behavior was previously composed from prompt_modules
      // (the legacy module seeder rip happened in Phase E.3-E.4, 2026-05-10).
      // The system_prompt below is a thin entry-point only — behavioral rules
      // now live in the RBAC `chat-system-{admin,member}.md` files in the
      // services/openagentic-api/src/prompts/ tree.
      const SEED_AGENTS = [
        { name: 'reasoning', display_name: 'Reasoning Agent', agent_type: 'reasoning', system_prompt: 'You are a deep reasoning agent. Analyze thoroughly and provide well-reasoned conclusions.' + CONTINUATION, model_config: { primaryModel: 'auto', maxTokens: 8192, temperature: 0.7, preferredTier: 'premium' }, tools_whitelist: ['web_search', 'web_fetch', 'sequential_thinking'], max_turns: 3, prompt_modules: ['identity-default', 'safety', 'tool-calling', 'continuation'], prompt_strategy: 'composite' },
        { name: 'data_query', display_name: 'Data Query Agent', agent_type: 'data_query', system_prompt: 'You are a data query specialist. Extract and return structured data efficiently.' + CONTINUATION, model_config: { primaryModel: 'auto', maxTokens: 8192, temperature: 0.3, preferredTier: 'economical' }, tools_whitelist: ['admin_postgres_raw_query', 'query_data'], max_turns: 8, prompt_modules: ['identity-default', 'safety', 'tool-calling', 'data-efficiency', 'continuation'], prompt_strategy: 'composite' },
        { name: 'tool_orchestration', display_name: 'Tool Orchestration Agent', agent_type: 'tool_orchestration', system_prompt: 'You are a tool orchestration agent. Determine which tools to call and in what order. If an operation is in progress (status: Creating, Provisioning, etc.), call the status tool again in the next turn. Do not give up — keep polling until the operation completes or fails.' + CONTINUATION, model_config: { primaryModel: 'auto', maxTokens: 8192, temperature: 0.5, preferredTier: 'balanced' }, tools_whitelist: [], max_turns: 20, prompt_modules: ['identity-default', 'safety', 'tool-calling', 'provisioning-loops', 'error-recovery', 'continuation'], prompt_strategy: 'composite' },
        { name: 'summarization', display_name: 'Summarization Agent', agent_type: 'summarization', system_prompt: 'You are a summarization specialist. Distill complex information into clear summaries.' + CONTINUATION, model_config: { primaryModel: 'auto', maxTokens: 8192, temperature: 0.5, preferredTier: 'economical' }, tools_whitelist: [], max_turns: 3, prompt_modules: ['identity-default', 'safety', 'continuation'], prompt_strategy: 'composite' },
        { name: 'code_execution', display_name: 'Code Execution Agent', agent_type: 'code_execution', system_prompt: 'You are a code execution agent. Write, run, and debug code to solve the task.' + CONTINUATION, model_config: { primaryModel: 'auto', maxTokens: 8192, temperature: 0.5, preferredTier: 'balanced' }, tools_whitelist: ['openagentic_execute'], max_turns: 12, prompt_modules: ['identity-default', 'safety', 'tool-calling', 'code-mode', 'continuation'], prompt_strategy: 'composite' },
        { name: 'planning', display_name: 'Planning Agent', agent_type: 'planning', system_prompt: 'You are a planning agent. Break down tasks into clear steps with dependencies.' + CONTINUATION, model_config: { primaryModel: 'auto', maxTokens: 8192, temperature: 0.5, preferredTier: 'premium' }, tools_whitelist: [], max_turns: 5, prompt_modules: ['identity-default', 'safety', 'agent-delegation', 'continuation'], prompt_strategy: 'composite' },
        { name: 'validation', display_name: 'Validation Agent', agent_type: 'validation', system_prompt: 'You are a validation agent. Verify outputs and check for errors.' + CONTINUATION, model_config: { primaryModel: 'auto', maxTokens: 8192, temperature: 0.3, preferredTier: 'economical' }, tools_whitelist: ['web_search'], max_turns: 6, prompt_modules: ['identity-default', 'safety', 'tool-calling', 'grounding', 'continuation'], prompt_strategy: 'composite' },
        { name: 'synthesis', display_name: 'Synthesis Agent', agent_type: 'synthesis', system_prompt: 'You are a synthesis agent. Combine information into a coherent response.' + CONTINUATION, model_config: { primaryModel: 'auto', maxTokens: 8192, temperature: 0.5, preferredTier: 'balanced' }, tools_whitelist: [], max_turns: 3, prompt_modules: ['identity-default', 'safety', 'continuation'], prompt_strategy: 'composite' },
        { name: 'artifact_creation', display_name: 'Artifact Creation Agent', agent_type: 'artifact_creation', system_prompt: null, model_config: { primaryModel: 'auto', maxTokens: 16384, temperature: 0.7, preferredTier: 'premium' }, tools_whitelist: [], max_turns: 8, prompt_modules: ['identity-default', 'safety', 'artifact-creation', 'continuation'], prompt_strategy: 'composite' },
        { name: 'oat_function_builder', display_name: 'OAT Function Builder', agent_type: 'oat_function_builder', system_prompt: null, model_config: { primaryModel: 'auto', maxTokens: 8192, temperature: 0.3, preferredTier: 'balanced' }, tools_whitelist: [], max_turns: 5, prompt_modules: ['identity-default', 'safety', 'oat-guidance', 'continuation'], prompt_strategy: 'composite' },
        // cloud_operations: long-horizon multi-cloud agent.
        // - max_turns lives in model_config.maxTurns (read by /api/agents/resolve)
        // - contextWindowMin enforces 1M-class model floor via ModelCapabilityGate Rule 6
        // - preferredTier is the SmartRouter hint (premium for this workload)
        // - Behavioral rules are composed from prompt_modules — DO NOT inline strings here
        { name: 'cloud_operations', display_name: 'Cloud Operations Agent', agent_type: 'cloud_operations', system_prompt: 'You are the cloud_operations agent. Long-horizon multi-cloud provisioning, audit, and lifecycle work across Azure, AWS, and GCP. Behavioral rules are composed from the modules listed in prompt_modules.', model_config: { primaryModel: 'auto', maxTokens: 32768, temperature: 0.1, preferredTier: 'premium', contextWindowMin: 1_000_000, maxTurns: 40 }, tools_whitelist: [], max_turns: 40, prompt_modules: ['identity-default', 'safety', 'tool-calling-strategy', 'cloud-ops-identity-discovery', 'cloud-ops-typed-tools-first', 'cloud-ops-quota-fallback', 'cloud-ops-region-fallback', 'cloud-ops-dependency-ordering', 'cloud-ops-long-running', 'cloud-ops-cleanup', 'cloud-ops-hitl-denial', 'cloud-ops-no-early-termination', 'cloud-ops-token-failure', 'provisioning-loops', 'error-recovery', 'azure-ops', 'aws-ops', 'gcp-ops', 'react-reasoning', 'continuation'], prompt_strategy: 'composite' },
        { name: 'custom', display_name: 'Custom Agent', agent_type: 'custom', system_prompt: 'You are a specialized agent. Complete the assigned task.' + CONTINUATION, model_config: { primaryModel: 'auto', maxTokens: 8192, temperature: 0.5, preferredTier: 'balanced' }, tools_whitelist: [], max_turns: 5, prompt_modules: ['identity-default', 'safety', 'tool-calling', 'continuation'], prompt_strategy: 'composite' },
      ];

      const results = { created: 0, updated: 0, errors: 0, details: [] as string[] };

      for (const agent of SEED_AGENTS) {
        try {
          const existing = await prisma.agent.findFirst({
            where: { name: agent.name },
            select: { id: true },
          });

          if (existing) {
            await prisma.agent.update({
              where: { id: existing.id },
              data: {
                display_name: agent.display_name,
                agent_type: agent.agent_type,
                system_prompt: agent.system_prompt,
                model_config: agent.model_config as any,
                tools_whitelist: agent.tools_whitelist,
                prompt_modules: agent.prompt_modules,
                prompt_strategy: agent.prompt_strategy,
                category: 'platform',
                enabled: true,
              },
            });
            results.updated++;
            results.details.push(`Updated "${agent.display_name}" (${existing.id})`);
          } else {
            const created = await prisma.agent.create({
              data: {
                name: agent.name,
                display_name: agent.display_name,
                description: `Platform default ${agent.agent_type} agent`,
                agent_type: agent.agent_type,
                category: 'platform',
                model_config: agent.model_config as any,
                system_prompt: agent.system_prompt,
                tools_whitelist: agent.tools_whitelist,
                prompt_modules: agent.prompt_modules,
                prompt_strategy: agent.prompt_strategy,
                is_default: true,
                enabled: true,
                created_by: userId,
              },
            });
            results.created++;
            results.details.push(`Created "${agent.display_name}" (${created.id})`);
          }
        } catch (err: any) {
          results.errors++;
          results.details.push(`Error seeding "${agent.name}": ${err.message}`);
        }
      }

      return reply.send({
        success: true,
        message: `Seeded ${results.created} agents (${results.updated} updated, ${results.errors} errors)`,
        ...results,
      });
    } catch (error: any) {
      return reply.code(500).send({ error: error.message });
    }
  });
};
