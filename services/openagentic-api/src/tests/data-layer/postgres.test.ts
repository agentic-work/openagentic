/**
 * PostgreSQL + pgvector Validation Tests
 *
 * Tests database connectivity, pgvector extension, and vector operations.
 * Run these after any schema or database configuration changes.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  getPrismaClient,
  cleanup,
  runTest,
  generateTestVector,
  TEST_CONFIG,
  type TestResult,
  type TestSuiteResult,
} from './setup.js';
import { PrismaClient } from '@prisma/client';

let prisma: PrismaClient;

describe('PostgreSQL Data Layer', () => {
  beforeAll(async () => {
    prisma = await getPrismaClient();
  });

  afterAll(async () => {
    await cleanup();
  });

  describe('Connectivity', () => {
    it('should connect to PostgreSQL', async () => {
      const result = await prisma.$queryRaw<[{ now: Date }]>`SELECT NOW() as now`;
      expect(result).toBeDefined();
      expect(result[0].now).toBeInstanceOf(Date);
    });

    it('should have correct database name', async () => {
      const result = await prisma.$queryRaw<[{ current_database: string }]>`
        SELECT current_database()
      `;
      expect(result[0].current_database).toBe('openagentic');
    });

    it('should have admin schema', async () => {
      const result = await prisma.$queryRaw<[{ exists: boolean }]>`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.schemata WHERE schema_name = 'admin'
        ) as exists
      `;
      expect(result[0].exists).toBe(true);
    });
  });

  describe('pgvector Extension', () => {
    it('should have pgvector extension installed', async () => {
      const result = await prisma.$queryRaw<[{ exists: boolean }]>`
        SELECT EXISTS (
          SELECT 1 FROM pg_extension WHERE extname = 'vector'
        ) as exists
      `;
      expect(result[0].exists).toBe(true);
    });

    it('should have correct pgvector version (>= 0.5.0)', async () => {
      const result = await prisma.$queryRaw<[{ extversion: string }]>`
        SELECT extversion FROM pg_extension WHERE extname = 'vector'
      `;
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);

      const version = result[0].extversion;
      const [major, minor] = version.split('.').map(Number);
      expect(major * 10 + minor).toBeGreaterThanOrEqual(5); // 0.5.0 or higher
    });

    it('should support vector type', async () => {
      // Create a temporary table with vector column
      await prisma.$executeRaw`
        CREATE TEMP TABLE IF NOT EXISTS test_vector_support (
          id SERIAL PRIMARY KEY,
          embedding vector(3)
        )
      `;

      // Insert a test vector
      await prisma.$executeRaw`
        INSERT INTO test_vector_support (embedding) VALUES ('[1,2,3]')
      `;

      // Query the vector
      const result = await prisma.$queryRaw<[{ embedding: string }]>`
        SELECT embedding::text FROM test_vector_support LIMIT 1
      `;
      expect(result[0].embedding).toBe('[1,2,3]');

      // Cleanup
      await prisma.$executeRaw`DROP TABLE IF EXISTS test_vector_support`;
    });

    it('should support cosine distance operator (<=>)', async () => {
      await prisma.$executeRaw`
        CREATE TEMP TABLE IF NOT EXISTS test_cosine_distance (
          id SERIAL PRIMARY KEY,
          embedding vector(3)
        )
      `;

      await prisma.$executeRaw`
        INSERT INTO test_cosine_distance (embedding) VALUES
          ('[1,0,0]'),
          ('[0,1,0]'),
          ('[0.707,0.707,0]')
      `;

      // Find vectors similar to [1,0,0]
      const result = await prisma.$queryRaw<{ id: number; distance: number }[]>`
        SELECT id, embedding <=> '[1,0,0]'::vector as distance
        FROM test_cosine_distance
        ORDER BY distance
        LIMIT 3
      `;

      expect(result.length).toBe(3);
      expect(result[0].distance).toBeCloseTo(0, 5); // Same vector = 0 distance
      expect(result[1].distance).toBeLessThan(result[2].distance); // [0.707,0.707,0] closer than [0,1,0]

      await prisma.$executeRaw`DROP TABLE IF EXISTS test_cosine_distance`;
    });

    it('should support HNSW index creation', async () => {
      await prisma.$executeRaw`
        CREATE TEMP TABLE IF NOT EXISTS test_hnsw_index (
          id SERIAL PRIMARY KEY,
          embedding vector(64)
        )
      `;

      // Create HNSW index
      await prisma.$executeRaw`
        CREATE INDEX IF NOT EXISTS test_hnsw_idx
        ON test_hnsw_index
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
      `;

      // Verify index exists
      const result = await prisma.$queryRaw<[{ exists: boolean }]>`
        SELECT EXISTS (
          SELECT 1 FROM pg_indexes WHERE indexname = 'test_hnsw_idx'
        ) as exists
      `;
      expect(result[0].exists).toBe(true);

      await prisma.$executeRaw`DROP TABLE IF EXISTS test_hnsw_index`;
    });
  });

  describe('Core Tables', () => {
    it('should have users table', async () => {
      const count = await prisma.user.count();
      expect(count).toBeGreaterThanOrEqual(0);
    });

    it('should have chat_sessions table', async () => {
      const count = await prisma.chatSession.count();
      expect(count).toBeGreaterThanOrEqual(0);
    });

    it('should have mcp_tools table', async () => {
      const count = await prisma.mCPTool.count();
      expect(count).toBeGreaterThanOrEqual(0);
    });

    it('should have llm_providers table', async () => {
      const count = await prisma.lLMProvider.count();
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Vector Column Support (Future)', () => {
    // These tests verify the schema is ready for vector columns
    // They will pass even before columns are added

    it('should be able to add vector column to table', async () => {
      // Test that we can add a vector column (uses temp table)
      await prisma.$executeRaw`
        CREATE TEMP TABLE IF NOT EXISTS test_add_vector_column (
          id SERIAL PRIMARY KEY,
          name TEXT
        )
      `;

      await prisma.$executeRaw`
        ALTER TABLE test_add_vector_column
        ADD COLUMN IF NOT EXISTS embedding vector(1536)
      `;

      const result = await prisma.$queryRaw<[{ column_name: string }]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'test_add_vector_column' AND column_name = 'embedding'
      `;
      expect(result.length).toBe(1);

      await prisma.$executeRaw`DROP TABLE IF EXISTS test_add_vector_column`;
    });

    it('should handle 1536-dimension vectors (OpenAI embedding size)', async () => {
      const testVector = generateTestVector(42);
      expect(testVector.length).toBe(1536);

      await prisma.$executeRaw`
        CREATE TEMP TABLE IF NOT EXISTS test_1536_vector (
          id SERIAL PRIMARY KEY,
          embedding vector(1536)
        )
      `;

      // Insert the vector
      const vectorStr = `[${testVector.join(',')}]`;
      await prisma.$executeRaw`
        INSERT INTO test_1536_vector (embedding)
        VALUES (${vectorStr}::vector)
      `;

      // Verify we can query it back
      const result = await prisma.$queryRaw<[{ dim: number }]>`
        SELECT vector_dims(embedding) as dim FROM test_1536_vector LIMIT 1
      `;
      expect(result[0].dim).toBe(1536);

      await prisma.$executeRaw`DROP TABLE IF EXISTS test_1536_vector`;
    });

    it('should perform vector similarity search efficiently', async () => {
      // Create table with 100 test vectors
      await prisma.$executeRaw`
        CREATE TEMP TABLE IF NOT EXISTS test_similarity_search (
          id SERIAL PRIMARY KEY,
          embedding vector(128)
        )
      `;

      // Insert 100 random vectors
      for (let i = 0; i < 100; i++) {
        const vector = generateTestVector(i).slice(0, 128);
        const vectorStr = `[${vector.join(',')}]`;
        await prisma.$executeRaw`
          INSERT INTO test_similarity_search (embedding)
          VALUES (${vectorStr}::vector)
        `;
      }

      // Perform similarity search
      const queryVector = generateTestVector(42).slice(0, 128);
      const queryStr = `[${queryVector.join(',')}]`;

      const start = Date.now();
      const result = await prisma.$queryRaw<{ id: number; similarity: number }[]>`
        SELECT id, 1 - (embedding <=> ${queryStr}::vector) as similarity
        FROM test_similarity_search
        ORDER BY embedding <=> ${queryStr}::vector
        LIMIT 5
      `;
      const duration = Date.now() - start;

      expect(result.length).toBe(5);
      expect(result[0].similarity).toBeCloseTo(1, 3); // Vector 42 should match itself
      expect(duration).toBeLessThan(1000); // Should complete in under 1 second

      await prisma.$executeRaw`DROP TABLE IF EXISTS test_similarity_search`;
    });
  });
});

/**
 * Standalone validation runner (for use outside vitest)
 */
