/**
 * /api/admin/slo/* — Phase 12 admin REST.
 *
 * 6 endpoints over the SLOService singleton:
 *  - GET    /api/admin/slo                     list
 *  - GET    /api/admin/slo/:metric             get one
 *  - POST   /api/admin/slo                     upsert
 *  - PATCH  /api/admin/slo/:metric/toggle      flip enabled
 *  - DELETE /api/admin/slo/:metric             remove
 *  - GET    /api/admin/slo/:metric/status      live evaluation
 *
 * The guard is mocked at adminGuard so tests don't need to mint admin
 * tokens. Each test injects an inline preHandler instead, mirroring
 * the pattern in llm-providers.create-p2002.test.ts.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

vi.mock('../../../middleware/adminGuard.js', () => ({
  // No-op guard — tests inject their own auth via preHandler.
  requireAdminFastify: async () => {},
  adminGuard: async () => {},
}));

import { sloRoutes } from '../slo.js';
import { _resetSLOServiceForTests, getSLOService } from '../../../services/SLOService.js';

async function buildApp(opts: { admin: boolean } = { admin: true }): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.addHook('preHandler', async (request: any) => {
    request.user = opts.admin
      ? { id: 'admin-1', email: 'admin@test', isAdmin: true }
      : { id: 'user-1', email: 'user@test', isAdmin: false };
  });
  await app.register(sloRoutes, { prefix: '/api/admin/slo' });
  await app.ready();
  return app;
}

describe('GET /api/admin/slo', () => {
  let app: FastifyInstance;
  beforeEach(() => _resetSLOServiceForTests());
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });

  it('returns the seeded default SLO list', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/admin/slo' });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(Array.isArray(body.slos)).toBe(true);
    expect(body.slos.length).toBeGreaterThanOrEqual(8);
    // Each entry has the SLO shape.
    expect(body.slos[0]).toMatchObject({
      metric: expect.any(String),
      type: expect.any(String),
      threshold: expect.any(Number),
      window: expect.any(String),
      description: expect.any(String),
      enabled: expect.any(Boolean),
    });
  });
});

describe('GET /api/admin/slo/:metric', () => {
  let app: FastifyInstance;
  beforeEach(() => _resetSLOServiceForTests());
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });

  it('returns the matching SLO row by metric name', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/admin/slo/v3_chat_turn_duration_seconds',
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.slo.metric).toBe('v3_chat_turn_duration_seconds');
  });

  it('returns 404 for unknown metric', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/admin/slo/v3_does_not_exist',
    });
    expect(r.statusCode).toBe(404);
  });
});

describe('POST /api/admin/slo', () => {
  let app: FastifyInstance;
  beforeEach(() => _resetSLOServiceForTests());
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });

  it('upserts a new SLO and returns the row', async () => {
    const payload = {
      metric: 'v3_audience_routes_total',
      type: 'rps_floor',
      threshold: 0.1,
      window: '1h',
      description: 'audience routing must see >= 0.1 rps',
      enabled: true,
    };
    const r = await app.inject({
      method: 'POST',
      url: '/api/admin/slo',
      payload,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.slo.metric).toBe('v3_audience_routes_total');
    expect(body.slo.threshold).toBe(0.1);

    // Persisted on the singleton.
    const got = getSLOService().getSLO('v3_audience_routes_total');
    expect(got).toBeDefined();
    expect(got!.description).toBe(payload.description);
  });

  it('rejects payload missing required fields with 400', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/admin/slo',
      payload: { metric: 'foo' /* no threshold/type/etc */ },
    });
    expect(r.statusCode).toBe(400);
  });
});

describe('PATCH /api/admin/slo/:metric/toggle', () => {
  let app: FastifyInstance;
  beforeEach(() => _resetSLOServiceForTests());
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });

  it('toggles the enabled flag', async () => {
    const before = getSLOService().getSLO('v3_chat_turn_duration_seconds')!.enabled;
    const r = await app.inject({
      method: 'PATCH',
      url: '/api/admin/slo/v3_chat_turn_duration_seconds/toggle',
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.slo.enabled).toBe(!before);
  });

  it('returns 404 for unknown metric', async () => {
    const r = await app.inject({
      method: 'PATCH',
      url: '/api/admin/slo/v3_does_not_exist/toggle',
    });
    expect(r.statusCode).toBe(404);
  });
});

describe('DELETE /api/admin/slo/:metric', () => {
  let app: FastifyInstance;
  beforeEach(() => _resetSLOServiceForTests());
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });

  it('removes the row and returns 204', async () => {
    const r = await app.inject({
      method: 'DELETE',
      url: '/api/admin/slo/v3_chat_turn_duration_seconds',
    });
    expect(r.statusCode).toBe(204);
    expect(getSLOService().getSLO('v3_chat_turn_duration_seconds')).toBeUndefined();
  });

  it('returns 404 for unknown metric', async () => {
    const r = await app.inject({
      method: 'DELETE',
      url: '/api/admin/slo/v3_does_not_exist',
    });
    expect(r.statusCode).toBe(404);
  });
});

describe('GET /api/admin/slo/:metric/status', () => {
  let app: FastifyInstance;
  beforeEach(() => _resetSLOServiceForTests());
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });

  it('returns the SLO + a met:boolean evaluation against current registry state', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/admin/slo/v3_chat_turn_duration_seconds/status',
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.slo.metric).toBe('v3_chat_turn_duration_seconds');
    expect(typeof body.met).toBe('boolean');
    // observation should be present (may be null if no observations yet).
    expect('observation' in body).toBe(true);
  });

  it('returns 404 for unknown metric', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/admin/slo/v3_does_not_exist/status',
    });
    expect(r.statusCode).toBe(404);
  });
});
