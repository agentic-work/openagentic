/**
 * resolveMilvusHealthStatus — accurate /api/health milvus probe.
 *
 * Triage context (open-dev deployment-acceptance harness, HEALTH=FAIL):
 *   /api/health reported milvus.status="not_initialized" while Milvus was
 *   actually serving (checkHealth().isHealthy=true, 10 collections, tool
 *   cache LoadStateLoaded, chat MCP tool calls working).
 *
 * Root cause: the old probe only read getMilvusConnectionManager() (never
 * populated by the boot path) and fastify.app?.milvusVectorService (decorateApp
 * is never called), then fell through to a lazy reconnect that constructed
 * `new MilvusConnectionManager(null)` and crashed on the null logger
 * (`this.logger.info` → TypeError) → caught → 'not_initialized'.
 *
 * The running server actually stores the live client via setMilvusClient()
 * (startup/05-milvus.ts:69 → getMilvusClient()) and global.milvusVectorService
 * (05-milvus.ts:78). This helper probes those canonical signals with a REAL
 * checkHealth() ping (never a hardcoded 'connected'), mirroring the accessor
 * the chat pipeline uses (server.ts:930).
 */
import { describe, it, expect, vi } from 'vitest';
import { resolveMilvusHealthStatus } from '../milvusHealthProbe.js';

const healthyClient = { checkHealth: vi.fn(async () => ({ isHealthy: true, reasons: [] })) };
const unhealthyClient = { checkHealth: vi.fn(async () => ({ isHealthy: false, reasons: ['x'] })) };

describe('resolveMilvusHealthStatus', () => {
  it('returns "connected" when the live client handle pings healthy (real probe, not hardcoded)', async () => {
    const status = await resolveMilvusHealthStatus({
      getClient: () => healthyClient as any,
    });
    expect(status).toBe('connected');
    expect(healthyClient.checkHealth).toHaveBeenCalled();
  });

  it('returns "unhealthy" when the live client handle is present but pings unhealthy', async () => {
    const status = await resolveMilvusHealthStatus({
      getClient: () => unhealthyClient as any,
    });
    expect(status).toBe('unhealthy');
  });

  it('falls back to the vector service when no direct client, reporting "connected"', async () => {
    const status = await resolveMilvusHealthStatus({
      getClient: () => null,
      getVectorService: () => ({}) as any,
    });
    expect(status).toBe('connected');
  });

  it('prefers a client exposed by the vector service over the service-presence shortcut', async () => {
    const svc = { client: healthyClient } as any;
    const status = await resolveMilvusHealthStatus({
      getClient: () => null,
      getVectorService: () => svc,
    });
    expect(status).toBe('connected');
    expect(healthyClient.checkHealth).toHaveBeenCalled();
  });

  it('attempts a lazy reconnect (with a real logger) when nothing is initialized → "reconnected"', async () => {
    const reconnect = vi.fn(async () => ({ ok: true }) as any);
    const status = await resolveMilvusHealthStatus({
      getClient: () => null,
      getVectorService: () => null,
      reconnect,
    });
    expect(reconnect).toHaveBeenCalled();
    expect(status).toBe('reconnected');
  });

  it('returns "not_initialized" when nothing is up and reconnect yields no client', async () => {
    const status = await resolveMilvusHealthStatus({
      getClient: () => null,
      getVectorService: () => null,
      reconnect: async () => null,
    });
    expect(status).toBe('not_initialized');
  });

  it('does not crash (returns "not_initialized") when the lazy reconnect itself throws', async () => {
    const status = await resolveMilvusHealthStatus({
      getClient: () => null,
      getVectorService: () => null,
      reconnect: async () => {
        throw new Error('boom');
      },
    });
    expect(status).toBe('not_initialized');
  });

  it('times out a hung checkHealth ping rather than blocking the health route', async () => {
    const hung = { checkHealth: () => new Promise(() => {}) }; // never resolves
    const status = await resolveMilvusHealthStatus({
      getClient: () => hung as any,
      timeoutMs: 50,
    });
    // a hung ping must not be reported as healthy; degrade to unhealthy
    expect(status).toBe('unhealthy');
  });
});
