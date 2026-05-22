/**
 * RED-first TDD: RedisMemoryCache.setContextCache must NOT throw when
 * Redis responds with READONLY (write to replica).
 *
 * Bug: live pod log:
 *   "Cache lookup failed, continuing without cache:
 *    Error: Failed to parse context cache data:
 *    Error: READONLY You can't write against a read only replica."
 *
 * When getContextCache(key, trackHit: true) reads successfully but then
 * tries to update the hit count via setContextCache(), the write fails
 * with READONLY on a replica node. This error propagates through
 * getContextCache, silently aborting the cache read result.
 *
 * Fix: catch READONLY errors in setWithOptions (and by extension setContextCache)
 * and log them at debug level instead of rethrowing, so the read result is
 * still returned even when the hit-count write fails.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as redis from 'redis';

vi.mock('redis', () => {
  const readonlyError = Object.assign(
    new Error('READONLY You can\'t write against a read only replica.'),
    { code: 'READONLY' }
  );

  const mockClient = {
    on: vi.fn().mockReturnThis(),
    connect: vi.fn().mockResolvedValue(undefined),
    // reads succeed
    get: vi.fn().mockResolvedValue(JSON.stringify({
      context: 'test-context',
      timestamp: Date.now(),
      hitCount: 0,
      lastAccessed: Date.now(),
      ttl: 3600,
      version: 1,
    })),
    expire: vi.fn().mockResolvedValue(1),
    // writes fail with READONLY
    set: vi.fn().mockRejectedValue(readonlyError),
  };
  return {
    createClient: vi.fn(() => mockClient),
    __mockClient: mockClient,
  };
});

import { RedisMemoryCache } from '../RedisMemoryCache.js';

describe('RedisMemoryCache — READONLY write resilience', () => {
  it('getContextCache returns the cached entry even when hit-count write fails with READONLY', async () => {
    const cache = new RedisMemoryCache({
      host: 'localhost',
      port: 6379,
    });

    // Should NOT throw despite the READONLY error on the write path
    const result = await cache.getContextCache('test-key', /* trackHit */ true);

    // The read result must be returned
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('context', 'test-context');
  });

  it('setContextCache does not throw on READONLY errors', async () => {
    const cache = new RedisMemoryCache({
      host: 'localhost',
      port: 6379,
    });

    const entry = {
      context: 'hello',
      timestamp: Date.now(),
      hitCount: 0,
      lastAccessed: Date.now(),
      ttl: 3600,
      version: 1,
    };

    // Must NOT throw
    await expect(
      cache.setContextCache('some-key', entry as any)
    ).resolves.toBeUndefined();
  });
});
