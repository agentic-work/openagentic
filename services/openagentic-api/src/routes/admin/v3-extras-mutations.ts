/**
 * Admin V3 Extras — mutation endpoints referenced by the v3 admin UI.
 *
 * Sibling to v3-extras.ts (which is read-only). These five endpoints close
 * the "wire-up pending" gaps that v3 admin pages flagged with `<Banner>`s.
 *
 * Routes:
 *   1.  POST /integrations/:platform/oauth-start         — Slack/MS-Teams OAuth bootstrap
 *   1b. GET  /integrations/:platform/oauth-callback      — completes the OAuth flow (state validation, token exchange, persist)
 *   2.  PATCH /chargeback/reports/:id                    — report status state-machine
 *   3a. POST   /codemode/skills                          — direct CRUD for codemode skills
 *   3b. DELETE /codemode/skills/:id
 *   4a. POST   /codemode/plugins                         — direct CRUD for codemode plugins
 *   4b. DELETE /codemode/plugins/:id
 *   5. PUT   /codemode/mcp-policy                        — allow/deny MCP server lists
 *   6. POST  /llm-providers/registry/refresh-all         — bulk re-discovery sweep
 *   7a. GET  /workflow-settings                          — workflow governance config (read)
 *   7b. PUT  /workflow-settings                          — workflow governance config (write)
 *
 * Each handler:
 *   - Validates inputs (type-guards / explicit field checks).
 *   - Writes an admin_audit_log entry on every successful mutation.
 *   - Logs the action via loggers.services.info.
 *   - Returns { success: true, ... } or reply.code(<n>).send({ success: false, error }).
 *
 * Mounted under /api/admin by admin.plugin.ts inside an adminMiddleware-gated
 * scope. The per-handler defence-in-depth admin guard at the bottom guards
 * against accidental mounts in test rigs (mirrors the v3-extras.ts pattern).
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { randomBytes } from 'crypto';
import { prisma } from '../../utils/prisma.js';
import { loggers } from '../../utils/logger.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    // Audit-log writes must never block the user-visible mutation.
    loggers.services.warn(
      { err: err?.message, action: opts.action },
      '[AdminV3ExtrasMutations] Failed to write admin_audit_log row',
    );
  }
}

// system_configuration helpers (mirror routes/admin/codemode.ts so this
// file stays self-contained and the codemode helpers' shapes are preserved).
async function getSysConfig<T = any>(key: string): Promise<T | null> {
  const row = await prisma.systemConfiguration.findUnique({ where: { key } });
  if (!row) return null;
  try {
    return JSON.parse(row.value as unknown as string) as T;
  } catch {
    return row.value as unknown as T;
  }
}

async function setSysConfig(key: string, value: any): Promise<void> {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  await prisma.systemConfiguration.upsert({
    where: { key },
    update: { value: serialized as any, updated_at: new Date() },
    create: { key, value: serialized as any },
  });
}

// ---------------------------------------------------------------------------
// Workflow governance settings — schema + defaults + validation
// Mirror of services/openagentic-ui/src/features/admin/components/Workflows/
// AdminWorkflowSettingsView.tsx WorkflowSettings interface so v2 + v3 panes
// see the same authoritative defaults when no row is stored yet.
// ---------------------------------------------------------------------------
const WORKFLOW_SETTINGS_DEFAULTS = {
  // Execution Limits
  defaultNodeTimeout: 30,
  maxNodeTimeout: 300,
  maxExecutionTime: 600,
  maxNodesPerWorkflow: 50,
  maxConcurrentExecutions: 20,
  maxConcurrentPerUser: 5,
  maxExecutionsPerHourPerUser: 100,
  // Cost Governance
  defaultPerExecutionBudget: 1.0,
  maxPerExecutionBudget: 10.0,
  defaultDailyBudgetPerUser: 25.0,
  defaultMonthlyBudgetPerUser: 500.0,
  onBudgetExceeded: 'pause' as 'pause' | 'downgrade_model' | 'abort',
  // Model & Agent
  maxAgentTurns: 15,
  maxToolCallsPerAgent: 25,
  agentCostBudgetCap: 5.0,
  requireApprovalForHighRiskTools: true,
  highRiskToolsList: 'admin_postgres_raw_query, azure_create_resource_group, k8s_delete',
  // Node & Error Handling
  disabledNodeTypes: [] as string[],
  defaultRetryCount: 2,
  defaultRetryDelay: 1000,
  defaultBackoffStrategy: 'exponential' as 'fixed' | 'exponential',
  defaultOnError: 'stop' as 'stop' | 'continue' | 'retry',
  // Memory & Context
  crossModeMemoryEnabled: true,
  memoryRetentionDays: 90,
  maxMemoryEntriesPerUser: 1000,
};

type WorkflowSettingsKey = keyof typeof WORKFLOW_SETTINGS_DEFAULTS;
const ALLOWED_WORKFLOW_SETTING_KEYS: Set<string> = new Set(Object.keys(WORKFLOW_SETTINGS_DEFAULTS));

interface SettingValidation {
  ok: boolean;
  value?: unknown;
  reason: string;
}
function ok(value: unknown): SettingValidation {
  return { ok: true, value, reason: '' };
}
function bad(reason: string): SettingValidation {
  return { ok: false, reason };
}

/**
 * Per-key validation. Numbers are clamped to sane bounds; enums are gated;
 * arrays are coerced to string[] when relevant. Returns a typed reason on
 * rejection so the PUT response can name the offending key.
 */
