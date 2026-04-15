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
 * PostgreSQL + pgvector Standalone Validator
 *
 * Run this to validate PostgreSQL and pgvector are working correctly.
 * Does not depend on any test framework.
 */

import { PrismaClient } from '@prisma/client';
import type { TestResult, TestSuiteResult } from '../setup.js';
import { runTest, generateTestVector, cleanup, TEST_CONFIG } from '../setup.js';

/**
 * Run full PostgreSQL validation
 */
export async function runPostgresValidation(): Promise<TestSuiteResult> {
  const tests: TestResult[] = [];
  const start = Date.now();
  let prisma: PrismaClient | null = null;

  try {
    // FIXME(#37): cannot use shared singleton — this validator points at a
    // dedicated TEST_CONFIG.DATABASE_URL and uses a per-instance datasource
    // override. The singleton always reads process.env.DATABASE_URL.
    prisma = new PrismaClient({
      datasources: {
        db: { url: TEST_CONFIG.DATABASE_URL }
      },
      log: ['error'],
    });

    // Test 1: Basic connectivity
    tests.push(await runTest('Connect to PostgreSQL', async () => {
      const result = await prisma!.$queryRaw<[{ now: Date }]>`SELECT NOW() as now`;
      return { connected: true, serverTime: result[0].now.toISOString() };
    }));

    // Test 2: Verify database name
    tests.push(await runTest('Verify database name', async () => {
      const result = await prisma!.$queryRaw<[{ current_database: string }]>`
        SELECT current_database()
      `;
      const dbName = result[0].current_database;
      if (dbName !== 'openagentic') {
        throw new Error(`Expected 'openagentic', got '${dbName}'`);
      }
      return { database: dbName };
    }));

    // Test 3: Check pgvector extension
    tests.push(await runTest('pgvector extension installed', async () => {
      const result = await prisma!.$queryRaw<[{ extversion: string }] | []>`
        SELECT extversion FROM pg_extension WHERE extname = 'vector'
      `;
      if (!result.length) {
        throw new Error('pgvector extension not found - run: CREATE EXTENSION vector;');
      }
      return { version: result[0].extversion };
    }));

    // Test 4: Check admin schema exists
    tests.push(await runTest('Admin schema exists', async () => {
      const result = await prisma!.$queryRaw<[{ exists: boolean }]>`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.schemata WHERE schema_name = 'admin'
        ) as exists
      `;
      if (!result[0].exists) {
        throw new Error('admin schema not found');
      }
      return { exists: true };
    }));

    // Test 5: Vector operations work
    tests.push(await runTest('Vector operations work', async () => {
      // Create temp table
      await prisma!.$executeRaw`
        CREATE TEMP TABLE IF NOT EXISTS validation_vector_test (
          id SERIAL PRIMARY KEY,
          embedding vector(3)
        )
      `;

      // Insert test vector
      await prisma!.$executeRaw`
        INSERT INTO validation_vector_test (embedding) VALUES ('[1,2,3]')
      `;

      // Test cosine distance
      const result = await prisma!.$queryRaw<[{ distance: number }]>`
        SELECT embedding <=> '[1,2,3]'::vector as distance
        FROM validation_vector_test LIMIT 1
      `;

      // Cleanup
      await prisma!.$executeRaw`DROP TABLE IF EXISTS validation_vector_test`;

      return { cosineDistance: result[0].distance, success: true };
    }));

    // Test 6: HNSW index support
    tests.push(await runTest('HNSW index support', async () => {
      await prisma!.$executeRaw`
        CREATE TEMP TABLE IF NOT EXISTS validation_hnsw_test (
          id SERIAL PRIMARY KEY,
          embedding vector(64)
        )
      `;

      await prisma!.$executeRaw`
        CREATE INDEX IF NOT EXISTS validation_hnsw_idx
        ON validation_hnsw_test
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
      `;

      // Verify index exists
      const result = await prisma!.$queryRaw<[{ indexname: string }] | []>`
        SELECT indexname FROM pg_indexes WHERE indexname = 'validation_hnsw_idx'
      `;

      await prisma!.$executeRaw`DROP TABLE IF EXISTS validation_hnsw_test`;

      if (!result.length) {
        throw new Error('HNSW index creation failed');
      }
      return { indexType: 'HNSW', created: true };
    }));

    // Test 7: 1536-dimension vectors (OpenAI size)
    tests.push(await runTest('1536-dim vectors (OpenAI size)', async () => {
      const testVector = generateTestVector(42);

      await prisma!.$executeRaw`
        CREATE TEMP TABLE IF NOT EXISTS validation_1536_test (
          id SERIAL PRIMARY KEY,
          embedding vector(1536)
        )
      `;

      const vectorStr = `[${testVector.join(',')}]`;
      await prisma!.$executeRaw`
        INSERT INTO validation_1536_test (embedding)
        VALUES (${vectorStr}::vector)
      `;

      const result = await prisma!.$queryRaw<[{ dim: number }]>`
        SELECT vector_dims(embedding) as dim FROM validation_1536_test LIMIT 1
      `;

      await prisma!.$executeRaw`DROP TABLE IF EXISTS validation_1536_test`;

      if (result[0].dim !== 1536) {
        throw new Error(`Expected 1536 dims, got ${result[0].dim}`);
      }
      return { dimensions: result[0].dim };
    }));

    // Test 8: Core tables exist
    tests.push(await runTest('Core tables exist', async () => {
      const users = await prisma!.user.count();
      const sessions = await prisma!.chatSession.count();
      const tools = await prisma!.mCPTool.count();
      const prompts = await prisma!.promptTemplate.count();
      const providers = await prisma!.lLMProvider.count();
      return { users, sessions, tools, prompts, providers };
    }));

    // Test 9: Vector similarity search performance
    tests.push(await runTest('Vector similarity search (<1s)', async () => {
      await prisma!.$executeRaw`
        CREATE TEMP TABLE IF NOT EXISTS validation_perf_test (
          id SERIAL PRIMARY KEY,
          embedding vector(128)
        )
      `;

      // Insert 50 test vectors
      for (let i = 0; i < 50; i++) {
        const vector = generateTestVector(i).slice(0, 128);
        const vectorStr = `[${vector.join(',')}]`;
        await prisma!.$executeRaw`
          INSERT INTO validation_perf_test (embedding)
          VALUES (${vectorStr}::vector)
        `;
      }

      // Perform search
      const queryVector = generateTestVector(25).slice(0, 128);
      const queryStr = `[${queryVector.join(',')}]`;

      const startSearch = Date.now();
      const result = await prisma!.$queryRaw<{ id: number; similarity: number }[]>`
        SELECT id, 1 - (embedding <=> ${queryStr}::vector) as similarity
        FROM validation_perf_test
        ORDER BY embedding <=> ${queryStr}::vector
        LIMIT 5
      `;
      const searchDuration = Date.now() - startSearch;

      await prisma!.$executeRaw`DROP TABLE IF EXISTS validation_perf_test`;

      if (searchDuration > 1000) {
        throw new Error(`Search took ${searchDuration}ms, expected <1000ms`);
      }

      return {
        searchDurationMs: searchDuration,
        topResults: result.length,
        topSimilarity: result[0]?.similarity?.toFixed(4),
      };
    }));

    // Test 10: Check new data layer tables exist
    tests.push(await runTest('New data layer tables', async () => {
      const tables = ['query_embedding_cache', 'verified_tool_results', 'knowledge_facts', 'schema_versions'];
      const existing: string[] = [];
      const missing: string[] = [];

      for (const table of tables) {
        const schema = table === 'schema_versions' ? 'admin' : 'public';
        const result = await prisma!.$queryRaw<[{ exists: boolean }]>`
          SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_name = ${table}
            AND table_schema = ${schema}
          ) as exists
        `;
        if (result[0].exists) {
          existing.push(table);
        } else {
          missing.push(table);
        }
      }

      // Don't fail - these tables may not exist yet until migration runs
      return {
        existing,
        missing,
        message: missing.length > 0
          ? `Tables ${missing.join(', ')} need to be created via prisma db push`
          : 'All new data layer tables exist'
      };
    }));

    // Test 11: Check btree_gin extension (for composite indexes)
    tests.push(await runTest('btree_gin extension', async () => {
      const result = await prisma!.$queryRaw<[{ extversion: string }] | []>`
        SELECT extversion FROM pg_extension WHERE extname = 'btree_gin'
      `;
      if (!result.length) {
        // Just warn, don't fail
        return { installed: false, message: 'btree_gin not installed - run: CREATE EXTENSION btree_gin;' };
      }
      return { installed: true, version: result[0].extversion };
    }));

    // Test 12: Check pg_trgm extension (for fuzzy text search)
    tests.push(await runTest('pg_trgm extension', async () => {
      const result = await prisma!.$queryRaw<[{ extversion: string }] | []>`
        SELECT extversion FROM pg_extension WHERE extname = 'pg_trgm'
      `;
      if (!result.length) {
        throw new Error('pg_trgm extension not found - run: CREATE EXTENSION pg_trgm;');
      }
      return { version: result[0].extversion };
    }));

  } catch (error) {
    // If we can't even connect, record that
    if (tests.length === 0) {
      tests.push({
        name: 'Connect to PostgreSQL',
        passed: false,
        duration: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } finally {
    if (prisma) {
      await prisma.$disconnect();
    }
  }

  const passed = tests.filter(t => t.passed).length;
  const failed = tests.filter(t => !t.passed).length;

  return {
    suite: 'PostgreSQL + pgvector',
    passed,
    failed,
    skipped: 0,
    duration: Date.now() - start,
    tests,
  };
}
