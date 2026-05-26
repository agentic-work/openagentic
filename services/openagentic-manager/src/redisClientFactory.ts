/**
 * Redis client factory — #302 master-routing fix.
 *
 * bitnami-redis in replication+sentinel mode (the topology we run in k3s
 * agentic-dev) exposes a single Service named `redis` that round-robins
 * across 1 master + N replicas. Writes to a replica return
 * `READONLY You can't write against a read only replica.` so every Redis
 * client in code-manager must go through this factory, which prefers
 * Sentinel-based master discovery over a plain URL when the sentinel env
 * vars are present.
 *
 * Resolution order:
 *   1. Explicit options override (for tests + programmatic callers)
 *   2. REDIS_SENTINEL_HOSTS (CSV "host:port,host:port,...") — NEW, preferred
 *   3. REDIS_SENTINEL_HOST / REDIS_SENTINEL_PORT — legacy single-host shape
 *   4. REDIS_URL — direct connection (WILL hit replicas on bitnami HA; kept
 *      only for environments that deploy a single-node Redis)
 *   5. REDIS_HOST / REDIS_PORT — direct fallback
 *
 * Password:
 *   SESSION_STATE_REDIS_PASSWORD (session-store scoped)  > REDIS_PASSWORD
 *
 * ioredis handles re-resolving the master on +switch-master automatically,
 * so this factory survives the bitnami Sentinel HA failover path without
 * any app-level reconnect logic.
 */

import Redis, { type RedisOptions } from 'ioredis';

export interface SentinelHost {
  host: string;
  port: number;
}

export type RedisConnectionMode = 'sentinel' | 'url';

export interface ResolvedRedisConnection {
  mode: RedisConnectionMode;
  // sentinel-only
  sentinels?: SentinelHost[];
  masterName?: string;
  sentinelPassword?: string;
  // url-only
  url?: string;
  // shared
  password?: string;
}

export interface ResolveRedisOptions {
  /** CSV like `host:port,host:port` — overrides REDIS_SENTINEL_HOSTS env. */
  sentinelHosts?: string;
  /** Single-host shape — overrides REDIS_SENTINEL_HOST. */
  sentinelHost?: string;
  /** Port for single-host shape — overrides REDIS_SENTINEL_PORT. */
  sentinelPort?: number;
  /** Sentinel master name — overrides REDIS_SENTINEL_MASTER (default `mymaster`). */
  masterName?: string;
  /** Explicit Redis URL — overrides REDIS_URL. */
  url?: string;
  /** Direct host — overrides REDIS_HOST. */
  host?: string;
  /** Direct port — overrides REDIS_PORT. */
  port?: number;
  /** Auth password — overrides SESSION_STATE_REDIS_PASSWORD / REDIS_PASSWORD. */
  password?: string;
}

const DEFAULT_SENTINEL_PORT = 26379;
const DEFAULT_REDIS_PORT = 6379;
const DEFAULT_MASTER_NAME = 'mymaster';

/**
 * Parse a CSV of `host[:port]` entries into a list of {host, port} pairs.
 * Empty / malformed entries are skipped rather than thrown, so operator
 * typos in the env don't take the pod down entirely.
 */
function parseSentinelHosts(csv: string): SentinelHost[] {
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((entry): SentinelHost | null => {
      const [host, portStr] = entry.split(':');
      if (!host) return null;
      const port = portStr ? parseInt(portStr, 10) : DEFAULT_SENTINEL_PORT;
      if (!Number.isFinite(port) || port <= 0) return null;
      return { host: host.trim(), port };
    })
    .filter((v): v is SentinelHost => v !== null);
}

/**
 * Resolve the Redis connection config from env + options. Pure — no side
 * effects, safe to call multiple times.
 */
