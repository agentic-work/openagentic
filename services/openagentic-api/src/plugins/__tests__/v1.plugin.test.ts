/**
 * Phase 3.9 — v1 routes plugin smoke tests.
 *
 * Spins up an isolated Fastify instance, decorates a stubbed AppContext via
 * decorateApp(), registers v1RoutesPlugin, then asserts that the dual-mount
 * surfaces (/api/v1/status and /v1/status) are reachable.
 *
 * Why dual-mount matters:
 *  - /api/v1/*  — standard REST surface for browser / Swagger clients.
 *  - /v1/*      — Anthropic-SDK / openagentic CLI compat (OPENAGENTIC_BASE_URL
 *                 without /api prefix hits /v1/models, /v1/messages, etc.).
 *  Both mounts share the SAME v1Router definition; no routes are duplicated.
 *
 * Smoke-test honesty:
 *  - Auth-protected sub-routes return 404 in Bun test runtime due to the
 *    raw.writableEnded quirk (lesson 9). Those are marked it.todo.
 *  - We exercise only /status (no auth) to confirm both mounts are live.
 *  - Logger inoculation mock declared BEFORE any dynamic import (lessons 12, 13).
 *  - .child() present on every logger category (lesson 13).
 *  - No `as any` in production interface body (lesson 10).
 *  - Independent try/catch per register in the plugin (lesson 4).
 *
 * Bun-compatibility rules (lessons 2, 3, 9, 10, 12, 13):
 *  - Dynamic import inside beforeAll so stubs are in place first.
 *  - vi.fn() factories captured BEFORE any dynamic import.
 *  - Strongly typed options (lessons 3, 6).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { AppContext, decorateApp } from '../../context/AppContext.js';
import { createLoggerMock } from '../../test/mocks/logger.js';

// ---------------------------------------------------------------------------
// Logger stub — MUST be declared before any dynamic import (lessons 12, 13).
// Each category MUST have .child() so downstream services that call
// logger.child() at construction do not throw during plugin registration.
// ---------------------------------------------------------------------------

vi.mock('../../utils/logger.js', () => createLoggerMock());

// ---------------------------------------------------------------------------
// Stub deps — minimum surface to satisfy plugin instantiation (lesson 3)
// ---------------------------------------------------------------------------

const stubPrisma = {
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
// it.todo — auth-protected sub-routes (Bun quirk, lesson 9)
// ---------------------------------------------------------------------------

describe('v1RoutesPlugin — Phase 3.9 smoke tests', () => {
  it.todo(
    'MCP routes (/api/v1/mcp/* and /v1/mcp/*) — auth-gated. ' +
    'Returns 404 in Bun test runtime due to raw.writableEnded quirk. ' +
    'Memory: reference_fastify_v5_unawaited_send_bug.md. ' +
    'Follow-up: integration test with real auth context.'
  );

  it.todo(
    'Models routes (/api/v1/models/* and /v1/models/*) — optional, may require DB. ' +
    'Returns 404 in Bun test runtime. ' +
    'Follow-up: integration test with real auth context.'
  );

  // ---------------------------------------------------------------------------
  // Active assertions — /status is unauthenticated, confirms both mounts live
  // ---------------------------------------------------------------------------

  let server: FastifyInstance;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    savedEnv.JWT_SECRET = process.env.JWT_SECRET;
    savedEnv.DATABASE_URL = process.env.DATABASE_URL;
    savedEnv.OLLAMA_ENABLED = process.env.OLLAMA_ENABLED;
    savedEnv.OLLAMA_EMBEDDING_MODEL = process.env.OLLAMA_EMBEDDING_MODEL;
    savedEnv.EMBEDDING_MODEL = process.env.EMBEDDING_MODEL;

    process.env.JWT_SECRET = 'test-jwt-secret-phase39-plugin';
    process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://stub:stub@localhost:5432/stub';
    if (!process.env.OLLAMA_ENABLED) process.env.OLLAMA_ENABLED = 'true';
    if (!process.env.OLLAMA_EMBEDDING_MODEL && !process.env.EMBEDDING_MODEL) {
      process.env.OLLAMA_EMBEDDING_MODEL = 'stub-embedding-model';
    }

    server = Fastify({ logger: false });

    // Wire a stubbed AppContext (mirrors what server.ts does via decorateApp).
    const ctx = new AppContext({ prisma: stubPrisma, logger: stubLogger });
    decorateApp(server, ctx);

    // Import plugin AFTER stubs are in place (lesson 2).
    const { v1RoutesPlugin } = await import('../v1.plugin.js');

    await server.register(v1RoutesPlugin, {});
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

  it('GET /api/v1/status returns 200 with version=v1 (primary mount)', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/v1/status' });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.version).toBe('v1');
    expect(body.status).toBe('operational');
  });

  it('GET /v1/status returns 200 with version=v1 (SDK/CLI compat alias mount)', async () => {
    const response = await server.inject({ method: 'GET', url: '/v1/status' });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.version).toBe('v1');
    expect(body.status).toBe('operational');
  });

  it('/api/v1/status is mounted (inject returns non-404 — B4 fix replaces printRoutes)', async () => {
    const resp = await server.inject({ method: 'GET', url: '/api/v1/status' });
    expect(resp.statusCode).not.toBe(404);
  });
});
