/**
 * v3-extras-mutations admin routes — TDD spec
 *
 * Covers the mutation endpoints flagged by the v3 admin UI as
 * "wire-up pending":
 *
 *   1. POST   /api/admin/integrations/:platform/oauth-start
 *   2. PATCH  /api/admin/chargeback/reports/:id
 *   3. POST   /api/admin/llm-providers/registry/refresh-all
 *   4. GET/PUT /api/admin/workflow-settings
 *
 * Each endpoint is exercised for:
 *   - 200 OK on the happy path
 *   - 400 on bad input
 *   - 503 on missing-env (oauth-start specifically)
 *   - 403 defence-in-depth admin guard
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Mock prisma — vi.mock is hoisted, so we wire fresh mock fns before import.
// ---------------------------------------------------------------------------

vi.mock('../../../utils/prisma.js', () => ({
  prisma: {
    adminAuditLog:        { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    chargebackReport:     { findUnique: vi.fn(), update: vi.fn() },
    systemConfiguration:  { findUnique: vi.fn(), upsert: vi.fn() },
    lLMProvider:          { findMany: vi.fn() },
    modelRoleAssignment:  { findMany: vi.fn() },
    integration:          { create: vi.fn() },
  },
}));

vi.mock('../../../utils/logger.js', () => ({
  loggers: {
    routes:   { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
    services: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  },
}));

import { prisma } from '../../../utils/prisma.js';
const p = prisma as any;

/** Build a Fastify app with optional auth-stub preHandler. */
async function buildApp(opts: {
  isAdmin?: boolean;
  noUserAttached?: boolean;
} = {}): Promise<FastifyInstance> {
  const { isAdmin = true, noUserAttached = false } = opts;
  const app = Fastify({ logger: false });

  if (!noUserAttached) {
    app.addHook('preHandler', async (request: any) => {
      request.user = {
        id: 'test-user',
        email: 'admin@openagentic.io',
        isAdmin,
        role: isAdmin ? 'admin' : 'user',
      };
    });
  }

  const { default: routes } = await import('../v3-extras-mutations.js');
  await app.register(routes, { prefix: '/api/admin' });
  await app.ready();
  return app;
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

// ===========================================================================
// 1. POST /integrations/:platform/oauth-start
// ===========================================================================
describe('POST /api/admin/integrations/:platform/oauth-start', () => {
  it('200: returns authorize_url + state for slack when SLACK_CLIENT_ID is set', async () => {
    process.env.SLACK_CLIENT_ID = 'slack-test-client';
    p.adminAuditLog.create.mockResolvedValue({ id: 'a1' });

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/integrations/slack/oauth-start',
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.authorize_url).toContain('slack.com/oauth/v2/authorize');
    expect(body.authorize_url).toContain('client_id=slack-test-client');
    expect(body.authorize_url).toContain('scope=channels%3Aread%2Cchat%3Awrite%2Cusers%3Aread');
    expect(body.state).toBeTruthy();
    expect(body.state.length).toBeGreaterThanOrEqual(16);
    // State must be persisted
    expect(p.adminAuditLog.create).toHaveBeenCalled();
    await app.close();
  });

  it('200: returns authorize_url for ms-teams when MICROSOFT_TEAMS_CLIENT_ID is set', async () => {
    process.env.MICROSOFT_TEAMS_CLIENT_ID = 'teams-test-client';
    p.adminAuditLog.create.mockResolvedValue({ id: 'a1' });

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/integrations/ms-teams/oauth-start',
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.authorize_url).toContain('login.microsoftonline.com');
    expect(body.authorize_url).toContain('client_id=teams-test-client');
    await app.close();
  });

  it('400: rejects unsupported platform', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/integrations/discord/oauth-start',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/platform/);
    await app.close();
  });

  it('503: returns missingEnv when SLACK_CLIENT_ID is unset', async () => {
    delete process.env.SLACK_CLIENT_ID;
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/integrations/slack/oauth-start',
      payload: {},
    });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.missingEnv).toBe('SLACK_CLIENT_ID');
    await app.close();
  });

  it('honors custom redirect_uri from body', async () => {
    process.env.SLACK_CLIENT_ID = 'slack-test-client';
    p.adminAuditLog.create.mockResolvedValue({ id: 'a1' });

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/integrations/slack/oauth-start',
      payload: { redirect_uri: 'https://chat.example.com/admin/integrations/oauth-callback' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(decodeURIComponent(body.authorize_url)).toContain('chat.example.com/admin/integrations/oauth-callback');
    await app.close();
  });
});

