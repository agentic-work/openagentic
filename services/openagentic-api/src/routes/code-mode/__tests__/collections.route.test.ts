/**
 * Collections route tests — per-user Milvus collections + indexed files.
 *
 * Route: GET /api/code-mode/collections
 *        GET /api/code-mode/collections/:collectionId/files
 *
 * Auth: authMiddleware sets request.user.id; the route returns ONLY
 * collections/files owned by the authenticated user. Cross-tenant isolation
 * is non-negotiable: the route MUST 403 when the requested collection
 * doesn't belong to the authenticated user.
 *
 * The implementation wraps CodeModeMilvusService (same `codemode_user_<userId>`
 * naming convention used elsewhere). Tests inject a fake service so the
 * routes can be exercised without a live Milvus connection.
 *
 * TDD plan (red-first):
 *   1. 401 when no user is attached to the request
 *   2. 200 + {collections: []} when authenticated user has no collection
 *   3. 200 + scoped list when user owns a collection
 *   4. Cross-tenant: user A cannot see user B's collections (returns own only)
 *   5. 200 + files for the user's own collection
 *   6. 403 when user tries to read another user's collection by id
 *   7. 404 when collection doesn't exist for the authenticated user
 *   8. 500 (scrubbed) when the service throws
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import {
  registerCodeModeCollectionsRoute,
  type CollectionsCodeModeService,
} from '../collections.route.js';

interface FakeUser {
  id: string;
}

function buildAuthHook(user: FakeUser | null) {
  return async (request: any, reply: any) => {
    if (!user) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    (request as any).user = user;
  };
}

async function buildApp(
  user: FakeUser | null,
  service: CollectionsCodeModeService,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.addHook('preHandler', buildAuthHook(user));
  registerCodeModeCollectionsRoute(app, { service });
  await app.ready();
  return app;
}

function makeService(overrides: Partial<CollectionsCodeModeService>): CollectionsCodeModeService {
  return {
    getUserCollection: vi.fn().mockResolvedValue(null),
    listUserFiles: vi.fn().mockResolvedValue([]),
    getCollectionName: (userId: string) => `codemode_user_${userId}`,
    ...overrides,
  } as CollectionsCodeModeService;
}

describe('GET /api/code-mode/collections', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('401 when no user is attached to the request', async () => {
    const service = makeService({});
    app = await buildApp(null, service);
    const res = await app.inject({
      method: 'GET',
      url: '/api/code-mode/collections',
    });
    expect(res.statusCode).toBe(401);
  });

  it('200 + {collections: []} when authenticated user has no collection', async () => {
    const service = makeService({
      getUserCollection: vi.fn().mockResolvedValue(null),
    });
    app = await buildApp({ id: 'user-a' }, service);
    const res = await app.inject({
      method: 'GET',
      url: '/api/code-mode/collections',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ collections: [] });
    expect((service.getUserCollection as any)).toHaveBeenCalledWith('user-a');
  });

  it('200 + scoped list when user owns a collection', async () => {
    const service = makeService({
      getUserCollection: vi.fn().mockResolvedValue({
        name: 'codemode_user_user-a',
        userId: 'user-a',
        vectorCount: 12,
        fileCount: 3,
        status: 'active',
      }),
    });
    app = await buildApp({ id: 'user-a' }, service);
    const res = await app.inject({
      method: 'GET',
      url: '/api/code-mode/collections',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.collections).toHaveLength(1);
    expect(body.collections[0].userId).toBe('user-a');
    expect(body.collections[0].fileCount).toBe(3);
  });

  it('cross-tenant: user A only sees their own collection (not user B)', async () => {
    // The service is called with user A's id ONLY. Even if Milvus had a
    // user-B collection, this route never asks for it — the route trusts
    // request.user.id as the SoT and never enumerates global collections.
    const getUserCollection = vi.fn().mockResolvedValue({
      name: 'codemode_user_user-a',
      userId: 'user-a',
      vectorCount: 1,
      fileCount: 1,
      status: 'active',
    });
    const service = makeService({ getUserCollection });
    app = await buildApp({ id: 'user-a' }, service);
    const res = await app.inject({
      method: 'GET',
      url: '/api/code-mode/collections',
    });
    expect(res.statusCode).toBe(200);
    expect(getUserCollection).toHaveBeenCalledTimes(1);
    expect(getUserCollection).toHaveBeenCalledWith('user-a');
    // CRITICAL: must never have been called with user-b
    expect(getUserCollection).not.toHaveBeenCalledWith('user-b');
  });
});

describe('GET /api/code-mode/collections/:collectionId/files', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('200 + files for the user\'s own collection', async () => {
    const service = makeService({
      getUserCollection: vi.fn().mockResolvedValue({
        name: 'codemode_user_user-a',
        userId: 'user-a',
        vectorCount: 5,
        fileCount: 2,
        status: 'active',
      }),
      listUserFiles: vi.fn().mockResolvedValue([
        { name: 'main.py', path: '/workspaces/user-a/main.py', size: 100, mtimeMs: 1700000000000, mime: 'text/x-python' },
        { name: 'readme.md', path: '/workspaces/user-a/readme.md', size: 50, mtimeMs: 1700000000000, mime: 'text/markdown' },
      ]),
    });
    app = await buildApp({ id: 'user-a' }, service);
    const res = await app.inject({
      method: 'GET',
      url: '/api/code-mode/collections/codemode_user_user-a/files',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.files).toHaveLength(2);
    expect(body.files[0].name).toBe('main.py');
    expect((service.listUserFiles as any)).toHaveBeenCalledWith('user-a');
  });

  it('403 when user tries to read another user\'s collection by id', async () => {
    // user-a is authenticated but requests user-b's collection. Route MUST
    // refuse — the authoritative collection name is computed FROM the user
    // id, not from the URL parameter.
    const service = makeService({
      listUserFiles: vi.fn().mockResolvedValue([
        { name: 'secret.txt', path: '/workspaces/user-b/secret.txt', size: 10, mtimeMs: 0, mime: 'text/plain' },
      ]),
    });
    app = await buildApp({ id: 'user-a' }, service);
    const res = await app.inject({
      method: 'GET',
      url: '/api/code-mode/collections/codemode_user_user-b/files',
    });
    expect(res.statusCode).toBe(403);
    // Must NEVER have called the service with user-b
    expect((service.listUserFiles as any)).not.toHaveBeenCalledWith('user-b');
    // Must not leak any data from user-b
    expect(res.body).not.toContain('secret.txt');
  });

  it('404 when collection doesn\'t exist for the authenticated user', async () => {
    const service = makeService({
      getUserCollection: vi.fn().mockResolvedValue(null),
    });
    app = await buildApp({ id: 'user-a' }, service);
    const res = await app.inject({
      method: 'GET',
      url: '/api/code-mode/collections/codemode_user_user-a/files',
    });
    expect(res.statusCode).toBe(404);
  });

  it('500 with scrubbed message when service throws', async () => {
    const boom = new Error('milvus internal: collection_not_loaded /var/lib/milvus/...');
    boom.stack = 'Error: milvus internal\n    at z (/app/src/services/CodeModeMilvusService.ts:99:11)';
    const service = makeService({
      getUserCollection: vi.fn().mockRejectedValue(boom),
    });
    app = await buildApp({ id: 'user-a' }, service);
    const res = await app.inject({
      method: 'GET',
      url: '/api/code-mode/collections',
    });
    expect(res.statusCode).toBe(500);
    const body = res.json() as { error: string };
    expect(body.error).toBeTypeOf('string');
    // Must not leak Milvus internals or stack traces
    expect(body.error.toLowerCase()).not.toContain('milvus');
    expect(res.body).not.toContain('CodeModeMilvusService.ts');
  });
});
