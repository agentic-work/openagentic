/**
 * Admin Permissions API
 *
 * CRUD on PermissionService rules from the admin UI. Replaces the legacy
 * `tool_risk_overrides` regex-tier endpoint (which targeted the legacy gate)
 * with Claude-Code-style allow/deny/ask glob rules.
 *
 * Routes (mounted under /api/admin/permissions by admin.plugin.ts):
 *   GET    /                  — list all rules (seed + user)
 *   POST   /                  — add or replace a single rule
 *   DELETE /                  — remove a rule by (toolName, behavior)
 *   PUT    /                  — replace the entire rule set wholesale
 *   POST   /reset             — reset to seed defaults
 *
 * Each mutation writes an admin_audit_log entry and persists via the
 * `permission_rules` row in system_configuration.
 */
import { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { prisma } from '../../utils/prisma.js';
import { loggers } from '../../utils/logger.js';
import {
  getPermissionService,
  type PermissionRule,
  type PermissionBehavior,
} from '../../services/PermissionService.js';

const VALID_BEHAVIORS: ReadonlySet<PermissionBehavior> = new Set(['allow', 'deny', 'ask']);
const VALID_SOURCES = new Set([
  'userSettings',
  'projectSettings',
  'localSettings',
  'flagSettings',
  'policySettings',
  'cliArg',
  'command',
  'session',
]);

function isAdminUser(req: FastifyRequest): boolean {
  const user = (req as any).user;
  return Boolean(user?.isAdmin || user?.role === 'admin');
}

function adminUserMeta(req: FastifyRequest): {
  admin_user_id: string | null;
  admin_email: string | null;
  ip_address: string | null;
} {
  const user = (req as any).user ?? {};
  return {
    admin_user_id: typeof user.id === 'string' ? user.id : null,
    admin_email: typeof user.email === 'string' ? user.email : null,
    ip_address: req.ip ?? null,
  };
}

async function writeAudit(opts: {
  req: FastifyRequest;
  action: string;
  resource_type: string;
  resource_id: string;
  details?: Record<string, any>;
}): Promise<void> {
  const meta = adminUserMeta(opts.req);
  try {
    await prisma.adminAuditLog.create({
      data: {
        ...meta,
        action: opts.action,
        resource_type: opts.resource_type,
        resource_id: opts.resource_id,
        details: opts.details ?? {},
      },
    });
  } catch (err: any) {
    loggers.services.warn(
      { err: err?.message, action: opts.action },
      '[AdminPermissions] Failed to write admin_audit_log row',
    );
  }
}

function validateRule(input: unknown): { ok: true; rule: PermissionRule } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'rule must be an object' };
  }
  const r = input as Record<string, unknown>;
  const source = typeof r.source === 'string' ? r.source : 'userSettings';
  if (!VALID_SOURCES.has(source)) {
    return { ok: false, error: `source must be one of: ${[...VALID_SOURCES].join(', ')}` };
  }
  const behavior = r.ruleBehavior ?? r.behavior;
  if (typeof behavior !== 'string' || !VALID_BEHAVIORS.has(behavior as PermissionBehavior)) {
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
      source: source as PermissionRule['source'],
      ruleBehavior: behavior as PermissionBehavior,
      ruleValue: {
        toolName,
        ruleContent: typeof ruleValue?.ruleContent === 'string' ? ruleValue.ruleContent : undefined,
      },
    },
  };
}

