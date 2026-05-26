/**
 * Phase I — manager-side model binding contract.
 *
 * The openagentic-manager spawns a runner pod and emits OPENAGENTIC_BOOT_MODEL
 * on its env. That value MUST originate from the api's admin SoT
 * (`admin.system_configuration.default_models.code`, exposed via
 * `/api/internal/codemode-default-model`) and NOT from a helm-baked literal.
 *
 * This test pins:
 *   1. Happy path — when the api returns a registry-canonical id, that id
 *      lands on the pod spec's OPENAGENTIC_BOOT_MODEL env var verbatim.
 *   2. Fallback — when the api is unreachable / non-OK, we emit the empty
 *      string (helm-driven OPENAGENTIC_MODEL fallback or daemon smart
 *      routing). Pod still spawns.
 *   3. Empty registry — when the api returns no model, we treat it the
 *      same as fallback (don't crash, log warn, omit the env var).
 *   4. Caching — concurrent calls within the cache TTL share one HTTP
 *      round-trip.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module-level mocks — same shape as podPluginEnv.test.ts.
// ---------------------------------------------------------------------------

vi.mock('@kubernetes/client-node', () => {
  const readNamespacedPod = vi.fn();
  const makeApiClient = vi.fn().mockReturnValue({ readNamespacedPod });
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function envValueOf(env: Array<{ name: string; value?: string }>, name: string): string | undefined {
  return env.find((e) => e.name === name)?.value;
}

function makeSession(userId = 'user-test'): any {
  return {
    sessionId: `sess-${userId}`,
    userId,
    podName: `openagentic-${userId}`,
    serviceName: `openagentic-${userId}-svc`,
    status: 'running',
    servicePort: 3070,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    workspacePath: `/workspaces/${userId}`,
    healthChecksPassed: 1,
    consecutiveHealthFailures: 0,
  };
}

// Capture the URL/headers each fetch call sees so the test asserts on
// the exact contract the manager speaks to the api.
type FetchCall = { url: string; init: RequestInit | undefined };

function installFetchMock(
  responder: (url: string, init: RequestInit | undefined) => Response,
): { calls: FetchCall[]; restore: () => void } {
  const calls: FetchCall[] = [];
  const original = (globalThis as any).fetch;
  (globalThis as any).fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return responder(url, init);
  });
  return {
    calls,
    restore: () => {
      (globalThis as any).fetch = original;
    },
  };
}

function jsonResponse(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Phase I — fetchDefaultCodeModel binds OPENAGENTIC_BOOT_MODEL to api SoT', () => {
  let manager: K8sSessionManager;
  let fetchMock: ReturnType<typeof installFetchMock> | null = null;

  beforeEach(() => {
    storeData.clear();
    userMap.clear();
    vi.clearAllMocks();
    manager = new K8sSessionManager();
  });

  afterEach(() => {
    if (fetchMock) {
      fetchMock.restore();
      fetchMock = null;
    }
  });

  // -------------------------------------------------------------------------
  // 1. Happy path — registry-canonical id appears on pod env verbatim
  // -------------------------------------------------------------------------
  it('hits /api/internal/codemode-default-model and routes its model into OPENAGENTIC_BOOT_MODEL', async () => {
    fetchMock = installFetchMock(() =>
      jsonResponse({ model: 'anthropic.claude-sonnet-4-20250514' }),
    );

    // The new contract: a thin async helper that returns the canonical id.
    const fetched = await (manager as any).fetchDefaultCodeModel();
    expect(fetched).toBe('anthropic.claude-sonnet-4-20250514');

    // It must hit the new internal endpoint, not the admin route.
    expect(fetchMock.calls.length).toBeGreaterThanOrEqual(1);
    const call = fetchMock.calls[0];
    expect(call.url).toBe('http://test-api:8000/api/internal/codemode-default-model');
    const headers = (call.init?.headers ?? {}) as Record<string, string>;
    expect(headers['X-Internal-API-Key']).toBe('test-internal-key');

    // And the value flows to the pod spec via buildPodEnv.
    const session = makeSession('user-alice');
    const env = (manager as any).buildPodEnv(session, { bootModel: fetched });
    expect(envValueOf(env, 'OPENAGENTIC_BOOT_MODEL')).toBe('anthropic.claude-sonnet-4-20250514');
  });

  // -------------------------------------------------------------------------
  // 2. Fallback — api unreachable
  // -------------------------------------------------------------------------
  it('returns empty string (does NOT throw) when the api is unreachable', async () => {
    fetchMock = installFetchMock(() => {
      throw new Error('ECONNREFUSED');
    });
    // Reset the cache so this test sees a fresh fetch attempt
    (manager as any)._defaultCodeModelCache = null;

    const fetched = await (manager as any).fetchDefaultCodeModel();
    expect(fetched).toBe('');

    // Pod env: OPENAGENTIC_BOOT_MODEL omitted (metadataStripEnv contract).
    const session = makeSession('user-bob');
    const env = (manager as any).buildPodEnv(session, { bootModel: fetched });
    expect(env.find((e: any) => e.name === 'OPENAGENTIC_BOOT_MODEL')).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 3. Fallback — api returns non-OK
  // -------------------------------------------------------------------------
  it('returns empty string when the api responds non-2xx', async () => {
    fetchMock = installFetchMock(() => new Response('boom', { status: 500 }));
    (manager as any)._defaultCodeModelCache = null;

    const fetched = await (manager as any).fetchDefaultCodeModel();
    expect(fetched).toBe('');
  });

  // -------------------------------------------------------------------------
  // 4. Empty registry — api returns {model: ''} or null
  // -------------------------------------------------------------------------
  it('returns empty string when the api response carries no model', async () => {
    fetchMock = installFetchMock(() => jsonResponse({ model: '' }));
    (manager as any)._defaultCodeModelCache = null;

    const fetched = await (manager as any).fetchDefaultCodeModel();
    expect(fetched).toBe('');
  });

  it('returns empty string when the api response is malformed JSON', async () => {
    fetchMock = installFetchMock(() => new Response('not json', { status: 200 }));
    (manager as any)._defaultCodeModelCache = null;

    const fetched = await (manager as any).fetchDefaultCodeModel();
    expect(fetched).toBe('');
  });

  // -------------------------------------------------------------------------
  // 5. Caching — concurrent calls share one HTTP round-trip
  // -------------------------------------------------------------------------
  it('caches the resolved model so concurrent spawns share one HTTP round-trip', async () => {
    fetchMock = installFetchMock(() =>
      jsonResponse({ model: 'us.anthropic.claude-sonnet-4-6' }),
    );
    (manager as any)._defaultCodeModelCache = null;

    const [a, b, c] = await Promise.all([
      (manager as any).fetchDefaultCodeModel(),
      (manager as any).fetchDefaultCodeModel(),
      (manager as any).fetchDefaultCodeModel(),
    ]);

    expect(a).toBe('us.anthropic.claude-sonnet-4-6');
    expect(b).toBe('us.anthropic.claude-sonnet-4-6');
    expect(c).toBe('us.anthropic.claude-sonnet-4-6');
    // Inflight de-dup AND positive-result cache: at most one network call.
    expect(fetchMock.calls.length).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 6. Cache TTL — invalidates after window
  // -------------------------------------------------------------------------
  it('cache expires after TTL — the next call hits the api again', async () => {
    fetchMock = installFetchMock(() =>
      jsonResponse({ model: 'anthropic.claude-sonnet-4-20250514' }),
    );
    (manager as any)._defaultCodeModelCache = null;

    await (manager as any).fetchDefaultCodeModel();
    expect(fetchMock.calls.length).toBe(1);

    // Force-expire the cache by setting fetchedAt to 2 minutes ago.
    const cached = (manager as any)._defaultCodeModelCache;
    if (cached) {
      cached.fetchedAt = Date.now() - 120_000;
    }

    await (manager as any).fetchDefaultCodeModel();
    expect(fetchMock.calls.length).toBe(2);
  });
});
