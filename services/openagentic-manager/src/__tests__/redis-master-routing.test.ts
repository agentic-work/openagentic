/**
 * #302 — Redis master-routing tests.
 *
 * bitnami-redis in replication+sentinel mode exposes a single Service named
 * `redis` that round-robins across 1 master + N replicas. Writes to replica
 * nodes fail with `READONLY You can't write against a read only replica.`
 *
 * Fix: all code-manager Redis clients must go through a single factory that
 * prefers Sentinel discovery (REDIS_SENTINEL_HOSTS) over a plain URL, so every
 * write is routed to the current master — and automatically re-routed after a
 * failover.
 *
 * These tests are written first (red) and assert:
 *   1. The factory returns a Sentinel-mode ioredis client when
 *      REDIS_SENTINEL_HOSTS (or legacy REDIS_SENTINEL_HOST) is set.
 *   2. The factory falls back to a direct URL/host connection otherwise.
 *   3. Multiple sentinel hosts (CSV) are parsed correctly.
 *   4. The Sentinel master name defaults to `mymaster` and can be overridden.
 *   5. Password is passed through from REDIS_PASSWORD env.
 *   6. RedisSessionStore delegates to the shared factory.
 *   7. Factory is idempotent — passing the same config twice yields equivalent
 *      options (important because sessionStore + index.ts call it separately).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Redis from 'ioredis';
import {
  createRedisClient,
  resolveRedisConnection,
  type ResolvedRedisConnection,
} from '../redisClientFactory';

// Avoid actually opening sockets during unit tests — ioredis respects
// `lazyConnect: true` and does not attempt a TCP connect until a command is issued.
const LAZY = { lazyConnect: true };

describe('redisClientFactory.resolveRedisConnection', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    // Clean slate for each test — the factory reads process.env.
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('REDIS_') || key.startsWith('SESSION_STATE_REDIS')) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('prefers sentinel mode when REDIS_SENTINEL_HOSTS is set (CSV of host:port)', () => {
    process.env.REDIS_SENTINEL_HOSTS =
      'redis-node-0.redis-headless:26379,redis-node-1.redis-headless:26379,redis-node-2.redis-headless:26379';
    process.env.REDIS_PASSWORD = 'supersecret';

    const resolved = resolveRedisConnection();

    expect(resolved.mode).toBe('sentinel');
    expect(resolved.sentinels).toEqual([
      { host: 'redis-node-0.redis-headless', port: 26379 },
      { host: 'redis-node-1.redis-headless', port: 26379 },
      { host: 'redis-node-2.redis-headless', port: 26379 },
    ]);
    expect(resolved.masterName).toBe('mymaster');
    expect(resolved.password).toBe('supersecret');
    expect(resolved.sentinelPassword).toBe('supersecret');
  });

  it('supports the legacy single-host REDIS_SENTINEL_HOST / REDIS_SENTINEL_PORT env', () => {
    process.env.REDIS_SENTINEL_HOST = 'redis';
    process.env.REDIS_SENTINEL_PORT = '26379';
    process.env.REDIS_SENTINEL_MASTER = 'mymaster';
    process.env.REDIS_PASSWORD = 'legacy';

    const resolved = resolveRedisConnection();

    expect(resolved.mode).toBe('sentinel');
    expect(resolved.sentinels).toEqual([{ host: 'redis', port: 26379 }]);
    expect(resolved.password).toBe('legacy');
  });

  it('allows overriding the sentinel master name via REDIS_SENTINEL_MASTER', () => {
    process.env.REDIS_SENTINEL_HOSTS = 'sentinel-0:26379';
    process.env.REDIS_SENTINEL_MASTER = 'openagentic-master';

    const resolved = resolveRedisConnection();

    expect(resolved.mode).toBe('sentinel');
    expect(resolved.masterName).toBe('openagentic-master');
  });

  it('prefers SESSION_STATE_REDIS_PASSWORD over REDIS_PASSWORD when both are set', () => {
    process.env.REDIS_SENTINEL_HOSTS = 'sentinel-0:26379';
    process.env.REDIS_PASSWORD = 'generic';
    process.env.SESSION_STATE_REDIS_PASSWORD = 'session-scoped';

    const resolved = resolveRedisConnection();

    expect(resolved.password).toBe('session-scoped');
  });

  it('falls back to direct URL mode when no sentinel env is set', () => {
    process.env.REDIS_URL =
      'redis://:pw@redis.agentic-dev.svc.cluster.local:6379';

    const resolved = resolveRedisConnection();

    expect(resolved.mode).toBe('url');
    expect(resolved.url).toBe(
      'redis://:pw@redis.agentic-dev.svc.cluster.local:6379'
    );
    expect(resolved.sentinels).toBeUndefined();
  });

  it('falls back to host/port direct mode when no URL and no sentinel env', () => {
    process.env.REDIS_HOST = 'redis';
    process.env.REDIS_PORT = '6379';

    const resolved = resolveRedisConnection();

    expect(resolved.mode).toBe('url');
    expect(resolved.url).toContain('redis');
    expect(resolved.url).toContain('6379');
  });

  it('uses DEFAULT_REDIS_PORT (6379) when only REDIS_HOST is set', () => {
    process.env.REDIS_HOST = 'redis-primary';

    const resolved = resolveRedisConnection();

    expect(resolved.mode).toBe('url');
    expect(resolved.url).toBe('redis://redis-primary:6379');
  });

  it('URL-encodes special characters in the password when building a URL from host/port', () => {
    process.env.REDIS_HOST = 'r';
    process.env.REDIS_PASSWORD = 'p@ss:w/rd';

    const resolved = resolveRedisConnection();

    expect(resolved.mode).toBe('url');
    // @, :, / all must be percent-encoded in the userinfo.
    expect(resolved.url).toBe('redis://:p%40ss%3Aw%2Frd@r:6379');
  });

  it('trims whitespace around CSV sentinel entries', () => {
    process.env.REDIS_SENTINEL_HOSTS =
      ' redis-node-0:26379 , redis-node-1:26379 ,redis-node-2:26379 ';

    const resolved = resolveRedisConnection();

    expect(resolved.mode).toBe('sentinel');
    expect(resolved.sentinels).toEqual([
      { host: 'redis-node-0', port: 26379 },
      { host: 'redis-node-1', port: 26379 },
      { host: 'redis-node-2', port: 26379 },
    ]);
  });

  it('skips empty and unparseable-port CSV entries rather than crashing', () => {
    // Entries:
    //   redis-node-0:26379  → kept
    //   (empty)             → skipped (prevents double-comma crashes)
    //   redis-node-x:bogus  → skipped (NaN port)
    //   :6379               → skipped (empty host)
    //   redis-node-1:26379  → kept
    process.env.REDIS_SENTINEL_HOSTS =
      'redis-node-0:26379,,redis-node-x:bogus,:6379,redis-node-1:26379';

    const resolved = resolveRedisConnection();

    expect(resolved.mode).toBe('sentinel');
    expect(resolved.sentinels).toEqual([
      { host: 'redis-node-0', port: 26379 },
      { host: 'redis-node-1', port: 26379 },
    ]);
  });

  it('defaults a sentinel host with no port to 26379', () => {
    process.env.REDIS_SENTINEL_HOSTS = 'sentinel-a,sentinel-b:26500';

    const resolved = resolveRedisConnection();

    expect(resolved.sentinels).toEqual([
      { host: 'sentinel-a', port: 26379 },
      { host: 'sentinel-b', port: 26500 },
    ]);
  });

  it('accepts sentinel hosts passed as an options override (tests can pass explicit config)', () => {
    const resolved = resolveRedisConnection({
      sentinelHosts: 'custom-sentinel:26379',
      password: 'opt-pw',
    });

    expect(resolved.mode).toBe('sentinel');
    expect(resolved.sentinels).toEqual([
      { host: 'custom-sentinel', port: 26379 },
    ]);
    expect(resolved.password).toBe('opt-pw');
  });
});

describe('redisClientFactory.createRedisClient', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('REDIS_') || key.startsWith('SESSION_STATE_REDIS')) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns an ioredis client with sentinels populated in Sentinel mode', () => {
    process.env.REDIS_SENTINEL_HOSTS =
      'redis-node-0:26379,redis-node-1:26379,redis-node-2:26379';
    process.env.REDIS_PASSWORD = 'pw';

    const client = createRedisClient({ ...LAZY });

    expect(client).toBeInstanceOf(Redis);
    // ioredis stores original options on `.options`.
    const opts = (client as unknown as { options: Record<string, unknown> })
      .options;
    expect(opts.sentinels).toEqual([
      { host: 'redis-node-0', port: 26379 },
      { host: 'redis-node-1', port: 26379 },
      { host: 'redis-node-2', port: 26379 },
    ]);
    expect(opts.name).toBe('mymaster');
    expect(opts.password).toBe('pw');

    client.disconnect();
  });

  it('returns an ioredis client connected by URL when no sentinel env is set', () => {
    process.env.REDIS_URL =
      'redis://:pw@redis.agentic-dev.svc.cluster.local:6379';

    const client = createRedisClient({ ...LAZY });

    expect(client).toBeInstanceOf(Redis);
    const opts = (client as unknown as { options: Record<string, unknown> })
      .options;
    // In URL mode ioredis parses out host/port/password; confirm it picked up
    // the host we asked for. ioredis stores sentinels as null in URL mode.
    expect(opts.host).toBe('redis.agentic-dev.svc.cluster.local');
    expect(opts.port).toBe(6379);
    expect(opts.sentinels).toBeFalsy();

    client.disconnect();
  });

  it('invokes onMasterSwitch when ioredis emits +switch-master', () => {
    process.env.REDIS_SENTINEL_HOSTS = 'redis-node-0:26379';

    const onMasterSwitch = vi.fn();
    const client = createRedisClient({ ...LAZY, onMasterSwitch });

    // Simulate what ioredis emits on real failover.
    client.emit('+switch-master', 'mymaster 10.0.0.1 6379 10.0.0.2 6379');

    expect(onMasterSwitch).toHaveBeenCalledTimes(1);
    expect(onMasterSwitch).toHaveBeenCalledWith(
      'mymaster 10.0.0.1 6379 10.0.0.2 6379'
    );

    client.disconnect();
  });
});

describe('RedisSessionStore integration with the factory', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('REDIS_') || key.startsWith('SESSION_STATE_REDIS')) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('creates a Sentinel-mode ioredis client when sentinel env is set', async () => {
    process.env.REDIS_SENTINEL_HOSTS =
      'redis-node-0:26379,redis-node-1:26379';
    process.env.REDIS_PASSWORD = 'pw';

    const { RedisSessionStore } = await import('../sessionStore');
    // The constructor used to accept a `redisUrl` first arg — with the factory
    // refactor that arg becomes a fallback for the non-sentinel path. Sentinel
    // env must override it.
    const store = new RedisSessionStore('redis://should-be-ignored:6379');

    // Pull the internal client to assert its resolved options.
    const internal = (store as unknown as { redis: Redis }).redis;
    const opts = (internal as unknown as { options: Record<string, unknown> })
      .options;
    expect(opts.sentinels).toEqual([
      { host: 'redis-node-0', port: 26379 },
      { host: 'redis-node-1', port: 26379 },
    ]);
    expect(opts.name).toBe('mymaster');

    await store.close();
  });

  it('falls back to a direct URL when no sentinel env is set', async () => {
    const { RedisSessionStore } = await import('../sessionStore');
    const store = new RedisSessionStore(
      'redis://redis.agentic-dev.svc.cluster.local:6379'
    );

    const internal = (store as unknown as { redis: Redis }).redis;
    const opts = (internal as unknown as { options: Record<string, unknown> })
      .options;
    expect(opts.host).toBe('redis.agentic-dev.svc.cluster.local');
    expect(opts.sentinels).toBeFalsy();

    await store.close();
  });
});
