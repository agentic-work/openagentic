/**
 * Admin V3 Extras — read-only endpoints referenced by the v3 admin UI.
 *
 * The v3 admin pages renders `<EmptyInline>` placeholders + TODO comments
 * naming endpoints that didn't exist server-side. This file provides minimal
 * Fastify handlers backed by real Prisma queries (or audit-log fallback when
 * no purpose-built table exists).
 *
 * All routes are READ-only. Mounted under prefix `/api/admin` by
 * admin.plugin.ts and inherit `adminMiddleware` from the parent register
 * scope, so the per-handler guard is for defence-in-depth only.
 *
 * 14 endpoints (reference v3 page → endpoint):
 *   1.  GET /router/decisions                           — RouterTuningLab
 *   2.  GET /mcp/servers/:id/healthcheck-history        — MCPFleetV3 health pane
 *   3.  GET /permissions?mcpServer=:name                — MCPFleetV3 permissions pane
 *   4.  GET /mcp-cost?serverName=:name&window=24h       — MCPFleetV3 cost pane
 *   5.  GET /flows/recent-failures                       — WorkflowsPage failures
 *   6.  GET /flows/failing-nodes                         — WorkflowsPage failing-nodes
 *   7.  GET /workflows/:id/cost                          — WorkflowsPage costs (per-flow)
 *   8.  GET /api-requests/top-endpoints                  — DashboardV3 (api activity)
 *   9.  GET /api-requests/status-codes                   — DashboardV3 (api activity)
 *   10. GET /api-requests/auth-methods                   — DashboardV3 (api activity)
 *   11. GET /perf/percentiles                            — DashboardV3 (performance)
 *   12. GET /openagentic/api-keys                         — DashboardV3 (openagentic)
 *   13. GET /llm-providers/:id/health-history            — llm-providers/HealthPane
 *   14. GET /audit-logs/:id                              — single-event detail drilldown
 *
 * Where the canonical Prisma model doesn't exist, we fall back to scanning
 * `AdminAuditLog` with the right `action`/`resource_type` filter — those
 * fallbacks are flagged inline with a `// FALLBACK:` comment.
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma.js';
import { loggers } from '../../utils/logger.js';
import { createChainedAdminAudit } from '../../services/audit/adminAuditChain.js';

const logger = loggers.routes.child({ component: 'AdminV3Extras' });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampLimit(raw: unknown, def = 20, max = 200): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.floor(n), max);
}

function windowToHours(raw: unknown, def = 24): number {
  if (typeof raw !== 'string') return def;
  const m = raw.trim().toLowerCase().match(/^(\d+)\s*(h|d)?$/);
  if (!m) return def;
  const n = Number.parseInt(m[1], 10);
  if (!Number.isFinite(n) || n <= 0) return def;
  const unit = m[2] ?? 'h';
  return unit === 'd' ? n * 24 : n;
}

// ---------------------------------------------------------------------------
// Permission-rule helpers (shared with the PUT /permissions alias below).
// Mirrors the validation + audit shape in routes/admin/permissions.ts so the
// /api/admin/permissions alias behaves identically to the canonical
// /api/admin/tool-permissions handler it delegates to.
// ---------------------------------------------------------------------------
const PERMISSION_VALID_BEHAVIORS = new Set(['allow', 'deny', 'ask']);
const PERMISSION_VALID_SOURCES = new Set([
  'userSettings',
  'projectSettings',
  'localSettings',
  'flagSettings',
  'policySettings',
  'cliArg',
  'command',
  'session',
]);

function validatePermissionRule(
  input: unknown,
): { ok: true; rule: any } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'rule must be an object' };
  }
  const r = input as Record<string, unknown>;
  const source = typeof r.source === 'string' ? r.source : 'userSettings';
  if (!PERMISSION_VALID_SOURCES.has(source)) {
    return { ok: false, error: `source must be one of: ${[...PERMISSION_VALID_SOURCES].join(', ')}` };
  }
  const behavior = r.ruleBehavior ?? r.behavior;
  if (typeof behavior !== 'string' || !PERMISSION_VALID_BEHAVIORS.has(behavior)) {
    return { ok: false, error: 'ruleBehavior must be one of: allow, deny, ask' };
  }
  const ruleValue = r.ruleValue as Record<string, unknown> | undefined;
  const toolName = ruleValue?.toolName ?? r.toolName;
  if (typeof toolName !== 'string' || toolName.length === 0) {
    return { ok: false, error: 'ruleValue.toolName must be a non-empty string' };
  }
  return {
    ok: true,
    rule: {
      source,
      ruleBehavior: behavior,
      ruleValue: {
        toolName,
        ruleContent: typeof ruleValue?.ruleContent === 'string' ? ruleValue.ruleContent : undefined,
      },
    },
  };
}

async function writePermissionAudit(
  req: FastifyRequest,
  opts: { action: string; resource_type: string; resource_id: string; details?: Record<string, any> },
): Promise<void> {
  const user = (req as any).user ?? {};
  try {
    await createChainedAdminAudit({
      data: {
        admin_user_id: typeof user.id === 'string' ? user.id : null,
        admin_email: typeof user.email === 'string' ? user.email : null,
        ip_address: req.ip ?? null,
        action: opts.action,
        resource_type: opts.resource_type,
        resource_id: opts.resource_id,
        details: opts.details ?? {},
      },
    });
  } catch (err: any) {
    logger.warn({ err: err?.message, action: opts.action }, 'Failed to write admin_audit_log row');
  }
}

function windowCutoff(raw: unknown, def = 24): Date {
  return new Date(Date.now() - windowToHours(raw, def) * 60 * 60 * 1000);
}

/** Resolve Prometheus base URL (PROM_URL → PROMETHEUS_URL → host+port). */
function resolvePromBase(): string | null {
  const explicit = process.env.PROM_URL || process.env.PROMETHEUS_URL;
  if (explicit && explicit.length > 0) return explicit.replace(/\/+$/, '');
  const host = process.env.PROMETHEUS_HOST;
  if (!host) return null;
  const port = process.env.PROMETHEUS_PORT || '9090';
  return `http://${host}:${port}`;
}

