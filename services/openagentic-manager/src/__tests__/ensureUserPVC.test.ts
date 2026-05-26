/**
 * Task B1 / #324 complete — per-user RETAINED workspace PVC.
 *
 * Regression context: at commit cb16cf28 (2026-04-22) the code-manager
 * swapped s3fs/MinIO for k8s `ephemeral.volumeClaimTemplate` PVCs. That
 * pattern ties PVC lifecycle to pod lifecycle — pod dies, PVC gets
 * garbage-collected, all user files vanish. Codemode "worked for a
 * while" within a single pod's lifetime then users lost everything on
 * every pod restart / eviction / chart roll.
 *
 * Fix (this file's subject): K8sSessionManager.ensureUserPVC(userId)
 * provisions a PVC named `ws-<sha256(userId).slice(0,12)>` with
 * ReclaimPolicy=Retain (via storageClassName=nfs), ReadWriteOnce,
 * 10Gi default. Pod spec switches to
 * volumes[].persistentVolumeClaim.claimName — pod delete leaves PVC
 * intact.
 *
 * Test plan (TDD — written red-first):
 *   1. RED→GREEN: no existing PVC → create call fires, wasCreated=true,
 *      name is `ws-` + 12 hex chars (15 total), spec carries ReadWriteOnce
 *      + storageClass=nfs + size=10Gi.
 *   2. RED→GREEN: existing PVC → same name back, wasCreated=false,
 *      create call NOT invoked.
 *   3. RED→GREEN: deterministic — same userId twice → identical names;
 *      different userIds → different names.
 *   4. RED→GREEN: 403 on read → throws (NOT silently falls through to
 *      a pod with no backing PVC).
 *   5. RED→GREEN: empty userId → throws synchronously, k8s API untouched.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';

// ---------------------------------------------------------------------------
// Module-level mocks (hoisted before any import of the module under test)
// ---------------------------------------------------------------------------

vi.mock('@kubernetes/client-node', () => {
  const readNamespacedPersistentVolumeClaim = vi.fn();
  const createNamespacedPersistentVolumeClaim = vi.fn();
  const readNamespacedPod = vi.fn();
  const makeApiClient = vi.fn().mockReturnValue({
    readNamespacedPersistentVolumeClaim,
    createNamespacedPersistentVolumeClaim,
    readNamespacedPod,
  });
  const KubeConfig = vi.fn().mockImplementation(() => ({
    loadFromCluster: vi.fn(),
    makeApiClient,
  }));
  return { KubeConfig, CoreV1Api: vi.fn() };
});

vi.mock('../config', () => ({
  config: {
    k8s: {
      namespace: 'agentic-dev',
      runnerImage: 'test-image',
      warmPool: { enabled: false },
      workspaceStorageClass: 'nfs',
      workspaceStorageSizeGi: 10,
      workspaceStorageSize: '5120Mi',
    },
    redis: { url: null, keyPrefix: 'test:', sessionTTL: 3600 },
    maxGlobalSessions: 100,
    maxSessionsPerUser: 5,
    maxWorkspaceSizeMb: 10240,
    executionMode: 'kubernetes',
    openagenticApiEndpoint: 'http://test',
    internalApiKey: 'test-key',
  },
  K8sConfig: {},
}));

vi.mock('../logger.js', () => ({
  loggers: {
    k8s: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    sessions: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    api: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    events: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    websocket: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  },
}));

vi.mock('../sessionStore', () => ({
  createSessionStore: vi.fn(() => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    getAll: vi.fn(async () => []),
    getUserSession: vi.fn(async () => null),
    setUserSession: vi.fn(async () => {}),
    deleteUserSession: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  })),
  InMemorySessionStore: vi.fn(),
  RedisSessionStore: vi.fn(),
}));

import { K8sSessionManager } from '../k8sSessionManager';
import * as k8s from '@kubernetes/client-node';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCoreApiMocks() {
  const kc = new (k8s as any).KubeConfig();
  return kc.makeApiClient() as {
    readNamespacedPersistentVolumeClaim: ReturnType<typeof vi.fn>;
    createNamespacedPersistentVolumeClaim: ReturnType<typeof vi.fn>;
  };
}

function expectedPvcName(userId: string): string {
  return `ws-${createHash('sha256').update(userId).digest('hex').substring(0, 12)}`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('K8sSessionManager.ensureUserPVC', () => {
  let manager: K8sSessionManager;
  let api: ReturnType<typeof getCoreApiMocks>;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new K8sSessionManager();
    api = getCoreApiMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Create path — no existing PVC
  // -------------------------------------------------------------------------
  it('creates a new PVC when none exists and returns wasCreated=true with correct spec', async () => {
    const userId = 'user-trent-001';
    const expectedName = expectedPvcName(userId);

    // 404 on read → triggers create.
    const notFound = Object.assign(new Error('Not Found'), { code: 404 });
    api.readNamespacedPersistentVolumeClaim.mockRejectedValueOnce(notFound);
    api.createNamespacedPersistentVolumeClaim.mockResolvedValueOnce(undefined);

    const result = await manager.ensureUserPVC(userId);

    expect(result.wasCreated).toBe(true);
    expect(result.pvcName).toBe(expectedName);
    expect(result.pvcName).toMatch(/^ws-[0-9a-f]{12}$/);
    expect(result.pvcName.length).toBe(15); // 'ws-' (3) + 12 hex chars

    // Create was called exactly once with correct spec.
    expect(api.createNamespacedPersistentVolumeClaim).toHaveBeenCalledTimes(1);
    const createCall = api.createNamespacedPersistentVolumeClaim.mock.calls[0][0];
    expect(createCall.namespace).toBe('agentic-dev');
    const body = createCall.body;
    expect(body.metadata.name).toBe(expectedName);
    expect(body.metadata.namespace).toBe('agentic-dev');
    expect(body.spec.accessModes).toEqual(['ReadWriteOnce']);
    expect(body.spec.storageClassName).toBe('nfs');
    expect(body.spec.resources.requests.storage).toBe('10Gi');
    // Labels + annotations per spec.
    expect(body.metadata.labels['app.kubernetes.io/component']).toBe('user-workspace');
    expect(body.metadata.labels['app.kubernetes.io/managed-by']).toBe('openagentic-manager');
    expect(body.metadata.labels['openagentic.io/user-id']).toBe(userId);
    expect(body.metadata.annotations['openagentic.io/user-id-full']).toBe(userId);
    expect(body.metadata.annotations['openagentic.io/created-at']).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    );
  });

  // -------------------------------------------------------------------------
  // 2. Idempotent path — PVC already exists
  // -------------------------------------------------------------------------
  it('returns existing PVC name with wasCreated=false and does NOT call create', async () => {
    const userId = 'user-existing';
    const expectedName = expectedPvcName(userId);

    // Read returns an existing PVC (any truthy object).
    api.readNamespacedPersistentVolumeClaim.mockResolvedValueOnce({
      metadata: { name: expectedName },
    });

    const result = await manager.ensureUserPVC(userId);

    expect(result.wasCreated).toBe(false);
    expect(result.pvcName).toBe(expectedName);
    expect(api.createNamespacedPersistentVolumeClaim).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 3. Determinism — same userId → same name; different → different
  // -------------------------------------------------------------------------
  it('produces deterministic names: same userId yields same PVC, different userIds differ', async () => {
    const userA = 'alice@example.com';
    const userB = 'bob@example.com';

    // All four reads return 404 (each call to ensureUserPVC will trigger
    // a create). Use mockImplementation to avoid ordering issues.
    const notFound = Object.assign(new Error('Not Found'), { code: 404 });
    api.readNamespacedPersistentVolumeClaim.mockRejectedValue(notFound);
    api.createNamespacedPersistentVolumeClaim.mockResolvedValue(undefined);

    const a1 = await manager.ensureUserPVC(userA);
    const a2 = await manager.ensureUserPVC(userA);
    const b1 = await manager.ensureUserPVC(userB);

    expect(a1.pvcName).toBe(a2.pvcName); // same user → same name
    expect(a1.pvcName).not.toBe(b1.pvcName); // different users → different names
    // Sanity: the name really is derived from the userId hash.
    expect(a1.pvcName).toBe(expectedPvcName(userA));
    expect(b1.pvcName).toBe(expectedPvcName(userB));
  });

  // -------------------------------------------------------------------------
  // 4. Fail loud — 403 from k8s API must throw
  // -------------------------------------------------------------------------
  it('throws on non-404 read errors (403 forbidden) instead of silently falling through', async () => {
    const userId = 'user-forbidden';

    const forbidden = Object.assign(new Error('Forbidden'), { code: 403 });
    api.readNamespacedPersistentVolumeClaim.mockRejectedValueOnce(forbidden);

    await expect(manager.ensureUserPVC(userId)).rejects.toThrow(/forbidden/i);
    // Must NOT attempt to create when we can't even determine existence.
    expect(api.createNamespacedPersistentVolumeClaim).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 5. Empty userId guard — throws synchronously, no k8s API call
  // -------------------------------------------------------------------------
  it('throws immediately on empty/whitespace userId without touching the k8s API', async () => {
    await expect(manager.ensureUserPVC('')).rejects.toThrow(/userId/i);
    await expect(manager.ensureUserPVC('   ')).rejects.toThrow(/userId/i);

    expect(api.readNamespacedPersistentVolumeClaim).not.toHaveBeenCalled();
    expect(api.createNamespacedPersistentVolumeClaim).not.toHaveBeenCalled();
  });
});
