/**
 * #1107 — RED→GREEN test for ERR_HTTP_HEADERS_SENT regression in
 * /api/cluster/services GET handler.
 *
 * Live evidence (2026-05-25, api pod -5b4cbd7c5d-9xtwr):
 *   - 31 unhandled rejections in 24h, ~30s cadence
 *   - Fastify warning: "Reply was already sent, did you forget to
 *     'return reply' in the '/api/cluster/services' (GET) route?"
 *   - Stack: onSendEnd → safeWriteHead → ERR_HTTP_HEADERS_SENT
 *
 * Root cause:
 *   The async handler calls `reply.send({...})` then falls through
 *   without returning. The async function resolves to `undefined`
 *   while reply.sent is already true. Fastify processes the resolved
 *   promise value as a SECOND payload, re-fires the onSend hook
 *   chain, which calls writeHead a second time → ERR_HTTP_HEADERS_SENT.
 *
 * Fix (the only safe pattern for Fastify async handlers):
 *   Either `return reply.send(...)` at every send-site, OR return
 *   the payload directly and let Fastify do the single send.
 *
 * Test strategy:
 *   Pin every code-path return value. The fix returns the FastifyReply
 *   sentinel (truthy) instead of undefined. This is the structural
 *   invariant that Fastify uses to decide "handler told us it owns
 *   the response — do not double-send."
 *
 *   Three paths to pin:
 *     (a) k8s_unavailable early-return (line 161 pre-fix) — already
 *         returns OK, regression pin.
 *     (b) happy-path send (line 240 pre-fix) — THE bug site.
 *     (c) error-catch send (line 249 pre-fix) — ALSO a bug site.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @kubernetes/client-node BEFORE importing the handler so the
// KubeConfig + API client constructors return controllable stubs.
const fakeListResult = { items: [] as any[] };
const apiStubs = {
  listNamespacedDeployment: vi.fn().mockResolvedValue(fakeListResult),
  listNamespacedStatefulSet: vi.fn().mockResolvedValue(fakeListResult),
  listNamespacedPod: vi.fn().mockResolvedValue(fakeListResult),
};

vi.mock('@kubernetes/client-node', () => ({
  KubeConfig: class FakeKubeConfig {
    loadFromCluster() {}
    makeApiClient<T>(): T {
      return apiStubs as any;
    }
  },
  CoreV1Api: class {},
  AppsV1Api: class {},
}));

vi.mock('../../../config/featureFlags.js', () => ({
  featureFlags: { k8sNamespace: 'test-ns' },
}));

vi.mock('../../../utils/logger.js', () => ({
  loggers: {
    routes: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    },
  },
}));

// Build a minimal reply mock whose send returns a sentinel object —
// the same way Fastify's real reply.send does. The handler is correct
// iff it returns this sentinel (or a truthy value), not undefined.
function makeReply() {
  const sentinel: any = {};
  sentinel.statusCode = 200;
  sentinel.status = vi.fn((code: number) => { sentinel.statusCode = code; return sentinel; });
  sentinel.send = vi.fn((_body: any) => sentinel);
  return sentinel;
}
const reqStub = {} as any;

beforeEach(() => {
  apiStubs.listNamespacedDeployment.mockResolvedValue({ items: [] });
  apiStubs.listNamespacedStatefulSet.mockResolvedValue({ items: [] });
  apiStubs.listNamespacedPod.mockResolvedValue({ items: [] });
});

describe('#1107 — /api/cluster/services handler must return reply (no dual-send)', () => {
  it('happy path: handler returns reply sentinel, not undefined', async () => {
    const { clusterServicesHandler } = await import('../services.handler.js');
    const reply = makeReply();
    const result = await clusterServicesHandler(reqStub, reply);
    // The bug: result === undefined (Promise<void> handler with reply.send
    // called but not returned). Fix: result is the FastifyReply (truthy).
    expect(result).toBeDefined();
    expect(result).toBe(reply);
    expect(reply.send).toHaveBeenCalledTimes(1);
  });

  it('error path (k8s API throws): handler returns reply sentinel, not undefined', async () => {
    apiStubs.listNamespacedDeployment.mockRejectedValueOnce(
      Object.assign(new Error('forbidden'), { statusCode: 403 }),
    );
    const { clusterServicesHandler } = await import('../services.handler.js');
    const reply = makeReply();
    const result = await clusterServicesHandler(reqStub, reply);
    expect(result).toBeDefined();
    expect(result).toBe(reply);
    expect(reply.status).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledTimes(1);
  });

  // k8s_unavailable early-return path is verified by inspection: it had
  // an explicit `return` before this fix, so it never had the dual-send
  // bug. The two bug-site paths (happy + catch) are pinned above. Adding
  // a runtime test here would require re-assigning the read-only module
  // export of @kubernetes/client-node, which Bun's vi.mock blocks.

});