/** Run a PromQL instant query. Returns null on any failure. */
async function promInstant(base: string, query: string, signal?: AbortSignal): Promise<Array<{ metric: Record<string, string>; value: number }> | null> {
  try {
    const url = `${base}/api/v1/query?query=${encodeURIComponent(query)}`;
    const res = await fetch(url, { method: 'GET', signal });
    if (!res.ok) return null;
    const env = (await res.json()) as { status: string; data?: { result?: Array<{ metric: Record<string, string>; value: [number, string] }> } };
    if (env.status !== 'success' || !env.data?.result) return null;
    return env.data.result.map((r) => ({ metric: r.metric, value: Number(r.value[1]) }));
  } catch {
    return null;
  }
}

function dayBucket(d: Date): string {
  // YYYY-MM-DD
  return d.toISOString().slice(0, 10);
}

function hourBucket(d: Date): string {
  // YYYY-MM-DDTHH:00:00.000Z
  const iso = d.toISOString();
  return `${iso.slice(0, 13)}:00:00.000Z`;
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sortedAsc.length) - 1;
  return sortedAsc[Math.max(0, Math.min(idx, sortedAsc.length - 1))];
}

function isAdminUser(req: FastifyRequest): boolean {
  const user = (req as any).user;
  return Boolean(user?.isAdmin || user?.role === 'admin');
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const adminV3ExtrasRoutes: FastifyPluginAsync = async (fastify) => {

  // ─────────────────────────────────────────────────────────────────────────
  // 1. GET /router/decisions?limit=20
  //    Recent SmartModelRouter decisions. No dedicated table exists, so we
  //    pull from `ModelRoutingDecision` (auto-emitted by SmartModelRouter)
  //    and project the v3 RouterDecisionEntry shape.
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/router/decisions', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, string>;
    const limit = clampLimit(query.limit, 20, 200);

    try {
      const rows = await prisma.modelRoutingDecision.findMany({
        orderBy: { created_at: 'desc' },
        take: limit,
      });

      const decisions = rows.map((r) => {
        const ctx = (r.context ?? {}) as Record<string, any>;
        return {
          id: r.id,
          timestamp: r.created_at.toISOString(),
          prompt: typeof ctx.prompt === 'string' ? ctx.prompt.slice(0, 500) : undefined,
          intent: typeof ctx.intent === 'string' ? ctx.intent : undefined,
          chosenModel: r.model_to,
          previousModel: r.model_from,
          alternates: Array.isArray(ctx.alternates) ? ctx.alternates : [],
          score: typeof ctx.score === 'number' ? ctx.score : undefined,
          fca: typeof ctx.fca === 'number' ? ctx.fca : undefined,
          latencyMs: typeof ctx.latencyMs === 'number' ? ctx.latencyMs : undefined,
          reason: r.reason,
          tier: typeof ctx.tier === 'string' ? ctx.tier : undefined,
          resolvedBy: typeof ctx.resolvedBy === 'string' ? ctx.resolvedBy : undefined,
          inputCostPer1k: typeof ctx.inputCostPer1k === 'number' ? ctx.inputCostPer1k : undefined,
          avgLatencyMs: typeof ctx.avgLatencyMs === 'number' ? ctx.avgLatencyMs : undefined,
          sessionId: r.session_id,
        };
      });

      return reply.send({ success: true, decisions, count: decisions.length });
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to fetch router decisions');
      return reply.code(500).send({ success: false, error: 'Failed to fetch router decisions' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. GET /mcp/servers/:id/healthcheck-history?hours=24
  //    Per-server health probe history. No `McpHealthProbe` model exists, so
  //    FALLBACK: scan AdminAuditLog where action LIKE 'mcp.healthcheck.%'
  //    AND resource_id = :id.
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/mcp/servers/:id/healthcheck-history', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, string>;
    if (!id || typeof id !== 'string') {
      return reply.code(400).send({ success: false, error: 'id is required' });
    }
    const hours = windowToHours(query.hours, 24);
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

    try {
      // FALLBACK: audit-log scan (no McpHealthProbe model in schema).
      const events = await prisma.adminAuditLog.findMany({
        where: {
          resource_id: id,
          action: { startsWith: 'mcp.healthcheck.' },
          created_at: { gte: cutoff },
        },
        orderBy: { created_at: 'desc' },
        take: 1000,
      });

      const probes = events.map((e) => {
        const details = (e.details ?? {}) as Record<string, any>;
        return {
          timestamp: e.created_at.toISOString(),
          status: e.action.endsWith('.ok') ? 'ok' : e.action.endsWith('.fail') ? 'fail' : (typeof details.status === 'string' ? details.status : 'unknown'),
          latencyMs: typeof details.latencyMs === 'number' ? details.latencyMs : undefined,
          error: typeof details.error === 'string' ? details.error : undefined,
        };
      });

      return reply.send({ success: true, probes, source: 'admin_audit_log' });
    } catch (error: any) {
      logger.error({ err: error, mcpId: id }, 'Failed to fetch MCP healthcheck history');
      return reply.code(500).send({ success: false, error: 'Failed to fetch healthcheck history' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. GET /permissions?mcpServer=:name
  //    Cross-reference UserPermissions for users whose
  //    `allowed_mcp_servers` array contains `:name`. Also walks
  //    GroupPermissions for the group view.
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/permissions', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, string>;
    const mcpServer = (query.mcpServer ?? '').trim();
    if (!mcpServer) {
      return reply.code(400).send({ success: false, error: 'mcpServer query param is required' });
    }

    try {
      const userPerms = await prisma.userPermissions.findMany({
        where: {
          OR: [
            { allowed_mcp_servers: { has: mcpServer } },
            { denied_mcp_servers: { has: mcpServer } },
          ],
        },
        select: {
          user_id: true,
          allowed_mcp_servers: true,
          denied_mcp_servers: true,
        },
      });

      const userIds = userPerms.map((p) => p.user_id);
      const users = userIds.length > 0
        ? await prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, email: true, name: true },
          })
        : [];
      const userMap = new Map(users.map((u) => [u.id, u]));

      const usersOut = userPerms.map((p) => {
        const u = userMap.get(p.user_id);
        const allowed = p.allowed_mcp_servers.includes(mcpServer);
        const denied = p.denied_mcp_servers.includes(mcpServer);
        return {
          userId: p.user_id,
          email: u?.email ?? '',
          name: u?.name ?? null,
          allowed: allowed && !denied,
          source: denied ? 'denied' : (allowed ? 'allowed' : 'inherited'),
        };
      });

      // Group cross-reference (Azure AD groups stored in GroupPermissions).
      const groupPerms = await prisma.groupPermissions.findMany({
        where: {
          OR: [
            { allowed_mcp_servers: { has: mcpServer } },
            { denied_mcp_servers: { has: mcpServer } },
          ],
        },
        select: {
          azure_group_id: true,
          azure_group_name: true,
          allowed_mcp_servers: true,
          denied_mcp_servers: true,
        },
      });

      const groupsOut = groupPerms.map((g) => {
        const allowed = g.allowed_mcp_servers.includes(mcpServer);
        const denied = g.denied_mcp_servers.includes(mcpServer);
        return {
          groupId: g.azure_group_id,
          name: g.azure_group_name,
          allowed: allowed && !denied,
          source: denied ? 'denied' : (allowed ? 'allowed' : 'inherited'),
        };
      });

      return reply.send({ success: true, mcpServer, users: usersOut, groups: groupsOut });
    } catch (error: any) {
      logger.error({ err: error, mcpServer }, 'Failed to fetch permissions for MCP server');
      return reply.code(500).send({ success: false, error: 'Failed to fetch permissions' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3a. GET /permissions/available-mcps
  //     Grantable MCP servers for the per-user permission picker + the MCP
  //     Fleet IAM cross-reference pane. Reflects the REAL fleet — the live
  //     mcp-proxy servers (running built-ins, normalized to bare ids) UNIONed
  //     with the known built-in catalog (so env-disabled built-ins are still
  //     grantable) and any DB-registered admin-added servers. The DB registry
  //     alone is empty for built-ins, so it can no longer be the source here.
  //     Returns { servers: [{ id, name, description }] }.
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/permissions/available-mcps', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { MCPSyncService } = await import('../../services/MCPSyncService.js');
      const { normalizeMcpServerId, BUILTIN_MCP_CATALOG } = await import('../../services/mcpBuiltinCatalog.js');

      const byId = new Map<string, { id: string; name: string; description: string | null }>();

      // 1. Known built-in catalog (running OR available — all are grantable).
      for (const def of Object.values(BUILTIN_MCP_CATALOG)) {
        byId.set(def.id, { id: def.id, name: def.name, description: def.description });
      }

      // 2. Live proxy servers (running built-ins + user-connected remotes),
      //    normalized to bare ids so they reconcile with the catalog.
      try {
        const sync = new MCPSyncService(logger);
        const proxyServers = await sync.getMCPProxyServers();
        for (const ps of proxyServers) {
          const raw = String(ps.name ?? ps.id ?? '').trim();
          if (!raw) continue;
          const id = normalizeMcpServerId(raw) || raw.toLowerCase();
          if (!byId.has(id)) {
            byId.set(id, { id, name: id, description: ps.description ?? null });
          }
        }
      } catch (e: any) {
        logger.warn({ err: e?.message }, 'available-mcps: proxy fetch failed (non-fatal)');
      }

      // 3. DB-registered admin-added servers (anything not already covered).
      const rows = await prisma.mCPServerConfig.findMany({
        where: { enabled: true },
        select: { id: true, name: true, description: true },
        orderBy: { name: 'asc' },
      });
      for (const r of rows) {
        const id = normalizeMcpServerId(r.id) || r.id;
        if (!byId.has(id)) {
          byId.set(id, { id, name: r.name, description: r.description ?? null });
        }
      }

      const servers = Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
      return reply.send({ servers });
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to list available MCP servers');
      return reply.code(500).send({ success: false, error: 'Failed to list available MCP servers' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3b. GET /permissions/available-llms
  //     Grantable LLM providers for the per-user permission picker. Source =
  //     the LLMProvider registry (same rows as GET /api/admin/llm-providers).
  //     Returns { providers: [{ id, name, display_name, provider_type }] }.
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/permissions/available-llms', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const rows = await prisma.lLMProvider.findMany({
        where: { deleted_at: null, enabled: true },
        select: { id: true, name: true, display_name: true, provider_type: true },
        orderBy: { display_name: 'asc' },
      });
      const providers = rows.map((r) => ({
        id: r.id,
        name: r.name,
        display_name: r.display_name,
        provider_type: r.provider_type,
      }));
      return reply.send({ providers });
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to list available LLM providers');
      return reply.code(500).send({ success: false, error: 'Failed to list available LLM providers' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3c. PUT /permissions  — thin alias of the live tool-permissions PUT.
  //     The PermissionsPage saves the whole tool-permission rule set here.
  //     Delegates to the SAME PermissionService.replaceAllRules used by the
  //     canonical PUT /api/admin/tool-permissions handler.
  //     Body: { rules: PermissionRule[] }
  // ─────────────────────────────────────────────────────────────────────────
  fastify.put('/permissions', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { rules?: unknown } | null;
    if (!body || !Array.isArray(body.rules)) {
      return reply.code(400).send({ success: false, error: 'rules array required' });
    }
    try {
      const { getPermissionService } = await import('../../services/PermissionService.js');
      const validated: any[] = [];
      for (const raw of body.rules) {
        const v = validatePermissionRule(raw);
        if (!v.ok) {
          return reply.code(400).send({ success: false, error: `invalid rule: ${(v as { error: string }).error}` });
        }
        validated.push(v.rule);
      }
      const svc = getPermissionService(loggers.services as any);
      svc.replaceAllRules(validated);
      await writePermissionAudit(request, {
        action: 'permission_rules_replaced',
        resource_type: 'permission_rules',
        resource_id: 'all',
        details: { ruleCount: validated.length },
      });
      return reply.send({ success: true, count: validated.length });
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to replace permission rules');
      return reply.code(500).send({ success: false, error: 'Failed to replace permission rules' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3d. POST /permissions/reset  — thin alias of the live
  //     POST /api/admin/tool-permissions/reset. Clears user rules back to the
  //     seeded defaults via the same PermissionService.clearAllUserRules.
  // ─────────────────────────────────────────────────────────────────────────
  fastify.post('/permissions/reset', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { getPermissionService } = await import('../../services/PermissionService.js');
      const svc = getPermissionService(loggers.services as any);
      svc.clearAllUserRules();
      await writePermissionAudit(request, {
        action: 'permission_rules_reset',
        resource_type: 'permission_rules',
        resource_id: 'all',
      });
      return reply.send({ success: true });
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to reset permission rules');
      return reply.code(500).send({ success: false, error: 'Failed to reset permission rules' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. GET /mcp-cost?serverName=:name&window=24h
  //    Per-MCP-server cost time-series. MCPUsage doesn't carry a cost column
  //    directly, so we approximate by aggregating LLMRequestLog rows whose
  //    chat-message is in a session that called this MCP server, OR more
  //    pragmatically aggregate MCPUsage call counts and project zero-cost
  //    when no pricing is available. We return a series of {timestamp, cost,
  //    calls} hourly buckets — `cost` will be 0 unless future schema adds
  //    cost to MCPUsage.
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/mcp-cost', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, string>;
    const serverName = (query.serverName ?? '').trim();
    if (!serverName) {
      return reply.code(400).send({ success: false, error: 'serverName query param is required' });
    }
    const hours = windowToHours(query.window, 24);
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

    try {
      const usage = await prisma.mCPUsage.findMany({
        where: {
          server_name: serverName,
          timestamp: { gte: cutoff },
        },
        select: {
          timestamp: true,
          execution_time_ms: true,
          token_count: true,
        },
        orderBy: { timestamp: 'asc' },
      });

      // Bucket by hour
      const buckets = new Map<string, { calls: number; tokens: number; latencyMs: number }>();
      for (const row of usage) {
        const key = hourBucket(row.timestamp);
        const cur = buckets.get(key) ?? { calls: 0, tokens: 0, latencyMs: 0 };
        cur.calls += 1;
        cur.tokens += row.token_count ?? 0;
        cur.latencyMs += row.execution_time_ms ?? 0;
        buckets.set(key, cur);
      }

      const series = [...buckets.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([timestamp, agg]) => ({
          timestamp,
          // Cost not tracked on mcp_usage today — surface as 0 with metadata.
          cost: 0,
          calls: agg.calls,
          tokens: agg.tokens,
          avgLatencyMs: agg.calls > 0 ? Math.round(agg.latencyMs / agg.calls) : 0,
        }));

      return reply.send({
        success: true,
        serverName,
        windowHours: hours,
        series,
        note: 'cost column not present on mcp_usage; series.cost is 0. Wire in LLMRequestLog join when MCP→LLM correlation lands.',
      });
    } catch (error: any) {
      logger.error({ err: error, serverName }, 'Failed to fetch MCP cost series');
      return reply.code(500).send({ success: false, error: 'Failed to fetch MCP cost' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. GET /flows/recent-failures?limit=20
  //    Recent failed workflow executions.
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/flows/recent-failures', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, string>;
    const limit = clampLimit(query.limit, 20, 200);

    try {
      const rows = await prisma.workflowExecution.findMany({
        where: { status: { in: ['failed', 'error'] } },
        orderBy: { started_at: 'desc' },
        take: limit,
        select: {
          id: true,
          workflow_id: true,
          error_node_id: true,
          error: true,
          started_at: true,
          completed_at: true,
          execution_time_ms: true,
          started_by: true,
          workflow: { select: { id: true, name: true } },
        },
      });

      const failures = rows.map((r) => ({
        executionId: r.id,
        workflowId: r.workflow_id,
        workflowName: r.workflow?.name ?? r.workflow_id,
        failedNodeId: r.error_node_id,
        error: r.error,
        startedAt: r.started_at.toISOString(),
        completedAt: r.completed_at?.toISOString() ?? null,
        executionTimeMs: r.execution_time_ms,
        startedBy: r.started_by,
        // Use completed_at if available, else started_at, for "when did it fail" display.
        timestamp: (r.completed_at ?? r.started_at).toISOString(),
      }));

      return reply.send({ success: true, failures, count: failures.length });
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to fetch recent flow failures');
      return reply.code(500).send({ success: false, error: 'Failed to fetch recent failures' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. GET /flows/failing-nodes?include=lastSeen
  //    Per-node failure aggregate (extends /flows/kpis.top_failing_nodes).
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/flows/failing-nodes', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, string>;
    const includeLastSeen = (query.include ?? '').includes('lastSeen');

    try {
      // 30-day window — matches the KPI dashboards.
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const rows = await prisma.workflowExecution.findMany({
        where: {
          status: { in: ['failed', 'error'] },
          error_node_id: { not: null },
          started_at: { gte: cutoff },
        },
        select: {
          workflow_id: true,
          error_node_id: true,
          started_at: true,
          completed_at: true,
        },
      });

      type Agg = { count: number; lastSeen: Date | null; workflowIds: Set<string> };
      const map = new Map<string, Agg>();
      for (const r of rows) {
        const key = r.error_node_id!;
        const cur = map.get(key) ?? { count: 0, lastSeen: null, workflowIds: new Set<string>() };
        cur.count += 1;
        const ts = r.completed_at ?? r.started_at;
        if (!cur.lastSeen || ts > cur.lastSeen) cur.lastSeen = ts;
        cur.workflowIds.add(r.workflow_id);
        map.set(key, cur);
      }

      const nodes = [...map.entries()]
        .map(([nodeId, agg]) => ({
          nodeId,
          // nodeType isn't stored on the execution row; surface as null. Callers
          // can resolve via /api/workflows/:id once the failing-node detail panel asks.
          nodeType: null as string | null,
          count: agg.count,
          workflowCount: agg.workflowIds.size,
          ...(includeLastSeen && { lastSeen: agg.lastSeen?.toISOString() ?? null }),
        }))
        .sort((a, b) => b.count - a.count);

      return reply.send({ success: true, nodes, count: nodes.length });
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to compute failing-nodes aggregate');
      return reply.code(500).send({ success: false, error: 'Failed to compute failing nodes' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 7. GET /workflows/:id/cost?window=30d&groupBy=day
  //    Per-workflow cost time-series.
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/workflows/:id/cost', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, string>;
    if (!id || typeof id !== 'string') {
      return reply.code(400).send({ success: false, error: 'id is required' });
    }
    const groupBy = (query.groupBy ?? 'day').toLowerCase();
    if (groupBy !== 'day' && groupBy !== 'hour') {
      return reply.code(400).send({ success: false, error: 'groupBy must be "day" or "hour"' });
    }
    const hours = windowToHours(query.window, 30 * 24);
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

    try {
      const rows = await prisma.workflowExecution.findMany({
        where: {
          workflow_id: id,
          started_at: { gte: cutoff },
        },
        select: {
          started_at: true,
          cost: true,
          status: true,
        },
        orderBy: { started_at: 'asc' },
      });

      const buckets = new Map<string, { cost: number; runs: number; failed: number }>();
      for (const r of rows) {
        const key = groupBy === 'day' ? dayBucket(r.started_at) : hourBucket(r.started_at);
        const cur = buckets.get(key) ?? { cost: 0, runs: 0, failed: 0 };
        const c = r.cost ? Number(r.cost) : 0;
        cur.cost += c;
        cur.runs += 1;
        if (r.status === 'failed' || r.status === 'error') cur.failed += 1;
        buckets.set(key, cur);
      }

      const series = [...buckets.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([timestamp, agg]) => ({
          timestamp,
          cost: Number.parseFloat(agg.cost.toFixed(6)),
          runs: agg.runs,
          failed: agg.failed,
        }));

      return reply.send({ success: true, workflowId: id, groupBy, windowHours: hours, series });
    } catch (error: any) {
      logger.error({ err: error, workflowId: id }, 'Failed to compute per-workflow cost');
      return reply.code(500).send({ success: false, error: 'Failed to compute workflow cost' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 8. GET /api-requests/top-endpoints?limit=20&window=24h
  //    No purpose-built http_access_log table — FALLBACK: scan
  //    AdminAuditLog where action LIKE 'api.%' grouping by metadata.endpoint.
  //    Approximate volume from the audit trail.
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/api-requests/top-endpoints', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, string>;
    const limit = clampLimit(query.limit, 20, 100);
    const hours = windowToHours(query.window, 24);
    const promRange = `${hours}h`;

    const base = resolvePromBase();
    if (base) {
      // Prom-backed: api emits `http_requests_total{method,route,status_code,user_id}`
      // (services/openagentic-api/src/metrics/index.ts). Aggregate increase()
      // over the window, group by route, and compute error rate from the
      // status_code label. Latency from `http_request_duration_seconds_sum`
      // / `http_request_duration_seconds_count`.
      const callsQ = `topk(${limit}, sum by (route) (increase(http_requests_total[${promRange}])))`;
      const errorsQ = `sum by (route) (increase(http_requests_total{status_code=~"4..|5.."}[${promRange}]))`;
      const latSumQ = `sum by (route) (increase(http_request_duration_seconds_sum[${promRange}]))`;
      const latCntQ = `sum by (route) (increase(http_request_duration_seconds_count[${promRange}]))`;
      const [calls, errors, latSum, latCnt] = await Promise.all([
        promInstant(base, callsQ),
        promInstant(base, errorsQ),
        promInstant(base, latSumQ),
        promInstant(base, latCntQ),
      ]);
      if (calls && calls.length > 0) {
        const errorMap = new Map<string, number>();
        for (const r of errors ?? []) errorMap.set(r.metric.route, r.value);
        const latSumMap = new Map<string, number>();
        for (const r of latSum ?? []) latSumMap.set(r.metric.route, r.value);
        const latCntMap = new Map<string, number>();
        for (const r of latCnt ?? []) latCntMap.set(r.metric.route, r.value);
        const endpoints = calls
          .map((r) => {
            const route = r.metric.route || '(unknown)';
            const n = Math.round(r.value);
            const err = Math.round(errorMap.get(route) ?? 0);
            const sumS = latSumMap.get(route) ?? 0;
            const cnt = latCntMap.get(route) ?? 0;
            return {
              path: route,
              calls: n,
              errorRate: n > 0 ? Number.parseFloat((err / n).toFixed(4)) : 0,
              avgMs: cnt > 0 ? Math.round((sumS / cnt) * 1000) : 0,
            };
          })
          .sort((a, b) => b.calls - a.calls)
          .slice(0, limit);
        return reply.send({ success: true, endpoints, source: 'prometheus:http_requests_total' });
      }
    }

    // FALLBACK: admin_audit_log scan when Prom is unreachable or empty.
    try {
      const cutoff = windowCutoff(query.window, 24);
      const events = await prisma.adminAuditLog.findMany({
        where: {
          action: { startsWith: 'api.' },
          created_at: { gte: cutoff },
        },
        select: { action: true, details: true },
        take: 50000,
      });

      type Agg = { calls: number; errors: number; latencySumMs: number };
      const map = new Map<string, Agg>();
      for (const e of events) {
        const d = (e.details ?? {}) as Record<string, any>;
        const path = typeof d.endpoint === 'string' ? d.endpoint : (typeof d.path === 'string' ? d.path : e.action);
        const cur = map.get(path) ?? { calls: 0, errors: 0, latencySumMs: 0 };
        cur.calls += 1;
        if (typeof d.statusCode === 'number' && d.statusCode >= 400) cur.errors += 1;
        if (typeof d.latencyMs === 'number') cur.latencySumMs += d.latencyMs;
        map.set(path, cur);
      }

      const endpoints = [...map.entries()]
        .map(([path, agg]) => ({
          path,
          calls: agg.calls,
          errorRate: agg.calls > 0 ? Number.parseFloat((agg.errors / agg.calls).toFixed(4)) : 0,
          avgMs: agg.calls > 0 ? Math.round(agg.latencySumMs / agg.calls) : 0,
        }))
        .sort((a, b) => b.calls - a.calls)
        .slice(0, limit);

      return reply.send({ success: true, endpoints, source: 'admin_audit_log' });
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to compute top endpoints');
      return reply.code(500).send({ success: false, error: 'Failed to compute top endpoints' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 9. GET /api-requests/status-codes?window=24h
  //    Status-code histogram. FALLBACK: AdminAuditLog scan with details.statusCode.
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/api-requests/status-codes', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, string>;
    const hours = windowToHours(query.window, 24);
    const promRange = `${hours}h`;

    const base = resolvePromBase();
    if (base) {
      const result = await promInstant(base, `sum by (status_code) (increase(http_requests_total[${promRange}]))`);
      if (result && result.length > 0) {
        const codes: Record<string, number> = {};
        for (const r of result) {
          const sc = r.metric.status_code || 'unknown';
          codes[sc] = Math.round((codes[sc] ?? 0) + r.value);
        }
        return reply.send({ success: true, codes, source: 'prometheus:http_requests_total' });
      }
    }

    // FALLBACK: admin_audit_log
    try {
      const cutoff = windowCutoff(query.window, 24);
      const events = await prisma.adminAuditLog.findMany({
        where: {
          action: { startsWith: 'api.' },
          created_at: { gte: cutoff },
        },
        select: { details: true },
        take: 50000,
      });

      const codes: Record<string, number> = {};
      for (const e of events) {
        const d = (e.details ?? {}) as Record<string, any>;
        const code = typeof d.statusCode === 'number' ? String(d.statusCode) : 'unknown';
        codes[code] = (codes[code] ?? 0) + 1;
      }

      return reply.send({ success: true, codes, source: 'admin_audit_log' });
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to compute status-code histogram');
      return reply.code(500).send({ success: false, error: 'Failed to compute status codes' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 10. GET /api-requests/auth-methods?window=24h
  //    Auth-method histogram. FALLBACK: AdminAuditLog scan; api-key vs jwt vs sso
  //    inferred from details.authMethod or, when absent, from
  //    AdminAuditLog row vs LLMRequestLog row presence.
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/api-requests/auth-methods', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, string>;
    const cutoff = windowCutoff(query.window, 24);

    try {
      const [auditRows, llmRows] = await Promise.all([
        prisma.adminAuditLog.findMany({
          where: {
            action: { startsWith: 'api.' },
            created_at: { gte: cutoff },
          },
          select: { details: true },
          take: 50000,
        }),
        // api-key calls land in LLMRequestLog with api_key_id set.
        prisma.lLMRequestLog.findMany({
          where: {
            created_at: { gte: cutoff },
            api_key_id: { not: null },
          },
          select: { id: true },
          take: 50000,
        }),
      ]);

      const methods: Record<string, number> = {};
      for (const e of auditRows) {
        const d = (e.details ?? {}) as Record<string, any>;
        const m = typeof d.authMethod === 'string' ? d.authMethod : 'sso';
        methods[m] = (methods[m] ?? 0) + 1;
      }
      methods['api-key'] = (methods['api-key'] ?? 0) + llmRows.length;

      return reply.send({ success: true, methods, source: 'admin_audit_log+llm_request_logs' });
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to compute auth-method histogram');
      return reply.code(500).send({ success: false, error: 'Failed to compute auth methods' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 11. GET /perf/percentiles?window=24h
  //    Per-endpoint p50/p95/p99 latency. Backed by LLMRequestLog where the
  //    "endpoint" is the provider+model tuple. (We don't have a generic
  //    HTTP latency table; this is the cleanest real signal.)
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/perf/percentiles', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, string>;
    const cutoff = windowCutoff(query.window, 24);

    try {
      const rows = await prisma.lLMRequestLog.findMany({
        where: {
          created_at: { gte: cutoff },
          latency_ms: { not: null, gt: 0 },
        },
        select: {
          provider_type: true,
          model: true,
          latency_ms: true,
        },
        take: 100000,
      });

      const map = new Map<string, number[]>();
      for (const r of rows) {
        if (r.latency_ms == null) continue;
        const key = `${r.provider_type}:${r.model}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(r.latency_ms);
      }

      const out = [...map.entries()].map(([endpoint, arr]) => {
        const sorted = arr.slice().sort((a, b) => a - b);
        return {
          endpoint,
          p50: percentile(sorted, 50),
          p95: percentile(sorted, 95),
          p99: percentile(sorted, 99),
          count: sorted.length,
        };
      }).sort((a, b) => b.count - a.count);

      return reply.send({ success: true, rows: out, source: 'llm_request_logs' });
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to compute perf percentiles');
      return reply.code(500).send({ success: false, error: 'Failed to compute perf percentiles' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 12. GET /openagentic/api-keys
  //    Issued openagentic API keys — sourced from `ApiKey` (single table for
  //    all Bearer keys; openagentic CLI uses these). Never expose the secret.
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/openagentic/api-keys', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const rows = await prisma.apiKey.findMany({
        where: { is_active: true },
        include: {
          user: { select: { id: true, email: true, name: true } },
        },
        orderBy: { created_at: 'desc' },
      });

      const keys = rows.map((k) => ({
        id: k.id,
        // key_hash is bcrypt — there's no stable human-readable prefix. Surface
        // first 8 chars of the hash so admin UI can disambiguate without leaking.
        prefix: k.key_hash ? k.key_hash.slice(0, 8) : null,
        owner: k.user?.email ?? k.user_id,
        ownerName: k.user?.name ?? null,
        name: k.name,
        lastUsed: k.last_used_at?.toISOString() ?? null,
        createdAt: k.created_at.toISOString(),
        expiresAt: k.expires_at?.toISOString() ?? null,
        rateLimitTier: k.rate_limit_tier,
      }));

      return reply.send({ success: true, keys, count: keys.length });
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to list openagentic api keys');
      return reply.code(500).send({ success: false, error: 'Failed to list api keys' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 13. GET /llm-providers/:id/health-history?hours=24
  //    Per-provider health probe series. FALLBACK: scan AdminAuditLog where
  //    action='provider.healthcheck' AND resource_id=:id.
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/llm-providers/:id/health-history', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, string>;
    if (!id || typeof id !== 'string') {
      return reply.code(400).send({ success: false, error: 'id is required' });
    }
    const hours = windowToHours(query.hours, 24);
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

    try {
      // FALLBACK: no LLMProviderHealthProbe model — derive from audit log.
      const events = await prisma.adminAuditLog.findMany({
        where: {
          resource_id: id,
          action: { startsWith: 'provider.healthcheck' },
          created_at: { gte: cutoff },
        },
        orderBy: { created_at: 'desc' },
        take: 1000,
      });

      const probes = events.map((e) => {
        const d = (e.details ?? {}) as Record<string, any>;
        return {
          timestamp: e.created_at.toISOString(),
          healthy: e.action.endsWith('.ok') || d.healthy === true,
          latencyMs: typeof d.latencyMs === 'number' ? d.latencyMs : undefined,
          error: typeof d.error === 'string' ? d.error : undefined,
        };
      });

      return reply.send({ success: true, providerId: id, probes, source: 'admin_audit_log' });
    } catch (error: any) {
      logger.error({ err: error, providerId: id }, 'Failed to fetch provider health history');
      return reply.code(500).send({ success: false, error: 'Failed to fetch health history' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 14. GET /audit-logs/:id
  //    Single audit-log event detail with the joined admin user row.
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/audit-logs/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    if (!id || typeof id !== 'string') {
      return reply.code(400).send({ success: false, error: 'id is required' });
    }

    try {
      const row = await prisma.adminAuditLog.findUnique({
        where: { id },
        include: {
          user: { select: { id: true, email: true, name: true } },
        },
      });

      if (!row) {
        return reply.code(404).send({ success: false, error: 'audit log not found' });
      }

      return reply.send({
        success: true,
        log: {
          id: row.id,
          adminUserId: row.admin_user_id,
          adminEmail: row.admin_email ?? row.user?.email ?? null,
          adminName: row.user?.name ?? null,
          action: row.action,
          resourceType: row.resource_type,
          resourceId: row.resource_id,
          details: row.details,
          ipAddress: row.ip_address,
          createdAt: row.created_at.toISOString(),
          previousHash: row.previous_hash,
          chainHash: row.chain_hash,
        },
      });
    } catch (error: any) {
      logger.error({ err: error, auditId: id }, 'Failed to fetch audit log detail');
      return reply.code(500).send({ success: false, error: 'Failed to fetch audit log' });
    }
  });

  // Defence-in-depth: if mounted without the parent adminMiddleware (e.g. tests),
  // an unauthenticated caller returns 401 and a non-admin user returns 403.
  // Production prefix in admin.plugin.ts adds adminMiddleware to the parent
  // register scope. Use preHandler (not onRequest) so test rigs that attach
  // `request.user` in their own preHandler are visible to this guard.
  // SECURITY: fail CLOSED — a missing `request.user` is rejected (401), never
  // silently allowed through.
  fastify.addHook('preHandler', async (request, reply): Promise<void> => {
    const user = (request as any).user;
    if (!user) {
      reply.code(401).send({ success: false, error: 'Authentication required' });
      return;
    }
    if (!isAdminUser(request)) {
      reply.code(403).send({ success: false, error: 'Admin access required' });
      return;
    }
  });
};

// Re-export so tests can mount this against a bare Fastify instance.
export default adminV3ExtrasRoutes;

// Suppress unused-import warning when Prisma type isn't directly referenced.
export type { Prisma };
