/**
 * RED-first TDD: UnifiedRedisClient must expose sorted-set commands
 * (zremrangebyscore, zcard, zadd) and ioredis-compat write helpers
 * (incr, incrby) used by ChatAuthService for rate limiting.
 *
 * Bug: ChatAuthService calls redis.zremrangebyscore() but UnifiedRedisClient
 * only wraps node-redis (v4) and never exposed sorted-set methods, causing
 * "TypeError: redis.zremrangebyscore is not a function" in live pod logs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test the wrapper by injecting a mock inner client.
// Import after mock setup so module initialisation doesn't try to connect.
vi.mock('redis', () => {
  const mockClient = {
    on: vi.fn().mockReturnThis(),
    connect: vi.fn().mockResolvedValue(undefined),
    zRemRangeByScore: vi.fn().mockResolvedValue(1),
    zCard: vi.fn().mockResolvedValue(3),
    zAdd: vi.fn().mockResolvedValue(1),
    incr: vi.fn().mockResolvedValue(1),
    incrBy: vi.fn().mockResolvedValue(5),
    expire: vi.fn().mockResolvedValue(1),
  };
  return {
    createClient: vi.fn(() => mockClient),
    __mockClient: mockClient,
  };
});

import { getRedisClient, initializeRedis } from '../redis-client.js';
import * as redisMod from 'redis';

const silentLogger = {
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  child: () => silentLogger,
} as any;

describe('UnifiedRedisClient — sorted-set + ioredis-compat helpers', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Re-init to force connected state
    await initializeRedis(silentLogger);
  });

  it('exposes zremrangebyscore() that proxies to zRemRangeByScore', async () => {
    const client = getRedisClient();
    // This should NOT throw "is not a function"
    const result = await client.zremrangebyscore('testKey', 0, Date.now());
    expect(result).toBeTypeOf('number');
  });

  it('exposes zcard() that proxies to zCard', async () => {
    const client = getRedisClient();
    const result = await client.zcard('testKey');
    expect(result).toBeTypeOf('number');
  });

  it('exposes zadd() that proxies to zAdd', async () => {
    const client = getRedisClient();
    // ioredis-style: zadd(key, score, member)
    const result = await client.zadd('testKey', 1234567890, 'member-abc');
    expect(result).toBeTypeOf('number');
  });

  it('exposes incr() that proxies to incr', async () => {
    const client = getRedisClient();
    const result = await client.incr('counterKey');
    expect(result).toBeTypeOf('number');
    expect(result).toBeGreaterThan(0);
  });

  it('exposes incrby() that proxies to incrBy', async () => {
    const client = getRedisClient();
    const result = await client.incrby('counterKey', 42);
    expect(result).toBeTypeOf('number');
  });
});