export async function runPostgresValidation(): Promise<TestSuiteResult> {
  const tests: TestResult[] = [];
  const start = Date.now();

  try {
    const prisma = await getPrismaClient();

    // Connectivity tests
    tests.push(await runTest('Connect to PostgreSQL', async () => {
      const result = await prisma.$queryRaw<[{ now: Date }]>`SELECT NOW() as now`;
      return { connected: true, serverTime: result[0].now };
    }));

    tests.push(await runTest('Verify database name', async () => {
      const result = await prisma.$queryRaw<[{ current_database: string }]>`
        SELECT current_database()
      `;
      if (result[0].current_database !== 'openagentic') {
        throw new Error(`Expected 'openagentic', got '${result[0].current_database}'`);
      }
      return { database: result[0].current_database };
    }));

    // pgvector tests
    tests.push(await runTest('pgvector extension installed', async () => {
      const result = await prisma.$queryRaw<[{ extversion: string }]>`
        SELECT extversion FROM pg_extension WHERE extname = 'vector'
      `;
      if (!result.length) throw new Error('pgvector extension not found');
      return { version: result[0].extversion };
    }));

    tests.push(await runTest('Vector operations work', async () => {
      await prisma.$executeRaw`
        CREATE TEMP TABLE IF NOT EXISTS validation_vector_test (
          id SERIAL PRIMARY KEY,
          embedding vector(3)
        )
      `;
      await prisma.$executeRaw`
        INSERT INTO validation_vector_test (embedding) VALUES ('[1,2,3]')
      `;
      const result = await prisma.$queryRaw<[{ distance: number }]>`
        SELECT embedding <=> '[1,2,3]'::vector as distance
        FROM validation_vector_test LIMIT 1
      `;
      await prisma.$executeRaw`DROP TABLE IF EXISTS validation_vector_test`;
      return { cosineDistance: result[0].distance };
    }));

    // Core tables
    tests.push(await runTest('Core tables exist', async () => {
      const users = await prisma.user.count();
      const sessions = await prisma.chatSession.count();
      const tools = await prisma.mCPTool.count();
      return { users, sessions, tools };
    }));

  } finally {
    await cleanup();
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
