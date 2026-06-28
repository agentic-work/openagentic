/**
 * Router Tuning Admin Routes — TDD spec (Stage B)
 *
 * Covers:
 *  1. GET returns 200 with defaults when service hasn't been updated
 *  2. GET /api/admin/router-tuning requires admin auth (unauth → 401)
 *  3. PUT with valid patch returns 200 + service.updateTuning called with correct args
 *  4. PUT with out-of-range value (fcaChatPoolFloor=1.5) returns 400
 *  5. PUT with unknown field returns 400 (strict schema)
 *  6. PUT with non-numeric value returns 400
 *  7. POST /reset returns 200 + calls service.resetToDefaults
 *  8. Non-admin user on PUT returns 403
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ROUTER_TUNING_DEFAULTS, type RouterTuning } from '../../../services/RouterTuningService.js';

// ---------------------------------------------------------------------------
// Mock the RouterTuningService module
// vi.mock is hoisted, so we must use vi.fn() inline — not top-level variables
// ---------------------------------------------------------------------------

vi.mock('../../../services/RouterTuningService.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/RouterTuningService.js')>();
  return {
    ...actual,
    getRouterTuningService: vi.fn(),
    resetRouterTuningServiceInstance: vi.fn(),
  };
});

vi.mock('../../../utils/prisma.js', () => ({
  prisma: {} as any,
}));

vi.mock('../../../utils/redis-client.js', () => ({
  getRedisClient: vi.fn().mockReturnValue(null),
}));

// ---------------------------------------------------------------------------
// Import mocked factory AFTER vi.mock declarations
// ---------------------------------------------------------------------------

import { getRouterTuningService } from '../../../services/RouterTuningService.js';
const mockGetRouterTuningService = vi.mocked(getRouterTuningService);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDefaultTuning(): RouterTuning {
  return {
    id: 'singleton',
    ...ROUTER_TUNING_DEFAULTS,
    updated_at: new Date('2024-01-01T00:00:00Z'),
    updated_by: null,
  };
}

/** Build a Fastify app with the router-tuning plugin registered under /api/admin */
async function buildApp(opts: {
  isAdmin?: boolean;
  unauthenticated?: boolean;
  nonAdmin?: boolean;
}): Promise<FastifyInstance> {
  const { isAdmin = true, unauthenticated = false, nonAdmin = false } = opts;

  const app = Fastify({ logger: false });

  app.addHook('preHandler', async (request: any, reply) => {
    if (unauthenticated) {
      return reply.code(401).send({ success: false, error: 'Unauthorized' });
    }
    request.user = {
      id: 'user-test-id',
      email: 'admin@openagentic.io',
      isAdmin: !nonAdmin && isAdmin,
      role: !nonAdmin && isAdmin ? 'admin' : 'user',
    };
  });

  const { default: routerTuningRoutes } = await import('../router-tuning.js');
  await app.register(routerTuningRoutes, { prefix: '/api/admin' });
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Router Tuning Admin Routes', () => {
  let defaultTuning: RouterTuning;
  let mockGetTuning: ReturnType<typeof vi.fn>;
  let mockUpdateTuning: ReturnType<typeof vi.fn>;
  let mockResetToDefaults: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    defaultTuning = makeDefaultTuning();

    mockGetTuning = vi.fn().mockResolvedValue(defaultTuning);
    mockUpdateTuning = vi.fn().mockImplementation(async (patch: any, updatedBy: string) => ({
      ...defaultTuning,
      ...patch,
      updated_by: updatedBy,
      updated_at: new Date(),
    }));
    mockResetToDefaults = vi.fn().mockImplementation(async (updatedBy: string) => ({
      ...defaultTuning,
      updated_by: updatedBy,
      updated_at: new Date(),
    }));

    mockGetRouterTuningService.mockReturnValue({
      getTuning: mockGetTuning,
      updateTuning: mockUpdateTuning,
      resetToDefaults: mockResetToDefaults,
    } as any);
  });

  // ── 1. GET returns 200 with defaults ──────────────────────────────────────

  it('GET /api/admin/router-tuning returns 200 with tuning defaults', async () => {
    const app = await buildApp({ isAdmin: true });
    const res = await app.inject({ method: 'GET', url: '/api/admin/router-tuning' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.tuning).toBeDefined();
    expect(body.tuning.fcaChatPoolFloor).toBe(ROUTER_TUNING_DEFAULTS.fcaChatPoolFloor);
    expect(body.tuning.fcaQualityFloor).toBe(ROUTER_TUNING_DEFAULTS.fcaQualityFloor);
    expect(body.lastUpdatedAt).toBeDefined();
    expect(body.lastUpdatedBy).toBeNull();
    await app.close();
  });

  // ── 2. GET requires auth — unauth returns 401 ─────────────────────────────

  it('GET /api/admin/router-tuning returns 401 when unauthenticated', async () => {
    const app = await buildApp({ unauthenticated: true });
    const res = await app.inject({ method: 'GET', url: '/api/admin/router-tuning' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  // ── 3. PUT valid patch returns 200 + service called with correct args ──────

  it('PUT /api/admin/router-tuning with valid patch returns 200 and calls updateTuning', async () => {
    const app = await buildApp({ isAdmin: true });
    const patch = { fcaChatPoolFloor: 0.5, costWeight: 0.3 };
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/router-tuning',
      headers: { 'content-type': 'application/json' },
      payload: patch,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.tuning).toBeDefined();
    expect(mockUpdateTuning).toHaveBeenCalledOnce();
    const [calledPatch, calledBy] = mockUpdateTuning.mock.calls[0];
    expect(calledPatch).toMatchObject(patch);
    expect(calledBy).toBe('user-test-id');
    await app.close();
  });

  // ── 4. PUT out-of-range value → 400 ──────────────────────────────────────

  it('PUT /api/admin/router-tuning with fcaChatPoolFloor=1.5 returns 400', async () => {
    const app = await buildApp({ isAdmin: true });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/router-tuning',
      headers: { 'content-type': 'application/json' },
      payload: { fcaChatPoolFloor: 1.5 },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBeDefined();
    await app.close();
  });

  // ── 5. PUT unknown field → 400 (strict schema) ───────────────────────────

  it('PUT /api/admin/router-tuning with unknown field returns 400', async () => {
    const app = await buildApp({ isAdmin: true });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/router-tuning',
      headers: { 'content-type': 'application/json' },
      payload: { unknownField: 0.5 },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
    await app.close();
  });

  // ── 6. PUT non-numeric value → 400 ───────────────────────────────────────

  it('PUT /api/admin/router-tuning with non-numeric value returns 400', async () => {
    const app = await buildApp({ isAdmin: true });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/router-tuning',
      headers: { 'content-type': 'application/json' },
      payload: { fcaChatPoolFloor: 'not-a-number' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
    await app.close();
  });

  // ── 7. POST /reset returns 200 + calls resetToDefaults ───────────────────

  it('POST /api/admin/router-tuning/reset returns 200 and calls resetToDefaults', async () => {
    const app = await buildApp({ isAdmin: true });
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/router-tuning/reset',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.tuning).toBeDefined();
    expect(mockResetToDefaults).toHaveBeenCalledOnce();
    const [calledBy] = mockResetToDefaults.mock.calls[0];
    expect(calledBy).toBe('user-test-id');
    await app.close();
  });

  // ── 8. Non-admin user on PUT → 403 ───────────────────────────────────────

  it('PUT /api/admin/router-tuning returns 403 for non-admin user', async () => {
    const app = await buildApp({ nonAdmin: true });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/router-tuning',
      headers: { 'content-type': 'application/json' },
      payload: { fcaChatPoolFloor: 0.5 },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.success).toBe(false);
    await app.close();
  });

  // ── 9. PUT intentToFcaFloor record → 400 (field ripped 2026-05-02) ───────

  it('PUT /api/admin/router-tuning rejects ripped intentToFcaFloor field', async () => {
    const app = await buildApp({ isAdmin: true });
    // Strict-mode Zod schema must reject the unknown key with 400 — the
    // FCA-floor escalation branch was ripped with the viz-tier ladder.
    const patch = { intentToFcaFloor: { 'cloud-list': 0.82 } };
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/router-tuning',
      headers: { 'content-type': 'application/json' },
      payload: patch,
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
    await app.close();
  });

  // ── 10. PUT fcaCloudListFloor scalar → 200 (T2 schema) ───────────────────

  it('PUT /api/admin/router-tuning with fcaCloudListFloor=0.82 returns 200', async () => {
    const app = await buildApp({ isAdmin: true });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/router-tuning',
      headers: { 'content-type': 'application/json' },
      payload: { fcaCloudListFloor: 0.82 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    await app.close();
  });

  // ── 11. PUT intentClassifierEnabled boolean → 200 (T2 schema) ────────────

  it('PUT /api/admin/router-tuning with intentClassifierEnabled returns 200', async () => {
    const app = await buildApp({ isAdmin: true });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/router-tuning',
      headers: { 'content-type': 'application/json' },
      payload: { intentClassifierEnabled: true, intentClassifierModelId: 'gpt-oss:20b' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    await app.close();
  });

  // ── 12. PUT intentToTopK → 400 (field RIPPED, Phase E.10, 2026-05-10) ─────

  it('PUT /api/admin/router-tuning with intentToTopK field returns 400 (ripped Phase E.10)', async () => {
    // Phase E.10 (2026-05-10) — intentToTopK was the per-intent top-K limit
    // consumed by the (now-deleted) ToolRankerService. Field is no longer
    // in the zod schema; any patch that includes it is rejected.
    const app = await buildApp({ isAdmin: true });
    const patch = { intentToTopK: { 'cloud-list': 8 } };
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/router-tuning',
      headers: { 'content-type': 'application/json' },
      payload: patch,
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