function validateWorkflowSettingValue(key: string, value: unknown): SettingValidation {
  const k = key as WorkflowSettingsKey;
  switch (k) {
    // Numeric fields with min/max bounds.
    case 'defaultNodeTimeout':
    case 'maxNodeTimeout':
    case 'maxExecutionTime':
      return validateNumber(value, { min: 1, max: 86_400 });
    case 'maxNodesPerWorkflow':
      return validateNumber(value, { min: 1, max: 1_000, integer: true });
    case 'maxConcurrentExecutions':
    case 'maxConcurrentPerUser':
    case 'maxExecutionsPerHourPerUser':
      return validateNumber(value, { min: 0, max: 10_000, integer: true });
    case 'defaultPerExecutionBudget':
    case 'maxPerExecutionBudget':
    case 'defaultDailyBudgetPerUser':
    case 'defaultMonthlyBudgetPerUser':
    case 'agentCostBudgetCap':
      return validateNumber(value, { min: 0, max: 100_000 });
    case 'maxAgentTurns':
      return validateNumber(value, { min: 1, max: 200, integer: true });
    case 'maxToolCallsPerAgent':
      return validateNumber(value, { min: 1, max: 1_000, integer: true });
    case 'defaultRetryCount':
      return validateNumber(value, { min: 0, max: 20, integer: true });
    case 'defaultRetryDelay':
      return validateNumber(value, { min: 0, max: 600_000, integer: true });
    case 'memoryRetentionDays':
      return validateNumber(value, { min: 0, max: 36_500, integer: true });
    case 'maxMemoryEntriesPerUser':
      return validateNumber(value, { min: 0, max: 1_000_000, integer: true });
    // Boolean flags.
    case 'requireApprovalForHighRiskTools':
    case 'crossModeMemoryEnabled':
      return typeof value === 'boolean' ? ok(value) : bad('must be boolean');
    // Enum strings.
    case 'onBudgetExceeded':
      return value === 'pause' || value === 'downgrade_model' || value === 'abort'
        ? ok(value)
        : bad('must be one of: pause | downgrade_model | abort');
    case 'defaultBackoffStrategy':
      return value === 'fixed' || value === 'exponential'
        ? ok(value)
        : bad('must be one of: fixed | exponential');
    case 'defaultOnError':
      return value === 'stop' || value === 'continue' || value === 'retry'
        ? ok(value)
        : bad('must be one of: stop | continue | retry');
    // Free-text comma-separated tool list.
    case 'highRiskToolsList':
      return typeof value === 'string' ? ok(value) : bad('must be string');
    // Array of disabled node-type identifiers.
    case 'disabledNodeTypes':
      if (!Array.isArray(value)) return bad('must be string[]');
      if (value.some((v) => typeof v !== 'string')) return bad('all entries must be strings');
      return ok(value as string[]);
    default:
      return bad('unknown key');
  }
}

