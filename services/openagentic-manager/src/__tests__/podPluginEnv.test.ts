/**
 * Phase 6 (codemode-bridge): runner-pod plugin env-var contract.
 *
 * The openagentic CLI's `/plugin marketplace add` + `/plugin install`
 * write to `~/.openagentic/plugins/` by default. Without HOME pinned,
 * `~` resolves to the container's `/home/openagentic/` (ephemeral fs)
 * and every install evaporates on pod restart. The CLI also reads two
 * explicit overrides — `OPENAGENTIC_PLUGIN_CACHE_DIR` (install root)
 * and `OPENAGENTIC_PLUGIN_SEED_DIR` (read-only seed dirs for declared
 * marketplaces / installPluginsForHeadless). Both must point inside
 * the per-user PVC mount at `/workspaces/<userId>/...` so installs
 * persist across pod recycle / node reschedule.
 *
 * This test guards the contract on the rendered runner-pod env list:
 * given any userId, buildPodEnv MUST emit:
 *   HOME = /workspaces/<userId>
 *   OPENAGENTIC_PLUGIN_CACHE_DIR = /workspaces/<userId>/.openagentic/plugins
 *   OPENAGENTIC_PLUGIN_SEED_DIR  = /workspaces/<userId>/.openagentic/plugin-seed
 * and the userId interpolation must not leak between users — passing
 * a different userId must yield different paths, never a stale cached
 * value from an earlier call.
 *
 * openagentic CLI references:
 *   src/utils/plugins/pluginDirectories.ts:53-63 (CACHE_DIR override)
 *   src/utils/plugins/pluginDirectories.ts:85-90 (SEED_DIR layered list)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module-level mocks — same shape as k8sSessionManager.reconcile.test.ts.
// We don't need a live k8s API or store to exercise buildPodEnv.
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
    openagenticApiEndpoint: 'http://test',
    internalApiKey: 'test-key',
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

function makeSession(userId: string): any {
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

/** Find the rendered env value for a given var name on the pod-spec env list. */
function envValueOf(env: Array<{ name: string; value?: string }>, name: string): string | undefined {
  return env.find((e) => e.name === name)?.value;
}

// ---------------------------------------------------------------------------
// Tests — Phase 6 plugin-persistence env contract
// ---------------------------------------------------------------------------

describe('buildPodEnv — plugin persistence env vars (Phase 6)', () => {
  let manager: K8sSessionManager;

  beforeEach(() => {
    storeData.clear();
    userMap.clear();
    vi.clearAllMocks();
    manager = new K8sSessionManager();
  });

  // -------------------------------------------------------------------------
  // 1. HOME pin: ~ must resolve to the per-user PVC mount, not container fs
  // -------------------------------------------------------------------------
  it('pins HOME to /workspaces/<userId> so ~ resolves into the per-user PVC', () => {
    const session = makeSession('user-abc');
    const env = (manager as any).buildPodEnv(session, {});
    expect(envValueOf(env, 'HOME')).toBe('/workspaces/user-abc');
  });

  // -------------------------------------------------------------------------
  // 2. OPENAGENTIC_PLUGIN_CACHE_DIR — explicit install root, PVC-backed
  // -------------------------------------------------------------------------
  it('sets OPENAGENTIC_PLUGIN_CACHE_DIR to /workspaces/<userId>/.openagentic/plugins', () => {
    const session = makeSession('user-abc');
    const env = (manager as any).buildPodEnv(session, {});
    expect(envValueOf(env, 'OPENAGENTIC_PLUGIN_CACHE_DIR')).toBe(
      '/workspaces/user-abc/.openagentic/plugins',
    );
  });

  // -------------------------------------------------------------------------
  // 3. OPENAGENTIC_PLUGIN_SEED_DIR — declared-marketplace seed dir, PVC-backed
  // -------------------------------------------------------------------------
  it('sets OPENAGENTIC_PLUGIN_SEED_DIR to /workspaces/<userId>/.openagentic/plugin-seed', () => {
    const session = makeSession('user-abc');
    const env = (manager as any).buildPodEnv(session, {});
    expect(envValueOf(env, 'OPENAGENTIC_PLUGIN_SEED_DIR')).toBe(
      '/workspaces/user-abc/.openagentic/plugin-seed',
    );
  });

  // -------------------------------------------------------------------------
  // 4. No userId leakage across calls — paths interpolate per-call
  // -------------------------------------------------------------------------
  it('interpolates userId per-call — no leakage from a previous user', () => {
    const sessionAlice = makeSession('user-alice');
    const sessionBob = makeSession('user-bob');

    const envAlice = (manager as any).buildPodEnv(sessionAlice, {});
    const envBob = (manager as any).buildPodEnv(sessionBob, {});

    // Alice's env points only at Alice's PVC.
    expect(envValueOf(envAlice, 'HOME')).toBe('/workspaces/user-alice');
    expect(envValueOf(envAlice, 'OPENAGENTIC_PLUGIN_CACHE_DIR')).toBe(
      '/workspaces/user-alice/.openagentic/plugins',
    );
    expect(envValueOf(envAlice, 'OPENAGENTIC_PLUGIN_SEED_DIR')).toBe(
      '/workspaces/user-alice/.openagentic/plugin-seed',
    );

    // Bob's env points only at Bob's PVC — no Alice-isms anywhere.
    expect(envValueOf(envBob, 'HOME')).toBe('/workspaces/user-bob');
    expect(envValueOf(envBob, 'OPENAGENTIC_PLUGIN_CACHE_DIR')).toBe(
      '/workspaces/user-bob/.openagentic/plugins',
    );
    expect(envValueOf(envBob, 'OPENAGENTIC_PLUGIN_SEED_DIR')).toBe(
      '/workspaces/user-bob/.openagentic/plugin-seed',
    );
    for (const v of envBob) {
      if (typeof v.value === 'string') {
        expect(v.value).not.toContain('user-alice');
      }
    }
  });

  // -------------------------------------------------------------------------
  // 5. Plugin paths sit under /workspaces/ — never under the container fs
  // -------------------------------------------------------------------------
  it('NEVER points plugin paths at the ephemeral container filesystem', () => {
    const session = makeSession('user-xyz');
    const env = (manager as any).buildPodEnv(session, {});

    const cacheDir = envValueOf(env, 'OPENAGENTIC_PLUGIN_CACHE_DIR') ?? '';
    const seedDir = envValueOf(env, 'OPENAGENTIC_PLUGIN_SEED_DIR') ?? '';
    const home = envValueOf(env, 'HOME') ?? '';

    // All three must live under the PVC mount root.
    expect(cacheDir.startsWith('/workspaces/')).toBe(true);
    expect(seedDir.startsWith('/workspaces/')).toBe(true);
    expect(home.startsWith('/workspaces/')).toBe(true);

    // None of them may resolve under the container's home dir or /root —
    // those are on the ephemeral fs and would lose plugins on pod recycle.
    for (const path of [cacheDir, seedDir, home]) {
      expect(path).not.toMatch(/^\/home\/openagentic/);
      expect(path).not.toMatch(/^\/root/);
      expect(path).not.toMatch(/^\/tmp/);
    }
  });
});
