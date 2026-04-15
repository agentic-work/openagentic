#!/usr/bin/env tsx
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
 * Data Layer Validation Runner
 *
 * Standalone script to validate all data layer components.
 * Run after ANY changes to:
 * - Prisma schema
 * - Database configuration
 * - Redis configuration
 * - Milvus configuration
 * - Embedding services
 *
 * Usage:
 *   npx tsx src/tests/data-layer/runner.ts
 *   npm run test:data-layer
 *
 * Options:
 *   --postgres-only    Only run PostgreSQL tests
 *   --redis-only       Only run Redis tests
 *   --milvus-only      Only run Milvus tests
 *   --quick            Run minimal connectivity tests only
 *   --json             Output results as JSON
 */

import { runPostgresValidation } from './validators/postgres.validator.js';
import { runRedisValidation } from './validators/redis.validator.js';
import { runMilvusValidation } from './validators/milvus.validator.js';
import { printResults, type TestSuiteResult, type TestResult } from './setup.js';

interface RunnerOptions {
  postgresOnly: boolean;
  redisOnly: boolean;
  milvusOnly: boolean;
  quick: boolean;
  json: boolean;
}

function parseArgs(): RunnerOptions {
  const args = process.argv.slice(2);
  return {
    postgresOnly: args.includes('--postgres-only'),
    redisOnly: args.includes('--redis-only'),
    milvusOnly: args.includes('--milvus-only'),
    quick: args.includes('--quick'),
    json: args.includes('--json'),
  };
}

async function runQuickValidation(): Promise<TestSuiteResult[]> {
  const results: TestSuiteResult[] = [];

  console.log('Running quick connectivity validation...\n');

  // Quick PostgreSQL check
  const pgTests: TestResult[] = [];
  const pgStart = Date.now();
  try {
    const { PrismaClient } = await import('@prisma/client');
    const dbUrl = process.env.DATABASE_URL || 'postgresql://openagentic:openagentic123@localhost:5432/openagentic';
    const prisma = new PrismaClient({
      datasources: { db: { url: dbUrl } },
      log: ['error'],
    });

    const testStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    pgTests.push({
      name: 'Connection',
      passed: true,
      duration: Date.now() - testStart,
    });

    const extStart = Date.now();
    const pgvector = await prisma.$queryRaw<[{ exists: boolean }]>`
      SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') as exists
    `;
    pgTests.push({
      name: 'pgvector extension',
      passed: pgvector[0].exists,
      duration: Date.now() - extStart,
      error: pgvector[0].exists ? undefined : 'pgvector not installed',
    });

    await prisma.$disconnect();
  } catch (error) {
    pgTests.push({
      name: 'Connection',
      passed: false,
      duration: 0,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  results.push({
    suite: 'PostgreSQL (Quick)',
    passed: pgTests.filter(t => t.passed).length,
    failed: pgTests.filter(t => !t.passed).length,
    skipped: 0,
    duration: Date.now() - pgStart,
    tests: pgTests,
  });

  // Quick Redis check
  const redisTests: TestResult[] = [];
  const redisStart = Date.now();
  try {
    const Redis = (await import('ioredis')).default;
    const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      connectTimeout: 5000,
      maxRetriesPerRequest: 1,
    });

    const testStart = Date.now();
    const pong = await redis.ping();
    redisTests.push({
      name: 'Connection',
      passed: pong === 'PONG',
      duration: Date.now() - testStart,
      error: pong === 'PONG' ? undefined : `Expected PONG, got ${pong}`,
    });

    await redis.quit();
  } catch (error) {
    redisTests.push({
      name: 'Connection',
      passed: false,
      duration: 0,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  results.push({
    suite: 'Redis (Quick)',
    passed: redisTests.filter(t => t.passed).length,
    failed: redisTests.filter(t => !t.passed).length,
    skipped: 0,
    duration: Date.now() - redisStart,
    tests: redisTests,
  });

  // Quick Milvus check
  const milvusTests: TestResult[] = [];
  const milvusStart = Date.now();
  try {
    const { MilvusClient } = await import('@zilliz/milvus2-sdk-node');
    const milvus = new MilvusClient({
      address: process.env.MILVUS_ADDRESS || 'localhost:19530',
      token: process.env.MILVUS_TOKEN,
      timeout: 5000,
    });

    const testStart = Date.now();
    const health = await milvus.checkHealth();
    milvusTests.push({
      name: 'Connection',
      passed: health.isHealthy,
      duration: Date.now() - testStart,
      error: health.isHealthy ? undefined : 'Milvus unhealthy',
    });

    await milvus.closeConnection();
  } catch (error) {
    milvusTests.push({
      name: 'Connection',
      passed: false,
      duration: 0,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  results.push({
    suite: 'Milvus (Quick)',
    passed: milvusTests.filter(t => t.passed).length,
    failed: milvusTests.filter(t => !t.passed).length,
    skipped: 0,
    duration: Date.now() - milvusStart,
    tests: milvusTests,
  });

  return results;
}

async function main(): Promise<void> {
  const options = parseArgs();
  const results: TestSuiteResult[] = [];

  if (!options.json) {
    console.log('\n' + '='.repeat(80));
    console.log('DATA LAYER VALIDATION');
    console.log('='.repeat(80));
    console.log(`\nTimestamp: ${new Date().toISOString()}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Database: ${process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':****@') || 'default'}`);
    console.log(`Redis: ${process.env.REDIS_URL || 'redis://localhost:6379'}`);
    console.log(`Milvus: ${process.env.MILVUS_ADDRESS || 'localhost:19530'}`);
    console.log('');
  }

  try {
    if (options.quick) {
      const quickResults = await runQuickValidation();
      results.push(...quickResults);
    } else {
      // Full validation
      const runAll = !options.postgresOnly && !options.redisOnly && !options.milvusOnly;

      if (runAll || options.postgresOnly) {
        if (!options.json) console.log('Running PostgreSQL validation...');
        results.push(await runPostgresValidation());
      }

      if (runAll || options.redisOnly) {
        if (!options.json) console.log('Running Redis validation...');
        results.push(await runRedisValidation());
      }

      if (runAll || options.milvusOnly) {
        if (!options.json) console.log('Running Milvus validation...');
        results.push(await runMilvusValidation());
      }
    }

    if (options.json) {
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        results,
        summary: {
          totalPassed: results.reduce((sum, r) => sum + r.passed, 0),
          totalFailed: results.reduce((sum, r) => sum + r.failed, 0),
          totalSkipped: results.reduce((sum, r) => sum + r.skipped, 0),
          totalDuration: results.reduce((sum, r) => sum + r.duration, 0),
        },
      }, null, 2));
    } else {
      printResults(results);
    }

    // Set exit code based on results
    const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);
    if (totalFailed > 0) {
      process.exitCode = 1;
    }

  } catch (error) {
    console.error('Fatal error during validation:', error);
    process.exitCode = 1;
  }
}

// Run if executed directly
main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});

export { main as runDataLayerValidation };
