/**
 * Admin Permissions routes — TDD spec
 *
 * Covers the 5 endpoints under /api/admin/permissions that drive the
 * PermissionService rule CRUD from the admin UI.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

vi.mock('../../../utils/prisma.js', () => ({
  prisma: {
    adminAuditLog: { create: vi.fn().mockResolvedValue({}) },
    systemConfiguration: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      upsert: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock('../../../utils/logger.js', () => ({
  loggers: {
    routes: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
    services: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      // PermissionService.constructor calls logger.child if present
      child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    },
  },
}));

async function buildApp(opts: { isAdmin?: boolean } = {}): Promise<FastifyInstance> {
  const { isAdmin = true } = opts;
  const app = Fastify({ logger: false });
  app.addHook('preHandler', async (request: any) => {
    request.user = {
      id: 'test-admin',
      email: 'admin@openagentic.io',
      isAdmin,
      role: isAdmin ? 'admin' : 'user',
    };
  });
  // Reset the singleton so each test starts with seed defaults
  const { _resetPermissionServiceForTesting } = await import('../../../services/PermissionService.js');
  _resetPermissionServiceForTesting();
  const { default: routes } = await import('../permissions.js');
  // permissions.ts registers handlers at `/`, `/reset`, `/read-only-mode`
  // — so mount under `/api/admin/permissions` to land them at the
  // production paths the UI calls.
  await app.register(routes, { prefix: '/api/admin/permissions' });
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/admin/permissions', () => {
  it('200: returns rules + pending arrays', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/permissions' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.rules)).toBe(true);
    expect(body.rules.length).toBeGreaterThan(0); // seed defaults loaded
    expect(Array.isArray(body.pending)).toBe(true);
  });

  it('403: non-admin denied', async () => {
    const app = await buildApp({ isAdmin: false });
    const res = await app.inject({ method: 'GET', url: '/api/admin/permissions' });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /api/admin/permissions', () => {
  it('200: adds a rule and audits', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/permissions',
      payload: {
        source: 'userSettings',
        ruleBehavior: 'allow',
        ruleValue: { toolName: 'custom_thing' },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.rule.ruleValue.toolName).toBe('custom_thing');
  });

  it('400: invalid behavior rejected', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/permissions',
      payload: {
        ruleBehavior: 'maybe',
        ruleValue: { toolName: 'x' },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('400: missing toolName rejected', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/permissions',
      payload: {
        ruleBehavior: 'allow',
        ruleValue: {},
      },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('DELETE /api/admin/permissions', () => {
  it('200: removes a rule', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/admin/permissions',
      payload: { toolName: 'tool_search', behavior: 'allow' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.removed).toBe(true);
  });

  it('400: missing toolName rejected', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/admin/permissions',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('PUT /api/admin/permissions', () => {
  it('200: replaces the entire rule set', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/permissions',
      payload: {
        rules: [
          {
            source: 'userSettings',
            ruleBehavior: 'allow',
            ruleValue: { toolName: 'only_this_tool' },
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.count).toBe(1);
  });

  it('400: malformed rules array rejected', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/permissions',
      payload: { rules: 'not-an-array' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/admin/permissions/reset', () => {
  it('200: resets to seeded defaults', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/permissions/reset',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// #790 — global READ-ONLY mode toggle endpoints
// ---------------------------------------------------------------------------

describe('GET /api/admin/permissions/read-only-mode', () => {
  it('200: returns the current readOnlyMode flag (defaults to false)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/permissions/read-only-mode',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(typeof body.readOnlyMode).toBe('boolean');
    expect(body.readOnlyMode).toBe(false);
  });

  it('403: non-admin denied', async () => {
    const app = await buildApp({ isAdmin: false });
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/permissions/read-only-mode',
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('PUT /api/admin/permissions/read-only-mode', () => {
  it('200: flips the flag on and round-trips via GET', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/permissions/read-only-mode',
      payload: { readOnlyMode: true },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.readOnlyMode).toBe(true);

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/admin/permissions/read-only-mode',
    });
    expect(JSON.parse(getRes.body).readOnlyMode).toBe(true);
  });

  it('200: flips the flag off', async () => {
    const app = await buildApp();
    await app.inject({
      method: 'PUT',
      url: '/api/admin/permissions/read-only-mode',
      payload: { readOnlyMode: true },
    });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/permissions/read-only-mode',
      payload: { readOnlyMode: false },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).readOnlyMode).toBe(false);
  });

  it('400: missing readOnlyMode rejected', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/permissions/read-only-mode',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('400: non-boolean readOnlyMode rejected', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/permissions/read-only-mode',
      payload: { readOnlyMode: 'yes' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('403: non-admin denied', async () => {
    const app = await buildApp({ isAdmin: false });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/permissions/read-only-mode',
      payload: { readOnlyMode: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it('writes an admin_audit_log entry on flip', async () => {
    const app = await buildApp();
    const { prisma } = await import('../../../utils/prisma.js');
    const createMock = (prisma as any).adminAuditLog.create as ReturnType<typeof vi.fn>;
    createMock.mockClear();

    await app.inject({
      method: 'PUT',
      url: '/api/admin/permissions/read-only-mode',
      payload: { readOnlyMode: true },
    });

    expect(createMock).toHaveBeenCalled();
    const auditCall = createMock.mock.calls.find(
      (c: any[]) => c[0]?.data?.action === 'permission_read_only_mode_changed',
    );
    expect(auditCall).toBeDefined();
    expect((auditCall as any[])[0]?.data?.details?.readOnlyMode).toBe(true);
  });
});
