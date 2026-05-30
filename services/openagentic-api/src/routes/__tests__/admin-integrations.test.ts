/**
 * TDD — Admin Integrations: Test Connection & Send Message
 *
 * RED-first. All tests written before implementation changes.
 * Tests the enhanced /integrations/:id/test endpoint and the new
 * /integrations/:id/test/send-message endpoint.
 *
 * Strategy: spin up isolated Fastify with only admin-integrations routes.
 * Mock prisma, logger, SlackIntegrationService, TeamsIntegrationService,
 * and global fetch. No real network or DB.
 *
 * Test matrix:
 *   T1  Slack auth.test fails → HTTP 400 + success:false (bug fix)
 *   T2  Slack invalid botToken format → HTTP 400 before fetch (A1)
 *   T3  Slack invalid signingSecret format → HTTP 400 before fetch (A1)
 *   T4  Slack auth.test success → rich diagnostic including teamId/botId (A2)
 *   T5  Slack scopes call is made after auth.test success (A3)
 *   T6  Slack scopes included in response when available (A3)
 *   T7  Teams invalid appId (not UUID) → HTTP 400 before fetch (A1)
 *   T8  Teams success → tokenType + expiresIn (A4)
 *   T9  Teams auth failure → HTTP 400 (A5)
 *   T10 POST /test/send-message exists and posts chat.postMessage (A6)
 *   T11 POST /test/send-message returns 200 + ts+channel on success (A6)
 *   T12 POST /test/send-message returns 400 on Slack error (A6)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Logger stub — must be before any dynamic import
// ---------------------------------------------------------------------------
vi.mock('../../utils/logger.js', () => {
  const noop: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() };
  noop.child = () => noop;
  noop.bindings = () => ({});
  const cats = ['server','auth','chat','mcp','database','admin','routes','middleware','services','pipeline','storage','prompt'];
  const loggers: Record<string, typeof noop> = {};
  for (const c of cats) {
    const cat: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() };
    cat.child = () => cat;
    cat.bindings = () => ({});
    loggers[c] = cat;
  }
  return {
    default: noop,
    logger: noop,
    loggers,
    logError: vi.fn(),
    shutdown: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Prisma stub
// ---------------------------------------------------------------------------
const mockPrismaIntegration = {
  findUnique: vi.fn(),
  findMany: vi.fn().mockResolvedValue([]),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};
const mockPrismaIntegrationLog = {
  findMany: vi.fn().mockResolvedValue([]),
  count: vi.fn().mockResolvedValue(0),
};

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    integration: mockPrismaIntegration,
    integrationLog: mockPrismaIntegrationLog,
  },
}));

// ---------------------------------------------------------------------------
// SlackIntegrationService + TeamsIntegrationService stubs
// ---------------------------------------------------------------------------
vi.mock('../../services/SlackIntegrationService.js', () => ({
  SlackIntegrationService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../services/TeamsIntegrationService.js', () => ({
  TeamsIntegrationService: vi.fn().mockImplementation(() => ({})),
}));

// ---------------------------------------------------------------------------
// Global fetch mock
// ---------------------------------------------------------------------------
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const VALID_BOT_TOKEN = 'xoxb-1234567890-abcdefghijk';
const VALID_SIGNING_SECRET = 'abcdef1234567890abcdef1234567890'; // 32 hex chars
const VALID_APP_ID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_APP_PASSWORD = 'some-app-password';

function makeSlackIntegration(overrides: Record<string, any> = {}) {
  return {
    id: 'int-slack-1',
    platform: 'slack',
    config: {
      botToken: VALID_BOT_TOKEN,
      signingSecret: VALID_SIGNING_SECRET,
      appId: 'A0123456789',
      ...overrides.config,
    },
    ...overrides,
  };
}

function makeTeamsIntegration(overrides: Record<string, any> = {}) {
  return {
    id: 'int-teams-1',
    platform: 'teams',
    config: {
      appId: VALID_APP_ID,
      appPassword: VALID_APP_PASSWORD,
      tenantId: 'tenant-abc',
      ...overrides.config,
    },
    ...overrides,
  };
}

function makeResponse(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Fastify setup
// ---------------------------------------------------------------------------

let app: FastifyInstance;

beforeEach(async () => {
  vi.clearAllMocks();
  app = Fastify({ logger: false });
  const { default: routes } = await import('../../routes/admin-integrations.js');
  await app.register(routes, { prefix: '/api/admin' });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Admin Integrations — Test Connection enhanced endpoint', () => {

  // T1 — Slack auth.test failure → HTTP 400 (bug fix from HTTP 200)
  it('T1: Slack auth.test failure returns HTTP 400 with success:false', async () => {
    mockPrismaIntegration.findUnique.mockResolvedValue(makeSlackIntegration());

    mockFetch.mockResolvedValue(makeResponse({
      ok: false,
      error: 'invalid_auth',
    }));

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/integrations/int-slack-1/test',
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(false);
    expect(body.details.error).toBe('invalid_auth');
  });

  // T2 — Slack invalid botToken format → 400 before any fetch
  it('T2: Slack invalid botToken format returns HTTP 400 before calling Slack API', async () => {
    mockPrismaIntegration.findUnique.mockResolvedValue(makeSlackIntegration({
      config: { botToken: 'invalid-format-token', signingSecret: VALID_SIGNING_SECRET, appId: 'A0123456789' },
    }));

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/integrations/int-slack-1/test',
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(false);
    expect(body.details.error).toBe('invalid_token_format');
    expect(body.details.field).toBe('botToken');
    // Must NOT have called fetch
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // T3 — Slack invalid signingSecret format → 400 before any fetch
  it('T3: Slack invalid signingSecret format returns HTTP 400 before calling Slack API', async () => {
    mockPrismaIntegration.findUnique.mockResolvedValue(makeSlackIntegration({
      config: { botToken: VALID_BOT_TOKEN, signingSecret: 'too-short-not-hex', appId: 'A0123456789' },
    }));

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/integrations/int-slack-1/test',
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(false);
    expect(body.details.error).toBe('invalid_signing_secret_format');
    expect(body.details.field).toBe('signingSecret');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // T4 — Slack auth.test success → rich diagnostic
  it('T4: Slack auth.test success returns rich diagnostic (team, teamId, user, userId, botId)', async () => {
    mockPrismaIntegration.findUnique.mockResolvedValue(makeSlackIntegration());

    // auth.test succeeds
    mockFetch.mockResolvedValueOnce(makeResponse({
      ok: true,
      team: 'OpenAgentic',
      team_id: 'T01ABCDEFG',
      user: 'agenticbot',
      user_id: 'U01ABCDEFG',
      bot_id: 'B01ABCDEFG',
      url: 'https://openagentic.slack.com/',
    }));

    // scopes call — tolerate failure, return empty for this test
    mockFetch.mockResolvedValueOnce(makeResponse({ ok: false, error: 'missing_scope' }));

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/integrations/int-slack-1/test',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(body.details.team).toBe('OpenAgentic');
    expect(body.details.teamId).toBe('T01ABCDEFG');
    expect(body.details.user).toBe('agenticbot');
    expect(body.details.userId).toBe('U01ABCDEFG');
    expect(body.details.botId).toBe('B01ABCDEFG');
    expect(body.details.url).toBe('https://openagentic.slack.com/');
  });

  // T5 — Slack scopes call is made after auth.test success
  it('T5: apps.permissions.scopes.list is called after auth.test success', async () => {
    mockPrismaIntegration.findUnique.mockResolvedValue(makeSlackIntegration());

    mockFetch
      .mockResolvedValueOnce(makeResponse({ ok: true, team: 'X', team_id: 'T1', user: 'bot', user_id: 'U1', bot_id: 'B1', url: 'https://x.slack.com/' }))
      .mockResolvedValueOnce(makeResponse({ ok: false, error: 'missing_scope' }));

    await app.inject({
      method: 'POST',
      url: '/api/admin/integrations/int-slack-1/test',
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const secondCall = mockFetch.mock.calls[1];
    expect(secondCall[0]).toContain('apps.permissions.scopes.list');
  });

  // T6 — Scopes included in response when scopes call succeeds
  it('T6: scopes included in response when apps.permissions.scopes.list succeeds', async () => {
    mockPrismaIntegration.findUnique.mockResolvedValue(makeSlackIntegration());

    mockFetch
      .mockResolvedValueOnce(makeResponse({ ok: true, team: 'X', team_id: 'T1', user: 'bot', user_id: 'U1', bot_id: 'B1', url: 'https://x.slack.com/' }))
      .mockResolvedValueOnce(makeResponse({
        ok: true,
        scopes: {
          bot: ['chat:write', 'app_mentions:read', 'channels:history'],
          app_home: [],
          team: [],
          channel: [],
          group: [],
          mpim: [],
          im: [],
        },
      }));

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/integrations/int-slack-1/test',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.details.scopes).toEqual(['chat:write', 'app_mentions:read', 'channels:history']);
  });

  // T7 — Teams invalid appId (not UUID) → 400 before fetch
  it('T7: Teams invalid appId format returns HTTP 400 before calling token endpoint', async () => {
    mockPrismaIntegration.findUnique.mockResolvedValue(makeTeamsIntegration({
      config: { appId: 'not-a-uuid', appPassword: VALID_APP_PASSWORD, tenantId: 'tenant-abc' },
    }));

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/integrations/int-teams-1/test',
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(false);
    expect(body.details.error).toBe('invalid_app_id_format');
    expect(body.details.field).toBe('appId');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // T8 — Teams success → tokenType + expiresIn
  it('T8: Teams token success returns tokenType and expiresIn', async () => {
    mockPrismaIntegration.findUnique.mockResolvedValue(makeTeamsIntegration());

    mockFetch.mockResolvedValue(makeResponse({
      access_token: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJhcHBfZGlzcGxheW5hbWUiOiJBZ2VudGljV29yayBCb3QifQ.sig',
      token_type: 'Bearer',
      expires_in: 3599,
    }));

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/integrations/int-teams-1/test',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(body.details.tokenType).toBe('Bearer');
    expect(body.details.expiresIn).toBe(3599);
  });

  // T9 — Teams auth failure → HTTP 400
  it('T9: Teams token endpoint failure returns HTTP 400', async () => {
    mockPrismaIntegration.findUnique.mockResolvedValue(makeTeamsIntegration());

    mockFetch.mockResolvedValue(makeResponse({
      error: 'unauthorized_client',
      error_description: 'The client is not authorized.',
    }, 400));

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/integrations/int-teams-1/test',
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(false);
  });

});

describe('Admin Integrations — Send Test Message endpoint', () => {

  // T10 — send-message endpoint exists
  it('T10: POST /test/send-message exists (not 404) for Slack integration', async () => {
    mockPrismaIntegration.findUnique.mockResolvedValue(makeSlackIntegration());

    mockFetch.mockResolvedValue(makeResponse({
      ok: true,
      ts: '1234567890.123456',
      channel: 'C01ABCDEFG',
    }));

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/integrations/int-slack-1/test/send-message',
      payload: { channel: 'C01ABCDEFG' },
    });

    expect(res.statusCode).not.toBe(404);
  });

  // T11 — send-message success → ts + channel
  it('T11: send-message success returns ts and channel', async () => {
    mockPrismaIntegration.findUnique.mockResolvedValue(makeSlackIntegration());

    mockFetch.mockResolvedValue(makeResponse({
      ok: true,
      ts: '1234567890.123456',
      channel: 'C01ABCDEFG',
    }));

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/integrations/int-slack-1/test/send-message',
      payload: { channel: 'C01ABCDEFG' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(body.details.ts).toBe('1234567890.123456');
    expect(body.details.channel).toBe('C01ABCDEFG');
  });

  // T12 — send-message Slack error → 400
  it('T12: send-message returns 400 when Slack chat.postMessage fails', async () => {
    mockPrismaIntegration.findUnique.mockResolvedValue(makeSlackIntegration());

    mockFetch.mockResolvedValue(makeResponse({
      ok: false,
      error: 'channel_not_found',
    }));

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/integrations/int-slack-1/test/send-message',
      payload: { channel: 'C-nonexistent' },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(false);
    expect(body.details.error).toBe('channel_not_found');
  });

});
