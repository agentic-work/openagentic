/**
 * Redis Standalone Validator
 *
 * Run this to validate Redis is working correctly.
 * Does not depend on any test framework.
 */

import Redis from 'ioredis';
import type { TestResult, TestSuiteResult } from '../setup.js';
import { runTest, TEST_CONFIG } from '../setup.js';

/**
 * Run full Redis validation
 */
export async function runRedisValidation(): Promise<TestSuiteResult> {
  const tests: TestResult[] = [];
  const start = Date.now();
  let redis: Redis | null = null;
  const testPrefix = 'validation:datalayer:';

  try {
    redis = new Redis(TEST_CONFIG.REDIS_URL, {
      connectTimeout: TEST_CONFIG.CONNECTION_TIMEOUT,
      maxRetriesPerRequest: 3,
    });

    // Test 1: Basic connectivity
    tests.push(await runTest('Connect to Redis', async () => {
      const pong = await redis!.ping();
      if (pong !== 'PONG') {
        throw new Error(`Expected PONG, got ${pong}`);
      }
      return { response: pong };
    }));

    // Test 2: Get server info
    tests.push(await runTest('Get Redis info', async () => {
      const info = await redis!.info('server');
      const versionMatch = info.match(/redis_version:(\S+)/);
      const version = versionMatch ? versionMatch[1] : 'unknown';
      return { version };
    }));

    // Test 3: Set/Get operations
    tests.push(await runTest('Set/Get operations', async () => {
      const key = `${testPrefix}string:${Date.now()}`;
      const value = 'test-value-' + Date.now();

      await redis!.set(key, value);
      const result = await redis!.get(key);
      await redis!.del(key);

      if (result !== value) {
        throw new Error(`Value mismatch: expected '${value}', got '${result}'`);
      }
      return { success: true };
    }));

    // Test 4: TTL support
    tests.push(await runTest('TTL support', async () => {
      const key = `${testPrefix}ttl:${Date.now()}`;
      await redis!.setex(key, 60, 'expires-soon');

      const ttl = await redis!.ttl(key);
      await redis!.del(key);

      if (ttl <= 0 || ttl > 60) {
        throw new Error(`Invalid TTL: ${ttl}`);
      }
      return { ttlSeconds: ttl };
    }));

    // Test 5: Hash operations
    tests.push(await runTest('Hash operations', async () => {
      const key = `${testPrefix}hash:${Date.now()}`;
      const data = { field1: 'value1', field2: 'value2', count: '123' };

      await redis!.hset(key, data);
      const result = await redis!.hgetall(key);
      await redis!.del(key);

      if (JSON.stringify(result) !== JSON.stringify(data)) {
        throw new Error('Hash data mismatch');
      }
      return { fields: Object.keys(result).length };
    }));

    // Test 6: List operations
    tests.push(await runTest('List operations', async () => {
      const key = `${testPrefix}list:${Date.now()}`;

      await redis!.rpush(key, 'item1', 'item2', 'item3');
      const length = await redis!.llen(key);
      const items = await redis!.lrange(key, 0, -1);
      await redis!.del(key);

      if (length !== 3) {
        throw new Error(`Expected length 3, got ${length}`);
      }
      return { length, items };
    }));

    // Test 7: Atomic increment
    tests.push(await runTest('Atomic increment', async () => {
      const key = `${testPrefix}counter:${Date.now()}`;
      await redis!.set(key, '0');

      const results = await Promise.all([
        redis!.incr(key),
        redis!.incr(key),
        redis!.incr(key),
      ]);

      const final = await redis!.get(key);
      await redis!.del(key);

      if (final !== '3') {
        throw new Error(`Expected final value 3, got ${final}`);
      }
      return { increments: results, finalValue: final };
    }));

    // Test 8: Performance (100 operations)
    tests.push(await runTest('Performance (100 ops)', async () => {
      const key = `${testPrefix}perf:${Date.now()}`;
      const iterations = 100;

      const startOps = Date.now();
      for (let i = 0; i < iterations; i++) {
        await redis!.set(`${key}:${i}`, `value-${i}`);
      }
      const duration = Date.now() - startOps;

      // Cleanup
      const keys = await redis!.keys(`${key}:*`);
      if (keys.length > 0) {
        await redis!.del(...keys);
      }

      const opsPerSecond = Math.round(iterations / (duration / 1000));
      return { operations: iterations, durationMs: duration, opsPerSecond };
    }));

    // Test 9: Pipelining
    tests.push(await runTest('Pipelining (100 ops)', async () => {
      const key = `${testPrefix}pipeline:${Date.now()}`;
      const iterations = 100;

      const startOps = Date.now();
      const pipeline = redis!.pipeline();
      for (let i = 0; i < iterations; i++) {
        pipeline.set(`${key}:${i}`, `value-${i}`);
      }
      await pipeline.exec();
      const duration = Date.now() - startOps;

      // Cleanup
      const keys = await redis!.keys(`${key}:*`);
      if (keys.length > 0) {
        await redis!.del(...keys);
      }

      const opsPerSecond = Math.round(iterations / (duration / 1000));
      return { operations: iterations, durationMs: duration, opsPerSecond, pipelined: true };
    }));

    // Test 10: JSON storage
    tests.push(await runTest('JSON storage', async () => {
      const key = `${testPrefix}json:${Date.now()}`;
      const value = {
        test: true,
        timestamp: Date.now(),
        nested: { a: 1, b: [1, 2, 3] },
      };

      await redis!.set(key, JSON.stringify(value));
      const result = await redis!.get(key);
      await redis!.del(key);

      const parsed = JSON.parse(result!);
      if (JSON.stringify(parsed) !== JSON.stringify(value)) {
        throw new Error('JSON data mismatch');
      }
      return { success: true };
    }));

  } catch (error) {
    if (tests.length === 0) {
      tests.push({
        name: 'Connect to Redis',
        passed: false,
        duration: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } finally {
    if (redis) {
      // Clean up any remaining test keys
      try {
        const keys = await redis.keys(`${testPrefix}*`);
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      } catch (e) {
        // Ignore cleanup errors
      }
      await redis.quit();
    }
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