const adminPermissionsRoutes: FastifyPluginAsync = async (fastify) => {
  // Defence-in-depth admin guard for accidental mounts in test rigs.
  fastify.addHook('preHandler', async (request, reply): Promise<unknown> => {
    if (!isAdminUser(request)) {
      return reply.code(403).send({ success: false, error: 'admin required' });
    }
    return undefined;
  });

  /**
   * GET /api/admin/permissions
   * Returns the full rule set (seed + user-added) and metadata.
   */
  fastify.get('/', async () => {
    const svc = getPermissionService(loggers.services as any);
    await svc.loadConfig();
    const rules = svc.listRules();
    const pending = svc.getPendingApprovals();
    return {
      success: true,
      rules,
      pending: pending.map((p) => ({
        id: p.id,
        toolName: p.toolCall.toolName,
        userId: p.toolCall.userId,
        reason: p.reason,
        createdAt: p.createdAt,
        expiresAt: p.expiresAt,
      })),
    };
  });

  /**
   * POST /api/admin/permissions
   * Body: { source, ruleBehavior, ruleValue: { toolName, ruleContent? } }
   * Adds or replaces a single rule. Idempotent on (toolName, behavior, source).
   */
  fastify.post('/', async (request, reply) => {
    const v = validateRule(request.body);
    if (!v.ok) {
      return reply.code(400).send({ success: false, error: (v as { error: string }).error });
    }
    const svc = getPermissionService(loggers.services as any);
    svc.addRule(v.rule);
    await writeAudit({
      req: request,
      action: 'permission_rule_added',
      resource_type: 'permission_rule',
      resource_id: v.rule.ruleValue.toolName,
      details: { rule: v.rule },
    });
    return { success: true, rule: v.rule };
  });

  /**
   * DELETE /api/admin/permissions
   * Body: { toolName, behavior? }
   * Removes rule(s) matching toolName (+ optional behavior filter).
   */
  fastify.delete('/', async (request, reply) => {
    const body = request.body as { toolName?: unknown; behavior?: unknown } | null;
    if (!body || typeof body.toolName !== 'string') {
      return reply.code(400).send({ success: false, error: 'toolName required' });
    }
    const behavior =
      typeof body.behavior === 'string' && VALID_BEHAVIORS.has(body.behavior as PermissionBehavior)
        ? (body.behavior as PermissionBehavior)
        : undefined;
    const svc = getPermissionService(loggers.services as any);
    const removed = svc.removeRule({ toolName: body.toolName, behavior });
    await writeAudit({
      req: request,
      action: 'permission_rule_removed',
      resource_type: 'permission_rule',
      resource_id: body.toolName,
      details: { behavior, removed },
    });
    return { success: true, removed };
  });

  /**
   * PUT /api/admin/permissions
   * Body: { rules: PermissionRule[] }
   * Replaces the entire rule set. Use with caution — drops every previous
   * rule (including seed defaults).
   */
  fastify.put('/', async (request, reply) => {
    const body = request.body as { rules?: unknown } | null;
    if (!body || !Array.isArray(body.rules)) {
      return reply.code(400).send({ success: false, error: 'rules array required' });
    }
    const validated: PermissionRule[] = [];
    for (const raw of body.rules) {
      const v = validateRule(raw);
      if (!v.ok) {
        return reply.code(400).send({ success: false, error: `invalid rule: ${(v as { error: string }).error}` });
      }
      validated.push(v.rule);
    }
    const svc = getPermissionService(loggers.services as any);
    svc.replaceAllRules(validated);
    await writeAudit({
      req: request,
      action: 'permission_rules_replaced',
      resource_type: 'permission_rules',
      resource_id: 'all',
      details: { ruleCount: validated.length },
    });
    return { success: true, count: validated.length };
  });

  /**
   * POST /api/admin/permissions/reset
   * Resets to seeded defaults.
   */
  fastify.post('/reset', async (request) => {
    const svc = getPermissionService(loggers.services as any);
    svc.clearAllUserRules();
    await writeAudit({
      req: request,
      action: 'permission_rules_reset',
      resource_type: 'permission_rules',
      resource_id: 'all',
    });
    return { success: true };
  });

  // -------------------------------------------------------------------------
  // #790 (2026-05-13) — global READ-ONLY mode toggle.
  //
  // Lives on its own pair of endpoints so the UI can flip the kill-switch
  // without touching the per-rule cascade. State persists in a separate
  // `system_configuration` row keyed by `tool_read_only_mode` — survives
  // a "reset to seed defaults" on the rules array.
  // -------------------------------------------------------------------------

  /**
   * GET /api/admin/permissions/read-only-mode
   * Returns { success: true, readOnlyMode: boolean }.
   */
  fastify.get('/read-only-mode', async () => {
    const svc = getPermissionService(loggers.services as any);
    await svc.loadConfig();
    return { success: true, readOnlyMode: svc.getReadOnlyMode() };
  });

  /**
   * PUT /api/admin/permissions/read-only-mode
   * Body: { readOnlyMode: boolean }
   * Flips the global READ-ONLY platform toggle and audits the change.
   */
  fastify.put('/read-only-mode', async (request, reply) => {
    const body = request.body as { readOnlyMode?: unknown } | null;
    if (!body || typeof body.readOnlyMode !== 'boolean') {
      return reply.code(400).send({
        success: false,
        error: 'readOnlyMode (boolean) required',
      });
    }
    const svc = getPermissionService(loggers.services as any);
    await svc.setReadOnlyMode(body.readOnlyMode);
    await writeAudit({
      req: request,
      action: 'permission_read_only_mode_changed',
      resource_type: 'permission_read_only_mode',
      resource_id: 'global',
      details: { readOnlyMode: body.readOnlyMode },
    });
    return { success: true, readOnlyMode: svc.getReadOnlyMode() };
  });
};

export default adminPermissionsRoutes;
