/**
 * resolveMilvusHealthStatus — accurate /api/health Milvus probe.
 *
 * The /api/health route historically reported milvus.status='not_initialized'
 * even when Milvus was fully serving, because it only consulted signals the
 * boot path never populates (the connection-manager singleton + the
 * never-attached fastify.app decorator) and then fell into a lazy reconnect
 * that crashed on a null logger.
 *
 * This helper reads the SAME canonical signals the chat pipeline uses
 * (server.ts:930 → `global.milvusVectorService || milvusVectorService ||
 * milvusClient`, and the setMilvusClient() singleton populated by
 * startup/05-milvus.ts) and performs a REAL checkHealth() ping — never a
 * hardcoded 'connected'. Accessors are injected so the logic is unit-testable
 * without a live Milvus.
 */

export type MilvusHealthStatus =
  | 'connected'
  | 'unhealthy'
  | 'reconnected'
  | 'not_initialized';

interface MilvusClientLike {
  checkHealth: () => Promise<{ isHealthy?: boolean } | null>;
}

export interface ResolveMilvusHealthDeps {
  /** Live MilvusClient singleton (setMilvusClient/getMilvusClient + globals). */
  getClient?: () => MilvusClientLike | null | undefined;
  /** The MilvusVectorService (global.milvusVectorService); may expose a client. */
  getVectorService?: () =>
    | { client?: MilvusClientLike; milvusClient?: MilvusClientLike }
    | null
    | undefined;
  /**
   * Lazy reconnect, only attempted when no live handle is found. Must be
   * constructed with a real logger by the caller (the historic bug passed a
   * null logger and crashed). Returns a truthy handle on success.
   */
  reconnect?: () => Promise<unknown>;
  /** checkHealth ping timeout (ms). */
  timeoutMs?: number;
}

async function pingHealthy(
  client: MilvusClientLike,
  timeoutMs: number,
): Promise<boolean> {
  try {
    const result = await Promise.race([
      client.checkHealth(),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('milvus health ping timeout')), timeoutMs),
      ),
    ]);
    return !!(result && (result as { isHealthy?: boolean }).isHealthy);
  } catch {
    return false;
  }
}

/**
 * Probe Milvus health using the canonical live signals, with a real ping.
 * Order of preference:
 *   1. a live client handle (singleton or vector-service-exposed) → ping it
 *   2. vector service present but no pingable client → 'connected'
 *   3. lazy reconnect (real logger) → 'reconnected' | 'not_initialized'
 */
export async function resolveMilvusHealthStatus(
  deps: ResolveMilvusHealthDeps,
): Promise<MilvusHealthStatus> {
  const timeoutMs = deps.timeoutMs ?? 3000;

  const svc = deps.getVectorService?.() ?? null;
  const client =
    deps.getClient?.() ?? svc?.client ?? svc?.milvusClient ?? null;

  if (client && typeof client.checkHealth === 'function') {
    return (await pingHealthy(client, timeoutMs)) ? 'connected' : 'unhealthy';
  }

  // The service initialized successfully (mirrors server.ts:930 accessor)
  // even though it didn't hand us a pingable client handle.
  if (svc) {
    return 'connected';
  }

  // Nothing live — last-resort lazy reconnect. The caller MUST pass a real
  // logger inside `reconnect` (the historic null-logger crash forced a false
  // 'not_initialized').
  if (deps.reconnect) {
    try {
      const handle = await deps.reconnect();
      return handle ? 'reconnected' : 'not_initialized';
    } catch {
      return 'not_initialized';
    }
  }

  return 'not_initialized';
}
