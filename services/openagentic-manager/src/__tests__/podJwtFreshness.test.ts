/**
 * podJwtFreshness — verifies the freshness gate that protects the
 * permanent-pod reuse path from handing back a pod with a stale
 * OPENAGENTIC_API_KEY env JWT.
 *
 * Repro that drove this: pod was created 2026-04-27 14:10 UTC with a
 * 24h-TTL JWT, the user came back 30h later, code-manager reused the
 * pod, the CLI inside it kept hitting /api/openagentic/v1/messages
 * with the expired token → every callback returned 401 and the user
 * sat at "Formulating…" with 0 tokens forever.
 *
 * Behavior under test (all on the K8sSessionManager class):
 *   1. shouldRefreshPodForStaleJwt(pod) → true when the pod's
 *      OPENAGENTIC_API_KEY env JWT is past exp or within the grace.
 *   2. Returns false when the JWT has plenty of time left.
 *   3. Returns true (fail-closed) when the env var is missing or
 *      malformed — better to recreate than to keep serving 401s.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@kubernetes/client-node', () => {
  const readNamespacedPod = vi.fn();
  const deleteNamespacedPod = vi.fn();
  const makeApiClient = vi.fn().mockReturnValue({
    readNamespacedPod,
    deleteNamespacedPod,
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

vi.mock('../logger.js', () => ({
  loggers: {
    k8s: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    sessions: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    api: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    events: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    websocket: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    security: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
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

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function fakeJwt(expSec: number): string {
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const body = b64url({ userId: 'u1', source: 'code-mode-internal', exp: expSec });
  return `${header}.${body}.fake-sig`;
}

function podWithJwt(jwt: string | null): any {
  const env = jwt === null ? [] : [{ name: 'OPENAGENTIC_API_KEY', value: jwt }];
  return {
    status: { phase: 'Running' },
    spec: {
      containers: [{ env }],
    },
  };
}

describe('K8sSessionManager.shouldRefreshPodForStaleJwt', () => {
  it('returns true when OPENAGENTIC_API_KEY is expired (60s in the past)', () => {
    const manager = new K8sSessionManager();
    const expired = Math.floor(Date.now() / 1000) - 60;
    const pod = podWithJwt(fakeJwt(expired));
    expect(manager.shouldRefreshPodForStaleJwt(pod)).toBe(true);
  });

  it('returns true when OPENAGENTIC_API_KEY is within 1h of expiry', () => {
    const manager = new K8sSessionManager();
    const soon = Math.floor(Date.now() / 1000) + 600; // 10 min from now
    const pod = podWithJwt(fakeJwt(soon));
    expect(manager.shouldRefreshPodForStaleJwt(pod)).toBe(true);
  });

  it('returns false when OPENAGENTIC_API_KEY has 6 days left', () => {
    const manager = new K8sSessionManager();
    const safe = Math.floor(Date.now() / 1000) + 6 * 24 * 60 * 60;
    const pod = podWithJwt(fakeJwt(safe));
    expect(manager.shouldRefreshPodForStaleJwt(pod)).toBe(false);
  });

  it('returns true when OPENAGENTIC_API_KEY env var is missing (fail closed)', () => {
    const manager = new K8sSessionManager();
    const pod = podWithJwt(null);
    expect(manager.shouldRefreshPodForStaleJwt(pod)).toBe(true);
  });

  it('returns true when OPENAGENTIC_API_KEY value is malformed (fail closed)', () => {
    const manager = new K8sSessionManager();
    const pod = podWithJwt('not-a-jwt');
    expect(manager.shouldRefreshPodForStaleJwt(pod)).toBe(true);
  });

  it('returns true when pod has no containers (fail closed)', () => {
    const manager = new K8sSessionManager();
    const pod = { status: { phase: 'Running' }, spec: { containers: [] } };
    expect(manager.shouldRefreshPodForStaleJwt(pod)).toBe(true);
  });

  it('returns true when pod has no spec at all (fail closed)', () => {
    const manager = new K8sSessionManager();
    expect(manager.shouldRefreshPodForStaleJwt({} as any)).toBe(true);
  });
});
