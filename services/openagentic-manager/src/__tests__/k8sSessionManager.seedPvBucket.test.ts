/**
 * A.11 — seedPvBucketSubdir: after PVC binds, cm reads the PV volumeName
 * (= the CSI-S3-created pvc-<uuid> bucket) and posts to the api's new
 * seed-bucket-subdir endpoint so geesefs sees the per-user prefix.
 *
 * TDD plan:
 *   1. Happy path — reads PVC, extracts volumeName, calls api with correct payload
 *   2. If api call fails, session-create still succeeds (logs but doesn't throw)
 *   3. If PVC has no volumeName yet (race), logs warning but doesn't throw
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module-level mocks — hoisted before the module import
// ---------------------------------------------------------------------------

vi.mock('@kubernetes/client-node', () => {
  const readNamespacedPersistentVolumeClaim = vi.fn();
  const makeApiClient = vi.fn().mockReturnValue({ readNamespacedPersistentVolumeClaim });
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
    },
    redis: { url: null, keyPrefix: 'test:', sessionTTL: 3600 },
    maxGlobalSessions: 100,
    maxSessionsPerUser: 5,
    executionMode: 'kubernetes',
    openagenticApiEndpoint: 'http://test-api:8000',
    internalApiKey: 'test-internal-key',
    storage: { accessKeyId: '', secretAccessKey: '' },
    defaultModel: '',
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

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
    request: vi.fn(),
  },
}));

const storeData = new Map<string, any>();
const userMap = new Map<string, string>();
vi.mock('../sessionStore', () => ({
  createSessionStore: vi.fn(() => ({
    get: vi.fn(async (id: string) => storeData.get(id) ?? null),
    set: vi.fn(async (id: string, s: any) => { storeData.set(id, s); }),
    delete: vi.fn(async (id: string) => { storeData.delete(id); }),
    getAll: vi.fn(async () => Array.from(storeData.values())),
    getUserSession: vi.fn(async (uid: string) => userMap.get(uid) ?? null),
    setUserSession: vi.fn(async (uid: string, sid: string) => { userMap.set(uid, sid); }),
    deleteUserSession: vi.fn(async (uid: string) => { userMap.delete(uid); }),
    close: vi.fn(async () => {}),
  })),
  InMemorySessionStore: vi.fn(),
  RedisSessionStore: vi.fn(),
}));

import { K8sSessionManager } from '../k8sSessionManager';
import axios from 'axios';
import * as k8sClientNode from '@kubernetes/client-node';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMockK8sApi() {
  const kubeConfigInstance = new (k8sClientNode.KubeConfig as any)();
  return kubeConfigInstance.makeApiClient();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('A.11 — seedPvBucketSubdir', () => {
  let manager: K8sSessionManager;
  let mockK8sApi: any;

  beforeEach(() => {
    storeData.clear();
    userMap.clear();
    vi.clearAllMocks();
    manager = new K8sSessionManager();
    mockK8sApi = getMockK8sApi();
  });

  it('reads the PVC, extracts volumeName, posts to api seed endpoint with correct payload', async () => {
    const pvcName = 'ws-abc123def456';
    const volumeName = 'pvc-2cf188ca-4fb1-4d2f-b7c9-e6e52344d72a';
    const userId = 'alice@example.com';

    // Mock k8s PVC read to return a bound PVC with a volumeName
    mockK8sApi.readNamespacedPersistentVolumeClaim.mockResolvedValueOnce({
      spec: { volumeName },
    });

    // Mock axios.post to succeed
    (axios.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 200,
      data: { ok: true },
    });

    await (manager as any).seedPvBucketSubdir(pvcName, userId);

    // Should have called k8s API to read the PVC
    expect(mockK8sApi.readNamespacedPersistentVolumeClaim).toHaveBeenCalledWith({
      name: pvcName,
      namespace: 'agentic-dev',
    });

    // Should have posted to the seed endpoint with correct payload
    expect(axios.post).toHaveBeenCalledWith(
      'http://test-api:8000/api/internal/code-mode/seed-bucket-subdir',
      { bucket: volumeName, userId },
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Internal-API-Key': 'test-internal-key' }),
      }),
    );
  });

  it('does not throw when api call fails — best-effort', async () => {
    const pvcName = 'ws-abc123def456';
    const volumeName = 'pvc-2cf188ca-dead-beef-cafe-e6e52344d72a';
    const userId = 'bob@example.com';

    mockK8sApi.readNamespacedPersistentVolumeClaim.mockResolvedValueOnce({
      spec: { volumeName },
    });

    (axios.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('ECONNREFUSED'));

    // Must NOT throw — it's best-effort
    await expect(
      (manager as any).seedPvBucketSubdir(pvcName, userId),
    ).resolves.not.toThrow();
  });

  it('does not throw when PVC has no volumeName yet — race condition', async () => {
    const pvcName = 'ws-abc123def456';
    const userId = 'carol@example.com';

    // PVC exists but volumeName is not yet set (still provisioning)
    mockK8sApi.readNamespacedPersistentVolumeClaim.mockResolvedValueOnce({
      spec: {},
    });

    await expect(
      (manager as any).seedPvBucketSubdir(pvcName, userId),
    ).resolves.not.toThrow();

    // Should NOT have called axios.post since there's no volumeName
    expect(axios.post).not.toHaveBeenCalled();
  });
});
