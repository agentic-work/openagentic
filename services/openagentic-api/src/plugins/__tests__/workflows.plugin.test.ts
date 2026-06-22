/**
 * Phase 3.6 — workflows routes plugin smoke tests.
 *
 * Spins up an isolated Fastify instance, decorates a stubbed AppContext via
 * decorateApp(), registers workflowsRoutesPlugin, then asserts that each
 * sub-route is mounted at the correct prefix using printRoutes()-based
 * assertions.
 *
 * Sub-routes covered:
 *  1. workflowRoutes           — prefix: /api/workflows   (authMiddleware via addHook)
 *  2. workflowApprovalRoutes   — prefix: /api/workflows/approvals  (authMiddleware)
 *  3. workflowMarketplaceRoutes — prefix: /api/workflows/marketplace (authMiddleware)
 *  4. userContextRoutes        — no prefix (hardcodes /api/user-context/* internally)
 *
 * Phase E.8.f rip (2026-05-11): the legacy /api/orchestrate/* sub-route
 * (formerly slot 4) was deleted. Sub-agent dispatch now flows through
 * openagentic-proxy or the in-process chatLoopRecursor primitive.
 *
 * Smoke-test honesty:
 *  - Routes that require auth will return 404 in Bun test runtime due to the
 *    Bun raw.writableEnded quirk (lesson 9). Those are marked it.todo.
 *  - printRoutes() assertions check for radix-tree path segments — the tree
 *    strips leading slashes from inner path segments.
 *  - vi.fn() factories captured BEFORE any dynamic import (lesson 2).
 *  - Strongly typed options (lessons 3, 6).
 *  - No `as any` in production interface body (lesson 10).
 *  - Independent try/catch per register in the plugin (lesson 4).
 *
 * Bun-compatibility rules (lessons 2, 3, 9, 10):
 *  - Dynamic import inside beforeAll so stubs are in place first.
 *  - Env vars saved AND assigned stub values in beforeAll (not just saved).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { AppContext, decorateApp } from '../../context/AppContext.js';
import { createLoggerMock } from '../../test/mocks/logger.js';

// ---------------------------------------------------------------------------
// Logger stub — must be declared before any dynamic import that pulls in
// workflows.plugin.ts, which imports loggers from '../../utils/logger.js'.
// Without this stub, cross-test module-mock pollution in Bun's full suite
// runner can leave loggers.routes as undefined, crashing the plugin
// registration in beforeAll (lesson 9: complete mock surfaces prevent avvio
// uncaught errors that vitest counts as unnamed failures).
// ---------------------------------------------------------------------------

vi.mock('../../utils/logger.js', () => createLoggerMock());

// ---------------------------------------------------------------------------
// Stub deps — minimum surface to satisfy plugin instantiation (lesson 3)
// ---------------------------------------------------------------------------

const stubPrisma = {
  openagenticflow: {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'stub-id', name: 'stub', created_at: new Date(), updated_at: new Date(), definition: {} }),
    update: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(null),
    count: vi.fn().mockResolvedValue(0),
  },
  workflowApprovalRequest: {
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'stub-approval' }),
    update: vi.fn().mockResolvedValue({}),
  },
  userContextEntry: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  $queryRaw: vi.fn().mockResolvedValue([]),
  _stub: true,
} as any;

const stubLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: function () { return this; },
} as any;

// ---------------------------------------------------------------------------
// Outer it.todo block — auth-middleware protected routes (Bun quirk)
// ---------------------------------------------------------------------------

describe('workflowsRoutesPlugin — Phase 3.6 smoke tests', () => {
  it.todo(
    'workflowRoutes (GET /api/workflows) — protected by authMiddleware. ' +
    'Returns 404 instead of 401 in Bun test runtime due to raw.writableEnded quirk. ' +
    'Memory: reference_fastify_v5_unawaited_send_bug.md. ' +
    'Follow-up: integration test with real auth context.'
  );

  it.todo(
    'workflowApprovalRoutes (GET /api/workflows/approvals) — protected by authMiddleware. ' +
    'Returns 404 instead of 401 in Bun test runtime due to raw.writableEnded quirk. ' +
    'Memory: reference_fastify_v5_unawaited_send_bug.md. ' +
    'Follow-up: integration test with real auth context.'
  );

  it.todo(
    'workflowMarketplaceRoutes (GET /api/workflows/marketplace) — protected by authMiddleware. ' +
    'Returns 404 instead of 401 in Bun test runtime due to raw.writableEnded quirk. ' +
    'Memory: reference_fastify_v5_unawaited_send_bug.md. ' +
    'Follow-up: integration test with real auth context.'
  );

  it.todo(
    'userContextRoutes (GET /api/user-context) — protected by authMiddleware. ' +
    'Returns 404 instead of 401 in Bun test runtime due to raw.writableEnded quirk. ' +
    'Memory: reference_fastify_v5_unawaited_send_bug.md. ' +
    'Follow-up: integration test with real auth context.'
  );

  let server: FastifyInstance;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    // Save AND assign stubs (lesson 10).
    savedEnv.JWT_SECRET = process.env.JWT_SECRET;
    savedEnv.DATABASE_URL = process.env.DATABASE_URL;
    savedEnv.OLLAMA_ENABLED = process.env.OLLAMA_ENABLED;
    savedEnv.OLLAMA_EMBEDDING_MODEL = process.env.OLLAMA_EMBEDDING_MODEL;
    savedEnv.EMBEDDING_MODEL = process.env.EMBEDDING_MODEL;

    process.env.JWT_SECRET = 'test-jwt-secret-phase36-plugin';
    process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://stub:stub@localhost:5432/stub';
    if (!process.env.OLLAMA_ENABLED) {
      process.env.OLLAMA_ENABLED = 'true';
    }
    if (!process.env.OLLAMA_EMBEDDING_MODEL && !process.env.EMBEDDING_MODEL) {
      process.env.OLLAMA_EMBEDDING_MODEL = 'stub-embedding-model';
    }

    server = Fastify({ logger: false });

    // Wire a stubbed AppContext (matches what server.ts does via decorateApp).
    const ctx = new AppContext({ prisma: stubPrisma, logger: stubLogger });
    decorateApp(server, ctx);

    // Import the plugin AFTER stubs are in place (lesson 2).
    const { workflowsRoutesPlugin } = await import('../workflows.plugin.js');

    await server.register(workflowsRoutesPlugin, {});
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    if (savedEnv.JWT_SECRET === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = savedEnv.JWT_SECRET;
    if (savedEnv.DATABASE_URL === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedEnv.DATABASE_URL;
    if (savedEnv.OLLAMA_ENABLED === undefined) delete process.env.OLLAMA_ENABLED;
    else process.env.OLLAMA_ENABLED = savedEnv.OLLAMA_ENABLED;
    if (savedEnv.OLLAMA_EMBEDDING_MODEL === undefined) delete process.env.OLLAMA_EMBEDDING_MODEL;
    else process.env.OLLAMA_EMBEDDING_MODEL = savedEnv.OLLAMA_EMBEDDING_MODEL;
    if (savedEnv.EMBEDDING_MODEL === undefined) delete process.env.EMBEDDING_MODEL;
    else process.env.EMBEDDING_MODEL = savedEnv.EMBEDDING_MODEL;
  });

  // ── inject()-based mount assertions (B4 fix — replaces printRoutes() substring checks)
  // A non-404 response proves the route is mounted regardless of radix-tree internals.

  // ── 1. workflowRoutes ──────────────────────────────────────────────────
  it('workflowRoutes: /api/workflows/* is mounted (inject returns non-404)', async () => {
    const resp = await server.inject({ method: 'GET', url: '/api/workflows' });
    expect(resp.statusCode).not.toBe(404);
  });

  // ── 2. workflowApprovalRoutes ──────────────────────────────────────────
  it('workflowApprovalRoutes: /api/workflows/approvals/* is mounted (inject returns non-404)', async () => {
    const resp = await server.inject({ method: 'GET', url: '/api/workflows/approvals' });
    expect(resp.statusCode).not.toBe(404);
  });

  // ── 3. workflowMarketplaceRoutes ──────────────────────────────────────
  it('workflowMarketplaceRoutes: /api/workflows/marketplace/* is mounted (inject returns non-404)', async () => {
    const resp = await server.inject({ method: 'GET', url: '/api/workflows/marketplace' });
    expect(resp.statusCode).not.toBe(404);
  });

  // ── 4. userContextRoutes ──────────────────────────────────────────────
  it.todo(
    'userContextRoutes: /api/user-context/* — inject returns non-404. ' +
    'Bun raw.writableEnded quirk: authMiddleware returns 404 instead of 401 in test runtime. ' +
    'Memory: reference_fastify_v5_unawaited_send_bug.md'
  );
});