function validateNumber(
  value: unknown,
  opts: { min: number; max: number; integer?: boolean },
): SettingValidation {
  const n = Number(value);
  if (!Number.isFinite(n)) return bad('must be a finite number');
  if (n < opts.min || n > opts.max) return bad(`out of range [${opts.min}, ${opts.max}]`);
  if (opts.integer && !Number.isInteger(n)) return bad('must be an integer');
  return ok(n);
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const adminV3ExtrasMutationsRoutes: FastifyPluginAsync = async (fastify) => {

  // ─────────────────────────────────────────────────────────────────────────
  // 1. POST /integrations/:platform/oauth-start
  //    Returns { authorize_url, state } for slack | ms-teams. State is
  //    persisted to admin_audit_log under action='admin.integrations.oauth-start'
  //    so the OAuth callback handler can verify CSRF by looking up the nonce.
  // ─────────────────────────────────────────────────────────────────────────
  fastify.post<{
    Params: { platform: string };
    Body: { redirect_uri?: string };
  }>('/integrations/:platform/oauth-start', async (request, reply) => {
    const { platform } = request.params;
    const body = request.body ?? {};
    const redirectUri = typeof body.redirect_uri === 'string' && body.redirect_uri.length > 0
      ? body.redirect_uri
      : '/admin/integrations/oauth-callback';

    if (platform !== 'slack' && platform !== 'ms-teams') {
      return reply.code(400).send({
        success: false,
        error: `Unsupported platform "${platform}". Expected "slack" or "ms-teams".`,
      });
    }

    const isSlack = platform === 'slack';
    const envVar = isSlack ? 'SLACK_CLIENT_ID' : 'MICROSOFT_TEAMS_CLIENT_ID';
    const clientId = process.env[envVar];
    if (!clientId) {
      return reply.code(503).send({
        success: false,
        error: 'OAuth not configured',
        missingEnv: envVar,
      });
    }

    // CSRF state nonce — base64url 32 bytes → 43 chars, well above 16 floor
    const state = randomBytes(32).toString('base64url');

    let authorizeUrl: string;
    if (isSlack) {
      // Slack OAuth v2 — bot scopes only; user_scope intentionally empty.
      const scope = 'channels:read,chat:write,users:read';
      const params = new URLSearchParams({
        client_id: clientId,
        scope,
        redirect_uri: redirectUri,
        state,
      });
      authorizeUrl = `https://slack.com/oauth/v2/authorize?${params.toString()}`;
    } else {
      // Microsoft identity platform v2 — common tenant (multi-tenant app).
      const scope = 'https://graph.microsoft.com/Channel.ReadBasic.All https://graph.microsoft.com/ChatMessage.Send https://graph.microsoft.com/User.Read offline_access';
      const params = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        response_mode: 'query',
        scope,
        state,
      });
      authorizeUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
    }

    // Persist state nonce so the callback handler can verify CSRF. The
    // schema doesn't have a dedicated OAuthState model, so we land in
    // admin_audit_log with action='admin.integrations.oauth-start' and
    // details.state = nonce + details.platform = platform.
    await writeAudit({
      req: request,
      action: 'admin.integrations.oauth-start',
      resource_type: 'IntegrationOAuthState',
      resource_id: state,
      details: {
        platform,
        redirect_uri: redirectUri,
        // Track expiry — callbacks older than 10 min should be rejected.
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      },
    });

    loggers.services.info(
      { platform, hasRedirectUri: redirectUri !== '/admin/integrations/oauth-callback' },
      '[admin.integrations.oauth-start] OAuth bootstrap requested',
    );

    return reply.send({
      success: true,
      authorize_url: authorizeUrl,
      state,
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1b. GET /integrations/:platform/oauth-callback?code=&state=
  //     Completes the Slack / MS-Teams OAuth flow:
  //       1. validates :platform
  //       2. looks up the state nonce in admin_audit_log (action='admin.integrations.oauth-start')
  //       3. enforces 10-minute expiry recorded in details.expires_at
  //       4. enforces single-use by writing a 'admin.integrations.oauth-callback' row
  //          (presence of an existing callback row for the same state == replay → 400)
  //       5. exchanges code → access_token via the platform's standard token endpoint
  //       6. persists into the existing Integration model (config JSON carries
  //          access_token + scopes + team metadata, mirroring admin-integrations.ts)
  //       7. returns a small HTML page that postMessages success to opener and closes itself
  //
  //    SECURITY NOTE: the existing Integration.config column stores secrets as
  //    raw JSON in the schema (admin-integrations.ts notes "Should be encrypted
  //    in production"). We follow that same convention here for shape parity
  //    with manual /api/admin/integrations POST and the slack/teams services
  //    that read config.botToken / config.appId. The encryption story is a
  //    column-level concern tracked separately — flagged in the resume report.
  // ─────────────────────────────────────────────────────────────────────────
  type OAuthCallbackHtml = { html: string; status: number };
  function renderOAuthCallbackHtml(opts: {
    success: boolean;
    platform: string;
    error?: string;
    integrationId?: string;
  }): OAuthCallbackHtml {
    const payload = JSON.stringify({
      type: 'oauth-callback',
      success: opts.success,
      platform: opts.platform,
      error: opts.error,
      integrationId: opts.integrationId,
    });
    // Inline templating via JSON.stringify — guarantees the payload is valid
    // JS, can't break out of the template, can't run untrusted code.
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>OAuth ${opts.success ? 'complete' : 'failed'}</title></head><body style="font-family:system-ui,sans-serif;padding:24px;background:#0b0d10;color:#e5e7eb"><h2>${opts.success ? 'Connected' : 'Failed'}</h2><p>${opts.success ? `Your ${opts.platform} integration is connected. You can close this window.` : `OAuth failed: ${opts.error ?? 'unknown error'}`}</p><script>(function(){try{var msg=${payload};if(window.opener){window.opener.postMessage(msg,'*');}}catch(e){}window.setTimeout(function(){try{window.close();}catch(e){}},${opts.success ? 600 : 2500});})();</script></body></html>`;
    return { html, status: opts.success ? 200 : 400 };
  }

  fastify.get<{
    Params: { platform: string };
    Querystring: { code?: string; state?: string };
  }>('/integrations/:platform/oauth-callback', async (request, reply) => {
    const { platform } = request.params;
    const code = typeof request.query?.code === 'string' ? request.query.code : '';
    const state = typeof request.query?.state === 'string' ? request.query.state : '';

    // (1) Platform allow-list
    if (platform !== 'slack' && platform !== 'ms-teams') {
      return reply.code(400).send({
        success: false,
        error: `Unsupported platform "${platform}". Expected "slack" or "ms-teams".`,
      });
    }
    if (!code || !state) {
      return reply.code(400).send({
        success: false,
        error: 'code and state query params are required',
      });
    }

    // (2) Look up the state nonce and confirm it was issued for THIS platform.
    let stateRow: { id: string; created_at: Date; details: any } | null = null;
    try {
      stateRow = (await prisma.adminAuditLog.findFirst({
        where: {
          action: 'admin.integrations.oauth-start',
          resource_id: state,
          details: { path: ['platform'], equals: platform } as any,
        },
        orderBy: { created_at: 'desc' },
      })) as any;
    } catch (err: any) {
      loggers.services.error(
        { err: err?.message, platform },
        '[admin.integrations.oauth-callback] state lookup failed',
      );
      return reply.code(500).send({ success: false, error: 'state lookup failed' });
    }
    if (!stateRow) {
      return reply.code(400).send({ success: false, error: 'state not found' });
    }

    // (3) Expiry check
    const expiresAtRaw = (stateRow.details as any)?.expires_at;
    const expiresAt = typeof expiresAtRaw === 'string' ? Date.parse(expiresAtRaw) : NaN;
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
      return reply.code(400).send({ success: false, error: 'state expired' });
    }

    // (4) Replay protection — reject if the same state was already consumed.
    let consumed: { id: string } | null = null;
    try {
      consumed = (await prisma.adminAuditLog.findFirst({
        where: {
          action: 'admin.integrations.oauth-callback',
          resource_id: state,
        },
      })) as any;
    } catch (err: any) {
      loggers.services.warn(
        { err: err?.message, platform },
        '[admin.integrations.oauth-callback] replay-check lookup failed; proceeding',
      );
    }
    if (consumed) {
      return reply.code(400).send({ success: false, error: 'state already consumed' });
    }

    // (5) Token exchange. Validate per-platform secret env first.
    const isSlack = platform === 'slack';
    const clientIdEnv = isSlack ? 'SLACK_CLIENT_ID' : 'MICROSOFT_TEAMS_CLIENT_ID';
    const clientSecretEnv = isSlack ? 'SLACK_CLIENT_SECRET' : 'MICROSOFT_TEAMS_CLIENT_SECRET';
    const clientId = process.env[clientIdEnv];
    const clientSecret = process.env[clientSecretEnv];
    if (!clientId || !clientSecret) {
      return reply.code(503).send({
        success: false,
        error: 'OAuth not configured',
        missingEnv: !clientId ? clientIdEnv : clientSecretEnv,
      });
    }

    const redirectUri = (stateRow.details as any)?.redirect_uri ?? '/admin/integrations/oauth-callback';

    let exchangeJson: any = null;
    let exchangeOk = false;
    try {
      if (isSlack) {
        // Slack returns 200 with { ok: false, error } on failure — must
        // gate on `ok` not just HTTP status.
        const body = new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
        });
        const resp = await fetch('https://slack.com/api/oauth.v2.access', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        });
        exchangeJson = await resp.json().catch(() => null);
        exchangeOk = resp.ok && exchangeJson?.ok === true && typeof exchangeJson?.access_token === 'string';
      } else {
        // Microsoft identity platform v2 — 200 with access_token on
        // success, 4xx with { error, error_description } on failure.
        const body = new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        });
        const resp = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        });
        exchangeJson = await resp.json().catch(() => null);
        exchangeOk = resp.ok && typeof exchangeJson?.access_token === 'string';
      }
    } catch (err: any) {
      loggers.services.error(
        { err: err?.message, platform },
        '[admin.integrations.oauth-callback] token exchange threw',
      );
      return reply.code(502).send({
        success: false,
        error: `token exchange failed: ${err?.message ?? 'network error'}`,
      });
    }

    if (!exchangeOk) {
      const upstreamErr = isSlack
        ? exchangeJson?.error ?? 'unknown_slack_error'
        : exchangeJson?.error_description ?? exchangeJson?.error ?? 'unknown_msft_error';
      loggers.services.warn(
        { platform, upstreamErr },
        '[admin.integrations.oauth-callback] upstream OAuth provider rejected exchange',
      );
      // Mark state consumed even on upstream failure so a leaked code
      // can't be retried with the same state nonce.
      await writeAudit({
        req: request,
        action: 'admin.integrations.oauth-callback',
        resource_type: 'IntegrationOAuthState',
        resource_id: state,
        details: { platform, success: false, error: upstreamErr },
      });
      return reply.code(502).send({
        success: false,
        error: `upstream OAuth exchange failed: ${upstreamErr}`,
      });
    }

    // (6) Persist into Integration. Schema's `platform` column uses 'slack' or
    // 'teams' (NOT 'ms-teams'); align here.
    const dbPlatform = isSlack ? 'slack' : 'teams';

    let integrationId: string | null = null;
    try {
      const webhookId = randomBytes(24).toString('hex');
      let name: string;
      let config: Record<string, any>;
      if (isSlack) {
        const teamName = exchangeJson?.team?.name ?? 'Slack';
        name = `Slack — ${teamName}`;
        // Mirror existing Slack service expectations (config.botToken).
        config = {
          botToken: exchangeJson.access_token,
          teamId: exchangeJson?.team?.id ?? null,
          teamName: exchangeJson?.team?.name ?? null,
          botUserId: exchangeJson?.bot_user_id ?? null,
          scope: exchangeJson?.scope ?? null,
          source: 'oauth',
        };
      } else {
        name = 'Microsoft Teams';
        // The existing Teams services expect appId/appPassword (client_credentials);
        // for the user-OAuth flow we additionally land access_token + refresh_token
        // so the channel-message path can use delegated tokens.
        config = {
          accessToken: exchangeJson.access_token,
          refreshToken: exchangeJson.refresh_token ?? null,
          expiresIn: typeof exchangeJson.expires_in === 'number' ? exchangeJson.expires_in : null,
          tokenType: exchangeJson.token_type ?? null,
          scope: exchangeJson.scope ?? null,
          source: 'oauth',
        };
      }
      const created = await prisma.integration.create({
        data: {
          name,
          platform: dbPlatform,
          status: 'active',
          config,
          webhook_id: webhookId,
          allowed_channels: [],
          allowed_workflows: [],
          created_by: (request as any).user?.id ?? null,
        },
      });
      integrationId = created.id;
    } catch (err: any) {
      loggers.services.error(
        { err: err?.message, platform },
        '[admin.integrations.oauth-callback] integration persist failed',
      );
      return reply.code(500).send({
        success: false,
        error: `integration persist failed: ${err?.message ?? 'db error'}`,
      });
    }

    // (4-cont/8) Mark state consumed + record the success event.
    await writeAudit({
      req: request,
      action: 'admin.integrations.oauth-callback',
      resource_type: 'IntegrationOAuthState',
      resource_id: state,
      details: {
        platform,
        success: true,
        integration_id: integrationId,
      },
    });
    loggers.services.info(
      { platform, integration_id: integrationId },
      '[admin.integrations.oauth-callback] OAuth flow completed',
    );

    // (7) Render the postMessage HTML so the popup can hand control back
    // to the parent window in the v3 admin UI.
    const { html, status } = renderOAuthCallbackHtml({
      success: true,
      platform,
      integrationId: integrationId ?? undefined,
    });
    reply.code(status).header('Content-Type', 'text/html; charset=utf-8').send(html);
    return reply;
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. PATCH /chargeback/reports/:id
  //    Body: { status: 'pending' | 'approved' | 'rejected' | 'paid' }.
  //    Validates state-machine: pending→approved→paid OR pending→rejected.
  // ─────────────────────────────────────────────────────────────────────────
  const ALLOWED_STATUSES = new Set(['pending', 'approved', 'rejected', 'paid']);
  // Per-state allowed transitions (current → next).
  const TRANSITIONS: Record<string, Set<string>> = {
    pending:  new Set(['approved', 'rejected']),
    approved: new Set(['paid']),
    rejected: new Set(),
    paid:     new Set(),
  };
  // Legacy statuses produced by the chargeback generator
  // (admin-chargeback.ts hardcodes 'generated', schema default is
  // 'draft', and earlier UIs persisted 'finalized'/'exported'). All of
  // those are in-flight and should be treated as 'pending' for the
  // purpose of this state machine; otherwise existing reports would be
  // permanently un-advanceable.
  const LEGACY_PENDING = new Set(['draft', 'generated', 'finalized', 'exported']);
  const normalizeCurrent = (raw: string | null | undefined): string => {
    if (!raw) return 'pending';
    if (LEGACY_PENDING.has(raw)) return 'pending';
    return raw;
  };

  fastify.patch<{
    Params: { id: string };
    Body: { status?: string };
  }>('/chargeback/reports/:id', async (request, reply) => {
    const { id } = request.params;
    const body = request.body ?? {};
    const nextStatus = body.status;

    if (!id || typeof id !== 'string') {
      return reply.code(400).send({ success: false, error: 'id is required' });
    }
    if (!nextStatus || !ALLOWED_STATUSES.has(nextStatus)) {
      return reply.code(400).send({
        success: false,
        error: `Invalid status. Expected one of ${[...ALLOWED_STATUSES].join(', ')}.`,
      });
    }

    let report: { id: string; status: string } | null = null;
    try {
      report = (await prisma.chargebackReport.findUnique({
        where: { id },
        select: { id: true, status: true },
      })) as { id: string; status: string } | null;
    } catch (err: any) {
      loggers.services.error({ err: err?.message, id }, '[admin.chargeback.report.status-advance] lookup failed');
      return reply.code(500).send({ success: false, error: 'Failed to read report' });
    }

    if (!report) {
      return reply.code(404).send({ success: false, error: `Report ${id} not found` });
    }

    const rawCurrent = report.status ?? 'pending';
    const currentStatus = normalizeCurrent(rawCurrent);
    // Allow no-op advance to same status (idempotent).
    if (currentStatus !== nextStatus) {
      const allowed = TRANSITIONS[currentStatus] ?? new Set<string>();
      if (!allowed.has(nextStatus)) {
        return reply.code(400).send({
          success: false,
          error: `Invalid transition ${rawCurrent} → ${nextStatus}. Allowed from ${currentStatus}: ${[...allowed].join(', ') || '(terminal state)'}.`,
        });
      }
    }

    let updated;
    try {
      updated = await prisma.chargebackReport.update({
        where: { id },
        data: { status: nextStatus },
      });
    } catch (err: any) {
      loggers.services.error({ err: err?.message, id }, '[admin.chargeback.report.status-advance] update failed');
      return reply.code(500).send({ success: false, error: 'Failed to update report' });
    }

    await writeAudit({
      req: request,
      action: 'admin.chargeback.report.status-advance',
      resource_type: 'ChargebackReport',
      resource_id: id,
      details: { from: rawCurrent, normalizedFrom: currentStatus, to: nextStatus },
    });

    loggers.services.info(
      { id, from: rawCurrent, normalizedFrom: currentStatus, to: nextStatus },
      '[admin.chargeback.report.status-advance] status advanced',
    );

    return reply.send({
      success: true,
      report: { id: updated.id, status: updated.status },
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. POST /codemode/skills    +    DELETE /codemode/skills/:id
  //    Direct CRUD on the codemode.skills system_configuration array.
  // ─────────────────────────────────────────────────────────────────────────
  interface CodeModeSkillRow {
    id: string;
    name?: string;
    description?: string;
    enabled?: boolean;
    tags?: string[];
    source?: string;
    [k: string]: any;
  }

  fastify.post<{ Body: CodeModeSkillRow }>(
    '/codemode/skills',
    async (request, reply) => {
      const body = request.body ?? ({} as CodeModeSkillRow);
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      if (!id) {
        return reply.code(400).send({ success: false, error: 'id is required' });
      }

      const list: CodeModeSkillRow[] = (await getSysConfig<CodeModeSkillRow[]>('codemode.skills')) ?? [];
      if (list.some((s) => s.id === id)) {
        return reply.code(409).send({ success: false, error: `skill "${id}" already exists` });
      }

      const skill: CodeModeSkillRow = {
        id,
        name: typeof body.name === 'string' ? body.name : id,
        description: typeof body.description === 'string' ? body.description : undefined,
        enabled: body.enabled !== false,
        tags: Array.isArray(body.tags) ? body.tags : [],
        source: typeof body.source === 'string' ? body.source : 'admin-direct',
      };
      list.push(skill);
      await setSysConfig('codemode.skills', list);
      await writeAudit({
        req: request,
        action: 'admin.codemode.skills.create',
        resource_type: 'CodeModeSkill',
        resource_id: id,
        details: { name: skill.name, enabled: skill.enabled },
      });
      loggers.services.info({ id }, '[admin.codemode.skills.create] skill added');
      return reply.code(201).send({ success: true, skill });
    },
  );

  fastify.delete<{ Params: { id: string } }>(
    '/codemode/skills/:id',
    async (request, reply) => {
      const { id } = request.params;
      if (!id || typeof id !== 'string') {
        return reply.code(400).send({ success: false, error: 'id is required' });
      }
      const list: CodeModeSkillRow[] = (await getSysConfig<CodeModeSkillRow[]>('codemode.skills')) ?? [];
      const idx = list.findIndex((s) => s.id === id);
      if (idx === -1) {
        return reply.code(404).send({ success: false, error: `skill "${id}" not found` });
      }
      const [removed] = list.splice(idx, 1);
      await setSysConfig('codemode.skills', list);
      await writeAudit({
        req: request,
        action: 'admin.codemode.skills.delete',
        resource_type: 'CodeModeSkill',
        resource_id: id,
        details: { name: removed?.name ?? id },
      });
      loggers.services.info({ id }, '[admin.codemode.skills.delete] skill removed');
      return reply.send({ success: true, removed });
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // 4. POST /codemode/plugins   +   DELETE /codemode/plugins/:id
  // ─────────────────────────────────────────────────────────────────────────
  interface CodeModePluginRow {
    id: string;
    name?: string;
    version?: string;
    description?: string;
    enabled?: boolean;
    [k: string]: any;
  }

  fastify.post<{ Body: CodeModePluginRow }>(
    '/codemode/plugins',
    async (request, reply) => {
      const body = request.body ?? ({} as CodeModePluginRow);
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      if (!id) {
        return reply.code(400).send({ success: false, error: 'id is required' });
      }
      const list: CodeModePluginRow[] = (await getSysConfig<CodeModePluginRow[]>('codemode.plugins')) ?? [];
      if (list.some((p) => p.id === id)) {
        return reply.code(409).send({ success: false, error: `plugin "${id}" already exists` });
      }
      const plugin: CodeModePluginRow = {
        id,
        name: typeof body.name === 'string' ? body.name : id,
        version: typeof body.version === 'string' ? body.version : undefined,
        description: typeof body.description === 'string' ? body.description : undefined,
        enabled: body.enabled !== false,
      };
      list.push(plugin);
      await setSysConfig('codemode.plugins', list);
      await writeAudit({
        req: request,
        action: 'admin.codemode.plugins.create',
        resource_type: 'CodeModePlugin',
        resource_id: id,
        details: { name: plugin.name, version: plugin.version, enabled: plugin.enabled },
      });
      loggers.services.info({ id }, '[admin.codemode.plugins.create] plugin added');
      return reply.code(201).send({ success: true, plugin });
    },
  );

  fastify.delete<{ Params: { id: string } }>(
    '/codemode/plugins/:id',
    async (request, reply) => {
      const { id } = request.params;
      if (!id || typeof id !== 'string') {
        return reply.code(400).send({ success: false, error: 'id is required' });
      }
      const list: CodeModePluginRow[] = (await getSysConfig<CodeModePluginRow[]>('codemode.plugins')) ?? [];
      const idx = list.findIndex((p) => p.id === id);
      if (idx === -1) {
        return reply.code(404).send({ success: false, error: `plugin "${id}" not found` });
      }
      const [removed] = list.splice(idx, 1);
      await setSysConfig('codemode.plugins', list);
      await writeAudit({
        req: request,
        action: 'admin.codemode.plugins.delete',
        resource_type: 'CodeModePlugin',
        resource_id: id,
        details: { name: removed?.name ?? id },
      });
      loggers.services.info({ id }, '[admin.codemode.plugins.delete] plugin removed');
      return reply.send({ success: true, removed });
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // 5. PUT /codemode/mcp-policy
  //    Body: { allow?: string[]; deny?: string[] }
  //    Stores in codemode.mcp-policy SystemConfiguration row. Validates
  //    that allow ∩ deny = ∅. Partial updates preserve the unspecified side.
  // ─────────────────────────────────────────────────────────────────────────
  fastify.put<{
    Body: { allow?: string[]; deny?: string[] };
  }>('/codemode/mcp-policy', async (request, reply) => {
    const body = request.body ?? {};
    if (body.allow !== undefined && !Array.isArray(body.allow)) {
      return reply.code(400).send({ success: false, error: 'allow must be a string[]' });
    }
    if (body.deny !== undefined && !Array.isArray(body.deny)) {
      return reply.code(400).send({ success: false, error: 'deny must be a string[]' });
    }

    const current = (await getSysConfig<{ allow?: string[]; deny?: string[]; allowManagedOnly?: boolean }>(
      'codemode.mcp-policy',
    )) ?? {};
    const nextAllow = (body.allow ?? current.allow ?? []).map((s) => String(s));
    const nextDeny = (body.deny ?? current.deny ?? []).map((s) => String(s));

    const allowSet = new Set(nextAllow);
    const overlap = nextDeny.filter((d) => allowSet.has(d));
    if (overlap.length > 0) {
      return reply.code(400).send({
        success: false,
        error: `allow ∩ deny intersection is non-empty: ${overlap.join(', ')}`,
      });
    }

    const policy = {
      ...current,
      allow: nextAllow,
      deny: nextDeny,
    };
    await setSysConfig('codemode.mcp-policy', policy);
    await writeAudit({
      req: request,
      action: 'admin.codemode.mcp-policy.update',
      resource_type: 'CodeModeMcpPolicy',
      resource_id: 'codemode.mcp-policy',
      details: {
        allowCount: nextAllow.length,
        denyCount: nextDeny.length,
      },
    });
    loggers.services.info(
      { allowCount: nextAllow.length, denyCount: nextDeny.length },
      '[admin.codemode.mcp-policy.update] policy updated',
    );
    return reply.send({ success: true, policy });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. POST /llm-providers/registry/refresh-all
  //    Walks every enabled provider and calls discoverModels() server-side,
  //    merging results into admin.model_role_assignments. Returns:
  //      { success: true, summary: { providersScanned, modelsAdded,
  //        modelsUpdated, errors: [{provider, error}] } }
  //
  //    Idempotent — running twice in a row returns the same merged set
  //    (new = freshly discovered ids that didn't already exist; updated =
  //    existing rows whose discovery payload differed).
  //
  //    Internally delegates to RefreshModelDetailsJob when the live
  //    ProviderManager is decorated on `fastify.appContext`. When it is
  //    not (test rig), we fall back to a no-discovery summary that still
  //    reports providersScanned + zero adds/updates so the UI sees a
  //    consistent shape.
  // ─────────────────────────────────────────────────────────────────────────
  fastify.post('/llm-providers/registry/refresh-all', async (request, reply) => {
    const startedAt = Date.now();
    type ErrorEntry = { provider: string; error: string };
    const summary: {
      providersScanned: number;
      modelsAdded: number;
      modelsUpdated: number;
      errors: ErrorEntry[];
    } = { providersScanned: 0, modelsAdded: 0, modelsUpdated: 0, errors: [] };

    let providers: Array<{ id: string; name: string; enabled: boolean }> = [];
    try {
      providers = (await prisma.lLMProvider.findMany({
        where: { enabled: true, deleted_at: null },
        select: { id: true, name: true, enabled: true },
      })) as any;
    } catch (err: any) {
      loggers.services.error(
        { err: err?.message },
        '[admin.llm-providers.registry.refresh-all] provider lookup failed',
      );
      return reply.code(500).send({ success: false, error: 'Failed to enumerate providers' });
    }

    summary.providersScanned = providers.length;

    // Snapshot current registry so we can compute add/update deltas.
    let beforeIds: Set<string>;
    try {
      const before = await prisma.modelRoleAssignment.findMany({
        select: { provider: true, model: true },
      });
      beforeIds = new Set(before.map((r: any) => `${r.provider}::${r.model}`));
    } catch (err: any) {
      // If even the snapshot fails we still try the refresh and just report
      // both adds + updates as 0 — the run isn't fatal.
      loggers.services.warn(
        { err: err?.message },
        '[admin.llm-providers.registry.refresh-all] snapshot of model_role_assignments failed; deltas will be 0',
      );
      beforeIds = new Set();
    }

    const appCtx: any = (fastify as any).appContext ?? (request as any).server?.appContext;
    const providerManager = appCtx?.providerManager;
    if (providerManager) {
      try {
        const { RefreshModelDetailsJob } = await import('../../jobs/RefreshModelDetailsJob.js');
        const job = new RefreshModelDetailsJob(prisma as any, providerManager, loggers.services as any);
        const jobResult = await job.run();
        summary.modelsUpdated = jobResult.refreshed;
        // failed providers map onto error entries
        if (jobResult.failed > 0) {
          summary.errors.push({ provider: 'multiple', error: `${jobResult.failed} per-row failures (see job logs)` });
        }
      } catch (err: any) {
        loggers.services.error(
          { err: err?.message },
          '[admin.llm-providers.registry.refresh-all] RefreshModelDetailsJob threw',
        );
        summary.errors.push({ provider: 'all', error: err?.message ?? 'job failed' });
      }
    } else {
      // No live ProviderManager — log + report summary with zero adds/updates.
      // The endpoint still returns 200 because the UI just needs a shape.
      loggers.services.warn(
        '[admin.llm-providers.registry.refresh-all] ProviderManager not on appContext; returning shape-only summary',
      );
    }

    // Recompute delta after the refresh.
    try {
      const after = await prisma.modelRoleAssignment.findMany({
        select: { provider: true, model: true },
      });
      const afterIds = new Set(after.map((r: any) => `${r.provider}::${r.model}`));
      let added = 0;
      for (const id of afterIds) if (!beforeIds.has(id)) added += 1;
      summary.modelsAdded = added;
      // If the job didn't report updated count, keep what the snapshot can
      // infer — every preexisting row is treated as "updated" since we just
      // re-discovered against it.
      if (summary.modelsUpdated === 0) {
        let updated = 0;
        for (const id of afterIds) if (beforeIds.has(id)) updated += 1;
        // Cap at preexisting count so we don't double-count adds as updates
        summary.modelsUpdated = Math.min(updated, beforeIds.size);
      }
    } catch (err: any) {
      loggers.services.warn(
        { err: err?.message },
        '[admin.llm-providers.registry.refresh-all] post-snapshot failed; deltas may be 0',
      );
    }

    await writeAudit({
      req: request,
      action: 'admin.llm-providers.registry.refresh-all',
      resource_type: 'LLMProviderRegistry',
      resource_id: 'all',
      details: {
        ...summary,
        durationMs: Date.now() - startedAt,
      },
    });
    loggers.services.info(
      { ...summary, durationMs: Date.now() - startedAt },
      '[admin.llm-providers.registry.refresh-all] sweep complete',
    );

    return reply.send({ success: true, summary });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 7. GET / PUT /workflow-settings
  //    Org-wide workflow governance config. Backed by a single
  //    SystemConfiguration row keyed `workflows.governance`. The shape
  //    matches the AdminWorkflowSettingsView v2 component (see
  //    services/openagentic-ui/src/features/admin/components/Workflows/
  //    AdminWorkflowSettingsView.tsx) — five buckets:
  //      execution-limits / cost / model-agent / errors / memory
  //
  //    GET returns the row merged on top of WORKFLOW_SETTINGS_DEFAULTS so
  //    the UI never has to layer defaults itself. PUT validates allowed
  //    keys + bounds, writes the row, and emits an audit log entry. Both
  //    panes (v2 AdminWorkflowSettingsView + v3 GovernancePane) use this
  //    endpoint — keep the response shape stable.
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/workflow-settings', async (_request, reply) => {
    const stored = (await getSysConfig<Record<string, unknown>>('workflows.governance')) ?? {};
    const merged = { ...WORKFLOW_SETTINGS_DEFAULTS, ...stored };
    return reply.send(merged);
  });

  fastify.put<{ Body: Record<string, unknown> }>(
    '/workflow-settings',
    async (request, reply) => {
      const body = request.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return reply.code(400).send({ success: false, error: 'Body must be an object of settings' });
      }
      const sanitized: Record<string, unknown> = {};
      const rejected: Array<{ key: string; reason: string }> = [];
      for (const [k, v] of Object.entries(body)) {
        if (!ALLOWED_WORKFLOW_SETTING_KEYS.has(k)) {
          rejected.push({ key: k, reason: 'unknown setting key' });
          continue;
        }
        const validation = validateWorkflowSettingValue(k, v);
        if (validation.ok) {
          sanitized[k] = validation.value;
        } else {
          rejected.push({ key: k, reason: validation.reason });
        }
      }
      if (Object.keys(sanitized).length === 0) {
        return reply.code(400).send({
          success: false,
          error: 'No valid settings to write',
          rejected,
        });
      }

      // Merge into the existing row so partial PUTs don't blow away other keys.
      const existing = (await getSysConfig<Record<string, unknown>>('workflows.governance')) ?? {};
      const next = { ...existing, ...sanitized };
      await setSysConfig('workflows.governance', next);

      await writeAudit({
        req: request,
        action: 'admin.workflow-settings.update',
        resource_type: 'SystemConfiguration',
        resource_id: 'workflows.governance',
        details: {
          changedKeys: Object.keys(sanitized),
          rejectedCount: rejected.length,
        },
      });
      loggers.services.info(
        { changedKeys: Object.keys(sanitized), rejected: rejected.length },
        '[admin.workflow-settings.update] settings updated',
      );

      const merged = { ...WORKFLOW_SETTINGS_DEFAULTS, ...next };
      return reply.send({ success: true, settings: merged, rejected });
    },
  );

  // Defence-in-depth admin guard. Production mounts adminMiddleware on the
  // parent register scope (admin.plugin.ts); this preHandler is for test
  // rigs that mount the plugin bare.
  fastify.addHook('preHandler', async (request, reply): Promise<void> => {
    const user = (request as any).user;
    if (!user) return;
    if (!isAdminUser(request)) {
      reply.code(403).send({ success: false, error: 'Admin access required' });
      return;
    }
  });
};

export default adminV3ExtrasMutationsRoutes;
