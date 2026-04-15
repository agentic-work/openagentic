/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Redis Validation Tests
 *
 * Tests Redis connectivity and basic operations.
 * Run these after any Redis configuration changes.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  getRedisClient,
  cleanup,
  runTest,
  TEST_CONFIG,
  type TestResult,
  type TestSuiteResult,
} from './setup.js';
import Redis from 'ioredis';

let redis: Redis;

describe('Redis Data Layer', () => {
  beforeAll(async () => {
    redis = await getRedisClient();
  });

  afterAll(async () => {
    // Clean up test keys
    const testKeys = await redis.keys('test:datalayer:*');
    if (testKeys.length > 0) {
      await redis.del(...testKeys);
    }
    await cleanup();
  });

  describe('Connectivity', () => {
    it('should connect to Redis', async () => {
      const pong = await redis.ping();
      expect(pong).toBe('PONG');
    });

    it('should get server info', async () => {
      const info = await redis.info('server');
      expect(info).toContain('redis_version');
    });
  });

  describe('Basic Operations', () => {
    const testPrefix = 'test:datalayer:';

    it('should set and get string values', async () => {
      const key = `${testPrefix}string`;
      const value = 'test-value-' + Date.now();

      await redis.set(key, value);
      const result = await redis.get(key);
      expect(result).toBe(value);
    });

    it('should set values with TTL', async () => {
      const key = `${testPrefix}ttl`;
      const value = 'expires-soon';

      await redis.setex(key, 60, value); // 60 second TTL
      const ttl = await redis.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60);
    });

    it('should handle JSON values', async () => {
      const key = `${testPrefix}json`;
      const value = { test: true, timestamp: Date.now(), nested: { a: 1 } };

      await redis.set(key, JSON.stringify(value));
      const result = await redis.get(key);
      expect(JSON.parse(result!)).toEqual(value);
    });

    it('should handle hash operations', async () => {
      const key = `${testPrefix}hash`;

      await redis.hset(key, {
        field1: 'value1',
        field2: 'value2',
        field3: '123',
      });

      const result = await redis.hgetall(key);
      expect(result).toEqual({
        field1: 'value1',
        field2: 'value2',
        field3: '123',
      });
    });

    it('should handle list operations', async () => {
      const key = `${testPrefix}list`;

      await redis.rpush(key, 'item1', 'item2', 'item3');
      const length = await redis.llen(key);
      expect(length).toBe(3);

      const items = await redis.lrange(key, 0, -1);
      expect(items).toEqual(['item1', 'item2', 'item3']);
    });

    it('should handle set operations', async () => {
      const key = `${testPrefix}set`;

      await redis.sadd(key, 'member1', 'member2', 'member3');
      const isMember = await redis.sismember(key, 'member2');
      expect(isMember).toBe(1);

      const members = await redis.smembers(key);
      expect(members.sort()).toEqual(['member1', 'member2', 'member3']);
    });
  });

  describe('Performance', () => {
    it('should handle rapid reads/writes', async () => {
      const key = 'test:datalayer:perf';
      const iterations = 100;

      const start = Date.now();
      for (let i = 0; i < iterations; i++) {
        await redis.set(`${key}:${i}`, `value-${i}`);
        await redis.get(`${key}:${i}`);
      }
      const duration = Date.now() - start;

      // 100 read/write pairs should complete in under 5 seconds
      expect(duration).toBeLessThan(5000);

      // Cleanup
      const keys = await redis.keys(`${key}:*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    });

    it('should support pipelining', async () => {
      const key = 'test:datalayer:pipeline';
      const iterations = 100;

      const start = Date.now();
      const pipeline = redis.pipeline();
      for (let i = 0; i < iterations; i++) {
        pipeline.set(`${key}:${i}`, `value-${i}`);
      }
      await pipeline.exec();
      const duration = Date.now() - start;

      // 100 pipelined writes should be much faster
      expect(duration).toBeLessThan(1000);

      // Cleanup
      const keys = await redis.keys(`${key}:*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    });
  });

  describe('Cache Patterns', () => {
    it('should support cache-aside pattern', async () => {
      const cacheKey = 'test:datalayer:cache-aside';

      // Simulate cache miss -> fetch -> cache
      let cached = await redis.get(cacheKey);
      expect(cached).toBeNull();

      // Simulate fetching from "database"
      const dbValue = { id: 1, name: 'Test', fetched: true };
      await redis.setex(cacheKey, 300, JSON.stringify(dbValue)); // 5 min cache

      // Now should be cached
      cached = await redis.get(cacheKey);
      expect(JSON.parse(cached!)).toEqual(dbValue);
    });

    it('should support atomic increment for counters', async () => {
      const key = 'test:datalayer:counter';

      await redis.set(key, '0');
      const results = await Promise.all([
        redis.incr(key),
        redis.incr(key),
        redis.incr(key),
      ]);

      // All increments should work atomically
      expect(results.sort()).toEqual([1, 2, 3]);
      const final = await redis.get(key);
      expect(final).toBe('3');
    });
  });
});

/**
 * Standalone validation runner (for use outside vitest)
 */
export async function runRedisValidation(): Promise<TestSuiteResult> {
  const tests: TestResult[] = [];
  const start = Date.now();

  try {
    const redis = await getRedisClient();

    tests.push(await runTest('Connect to Redis', async () => {
      const pong = await redis.ping();
      if (pong !== 'PONG') throw new Error('Unexpected ping response');
      return { response: pong };
    }));

    tests.push(await runTest('Get Redis info', async () => {
      const info = await redis.info('server');
      const versionMatch = info.match(/redis_version:(\S+)/);
      return { version: versionMatch ? versionMatch[1] : 'unknown' };
    }));

    tests.push(await runTest('Set/Get operations', async () => {
      const key = 'validation:test:' + Date.now();
      const value = 'test-value';
      await redis.setex(key, 60, value);
      const result = await redis.get(key);
      await redis.del(key);
      if (result !== value) throw new Error('Value mismatch');
      return { success: true };
    }));

    tests.push(await runTest('Performance (100 ops)', async () => {
      const key = 'validation:perf:' + Date.now();
      const iterations = 100;
      const startOps = Date.now();
      for (let i = 0; i < iterations; i++) {
        await redis.set(`${key}:${i}`, `v${i}`);
      }
      const duration = Date.now() - startOps;
      // Cleanup
      const keys = await redis.keys(`${key}:*`);
      if (keys.length > 0) await redis.del(...keys);
      return { operations: iterations, durationMs: duration, opsPerSecond: Math.round(iterations / (duration / 1000)) };
    }));

  } finally {
    await cleanup();
  }

  const passed = tests.filter(t => t.passed).length;
  const failed = tests.filter(t => !t.passed).length;

  return {
    suite: 'Redis',
    passed,
    failed,
    skipped: 0,
    duration: Date.now() - start,
    tests,
  };
}
