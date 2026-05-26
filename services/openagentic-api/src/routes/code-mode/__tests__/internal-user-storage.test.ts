/**
 * Task 5 — CSI-S3 T5: Internal API route for cm → UserStorageService.
 *
 * Route: POST /api/internal/code-mode/ensure-user-bucket
 *
 * Auth: X-Internal-API-Key must match process.env.CODE_MANAGER_INTERNAL_KEY.
 * Same pattern as every other cm↔api internal call-site in this repo.
 *
 * This route is the ONLY in-cluster surface cm talks to for bucket/user
 * provisioning. cm does NOT import minio-js; all provisioning logic lives
 * in UserStorageService (Task 2, 23 tests green). This route is a thin
 * adapter: parse body → call ensureUserBucket() → scrub errors on failure.
 *
 * Test plan (TDD — red-first, 6 cases):
 *   1. 401 when X-Internal-API-Key header is missing
 *   2. 401 when X-Internal-API-Key header value is wrong
 *   3. 400 when body.userId is missing or empty
 *   4. 200 + {bucketName, minioUser, secretName} on happy path (UserStorageService mocked)
 *   5. 500 with scrubbed message when ensureUserBucket throws; no stack trace leakage
 *   6. Idempotency surface — second call with same userId returns same bucketName
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import type { UserBucketInfo } from '../../../services/UserStorageService.js';
import { registerInternalUserStorageRoute } from '../internal-user-storage.route.js';

const INTERNAL_KEY = 'unit-test-internal-key';

function mkService(info: UserBucketInfo) {
  return { ensureUserBucket: vi.fn().mockResolvedValue(info) };
}

async function buildApp(service: { ensureUserBucket: ReturnType<typeof vi.fn> }): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerInternalUserStorageRoute(app, {
    internalKey: INTERNAL_KEY,
    userStorageServiceFactory: () => service as any,
  });
  await app.ready();
  return app;
}

describe('POST /api/internal/code-mode/ensure-user-bucket', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('401 when X-Internal-API-Key is missing', async () => {
    app = await buildApp(mkService({ bucketName: 'ws-abc', minioUser: 'u-abc', secretName: 'ws-abc-creds' }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/code-mode/ensure-user-bucket',
      payload: { userId: 'user-1' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('401 when X-Internal-API-Key value is wrong', async () => {
    app = await buildApp(mkService({ bucketName: 'ws-abc', minioUser: 'u-abc', secretName: 'ws-abc-creds' }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/code-mode/ensure-user-bucket',
      headers: { 'x-internal-api-key': 'wrong-key' },
      payload: { userId: 'user-1' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('400 when body.userId is missing', async () => {
    app = await buildApp(mkService({ bucketName: 'ws-abc', minioUser: 'u-abc', secretName: 'ws-abc-creds' }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/code-mode/ensure-user-bucket',
      headers: { 'x-internal-api-key': INTERNAL_KEY },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('400 when body.userId is empty string', async () => {
    app = await buildApp(mkService({ bucketName: 'ws-abc', minioUser: 'u-abc', secretName: 'ws-abc-creds' }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/code-mode/ensure-user-bucket',
      headers: { 'x-internal-api-key': INTERNAL_KEY },
      payload: { userId: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('200 + {bucketName, minioUser, secretName} on happy path', async () => {
    const info: UserBucketInfo = {
      bucketName: 'ws-deadbeefcafe1234',
      minioUser: 'u-deadbeefcafe1234',
      secretName: 'ws-deadbeefcafe1234-creds',
    };
    const svc = mkService(info);
    app = await buildApp(svc);
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/code-mode/ensure-user-bucket',
      headers: { 'x-internal-api-key': INTERNAL_KEY },
      payload: { userId: 'user-42' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(info);
    expect(svc.ensureUserBucket).toHaveBeenCalledWith('user-42');
  });

  it('500 with scrubbed message when ensureUserBucket throws; no stack trace leakage', async () => {
    const boom = new Error('raw minio admin HTTP 500: /minio/admin/v3/add-user server error');
    boom.stack = 'Error: raw minio admin\n    at x (/app/src/services/UserStorageService.ts:42:11)';
    const svc = { ensureUserBucket: vi.fn().mockRejectedValue(boom) };
    app = await buildApp(svc as any);
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/code-mode/ensure-user-bucket',
      headers: { 'x-internal-api-key': INTERNAL_KEY },
      payload: { userId: 'user-42' },
    });
    expect(res.statusCode).toBe(500);
    const body = res.json() as { error: string };
    expect(body.error).toBeTypeOf('string');
    // Must NOT leak raw MinIO / axios / stack content
    expect(body.error.toLowerCase()).not.toContain('minio');
    expect(body.error.toLowerCase()).not.toContain('axios');
    expect(body.error).not.toContain('/minio/admin/v3');
    expect(body.error).not.toContain('UserStorageService.ts');
    expect(res.body).not.toContain('UserStorageService.ts');
  });

  it('idempotency surface — second call with same userId returns same bucketName', async () => {
    const info: UserBucketInfo = {
      bucketName: 'ws-idempotent',
      minioUser: 'u-idempotent',
      secretName: 'ws-idempotent-creds',
    };
    const svc = mkService(info);
    app = await buildApp(svc);
    const headers = { 'x-internal-api-key': INTERNAL_KEY };
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/internal/code-mode/ensure-user-bucket',
      headers, payload: { userId: 'user-42' },
    });
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/internal/code-mode/ensure-user-bucket',
      headers, payload: { userId: 'user-42' },
    });
    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);
    expect(res1.json()).toEqual(info);
    expect(res2.json()).toEqual(info);
    expect(svc.ensureUserBucket).toHaveBeenCalledTimes(2);
  });

  it('400 when body.userId is not a string', async () => {
    app = await buildApp(mkService({ bucketName: 'ws-abc', minioUser: 'u-abc', secretName: 'ws-abc-creds' }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/code-mode/ensure-user-bucket',
      headers: { 'x-internal-api-key': INTERNAL_KEY },
      payload: { userId: 12345 },
    });
    expect(res.statusCode).toBe(400);
  });
});
