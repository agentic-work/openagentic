/**
 * Task #360 — Codemode "Maximum sessions (3) reached for user" wedge.
 *
 * Root cause observed 2026-04-24 in live cluster (phatoldsun user):
 *
 *   1. UI opens codemode → cm creates K8s session A (pod X).
 *   2. User navigates away / WS disconnects → cm.stopSession(A) runs, but
 *      the K8s branch intentionally skips cleanup() (pod is permanent).
 *      userToSessions[phatoldsun] still contains {A}.
 *   3. UI reopens → registerK8sSession creates session B for SAME pod X.
 *      userToSessions[phatoldsun] = {A, B}.
 *   4. Repeat 2-3 three more times → {A, B, C, D, E}.
 *   5. Next /sessions POST throws "Maximum sessions (3) reached for user"
 *      because the quota counts DEAD sessionIds still lingering in the
 *      in-memory map.
 *
 * Symptoms in logs:
 *   - "Reusing session record" every reconnect
 *   - "Failed to reconnect terminal"
 *   - "Session initialization incomplete"
 *   - "Maximum sessions (3) reached for user" on 2nd+ new prompt
 *
 * Fix required:
 *   - registerK8sSession MUST prune prior in-memory sessionIds for the
 *     same userId that point to the same pod (or are no longer live).
 *   - stopSession in K8s branch MUST decrement userToSessions (the pod
 *     stays; the sessionId does not).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionManager } from '../sessionManager';
import type { Config } from '../config';
import type { K8sSession } from '../k8sSessionManager';

// Minimal stub for workspaceStorageService — not exercised in these tests
vi.mock('../workspaceStorageService', () => ({
  getWorkspaceStorageService: () => ({
    initialize: async () => {},
    stopWorkspace: async () => {},
  }),
}));

// Don't talk to a real k8s API in unit tests
vi.mock('../k8sSessionManager', async () => {
  return {
    getK8sSessionManager: () => ({
      on: () => {},
      syncWithCluster: async () => {},
      listSessions: async () => [],
      stopSession: async () => {},
    }),
  };
});

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 3050,
    openagenticPath: '/usr/local/bin/openagentic',
    maxSessionsPerUser: 3,
    maxGlobalSessions: 100,
    sessionIdleTimeout: 1800,
    sessionMaxLifetime: 14400,
    maxWorkspaceSizeMb: 5120,
    workspacesPath: '/tmp/ws',
    openagenticApiEndpoint: 'http://openagentic-api:8000',
    defaultModel: '',
    defaultUi: 'ink',
    defaultCliBackend: 'http',
    internalApiKey: '',
    storage: {
      provider: 'minio',
      bucket: 'openagentic-workspaces',
      endpoint: 'http://minio:9000',
    },
    redis: { keyPrefix: 'openagentic:session:', sessionTTL: 86400 },
    executionMode: 'kubernetes',
    execContainer: { url: 'http://exec:3060' },
    k8s: { namespace: 'agentic-dev', runnerImage: 'foo:latest' },
    ...overrides,
  };
}

function makeK8sSession(sessionId: string, userId: string, podName: string): K8sSession {
  return {
    sessionId,
    userId,
    podName,
    serviceName: `${podName}-svc`,
    status: 'running',
    servicePort: 3070,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    workspacePath: `/workspaces/${userId}`,
    healthChecksPassed: 1,
    consecutiveHealthFailures: 0,
  } as K8sSession;
}

describe('SessionManager — per-user session leak (task #360)', () => {
  let mgr: SessionManager;
  const USER = 'azure_8f6f8f04-phatoldsun';
  const POD = 'openagentic-2cb1bf3f719f';

  beforeEach(() => {
    mgr = new SessionManager(makeConfig());
  });

  it('registering a fresh K8s session for the SAME user + SAME pod evicts the prior sessionId', () => {
    // Simulate the real failure mode: UI reconnects five times in a row,
    // each time cm.getOrCreateSession mints a NEW sessionId for the same
    // permanent pod, and registerK8sSession is invoked.
    const s1 = makeK8sSession('sid-1', USER, POD);
    const s2 = makeK8sSession('sid-2', USER, POD);
    const s3 = makeK8sSession('sid-3', USER, POD);
    const s4 = makeK8sSession('sid-4', USER, POD);
    const s5 = makeK8sSession('sid-5', USER, POD);

    mgr.registerK8sSession(s1);
    mgr.registerK8sSession(s2);
    mgr.registerK8sSession(s3);
    mgr.registerK8sSession(s4);
    mgr.registerK8sSession(s5);

    const live = mgr.getSessionsByUser(USER);
    // After the fix: only the most recently-registered sessionId for a
    // given pod is retained. Prior sessionIds that pointed to the same
    // pod are evicted so the quota check in createSession() does not
    // see them.
    expect(live.map(s => s.id)).toEqual(['sid-5']);
  });

  it('stopSession in K8s mode decrements userToSessions (so /sessions POST can retry)', async () => {
    const s1 = makeK8sSession('sid-a', USER, POD);
    mgr.registerK8sSession(s1);
    expect(mgr.getSessionsByUser(USER).map(s => s.id)).toEqual(['sid-a']);

    // Simulate the UI disconnect path that calls stopSession()
    await mgr.stopSession('sid-a');

    // After the fix: the K8s stopSession MUST remove the sessionId from
    // userToSessions so the quota check in createSession doesn't count
    // it against the user. The pod itself is still permanent — that is
    // unrelated to the in-memory accounting here.
    expect(mgr.getSessionsByUser(USER)).toEqual([]);
  });

  it('different users do NOT prune each other on registerK8sSession', () => {
    const u1 = 'user-1';
    const u2 = 'user-2';
    const pod1 = 'openagentic-pod-one';
    const pod2 = 'openagentic-pod-two';

    mgr.registerK8sSession(makeK8sSession('sid-u1', u1, pod1));
    mgr.registerK8sSession(makeK8sSession('sid-u2', u2, pod2));

    // Both users keep their own sessions — pruning is scoped to the
    // user + pod tuple, never cross-user.
    expect(mgr.getSessionsByUser(u1).map(s => s.id)).toEqual(['sid-u1']);
    expect(mgr.getSessionsByUser(u2).map(s => s.id)).toEqual(['sid-u2']);
  });
});
