/**
 * Data Layer Test Setup
 *
 * Shared configuration and utilities for data layer validation tests.
 * These tests run against the REAL environment (K8s or local) to validate
 * that all data layer components are working correctly.
 */

import { PrismaClient } from '@prisma/client';
import { MilvusClient } from '@zilliz/milvus2-sdk-node';
import Redis from 'ioredis';
import { logger } from '../../utils/logger.js';

// Test configuration
export const TEST_CONFIG = {
  // Database
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://openagentic:openagentic123@localhost:5432/openagentic',

  // Redis
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',

  // Milvus
  MILVUS_ADDRESS: process.env.MILVUS_ADDRESS || 'localhost:19530',
  MILVUS_TOKEN: process.env.MILVUS_TOKEN,

  // Test timeouts
  CONNECTION_TIMEOUT: 10000,
  QUERY_TIMEOUT: 30000,
};

// Shared clients (initialized lazily)
let prismaClient: PrismaClient | null = null;
let redisClient: Redis | null = null;
let milvusClient: MilvusClient | null = null;

/**
 * Get or create Prisma client
 */
export async function getPrismaClient(): Promise<PrismaClient> {
  if (!prismaClient) {
    prismaClient = new PrismaClient({
      datasources: {
        db: { url: TEST_CONFIG.DATABASE_URL }
      },
      log: ['error', 'warn'],
    });
  }
  return prismaClient;
}

/**
 * Get or create Redis client
 */
export async function getRedisClient(): Promise<Redis> {
  if (!redisClient) {
    redisClient = new Redis(TEST_CONFIG.REDIS_URL, {
      connectTimeout: TEST_CONFIG.CONNECTION_TIMEOUT,
      maxRetriesPerRequest: 3,
    });
  }
  return redisClient;
}

/**
 * Get or create Milvus client
 */
export async function getMilvusClient(): Promise<MilvusClient> {
  if (!milvusClient) {
    milvusClient = new MilvusClient({
      address: TEST_CONFIG.MILVUS_ADDRESS,
      token: TEST_CONFIG.MILVUS_TOKEN,
      timeout: TEST_CONFIG.CONNECTION_TIMEOUT,
    });
  }
  return milvusClient;
}

/**
 * Cleanup all test connections
 */
export async function cleanup(): Promise<void> {
  const errors: Error[] = [];

  if (prismaClient) {
    try {
      await prismaClient.$disconnect();
      prismaClient = null;
    } catch (e) {
      errors.push(e as Error);
    }
  }

  if (redisClient) {
    try {
      await redisClient.quit();
      redisClient = null;
    } catch (e) {
      errors.push(e as Error);
    }
  }

  if (milvusClient) {
    try {
      await milvusClient.closeConnection();
      milvusClient = null;
    } catch (e) {
      errors.push(e as Error);
    }
  }

  if (errors.length > 0) {
    console.warn('Cleanup errors:', errors.map(e => e.message));
  }
}

/**
 * Test result interface
 */
export interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  details?: Record<string, any>;
}

/**
 * Test suite result interface
 */
export interface TestSuiteResult {
  suite: string;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  tests: TestResult[];
}

/**
 * Run a single test with timing and error handling
 */
export async function runTest(
  name: string,
  testFn: () => Promise<Record<string, any> | void>
): Promise<TestResult> {
  const start = Date.now();

  try {
    const details = await testFn();
    return {
      name,
      passed: true,
      duration: Date.now() - start,
      details: details || undefined,
    };
  } catch (error) {
    return {
      name,
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Print test results to console
 */
export function printResults(results: TestSuiteResult[]): void {
  console.log('\n' + '='.repeat(80));
  console.log('DATA LAYER VALIDATION RESULTS');
  console.log('='.repeat(80) + '\n');

  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  for (const suite of results) {
    console.log(`\n ${suite.suite} (${suite.duration}ms)`);
    console.log('-'.repeat(60));

    for (const test of suite.tests) {
      const icon = test.passed ? '✅' : '❌';
      const status = test.passed ? 'PASS' : 'FAIL';
      console.log(`  ${icon} ${test.name} [${status}] (${test.duration}ms)`);

      if (test.error) {
        console.log(`     └─ Error: ${test.error}`);
      }

      if (test.details && Object.keys(test.details).length > 0) {
        for (const [key, value] of Object.entries(test.details)) {
          console.log(`     └─ ${key}: ${JSON.stringify(value)}`);
        }
      }
    }

    totalPassed += suite.passed;
    totalFailed += suite.failed;
    totalSkipped += suite.skipped;
  }

  console.log('\n' + '='.repeat(80));
  console.log(`TOTAL: ${totalPassed} passed, ${totalFailed} failed, ${totalSkipped} skipped`);
  console.log('='.repeat(80) + '\n');

  if (totalFailed > 0) {
    console.log('DATA LAYER VALIDATION FAILED\n');
    process.exitCode = 1;
  } else {
    console.log('DATA LAYER VALIDATION PASSED\n');
  }
}

/**
 * Generate a test vector (1536 dimensions for OpenAI embeddings)
 */
export function generateTestVector(seed: number = 42): number[] {
  // Deterministic pseudo-random vector for testing
  const vector: number[] = [];
  let value = seed;

  for (let i = 0; i < 1536; i++) {
    // Simple LCG for reproducible values
    value = (value * 1103515245 + 12345) & 0x7fffffff;
    vector.push((value / 0x7fffffff) * 2 - 1); // Normalize to [-1, 1]
  }

  // Normalize to unit vector
  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  return vector.map(v => v / magnitude);
}
