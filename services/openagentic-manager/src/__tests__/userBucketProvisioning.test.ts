/**
 * Task 5 — CSI-S3 T5: cm provisions user bucket + renders per-session
 * PVC + workspace mount annotation. Red-first; 6 cases:
 *   1. provisionUserBucket POSTs correct body + X-Internal-API-Key header
 *   2. Same userId twice → single HTTP call (cached for session lifetime)
 *   3. Pod annotation openagentic.io/workspace-mount = minio-csi
 *   4. Pod workspace volume claimName == <bucketName>; PVC spec uses
 *      storageClassName=minio-csi, ReadWriteOnce, 10Gi
 *   5. Pod env includes USER_WORKSPACE_PATH=/workspaces/<userId>
 *   6. Reconcile — lastUserBucketHash mismatch on reuse → pod recreate
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@kubernetes/client-node', () => {
  const mk = () => vi.fn();
  const makeApiClient = vi.fn().mockReturnValue({
    readNamespacedPod: mk(),
    createNamespacedPod: mk(),
    deleteNamespacedPod: mk(),
    readNamespacedService: mk(),
    createNamespacedService: mk(),
    readNamespacedPersistentVolumeClaim: mk(),
    createNamespacedPersistentVolumeClaim: mk(),
    deleteNamespacedPersistentVolumeClaim: mk(),
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
      workspaceStorageClass: 'minio-csi',
      workspaceStorageSizeGi: 10,
      runnerServiceAccount: 'test-runner-sa',
    },
    redis: { url: null, keyPrefix: 'test:', sessionTTL: 3600 },
    maxGlobalSessions: 100,
    maxSessionsPerUser: 5,
    maxWorkspaceSizeMb: 10240,
    executionMode: 'kubernetes',
    openagenticApiEndpoint: 'http://openagentic-api:8000',
    internalApiKey: 'test-internal-key',
    defaultModel: '',
    storage: { accessKeyId: '', secretAccessKey: '' },
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

vi.mock('axios', () => {
  const post = vi.fn();
  return { default: { post }, post };
});

import { K8sSessionManager } from '../k8sSessionManager';
import * as k8s from '@kubernetes/client-node';
import axios from 'axios';
import { hashInternalKey } from '../internalKeyDrift.js';

function getK8sApi() {
  return new (k8s as any).KubeConfig().makeApiClient();
}

// Mock-happy-path baseline the create/PVC/read/run calls.
function stubPodCreateHappyPath(api: any) {
  const notFound = Object.assign(new Error('not found'), { statusCode: 404 });
  api.readNamespacedPersistentVolumeClaim.mockRejectedValue(notFound);
  api.createNamespacedPersistentVolumeClaim.mockResolvedValue({});
  api.createNamespacedPod.mockResolvedValue({});
  api.createNamespacedService.mockResolvedValue({});
  api.readNamespacedPod.mockResolvedValue({
    status: { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }], podIP: '10.0.0.5' },
  });
  api.readNamespacedService.mockResolvedValue({ spec: { clusterIP: '10.0.0.10' } });
}

describe('K8sSessionManager.provisionUserBucket + pod-spec CSI-S3 wiring', () => {
  let manager: K8sSessionManager;
  let api: ReturnType<typeof getK8sApi>;
  const axiosPost = (axios as any).post as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    storeData.clear();
    userMap.clear();
    vi.clearAllMocks();
    manager = new K8sSessionManager();
    api = getK8sApi();
    axiosPost.mockResolvedValue({
      status: 200,
      data: {
        bucketName: 'ws-abc123def4567890',
        minioUser: 'u-abc123def4567890',
        secretName: 'ws-abc123def4567890-creds',
      },
    });
  });

  it('POSTs correct body + X-Internal-API-Key header', async () => {
    const info = await manager.provisionUserBucket('user-42');

    expect(axiosPost).toHaveBeenCalledTimes(1);
    const [url, body, config] = axiosPost.mock.calls[0];
    expect(url).toMatch(/\/api\/internal\/code-mode\/ensure-user-bucket$/);
    expect(body).toEqual({ userId: 'user-42' });
    expect(config?.headers?.['X-Internal-API-Key']).toBe('test-internal-key');

    expect(info).toEqual({
      bucketName: 'ws-abc123def4567890',
      minioUser: 'u-abc123def4567890',
      secretName: 'ws-abc123def4567890-creds',
    });
  });

  it('caches the result per userId — second call skips HTTP', async () => {
    await manager.provisionUserBucket('user-42');
    await manager.provisionUserBucket('user-42');
    expect(axiosPost).toHaveBeenCalledTimes(1);
  });

  it('renders pod annotation openagentic.io/workspace-mount=minio-csi', async () => {
    stubPodCreateHappyPath(api);
    await manager.createSession({ sessionId: 'sess-1', userId: 'user-42', apiKey: 'jwt.a' });

    expect(api.createNamespacedPod).toHaveBeenCalledTimes(1);
    const podBody = api.createNamespacedPod.mock.calls[0][0].body;
    expect(podBody.metadata.annotations?.['openagentic.io/workspace-mount']).toBe('minio-csi');
  });

  it('workspace PVC claimName == bucketName; PVC spec is CSI-S3 (minio-csi, RWO, 10Gi)', async () => {
    stubPodCreateHappyPath(api);
    await manager.createSession({ sessionId: 'sess-2', userId: 'user-42', apiKey: 'jwt.a' });

    const podBody = api.createNamespacedPod.mock.calls[0][0].body;
    const wsVol = podBody.spec.volumes.find((v: any) => v.name === 'workspace');
    expect(wsVol?.persistentVolumeClaim?.claimName).toBe('ws-abc123def4567890');

    expect(api.createNamespacedPersistentVolumeClaim).toHaveBeenCalledTimes(1);
    const pvcBody = api.createNamespacedPersistentVolumeClaim.mock.calls[0][0].body;
    expect(pvcBody.metadata.name).toBe('ws-abc123def4567890');
    expect(pvcBody.spec.storageClassName).toBe('minio-csi');
    expect(pvcBody.spec.accessModes).toEqual(['ReadWriteOnce']);
    expect(pvcBody.spec.resources.requests.storage).toBe('10Gi');
  });

  it('pod env includes USER_WORKSPACE_PATH=/workspaces/<userId>', async () => {
    stubPodCreateHappyPath(api);
    await manager.createSession({ sessionId: 'sess-3', userId: 'user-42', apiKey: 'jwt.a' });

    const podBody = api.createNamespacedPod.mock.calls[0][0].body;
    const env: Array<{ name: string; value?: string }> = podBody.spec.containers[0].env;
    const wsPath = env.find((e) => e.name === 'USER_WORKSPACE_PATH');
    expect(wsPath?.value).toBe('/workspaces/user-42');
  });

  it('reconciles on session reuse when lastUserBucketHash differs — pod deleted', async () => {
    // Pod name MUST match getUserPodName('user-42') = openagentic-<sha256slice12>.
    const podName = 'openagentic-6d894aa3ee80';
    const oldSession = {
      sessionId: 'sess-old',
      userId: 'user-42',
      podName,
      serviceName: `${podName}-svc`,
      status: 'running',
      servicePort: 3070,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      workspacePath: '/workspaces/user-42',
      healthChecksPassed: 1,
      consecutiveHealthFailures: 0,
      lastUserBucketHash: 'ws-OLD-HASH',
      lastInternalKeyHash: hashInternalKey('test-internal-key'),
    };
    storeData.set(oldSession.sessionId, oldSession);
    userMap.set(oldSession.userId, oldSession.sessionId);

    api.readNamespacedPod
      .mockResolvedValueOnce({ status: { phase: 'Running' }, metadata: { name: podName } })
      .mockRejectedValue(Object.assign(new Error('not found'), { statusCode: 404 }));
    api.deleteNamespacedPod.mockResolvedValue({});
    axiosPost.mockResolvedValue({
      status: 200,
      data: {
        bucketName: 'ws-NEW-HASH-12345',
        minioUser: 'u-NEW-HASH-12345',
        secretName: 'ws-NEW-HASH-12345-creds',
      },
    });
    // Stop the recursive-rebuild path at the PVC/pod-create boundary —
    // we just need to observe that deleteNamespacedPod fired.
    api.createNamespacedPod.mockRejectedValue(new Error('stop-recursion'));
    api.createNamespacedPersistentVolumeClaim.mockRejectedValue(new Error('stop-recursion'));
    api.readNamespacedPersistentVolumeClaim.mockRejectedValue(
      Object.assign(new Error('not found'), { statusCode: 404 }),
    );

    await expect(
      manager.getOrCreateSession({ sessionId: 'sess-new', userId: 'user-42' }),
    ).rejects.toThrow();

    expect(api.deleteNamespacedPod).toHaveBeenCalled();
    expect(api.deleteNamespacedPod.mock.calls[0][0].name).toBe(podName);
  });
});
