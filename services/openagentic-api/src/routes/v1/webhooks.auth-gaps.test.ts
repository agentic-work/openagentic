/**
 * Webhook auth-gap hardening (TDD)
 *
 * Closes three confirmed authentication gaps in the inbound webhook router:
 *
 *   #2 (HIGH)   /slack-command did ZERO signature verification before
 *               dispatching to slackIntegrationService.handleEvent (which can
 *               resolve+run a workflow and POST to an attacker-supplied
 *               response_url). Now mirrors the /slack HMAC gate.
 *   #11 (LOW)   /integration/:webhookId dispatched the slack platform to
 *               handleEvent with NO HMAC check (capability URL only). Now gates
 *               the slack platform with the same decrypt+verifySignature check.
 *   #7 (MEDIUM) /alertmanager was fully unauthenticated and triggered workflows
 *               with attacker-controlled input. Now requires a shared secret
 *               (ALERTMANAGER_WEBHOOK_SECRET, Authorization: Bearer <secret>)
 *               compared in constant time; fails closed (403) when unset.
 *
 * Mirrors the boot + mock pattern of webhooks.slack.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Logger stub — must be declared before dynamic imports
// ---------------------------------------------------------------------------
vi.mock('../../utils/logger.js', () => {
  const noop = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() };
  const cats = ['server','auth','chat','mcp','database','admin','routes','middleware','services','pipeline','storage','prompt'];
  const loggers: Record<string, typeof noop> = {};
  for (const c of cats) loggers[c] = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() };
  return { default: noop, logger: noop, loggers, logError: vi.fn(), shutdown: vi.fn() };
});

// ---------------------------------------------------------------------------
// Prisma stub
// ---------------------------------------------------------------------------
const mockFindFirst = vi.fn().mockResolvedValue(null);
vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    integration: { findFirst: mockFindFirst },
    workflowWebhook: { findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    workflow: { findMany: vi.fn().mockResolvedValue([]) },
    workflowExecution: { create: vi.fn().mockResolvedValue({ id: 'exec-1' }), update: vi.fn() },
  },
}));

// ---------------------------------------------------------------------------
// SlackIntegrationService stub
// ---------------------------------------------------------------------------
const mockVerifySignature = vi.fn();
const mockHandleEvent = vi.fn().mockResolvedValue({ statusCode: 200, body: { ok: true } });
vi.mock('../../services/SlackIntegrationService.js', () => ({
  slackIntegrationService: {
    verifySignature: mockVerifySignature,
    handleEvent: mockHandleEvent,
  },
  SlackIntegrationService: vi.fn(),
}));

// ---------------------------------------------------------------------------
// TeamsIntegrationService stub
// ---------------------------------------------------------------------------
const mockHandleActivity = vi.fn().mockResolvedValue({ statusCode: 200, body: {} });
vi.mock('../../services/TeamsIntegrationService.js', () => ({
  TeamsIntegrationService: vi.fn().mockImplementation(() => ({
    verifyToken: vi.fn().mockResolvedValue(false),
    handleActivity: mockHandleActivity,
  })),
}));

// ---------------------------------------------------------------------------
// WebhookSecurityService stub
// ---------------------------------------------------------------------------
vi.mock('../../services/WebhookSecurityService.js', () => ({
  webhookSecurityService: {
    validateRequest: vi.fn().mockResolvedValue({ allowed: false, status: 'rejected', statusCode: 403, rejectionReason: 'stub' }),
    auditLog: vi.fn().mockResolvedValue(undefined),
  },
}));

// ---------------------------------------------------------------------------
// executeViaWorkflowsService stub (webhook → workflows-svc proxy)
// ---------------------------------------------------------------------------
vi.mock('../../services/executeViaWorkflowsService.js', () => ({
  executeViaWorkflowsService: vi.fn().mockResolvedValue({ success: true }),
}));

// ---------------------------------------------------------------------------
// WorkflowCompiler stub
// ---------------------------------------------------------------------------
vi.mock('../../services/WorkflowCompiler.js', () => ({
  WorkflowCompiler: vi.fn().mockImplementation(() => ({
    compile: vi.fn().mockReturnValue({ valid: false, errors: [] }),
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SIGNING_SECRET = 'test-signing-secret-auth-gaps';
const ALERT_SECRET = 'alert-shared-secret-xyz';

function computeSlackSig(secret: string, timestamp: string, rawBody: string): string {
  const basestring = `v0:${timestamp}:${rawBody}`;
  return 'v0=' + crypto.createHmac('sha256', secret).update(basestring).digest('hex');
}

function freshTimestamp(): string {
  return String(Math.floor(Date.now() / 1000));
}

const MOCK_SLACK_INTEGRATION = {
  id: 'integ-1',
  platform: 'slack',
  status: 'active',
  deleted_at: null,
  webhook_id: 'wh-1',
  config: { signingSecret: SIGNING_SECRET },
};

const VALID_ALERT_BODY = JSON.stringify({
  version: '4',
  groupKey: 'g1',
  status: 'firing',
  receiver: 'openagentic',
  alerts: [{ status: 'firing', labels: { alertname: 'HighCpu', severity: 'critical' }, annotations: { summary: 'cpu' } }],
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Webhook auth-gap hardening', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    const { webhookRoutes } = await import('./webhooks.js');
    await app.register(webhookRoutes, { prefix: '' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockVerifySignature.mockReset();
    mockHandleEvent.mockReset().mockResolvedValue({ statusCode: 200, body: { ok: true } });
    mockHandleActivity.mockReset().mockResolvedValue({ statusCode: 200, body: {} });
    mockFindFirst.mockReset().mockResolvedValue(null);
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ─── #2 /slack-command ────────────────────────────────────────────────────
  describe('#2 /slack-command signature enforcement', () => {
    it('forged slash command with NO signature headers → 403, handleEvent NOT called', async () => {
      mockFindFirst.mockResolvedValueOnce(MOCK_SLACK_INTEGRATION);

      const form = new URLSearchParams({
        command: '/flow',
        text: 'do something dangerous',
        user_id: 'U1',
        channel_id: 'C1',
        response_url: 'https://hooks.slack.com/commands/123/456',
      }).toString();

      const response = await app.inject({
        method: 'POST',
        url: '/slack-command',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: form,
      });

      expect(response.statusCode).toBe(403);
      expect(mockHandleEvent).not.toHaveBeenCalled();
    });

    it('slash command with INVALID signature → 403 invalid_signature, handleEvent NOT called', async () => {
      mockFindFirst.mockResolvedValueOnce(MOCK_SLACK_INTEGRATION);
      mockVerifySignature.mockReturnValueOnce(false);

      const form = new URLSearchParams({
        command: '/flow',
        text: 'hi',
        user_id: 'U1',
        channel_id: 'C1',
        response_url: 'https://hooks.slack.com/commands/123/456',
      }).toString();

      const response = await app.inject({
        method: 'POST',
        url: '/slack-command',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-slack-request-timestamp': freshTimestamp(),
          'x-slack-signature': 'v0=deadbeef',
        },
        payload: form,
      });

      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body)).toMatchObject({ error: 'invalid_signature' });
      expect(mockHandleEvent).not.toHaveBeenCalled();
    });

    it('slash command with VALID signature → 200 and handleEvent called', async () => {
      mockFindFirst.mockResolvedValue(MOCK_SLACK_INTEGRATION);
      mockVerifySignature.mockReturnValue(true);
      // Stub global fetch so the response_url POST does not hit the network.
      const fetchStub = vi.fn(async () => ({ ok: true, status: 200 }));
      vi.stubGlobal('fetch', fetchStub);

      const ts = freshTimestamp();
      const form = new URLSearchParams({
        command: '/flow',
        text: 'hi',
        user_id: 'U1',
        channel_id: 'C1',
        response_url: 'https://hooks.slack.com/commands/123/456',
      }).toString();
      const sig = computeSlackSig(SIGNING_SECRET, ts, form);

      const response = await app.inject({
        method: 'POST',
        url: '/slack-command',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-slack-request-timestamp': ts,
          'x-slack-signature': sig,
        },
        payload: form,
      });

      expect(response.statusCode).toBe(200);
      // Async dispatch happens after the immediate ack — wait for it.
      await vi.waitFor(() => {
        expect(mockHandleEvent).toHaveBeenCalled();
      });
    });

    it('no active slack integration → 403, handleEvent NOT called', async () => {
      mockFindFirst.mockResolvedValueOnce(null);

      const form = new URLSearchParams({ command: '/flow', text: 'hi', response_url: 'https://hooks.slack.com/x' }).toString();
      const response = await app.inject({
        method: 'POST',
        url: '/slack-command',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-slack-request-timestamp': freshTimestamp(),
          'x-slack-signature': 'v0=abc',
        },
        payload: form,
      });

      expect(response.statusCode).toBe(403);
      expect(mockHandleEvent).not.toHaveBeenCalled();
    });
  });

  // ─── #11 /integration/:webhookId slack path ───────────────────────────────
  describe('#11 /integration/:webhookId slack HMAC gate', () => {
    it('slack integration WITHOUT signature → 403, handleEvent NOT called', async () => {
      mockFindFirst.mockResolvedValueOnce(MOCK_SLACK_INTEGRATION);

      const body = JSON.stringify({ type: 'event_callback', event: { type: 'app_mention', text: 'x' } });
      const response = await app.inject({
        method: 'POST',
        url: '/integration/wh-1',
        headers: { 'content-type': 'application/json' },
        payload: body,
      });

      expect(response.statusCode).toBe(403);
      expect(mockHandleEvent).not.toHaveBeenCalled();
    });

    it('slack integration with VALID signature → 200 and handleEvent called', async () => {
      mockFindFirst.mockResolvedValueOnce(MOCK_SLACK_INTEGRATION);
      mockVerifySignature.mockReturnValueOnce(true);

      const ts = freshTimestamp();
      const body = JSON.stringify({ type: 'event_callback', event: { type: 'app_mention', text: 'x' } });
      const sig = computeSlackSig(SIGNING_SECRET, ts, body);

      const response = await app.inject({
        method: 'POST',
        url: '/integration/wh-1',
        headers: {
          'content-type': 'application/json',
          'x-slack-request-timestamp': ts,
          'x-slack-signature': sig,
        },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      expect(mockHandleEvent).toHaveBeenCalledOnce();
    });

    it('url_verification challenge passes without signature (no handleEvent)', async () => {
      mockFindFirst.mockResolvedValueOnce(MOCK_SLACK_INTEGRATION);
      const body = JSON.stringify({ type: 'url_verification', challenge: 'chal-1' });
      const response = await app.inject({
        method: 'POST',
        url: '/integration/wh-1',
        headers: { 'content-type': 'application/json' },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({ challenge: 'chal-1' });
      expect(mockHandleEvent).not.toHaveBeenCalled();
    });
  });

  // ─── #7 /alertmanager shared-secret gate ──────────────────────────────────
  describe('#7 /alertmanager shared-secret auth', () => {
    afterEach(() => {
      delete process.env.ALERTMANAGER_WEBHOOK_SECRET;
    });

    it('secret UNSET → 403 (fail closed), no DB lookup', async () => {
      delete process.env.ALERTMANAGER_WEBHOOK_SECRET;

      const response = await app.inject({
        method: 'POST',
        url: '/alertmanager',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${ALERT_SECRET}`,
        },
        payload: VALID_ALERT_BODY,
      });

      expect(response.statusCode).toBe(403);
    });

    it('WRONG secret → 403', async () => {
      process.env.ALERTMANAGER_WEBHOOK_SECRET = ALERT_SECRET;

      const response = await app.inject({
        method: 'POST',
        url: '/alertmanager',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer not-the-secret',
        },
        payload: VALID_ALERT_BODY,
      });

      expect(response.statusCode).toBe(403);
    });

    it('MISSING authorization header → 403', async () => {
      process.env.ALERTMANAGER_WEBHOOK_SECRET = ALERT_SECRET;

      const response = await app.inject({
        method: 'POST',
        url: '/alertmanager',
        headers: { 'content-type': 'application/json' },
        payload: VALID_ALERT_BODY,
      });

      expect(response.statusCode).toBe(403);
    });

    it('CORRECT secret → proceeds (202)', async () => {
      process.env.ALERTMANAGER_WEBHOOK_SECRET = ALERT_SECRET;

      const response = await app.inject({
        method: 'POST',
        url: '/alertmanager',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${ALERT_SECRET}`,
        },
        payload: VALID_ALERT_BODY,
      });

      expect(response.statusCode).toBe(202);
      expect(JSON.parse(response.body)).toMatchObject({ accepted: true });
    });
  });
});
