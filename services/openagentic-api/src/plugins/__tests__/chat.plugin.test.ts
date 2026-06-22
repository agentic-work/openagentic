/**
 * Phase 3.1 — chat routes plugin smoke tests.
 *
 * Spins up an isolated Fastify instance, decorates a stubbed AppContext via
 * decorateApp(), registers chatRoutesPlugin with minimal stub deps, then
 * asserts that each sub-route is mounted at the correct prefix.
 *
 * Strategy: use `server.printRoutes()` to assert that the expected path
 * segments appear in the route table — this is the cleanest way to verify
 * registration without standing up real backends.  Where the route emits
 * a deterministic status (e.g. 401 missing auth, 400 bad body), we also
 * fire a fake `inject()` and verify.
 *
 * NOTE on printRoutes() format: Fastify prints a radix-tree where common
 * prefixes are split character-by-character into branches. For example
 * "/api/chat/approvals" appears as "chat/ → a → pprovals" in the tree.
 * Assertions therefore check for path substrings that survive the split
 * (e.g. "pprovals", "sandbox-result", "agent-event") rather than the full
 * mounted path.
 *
 * Bun-compatibility rules applied throughout:
 *  - vi.fn() factories captured BEFORE any import factory (no module-scope
 *    vi.mocked() calls).
 *  - Dynamic import inside beforeAll so stubs are in place first.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { AppContext, decorateApp } from '../../context/AppContext.js';

// ---------------------------------------------------------------------------
// Stub deps — minimum surface to satisfy chatPlugin constructor checks
// ---------------------------------------------------------------------------

const stubChatStorage = {
  createSession: vi.fn().mockResolvedValue({ id: 'stub-session' }),
  getSession: vi.fn().mockResolvedValue(null),
  updateSession: vi.fn().mockResolvedValue(null),
  deleteSession: vi.fn().mockResolvedValue(undefined),
  listSessions: vi.fn().mockResolvedValue([]),
  addMessage: vi.fn().mockResolvedValue({ id: 'stub-msg' }),
  getMessages: vi.fn().mockResolvedValue([]),
  updateMessage: vi.fn().mockResolvedValue(null),
  deleteMessage: vi.fn().mockResolvedValue(undefined),
  healthCheck: vi.fn().mockResolvedValue(true),
};

const stubProviderManager = {
  _isFakeProviderManager: true,
  getProvider: vi.fn().mockReturnValue(null),
  listProviders: vi.fn().mockReturnValue([]),
} as any;

const stubMilvusClient = {
  _isFakeMilvus: true,
} as any;

const stubPrisma = { _stub: true } as any;
const stubLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: function () { return this; },
} as any;

// Internal API key used for agent-event auth tests.
const TEST_INTERNAL_SECRET = 'test-internal-secret-phase31';

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('chatRoutesPlugin — Phase 3.1 smoke tests', () => {
  // Documenting a known coverage gap: chatPlugin itself is NOT exercised by
  // this suite because it throws a circular-reference error against the stub
  // deps and falls back to registering only sub-routes (approvalsRoutes,
  // sandbox-result, agentEventRoute).  The it.todo below tracks the follow-up.
  it.todo(
    'chatPlugin main handler — currently NOT exercised in this smoke test ' +
    'due to a circular-reference error when registering with stub deps. ' +
    'Coverage of the /api/chat prefix in the assertions above comes from ' +
    'approvalsRoutes + agentEventRoute, NOT from chatPlugin itself. ' +
    'Follow-up: add an integration test that registers chatPlugin against a ' +
    'real (or richer-stub) ChatStorageService + ProviderManager.'
  );

  let server: FastifyInstance;
  const previousSecret = process.env.INTERNAL_API_KEY;

  beforeAll(async () => {
    // Set the internal secret so the agent-event route enforces auth.
    process.env.INTERNAL_API_KEY = TEST_INTERNAL_SECRET;

    server = Fastify({ logger: false });

    // Wire a stubbed AppContext onto the test server (matches what server.ts does).
    const ctx = new AppContext({ prisma: stubPrisma, logger: stubLogger });
    ctx.chatStorage = stubChatStorage as any;
    ctx.providerManager = stubProviderManager;
    ctx.milvusClient = stubMilvusClient;
    decorateApp(server, ctx);

    // Import the plugin AFTER stubs are in place.
    const { default: chatRoutesPlugin } = await import('../chat.plugin.js');

    await server.register(chatRoutesPlugin, {
      enableCoT: false,
    });

    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    // Restore env.
    if (previousSecret === undefined) {
      delete process.env.INTERNAL_API_KEY;
    } else {
      process.env.INTERNAL_API_KEY = previousSecret;
    }
  });

  // ── Route mount assertions (inject-based, robust to Fastify version changes) ─
  // Using inject() instead of printRoutes() substring matching — printRoutes()
  // depends on radix-tree internals that vary across Fastify versions (B4 fix).

  /**
   * NOTE: /api/chat/approvals returns 401 (auth-gated) rather than 200/404,
   * which proves the route IS mounted (404 would mean route not registered).
   */
  it('route /api/chat prefix is reachable (approvalsRoutes mounted)', async () => {
    const resp = await server.inject({ method: 'GET', url: '/api/chat/approvals' });
    expect(resp.statusCode).not.toBe(404);
  });

  it('HITL approvals route is mounted at /api/chat/approvals (non-404)', async () => {
    const resp = await server.inject({ method: 'GET', url: '/api/chat/approvals' });
    expect(resp.statusCode).not.toBe(404);
  });

  it('sandbox-result route is mounted at /api/chat/sandbox-result (non-404)', async () => {
    const resp = await server.inject({ method: 'POST', url: '/api/chat/sandbox-result' });
    expect(resp.statusCode).not.toBe(404);
  });

  it('agent-event route is mounted at /api/chat/agent-event (non-404)', async () => {
    const resp = await server.inject({
      method: 'POST',
      url: '/api/chat/agent-event',
      headers: { 'content-type': 'application/json' },
      payload: { turnId: 'probe', runId: 'R0', event: 'agent_start', payload: {}, seq: 0, ts: Date.now() },
    });
    // 401 = route mounted + auth enforced; 404 = not mounted
    expect(resp.statusCode).not.toBe(404);
  });

  it('agent-event route is ALSO mounted under /api (dual-mount)', async () => {
    // Verify the /api/agent-event path responds (dual-mount).  The tree collapses
    // the two mounts into shared radix nodes so we use inject() instead of
    // counting occurrences in printRoutes().
    const resp = await server.inject({
      method: 'POST',
      url: '/api/agent-event',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': TEST_INTERNAL_SECRET,
      },
      payload: {
        turnId: 'dual-mount-probe',
        runId: 'R-probe',
        event: 'agent_start',
        payload: {},
        seq: 0,
        ts: Date.now(),
      },
    });
    // 200 means the route exists at /api/agent-event (dual-mount confirmed).
    expect(resp.statusCode).toBe(200);
  });

  // ── Inject-based auth assertions ──────────────────────────────────────────

  it('POST /api/chat/agent-event without X-Internal-Secret returns 401', async () => {
    const resp = await server.inject({
      method: 'POST',
      url: '/api/chat/agent-event',
      headers: { 'content-type': 'application/json' },
      payload: {
        turnId: 'test-turn',
        runId: 'R1',
        event: 'agent_start',
        payload: {},
        seq: 0,
        ts: Date.now(),
      },
    });
    expect(resp.statusCode).toBe(401);
  });

  it('POST /api/agent-event without X-Internal-Secret returns 401 (dual-mount)', async () => {
    const resp = await server.inject({
      method: 'POST',
      url: '/api/agent-event',
      headers: { 'content-type': 'application/json' },
      payload: {
        turnId: 'test-turn-2',
        runId: 'R2',
        event: 'agent_start',
        payload: {},
        seq: 0,
        ts: Date.now(),
      },
    });
    expect(resp.statusCode).toBe(401);
  });
});
