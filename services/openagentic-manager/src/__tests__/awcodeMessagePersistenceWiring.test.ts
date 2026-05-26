/**
 * Bug #68 — Code Mode message-token writer is dead — awcode_messages stays empty.
 *
 * Root cause:
 *   sessionManager.ts wires `OutputMessageParser` (the only writer to
 *   awcode_messages via persistMessages → POST /api/awcode/sessions/:id/
 *   messages/batch) ONLY in the LOCAL PTY branch of createSession (line
 *   ~682). In K8s mode and exec-container mode — the modes used in
 *   production on chat-dev.openagentic.io — the messageParser is NEVER
 *   created and the K8s/exec terminal:data listener NEVER feeds output
 *   to it. Result: awcode_messages count = 0 forever, while
 *   awcode_sessions accumulates rows on every reconnect.
 *
 * Reproduction (before fix):
 *   - PG: SELECT count(*) FROM awcode_sessions; → 103
 *   - PG: SELECT count(*) FROM awcode_messages; → 0
 *
 * Fix:
 *   Wire the messageParser into the K8s and exec-container branches of
 *   sessionManager so terminal data drives persistMessages, just as the
 *   LOCAL PTY branch already does. This test pins the wiring at the
 *   sessionManager seam (the registerK8sSession terminal:data listener)
 *   without requiring a real Postgres / API round-trip.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { SessionManager } from '../sessionManager';
import type { Config } from '../config';
import type { K8sSession } from '../k8sSessionManager';

// In-memory log captures every messageParser.addOutput / cleanup call
// so the test can assert the K8s/exec terminal:data listener actually
// fed the parser. The HTTP path itself is exercised by persistenceClient
// tests; here we only need to pin the wiring seam in sessionManager.
const parserEvents: Array<{ sessionId: string; kind: 'addOutput' | 'cleanup'; data?: string }> = [];

vi.mock('../persistenceClient', async (importOriginal) => {
  const orig: any = await importOriginal();

  // Replace the OutputMessageParser class with an instrumented stub.
  // The real parser's behaviour (parsing stream-json, flushing on
  // timer, calling persistMessages) is unit-tested elsewhere; what
  // matters for bug #68 is whether sessionManager wires terminal data
  // INTO a parser at all. If the K8s/exec branches never call
  // parser.addOutput, no parser will ever flush — that is the
  // regression this test pins.
  class InstrumentedParser {
    constructor(public sessionId: string) {}
    addOutput(data: string) {
      parserEvents.push({ sessionId: this.sessionId, kind: 'addOutput', data });
    }
    async cleanup() {
      parserEvents.push({ sessionId: this.sessionId, kind: 'cleanup' });
    }
    async flush() {
      // Not exercised in this test — kept for type-compat.
    }
  }

  return {
    ...orig,
    persistMessage: vi.fn(async () => {}),
    persistMessages: vi.fn(async () => {}),
    OutputMessageParser: InstrumentedParser,
  };
});

vi.mock('../workspaceStorageService', () => ({
  getWorkspaceStorageService: () => ({
    initialize: async () => {},
    stopWorkspace: async () => {},
  }),
}));

// Shared k8sManager event bus so the test can emit terminal:data and
// have sessionManager's listener (registered inside registerK8sSession)
// receive it.
const fakeK8sBus = new EventEmitter();

vi.mock('../k8sSessionManager', () => ({
  getK8sSessionManager: () => ({
    on: (event: string, handler: (...args: any[]) => void) =>
      fakeK8sBus.on(event, handler),
    off: (event: string, handler: (...args: any[]) => void) =>
      fakeK8sBus.off(event, handler),
    emit: (event: string, ...args: any[]) => fakeK8sBus.emit(event, ...args),
    syncWithCluster: async () => {},
    listSessions: async () => [],
    stopSession: async () => {},
  }),
}));

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
  } as Config;
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

describe('SessionManager — awcode_messages writer wiring (bug #68)', () => {
  const USER = 'azure_phatoldsun';
  const POD = 'openagentic-test-pod';
  const SESSION_ID = 'sid-msg-1';

  beforeEach(() => {
    parserEvents.length = 0;
    fakeK8sBus.removeAllListeners();
    vi.clearAllMocks();
  });

  it('K8s registerK8sSession terminal:data feeds the message parser', async () => {
    const mgr = new SessionManager(makeConfig());

    // Register a K8s session as the cluster does on /ws/events connect
    // (real production path — pods are permanent so registerK8sSession
    // is what runs on every reconnect, not createSession).
    mgr.registerK8sSession(makeK8sSession(SESSION_ID, USER, POD));

    // Simulate the openagentic runner pod emitting terminal output via
    // its terminal WS. Pre-fix: nothing was wired to a parser, so this
    // event landed in the output buffer only and never reached
    // awcode_messages.
    const payload = '{"type":"text","content":"hello","model":"claude-sonnet-4-6","tokens":12}\n';
    fakeK8sBus.emit('terminal:data', SESSION_ID, payload);

    const adds = parserEvents.filter(
      (e) => e.kind === 'addOutput' && e.sessionId === SESSION_ID,
    );
    // After fix: at least one addOutput call landed for this session.
    // Before fix: zero — the K8s branch never created a parser.
    expect(adds.length).toBeGreaterThan(0);
    expect(adds[0].data).toBe(payload);
  });

  it('K8s stopSession (disconnect) flushes the parser to persist any tail output', async () => {
    const mgr = new SessionManager(makeConfig());
    mgr.registerK8sSession(makeK8sSession(SESSION_ID, USER, POD));

    // Feed some output, then disconnect — the cleanup must run so any
    // buffered final-turn tail is mirrored into awcode_messages before
    // the in-memory record is dropped.
    fakeK8sBus.emit('terminal:data', SESSION_ID, 'partial output line\n');
    await mgr.stopSession(SESSION_ID);

    const cleanups = parserEvents.filter(
      (e) => e.kind === 'cleanup' && e.sessionId === SESSION_ID,
    );
    expect(cleanups.length).toBe(1);
  });
});
