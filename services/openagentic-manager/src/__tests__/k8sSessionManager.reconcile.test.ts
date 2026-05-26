/**
 * Task #335 — Pod-reconcile guard for stale in-memory sessions.
 *
 * Root cause: K8sSessionManager.getSession() reads from the session store
 * only, never touching the k8s API. POST /sessions used getSession() to
 * retrieve podName/serviceName for the "existing" response. When the pod
 * was externally deleted the store entry survived, reported status:'running',
 * but carried no real backing pod — relay-ws threw
 * "pod provision response missing podName/podHost" and the chat died silently.
 *
 * Fix: verifySessionPod() cross-checks the store entry against the live k8s
 * API, evicts stale entries (404 or terminal phase), and returns null so
 * the POST /sessions handler falls through to a fresh createSession().
 *
 * Test plan (TDD — written red-first):
 *   1. RED→GREEN: readNamespacedPod returns 404 → verifySessionPod evicts
 *      map entry and returns null.
 *   2. GREEN: readNamespacedPod returns Running pod → session returned
 *      unchanged (no unnecessary re-provision).
 *   3. GREEN: readNamespacedPod returns Succeeded phase → eviction + null.
 *   4. GREEN: readNamespacedPod throws a non-404 error → optimistic return
 *      (session returned as-is so one bad k8s API blip doesn't break chat).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module-level mocks (hoisted before any import of the module under test)
// ---------------------------------------------------------------------------

// Mock @kubernetes/client-node so no cluster connection is attempted.
vi.mock('@kubernetes/client-node', () => {
  const readNamespacedPod = vi.fn();
  const makeApiClient = vi.fn().mockReturnValue({ readNamespacedPod });
  const KubeConfig = vi.fn().mockImplementation(() => ({
    loadFromCluster: vi.fn(),
    makeApiClient,
  }));
  return { KubeConfig, CoreV1Api: vi.fn() };
});

// Mock config to avoid real env requirements.
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
    openagenticApiEndpoint: 'http://test',
    internalApiKey: 'test-key',
  },
  K8sConfig: {},
}));

// Mock logger to suppress noisy output during tests.
vi.mock('../logger.js', () => ({
  loggers: {
    k8s: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    sessions: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    api: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    events: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    websocket: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  },
}));

// Mock session store with a simple in-memory implementation so we can
// inspect evictions without touching Redis.
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

// Now import the module under test (after all vi.mock calls).
import { K8sSessionManager } from '../k8sSessionManager';
import * as k8s from '@kubernetes/client-node';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<any> = {}): any {
  return {
    sessionId: 'sess-abc123',
    userId: 'user-1',
    podName: 'openagentic-deadbeef0000',
    serviceName: 'openagentic-deadbeef0000-svc',
    status: 'running',
    servicePort: 3070,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    workspacePath: '/workspaces/user-1',
    healthChecksPassed: 1,
    consecutiveHealthFailures: 0,
    ...overrides,
  };
}

function getReadNamespacedPod(): ReturnType<typeof vi.fn> {
  // Reach through the mocked KubeConfig → makeApiClient → readNamespacedPod
  const kc = new (k8s as any).KubeConfig();
  return kc.makeApiClient().readNamespacedPod as ReturnType<typeof vi.fn>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('K8sSessionManager.verifySessionPod', () => {
  let manager: K8sSessionManager;
  let readNamespacedPod: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    storeData.clear();
    userMap.clear();
    vi.clearAllMocks();

    // Construct manager — constructor calls loadFromCluster + makeApiClient.
    manager = new K8sSessionManager();

    // Grab the mock so tests can configure it per-case.
    readNamespacedPod = getReadNamespacedPod();
  });

  // -------------------------------------------------------------------------
  // 1. 404 → eviction + null
  // -------------------------------------------------------------------------
  it('evicts stale map entry and returns null when pod returns 404', async () => {
    const session = makeSession();
    storeData.set(session.sessionId, session);
    userMap.set(session.userId, session.sessionId);

    // Simulate k8s 404 (pod not found).
    const notFoundErr = Object.assign(new Error('Not Found'), { code: 404 });
    readNamespacedPod.mockRejectedValueOnce(notFoundErr);

    const result = await manager.verifySessionPod(session.sessionId);

    expect(result).toBeNull();
    // Session store entry must be evicted.
    expect(storeData.has(session.sessionId)).toBe(false);
    // User → session mapping must be cleared.
    expect(userMap.has(session.userId)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 2. Running → session returned as-is
  // -------------------------------------------------------------------------
  it('returns the session unchanged when pod is Running', async () => {
    const session = makeSession();
    storeData.set(session.sessionId, session);

    readNamespacedPod.mockResolvedValueOnce({
      status: { phase: 'Running' },
    });

    const result = await manager.verifySessionPod(session.sessionId);

    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe(session.sessionId);
    expect(result!.podName).toBe(session.podName);
    expect(result!.serviceName).toBe(session.serviceName);
    // Nothing was evicted.
    expect(storeData.has(session.sessionId)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 3. Succeeded phase → eviction + null
  // -------------------------------------------------------------------------
  it('evicts stale map entry and returns null when pod phase is Succeeded', async () => {
    const session = makeSession();
    storeData.set(session.sessionId, session);
    userMap.set(session.userId, session.sessionId);

    readNamespacedPod.mockResolvedValueOnce({
      status: { phase: 'Succeeded' },
    });

    const result = await manager.verifySessionPod(session.sessionId);

    expect(result).toBeNull();
    expect(storeData.has(session.sessionId)).toBe(false);
    expect(userMap.has(session.userId)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 4. Transient k8s error → optimistic return (fail open)
  // -------------------------------------------------------------------------
  it('returns the session optimistically when k8s API throws a non-404 error', async () => {
    const session = makeSession();
    storeData.set(session.sessionId, session);

    const transientErr = new Error('connection refused');
    readNamespacedPod.mockRejectedValueOnce(transientErr);

    const result = await manager.verifySessionPod(session.sessionId);

    // We fail open — don't evict on transient errors.
    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe(session.sessionId);
    expect(storeData.has(session.sessionId)).toBe(true);
  });
});
