/**
 * Phase I (2026-04-29) — internal codemode default-model endpoint.
 *
 * Route: GET /api/internal/codemode-default-model
 *
 * Auth: X-Internal-API-Key must match the configured internalKey.
 * Same fail-closed pattern as every other cm↔api internal call-site
 * (see internal-user-storage.test.ts for the canonical six-case
 * regression suite).
 *
 * TDD plan:
 *   1. 401 when X-Internal-API-Key header is missing
 *   2. 401 when X-Internal-API-Key value is wrong
 *   3. 401 when server-side internalKey is empty (fail-closed)
 *   4. 200 + {model: <id>} on happy path
 *   5. 200 + {model: ""} when registry has no default configured (valid)
 *   6. 500 with scrubbed error when resolveDefaultCodeModel throws
 *   7. The resolver is invoked exactly once per request (no caching at
 *      route level — caller-side cm caches, see k8sSessionManager).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { registerInternalCodemodeModelRoute } from '../internal-codemode-model.route.js';

const INTERNAL_KEY = 'unit-test-internal-key';

async function buildApp(opts: {
  internalKey?: string;
  resolver: () => Promise<string>;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerInternalCodemodeModelRoute(app, {
    internalKey: opts.internalKey ?? INTERNAL_KEY,
    resolveDefaultCodeModel: opts.resolver,
  });
  await app.ready();
  return app;
}

describe('GET /api/internal/codemode-default-model', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('401 when X-Internal-API-Key header is missing', async () => {
    const resolver = vi.fn().mockResolvedValue('anthropic.claude-sonnet-4-20250514');
    app = await buildApp({ resolver });
    const res = await app.inject({
      method: 'GET',
      url: '/api/internal/codemode-default-model',
    });
    expect(res.statusCode).toBe(401);
    expect(resolver).not.toHaveBeenCalled();
  });

  it('401 when X-Internal-API-Key value is wrong', async () => {
    const resolver = vi.fn().mockResolvedValue('anthropic.claude-sonnet-4-20250514');
    app = await buildApp({ resolver });
    const res = await app.inject({
      method: 'GET',
      url: '/api/internal/codemode-default-model',
      headers: { 'x-internal-api-key': 'wrong-key' },
    });
    expect(res.statusCode).toBe(401);
    expect(resolver).not.toHaveBeenCalled();
  });

  it('401 when server-side internalKey is empty (fail-closed)', async () => {
    const resolver = vi.fn().mockResolvedValue('anthropic.claude-sonnet-4-20250514');
    app = await buildApp({ internalKey: '', resolver });
    const res = await app.inject({
      method: 'GET',
      url: '/api/internal/codemode-default-model',
      headers: { 'x-internal-api-key': 'anything' },
    });
    expect(res.statusCode).toBe(401);
    expect(resolver).not.toHaveBeenCalled();
  });

  it('200 + {model} on happy path with the registry-canonical id', async () => {
    const resolver = vi.fn().mockResolvedValue('anthropic.claude-sonnet-4-20250514');
    app = await buildApp({ resolver });
    const res = await app.inject({
      method: 'GET',
      url: '/api/internal/codemode-default-model',
      headers: { 'x-internal-api-key': INTERNAL_KEY },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ model: 'anthropic.claude-sonnet-4-20250514' });
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('200 + {model: ""} when the registry has no default configured', async () => {
    const resolver = vi.fn().mockResolvedValue('');
    app = await buildApp({ resolver });
    const res = await app.inject({
      method: 'GET',
      url: '/api/internal/codemode-default-model',
      headers: { 'x-internal-api-key': INTERNAL_KEY },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ model: '' });
  });

  it('500 with scrubbed error when resolver throws — no DB/stack leakage', async () => {
    const boom = new Error('raw prisma "P2025": no row in admin.model_role_assignments matched');
    boom.stack = 'Error: raw prisma\n    at ModelConfigurationService.getDefaultCodeModel (/app/src/services/ModelConfigurationService.ts:162:11)';
    const resolver = vi.fn().mockRejectedValue(boom);
    app = await buildApp({ resolver });
    const res = await app.inject({
      method: 'GET',
      url: '/api/internal/codemode-default-model',
      headers: { 'x-internal-api-key': INTERNAL_KEY },
    });
    expect(res.statusCode).toBe(500);
    const body = res.json() as { error: string };
    expect(body.error).toBe('codemode_default_model_failed');
    // No raw error / stack / file path leakage in the response body.
    const raw = res.body;
    expect(raw).not.toContain('prisma');
    expect(raw).not.toContain('ModelConfigurationService');
    expect(raw).not.toContain('admin.model_role_assignments');
  });

  it('coerces non-string resolver returns to empty string (defensive)', async () => {
    const resolver = vi.fn().mockResolvedValue(undefined as any);
    app = await buildApp({ resolver });
    const res = await app.inject({
      method: 'GET',
      url: '/api/internal/codemode-default-model',
      headers: { 'x-internal-api-key': INTERNAL_KEY },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ model: '' });
  });
});