// ===========================================================================
// 2. PATCH /chargeback/reports/:id
// ===========================================================================
describe('PATCH /api/admin/chargeback/reports/:id', () => {
  it('200: pending → approved transition succeeds', async () => {
    p.chargebackReport.findUnique.mockResolvedValue({
      id: 'r1',
      status: 'pending',
    });
    p.chargebackReport.update.mockResolvedValue({
      id: 'r1',
      status: 'approved',
    });
    p.adminAuditLog.create.mockResolvedValue({ id: 'a1' });

    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/chargeback/reports/r1',
      payload: { status: 'approved' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.report.status).toBe('approved');
    expect(p.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'admin.chargeback.report.status-advance',
          resource_type: 'ChargebackReport',
          resource_id: 'r1',
        }),
      }),
    );
    await app.close();
  });

  it('200: approved → paid transition succeeds', async () => {
    p.chargebackReport.findUnique.mockResolvedValue({ id: 'r1', status: 'approved' });
    p.chargebackReport.update.mockResolvedValue({ id: 'r1', status: 'paid' });
    p.adminAuditLog.create.mockResolvedValue({ id: 'a1' });

    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/chargeback/reports/r1',
      payload: { status: 'paid' },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('200: legacy "draft" status normalizes to pending and accepts approved', async () => {
    p.chargebackReport.findUnique.mockResolvedValue({ id: 'r1', status: 'draft' });
    p.chargebackReport.update.mockResolvedValue({ id: 'r1', status: 'approved' });
    p.adminAuditLog.create.mockResolvedValue({ id: 'a1' });

    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/chargeback/reports/r1',
      payload: { status: 'approved' },
    });
    expect(res.statusCode).toBe(200);
    // Audit captures the raw legacy value + the normalized one
    const auditCall = p.adminAuditLog.create.mock.calls[0][0];
    expect(auditCall.data.details.from).toBe('draft');
    expect(auditCall.data.details.normalizedFrom).toBe('pending');
    expect(auditCall.data.details.to).toBe('approved');
    await app.close();
  });

  it('200: pending → rejected transition succeeds', async () => {
    p.chargebackReport.findUnique.mockResolvedValue({ id: 'r1', status: 'pending' });
    p.chargebackReport.update.mockResolvedValue({ id: 'r1', status: 'rejected' });
    p.adminAuditLog.create.mockResolvedValue({ id: 'a1' });

    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/chargeback/reports/r1',
      payload: { status: 'rejected' },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('400: rejects pending → paid (skips approval)', async () => {
    p.chargebackReport.findUnique.mockResolvedValue({ id: 'r1', status: 'pending' });
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/chargeback/reports/r1',
      payload: { status: 'paid' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/transition/);
    expect(p.chargebackReport.update).not.toHaveBeenCalled();
    await app.close();
  });

  it('400: rejects approved → rejected (cannot reject post-approval)', async () => {
    p.chargebackReport.findUnique.mockResolvedValue({ id: 'r1', status: 'approved' });
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/chargeback/reports/r1',
      payload: { status: 'rejected' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('400: rejects unknown status value', async () => {
    p.chargebackReport.findUnique.mockResolvedValue({ id: 'r1', status: 'pending' });
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/chargeback/reports/r1',
      payload: { status: 'whatever' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('404: when report id not found', async () => {
    p.chargebackReport.findUnique.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/chargeback/reports/missing',
      payload: { status: 'approved' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

// ===========================================================================
// 6. POST /llm-providers/registry/refresh-all
// ===========================================================================
describe('POST /api/admin/llm-providers/registry/refresh-all', () => {
  it('200: returns summary with providersScanned + modelsAdded + modelsUpdated + errors', async () => {
    p.lLMProvider.findMany.mockResolvedValue([
      { id: 'pr-1', name: 'azure', enabled: true },
      { id: 'pr-2', name: 'ollama', enabled: true },
    ]);
    p.modelRoleAssignment.findMany.mockResolvedValue([]);
    p.adminAuditLog.create.mockResolvedValue({ id: 'a1' });

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/llm-providers/registry/refresh-all',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.summary).toMatchObject({
      providersScanned: expect.any(Number),
      modelsAdded: expect.any(Number),
      modelsUpdated: expect.any(Number),
      errors: expect.any(Array),
    });
    await app.close();
  });

  it('200: idempotent — second invocation returns same merged shape', async () => {
    p.lLMProvider.findMany.mockResolvedValue([
      { id: 'pr-1', name: 'azure', enabled: true },
    ]);
    p.modelRoleAssignment.findMany.mockResolvedValue([]);
    p.adminAuditLog.create.mockResolvedValue({ id: 'a1' });

    const app = await buildApp();
    const a = await app.inject({
      method: 'POST',
      url: '/api/admin/llm-providers/registry/refresh-all',
    });
    const b = await app.inject({
      method: 'POST',
      url: '/api/admin/llm-providers/registry/refresh-all',
    });
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(a.json().summary.providersScanned).toBe(b.json().summary.providersScanned);
    await app.close();
  });
});

// ===========================================================================
// AUTH: defence-in-depth admin guard (403 for non-admin)
// ===========================================================================
describe('Defence-in-depth admin guard', () => {
  it('403 when authenticated user is not admin', async () => {
    const app = await buildApp({ isAdmin: false });
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/llm-providers/registry/refresh-all',
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('fails closed: 401 when no user is attached (no upstream auth ran)', async () => {
    // SECURITY: mutating routes must NOT fail open for an unauthenticated caller.
    const app = await buildApp({ noUserAttached: true });
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/llm-providers/registry/refresh-all',
      payload: {},
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

// ===========================================================================
// 1b. GET /integrations/:platform/oauth-callback
// ===========================================================================
describe('GET /api/admin/integrations/:platform/oauth-callback', () => {
  const ORIGINAL_FETCH = globalThis.fetch;
  const futureExpiry = () => new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const pastExpiry = () => new Date(Date.now() - 60 * 1000).toISOString();

  function mockFetchOnce(payload: any, init: { ok?: boolean; status?: number } = {}) {
    const ok = init.ok ?? true;
    const status = init.status ?? (ok ? 200 : 400);
    (globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok,
      status,
      json: async () => payload,
    });
  }

  beforeEach(() => {
    process.env.SLACK_CLIENT_ID = 'slack-id';
    process.env.SLACK_CLIENT_SECRET = 'slack-secret';
    process.env.MICROSOFT_TEAMS_CLIENT_ID = 'msft-id';
    process.env.MICROSOFT_TEAMS_CLIENT_SECRET = 'msft-secret';
  });

  afterEach(() => {
    (globalThis as any).fetch = ORIGINAL_FETCH;
  });

  it('200: happy path — slack code/state validate, token persisted, success HTML returned', async () => {
    p.adminAuditLog.findFirst
      .mockResolvedValueOnce({
        id: 'state-row',
        created_at: new Date(),
        details: { platform: 'slack', expires_at: futureExpiry(), redirect_uri: '/admin/integrations/oauth-callback' },
      })
      // replay-check: not yet consumed
      .mockResolvedValueOnce(null);
    p.adminAuditLog.create.mockResolvedValue({ id: 'audit-callback' });
    p.integration.create.mockResolvedValue({
      id: 'integ-1',
      name: 'Slack — TestTeam',
      platform: 'slack',
      status: 'active',
    });
    mockFetchOnce({
      ok: true,
      access_token: 'xoxb-fake',
      team: { id: 'T1', name: 'TestTeam' },
      bot_user_id: 'U-bot',
      scope: 'channels:read,chat:write',
    });

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/integrations/slack/oauth-callback?code=auth-code-123&state=nonce-abc',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('oauth-callback');
    expect(res.body).toContain('postMessage');
    expect(p.integration.create).toHaveBeenCalledTimes(1);
    const integArg = p.integration.create.mock.calls[0][0];
    expect(integArg.data.platform).toBe('slack');
    expect(integArg.data.status).toBe('active');
    // SC-28 (#3): the secret botToken is envelope-ENCRYPTED at rest, NOT plaintext.
    expect(integArg.data.config.botToken).not.toBe('xoxb-fake');
    expect(integArg.data.config.botToken).toMatch(/^local2:/);
    const { decryptIntegrationConfig } = await import('../../../services/IntegrationConfigService.js');
    expect(decryptIntegrationConfig(integArg.data.config).botToken).toBe('xoxb-fake');
    // Non-secret metadata stays plaintext.
    expect(integArg.data.config.teamId).toBe('T1');
    // Two adminAuditLog.create calls expected — one is from writeAudit on
    // success-path. (oauth-start was NOT called in this test; only callback.)
    expect(p.adminAuditLog.create).toHaveBeenCalled();
    const successAuditCalls = p.adminAuditLog.create.mock.calls.filter(
      (c: any) => c[0]?.data?.action === 'admin.integrations.oauth-callback',
    );
    expect(successAuditCalls).toHaveLength(1);
    expect(successAuditCalls[0][0].data.details.success).toBe(true);
    await app.close();
  });

  it('200: happy path — ms-teams code/state validate, token persisted', async () => {
    p.adminAuditLog.findFirst
      .mockResolvedValueOnce({
        id: 'state-row',
        created_at: new Date(),
        details: { platform: 'ms-teams', expires_at: futureExpiry() },
      })
      .mockResolvedValueOnce(null);
    p.adminAuditLog.create.mockResolvedValue({ id: 'audit-callback' });
    p.integration.create.mockResolvedValue({
      id: 'integ-2',
      name: 'Microsoft Teams',
      platform: 'teams',
      status: 'active',
    });
    mockFetchOnce({
      access_token: 'eyJ-msft-token',
      refresh_token: 'eyJ-refresh',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'Channel.ReadBasic.All',
    });

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/integrations/ms-teams/oauth-callback?code=auth-code-456&state=nonce-msft',
    });
    expect(res.statusCode).toBe(200);
    expect(p.integration.create).toHaveBeenCalledTimes(1);
    const integArg = p.integration.create.mock.calls[0][0];
    expect(integArg.data.platform).toBe('teams'); // schema uses 'teams', not 'ms-teams'
    // SC-28 (#3): delegated tokens are envelope-ENCRYPTED at rest, NOT plaintext.
    expect(integArg.data.config.accessToken).not.toBe('eyJ-msft-token');
    expect(integArg.data.config.accessToken).toMatch(/^local2:/);
    expect(integArg.data.config.refreshToken).toMatch(/^local2:/);
    const { decryptIntegrationConfig } = await import('../../../services/IntegrationConfigService.js');
    const decryptedTeams = decryptIntegrationConfig(integArg.data.config);
    expect(decryptedTeams.accessToken).toBe('eyJ-msft-token');
    expect(decryptedTeams.refreshToken).toBe('eyJ-refresh');
    await app.close();
  });

  // #3 HIGH — SC-28 at-rest encryption regression. Before the fix the OAuth
  // callback persisted Integration.config in PLAINTEXT, bypassing #119's
  // encryptIntegrationConfig() envelope used by the manual admin POST path.
  it('SC-28 (#3): persists the OAuth-issued secret ENCRYPTED — never plaintext — and round-trips', async () => {
    const SECRET = 'xoxb-super-secret-oauth-token';
    p.adminAuditLog.findFirst
      .mockResolvedValueOnce({
        id: 'state-row',
        created_at: new Date(),
        details: { platform: 'slack', expires_at: futureExpiry(), redirect_uri: '/admin/integrations/oauth-callback' },
      })
      .mockResolvedValueOnce(null);
    p.adminAuditLog.create.mockResolvedValue({ id: 'audit-callback' });
    p.integration.create.mockResolvedValue({ id: 'integ-3', platform: 'slack', status: 'active' });
    mockFetchOnce({
      ok: true,
      access_token: SECRET,
      team: { id: 'T9', name: 'SecureTeam' },
      bot_user_id: 'U-bot',
      scope: 'channels:read,chat:write',
    });

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/integrations/slack/oauth-callback?code=auth-code&state=nonce-sc28',
    });
    expect(res.statusCode).toBe(200);
    expect(p.integration.create).toHaveBeenCalledTimes(1);

    const storedConfig = p.integration.create.mock.calls[0][0].data.config;
    // The raw secret must NOT appear anywhere in the persisted config payload.
    expect(JSON.stringify(storedConfig)).not.toContain(SECRET);
    // It carries the vault envelope prefix produced by encryptIntegrationConfig.
    expect(storedConfig.botToken).toMatch(/^local2:/);

    // The stored config is exactly the encryptIntegrationConfig output: it
    // round-trips back to the original secret via decryptIntegrationConfig.
    const { decryptIntegrationConfig } = await import('../../../services/IntegrationConfigService.js');
    expect(decryptIntegrationConfig(storedConfig).botToken).toBe(SECRET);
    await app.close();
  });

  it('400: rejects unknown platform', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/integrations/discord/oauth-callback?code=x&state=y',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/platform/i);
    await app.close();
  });

  it('400: rejects missing code or state', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/integrations/slack/oauth-callback?code=onlycode',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/code|state/i);
    await app.close();
  });

  it('400: state not found', async () => {
    p.adminAuditLog.findFirst.mockResolvedValueOnce(null);
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/integrations/slack/oauth-callback?code=c&state=missing',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/state/i);
    await app.close();
  });

  it('400: state expired', async () => {
    p.adminAuditLog.findFirst.mockResolvedValueOnce({
      id: 'state-row',
      created_at: new Date(),
      details: { platform: 'slack', expires_at: pastExpiry() },
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/integrations/slack/oauth-callback?code=c&state=stale',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/expired/i);
    expect(p.integration.create).not.toHaveBeenCalled();
    await app.close();
  });

  it('400: state already consumed (replay)', async () => {
    p.adminAuditLog.findFirst
      .mockResolvedValueOnce({
        id: 'state-row',
        created_at: new Date(),
        details: { platform: 'slack', expires_at: futureExpiry() },
      })
      .mockResolvedValueOnce({
        id: 'replay-row',
      });
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/integrations/slack/oauth-callback?code=c&state=replayed',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/consumed|replay|already/i);
    expect(p.integration.create).not.toHaveBeenCalled();
    await app.close();
  });

  it('503: missing SLACK_CLIENT_SECRET env', async () => {
    delete process.env.SLACK_CLIENT_SECRET;
    p.adminAuditLog.findFirst
      .mockResolvedValueOnce({
        id: 'state-row',
        created_at: new Date(),
        details: { platform: 'slack', expires_at: futureExpiry() },
      })
      .mockResolvedValueOnce(null);
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/integrations/slack/oauth-callback?code=c&state=s',
    });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.missingEnv).toBe('SLACK_CLIENT_SECRET');
    expect(p.integration.create).not.toHaveBeenCalled();
    await app.close();
  });

  it('502: upstream OAuth provider returns failure (slack ok=false)', async () => {
    p.adminAuditLog.findFirst
      .mockResolvedValueOnce({
        id: 'state-row',
        created_at: new Date(),
        details: { platform: 'slack', expires_at: futureExpiry() },
      })
      .mockResolvedValueOnce(null);
    p.adminAuditLog.create.mockResolvedValue({ id: 'audit' });
    mockFetchOnce({ ok: false, error: 'invalid_code' }, { ok: true, status: 200 });
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/integrations/slack/oauth-callback?code=bad&state=s',
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toMatch(/upstream|invalid_code/i);
    expect(p.integration.create).not.toHaveBeenCalled();
    // State must be marked consumed even on upstream failure (anti-replay)
    const failureAuditCalls = p.adminAuditLog.create.mock.calls.filter(
      (c: any) => c[0]?.data?.action === 'admin.integrations.oauth-callback',
    );
    expect(failureAuditCalls).toHaveLength(1);
    expect(failureAuditCalls[0][0].data.details.success).toBe(false);
    await app.close();
  });

  it('502: upstream MSFT returns 4xx', async () => {
    p.adminAuditLog.findFirst
      .mockResolvedValueOnce({
        id: 'state-row',
        created_at: new Date(),
        details: { platform: 'ms-teams', expires_at: futureExpiry() },
      })
      .mockResolvedValueOnce(null);
    p.adminAuditLog.create.mockResolvedValue({ id: 'audit' });
    mockFetchOnce(
      { error: 'invalid_grant', error_description: 'AADSTS70008: code expired' },
      { ok: false, status: 400 },
    );
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/integrations/ms-teams/oauth-callback?code=bad&state=s',
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toMatch(/upstream|expired|invalid_grant/i);
    expect(p.integration.create).not.toHaveBeenCalled();
    await app.close();
  });
});

// ===========================================================================
// 7. GET / PUT /workflow-settings (governance config)
// ===========================================================================
describe('GET /api/admin/workflow-settings', () => {
  it('200: returns DEFAULTS merged on top of stored row', async () => {
    p.systemConfiguration.findUnique.mockResolvedValue({
      key: 'workflows.governance',
      value: JSON.stringify({ defaultNodeTimeout: 60, maxAgentTurns: 30 }),
    });

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/workflow-settings',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Stored values override defaults
    expect(body.defaultNodeTimeout).toBe(60);
    expect(body.maxAgentTurns).toBe(30);
    // Unset keys still come from defaults
    expect(body.maxNodeTimeout).toBe(300);
    expect(body.onBudgetExceeded).toBe('pause');
    expect(body.crossModeMemoryEnabled).toBe(true);
    await app.close();
  });

  it('200: returns full DEFAULTS when no row exists', async () => {
    p.systemConfiguration.findUnique.mockResolvedValue(null);

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/workflow-settings',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.defaultNodeTimeout).toBe(30);
    expect(body.maxNodesPerWorkflow).toBe(50);
    expect(body.defaultBackoffStrategy).toBe('exponential');
    await app.close();
  });
});

describe('PUT /api/admin/workflow-settings', () => {
  it('200: writes valid settings + emits audit log', async () => {
    p.systemConfiguration.findUnique.mockResolvedValue(null);
    p.systemConfiguration.upsert.mockResolvedValue({ key: 'workflows.governance' });
    p.adminAuditLog.create.mockResolvedValue({ id: 'a1' });

    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/workflow-settings',
      payload: {
        defaultNodeTimeout: 45,
        maxAgentTurns: 20,
        crossModeMemoryEnabled: false,
        onBudgetExceeded: 'abort',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.settings.defaultNodeTimeout).toBe(45);
    expect(body.settings.maxAgentTurns).toBe(20);
    expect(body.settings.crossModeMemoryEnabled).toBe(false);
    expect(body.settings.onBudgetExceeded).toBe('abort');
    // Defaults bleed through unspecified keys
    expect(body.settings.maxNodeTimeout).toBe(300);
    expect(p.systemConfiguration.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: 'workflows.governance' } }),
    );
    expect(p.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'admin.workflow-settings.update',
          resource_type: 'SystemConfiguration',
          resource_id: 'workflows.governance',
        }),
      }),
    );
    await app.close();
  });

  it('400: rejects out-of-range numeric value', async () => {
    p.systemConfiguration.findUnique.mockResolvedValue(null);
    p.systemConfiguration.upsert.mockResolvedValue({ key: 'workflows.governance' });
    p.adminAuditLog.create.mockResolvedValue({ id: 'a1' });

    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/workflow-settings',
      payload: { defaultNodeTimeout: 999_999 },
    });
    // No valid keys → 400 with rejected payload listing the bad key
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(Array.isArray(body.rejected)).toBe(true);
    expect(body.rejected.some((r: any) => r.key === 'defaultNodeTimeout')).toBe(true);
    expect(p.systemConfiguration.upsert).not.toHaveBeenCalled();
    await app.close();
  });

  it('200: rejects unknown keys but writes valid ones', async () => {
    p.systemConfiguration.findUnique.mockResolvedValue(null);
    p.systemConfiguration.upsert.mockResolvedValue({ key: 'workflows.governance' });
    p.adminAuditLog.create.mockResolvedValue({ id: 'a1' });

    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/workflow-settings',
      payload: {
        bogusKey: 'nope',
        defaultNodeTimeout: 90,
        // bad enum
        onBudgetExceeded: 'destroy_everything',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.settings.defaultNodeTimeout).toBe(90);
    expect(body.rejected.some((r: any) => r.key === 'bogusKey')).toBe(true);
    expect(body.rejected.some((r: any) => r.key === 'onBudgetExceeded')).toBe(true);
    await app.close();
  });

  it('403: non-admin user blocked by defence-in-depth', async () => {
    const app = await buildApp({ isAdmin: false });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/workflow-settings',
      payload: { defaultNodeTimeout: 60 },
    });
    expect(res.statusCode).toBe(403);
    expect(p.systemConfiguration.upsert).not.toHaveBeenCalled();
    await app.close();
  });
});