export function resolveRedisConnection(
  opts: ResolveRedisOptions = {}
): ResolvedRedisConnection {
  const password =
    opts.password ??
    process.env.SESSION_STATE_REDIS_PASSWORD ??
    process.env.REDIS_PASSWORD ??
    undefined;

  // --- Sentinel path -------------------------------------------------------
  const sentinelHostsCsv =
    opts.sentinelHosts ?? process.env.REDIS_SENTINEL_HOSTS ?? '';
  const sentinelsFromCsv = sentinelHostsCsv
    ? parseSentinelHosts(sentinelHostsCsv)
    : [];

  const legacySentinelHost =
    opts.sentinelHost ?? process.env.REDIS_SENTINEL_HOST;
  const legacySentinelPort =
    opts.sentinelPort ??
    (process.env.REDIS_SENTINEL_PORT
      ? parseInt(process.env.REDIS_SENTINEL_PORT, 10)
      : undefined);

  const sentinels: SentinelHost[] =
    sentinelsFromCsv.length > 0
      ? sentinelsFromCsv
      : legacySentinelHost
      ? [
          {
            host: legacySentinelHost,
            port: legacySentinelPort || DEFAULT_SENTINEL_PORT,
          },
        ]
      : [];

  if (sentinels.length > 0) {
    const masterName =
      opts.masterName ??
      process.env.REDIS_SENTINEL_MASTER ??
      DEFAULT_MASTER_NAME;
    return {
      mode: 'sentinel',
      sentinels,
      masterName,
      password,
      sentinelPassword: password,
    };
  }

  // --- URL path -----------------------------------------------------------
  const explicitUrl = opts.url ?? process.env.REDIS_URL;
  if (explicitUrl) {
    return { mode: 'url', url: explicitUrl, password };
  }

  // --- Host/port fallback (builds a URL) ----------------------------------
  const host = opts.host ?? process.env.REDIS_HOST ?? 'redis';
  const port =
    opts.port ??
    (process.env.REDIS_PORT
      ? parseInt(process.env.REDIS_PORT, 10)
      : DEFAULT_REDIS_PORT);
  const authPart = password ? `:${encodeURIComponent(password)}@` : '';
  const url = `redis://${authPart}${host}:${port}`;
  return { mode: 'url', url, password };
}

export interface CreateRedisClientOptions extends ResolveRedisOptions {
  /** Passed through to ioredis — skip the initial TCP connect (tests). */
  lazyConnect?: boolean;
  /** Called when ioredis emits +switch-master (Sentinel failover). */
  onMasterSwitch?: (payload: string) => void;
  /** Called on ioredis 'error' events. */
  onError?: (err: Error) => void;
  /** Passed through to ioredis. */
  maxRetriesPerRequest?: number;
  /** Passed through to ioredis. */
  enableReadyCheck?: boolean;
}

/**
 * Build an ioredis client using the resolved connection config. Sentinel
 * mode routes every command to the current master (ioredis handles
 * +switch-master re-resolution), eliminating the READONLY error.
 */
export function createRedisClient(
  opts: CreateRedisClientOptions = {}
): Redis {
  const resolved = resolveRedisConnection(opts);

  const common: Partial<RedisOptions> = {
    lazyConnect: opts.lazyConnect,
    maxRetriesPerRequest: opts.maxRetriesPerRequest ?? 3,
    enableReadyCheck: opts.enableReadyCheck ?? true,
  };

  let client: Redis;
  if (resolved.mode === 'sentinel') {
    const sentinelOpts: RedisOptions = {
      sentinels: resolved.sentinels,
      name: resolved.masterName,
      password: resolved.password,
      sentinelPassword: resolved.sentinelPassword,
      ...common,
    };
    client = new Redis(sentinelOpts);
  } else {
    // URL path — ioredis parses host/port/auth from the URL.
    client = new Redis(resolved.url as string, common as RedisOptions);
  }

  if (opts.onError) {
    client.on('error', opts.onError);
  }
  if (opts.onMasterSwitch) {
    client.on('+switch-master', opts.onMasterSwitch);
  }

  return client;
}
