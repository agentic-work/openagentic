/**
 * A.11 — internal bucket-seed endpoint.
 *
 * Route: POST /api/internal/code-mode/seed-bucket-subdir
 *
 * Auth: X-Internal-API-Key must match the configured internalKey.
 * Same fail-closed pattern as internal-user-storage.route.ts and
 * internal-codemode-model.route.ts.
 *
 * TDD plan (5 cases):
 *   1. 401 when X-Internal-API-Key header is missing
 *   2. 401 when X-Internal-API-Key value is wrong
 *   3. 200 + {ok:true} when valid key + valid body → calls seedBucketSubdir
 *   4. 400 when valid key + missing/invalid body fields
 *   5. 500 with {ok:false, error} when service throws
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { registerInternalBucketSeedRoute } from '../internal-bucket-seed.route.js';

const INTERNAL_KEY = 'unit-test-seed-key';

function mkService(seedFn?: () => Promise<void>) {
  return {
    seedBucketSubdir: vi.fn(seedFn ?? (() => Promise.resolve())),
  };
}

async function buildApp(opts: {
  internalKey?: string;
  service?: ReturnType<typeof mkService>;
}): Promise<{ app: FastifyInstance; svc: ReturnType<typeof mkService> }> {
  const app = Fastify({ logger: false });
  const svc = opts.service ?? mkService();
  registerInternalBucketSeedRoute(app, {
    internalKey: opts.internalKey ?? INTERNAL_KEY,
    userStorageServiceFactory: () => svc as any,
  });
  await app.ready();
  return { app, svc };
}

describe('POST /api/internal/code-mode/seed-bucket-subdir', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('401 when X-Internal-API-Key header is missing', async () => {
    ({ app } = await buildApp({}));
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/code-mode/seed-bucket-subdir',
      payload: { bucket: 'pvc-abc', userId: 'user-1' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('401 when X-Internal-API-Key value is wrong', async () => {
    ({ app } = await buildApp({}));
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/code-mode/seed-bucket-subdir',
      headers: { 'x-internal-api-key': 'wrong-key' },
      payload: { bucket: 'pvc-abc', userId: 'user-1' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('200 + {ok:true} on happy path — calls seedBucketSubdir with bucket + userId', async () => {
    let called: { bucket: string; userId: string } | null = null;
    const svc = mkService(async () => { /* no-op */ });
    svc.seedBucketSubdir = vi.fn(async (bucket: string, userId: string) => {
      called = { bucket, userId };
    });
    ({ app } = await buildApp({ service: svc }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/code-mode/seed-bucket-subdir',
      headers: { 'x-internal-api-key': INTERNAL_KEY },
      payload: { bucket: 'pvc-2cf188ca-4fb1-4d2f-b7c9-e6e52344d72a', userId: 'alice@example.com' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(called).toEqual({ bucket: 'pvc-2cf188ca-4fb1-4d2f-b7c9-e6e52344d72a', userId: 'alice@example.com' });
  });

  it('400 when bucket is missing from body', async () => {
    ({ app } = await buildApp({}));
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/code-mode/seed-bucket-subdir',
      headers: { 'x-internal-api-key': INTERNAL_KEY },
      payload: { userId: 'alice@example.com' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('400 when userId is missing from body', async () => {
    ({ app } = await buildApp({}));
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/code-mode/seed-bucket-subdir',
      headers: { 'x-internal-api-key': INTERNAL_KEY },
      payload: { bucket: 'pvc-abc' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('500 with {ok:false, error} when service throws', async () => {
    const boom = new Error('raw s3 putObject failed: AccessDenied at /some/internal/path.ts:42');
    boom.stack = 'Error: raw s3\n    at UserStorageService.seedBucketSubdir (/app/src/services/UserStorageService.ts:300:11)';
    const svc = mkService(() => Promise.reject(boom));
    ({ app } = await buildApp({ service: svc }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/code-mode/seed-bucket-subdir',
      headers: { 'x-internal-api-key': INTERNAL_KEY },
      payload: { bucket: 'pvc-abc', userId: 'alice@example.com' },
    });
    expect(res.statusCode).toBe(500);
    const body = res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(typeof body.error).toBe('string');
    // Must not leak internal paths or stack frames
    expect(res.body).not.toContain('UserStorageService.ts');
    expect(res.body).not.toContain('/app/src');
  });
});
