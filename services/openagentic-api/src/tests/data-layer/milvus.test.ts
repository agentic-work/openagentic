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
 * Milvus Validation Tests
 *
 * Tests Milvus connectivity and vector operations.
 * Run these after any Milvus configuration changes.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  getMilvusClient,
  cleanup,
  runTest,
  generateTestVector,
  TEST_CONFIG,
  type TestResult,
  type TestSuiteResult,
} from './setup.js';
import { MilvusClient, DataType } from '@zilliz/milvus2-sdk-node';

let milvus: MilvusClient;
const TEST_COLLECTION = 'validation_test_collection';

describe('Milvus Data Layer', () => {
  beforeAll(async () => {
    milvus = await getMilvusClient();
  });

  afterAll(async () => {
    // Cleanup test collection
    try {
      await milvus.dropCollection({ collection_name: TEST_COLLECTION });
    } catch (e) {
      // Collection might not exist
    }
    await cleanup();
  });

  describe('Connectivity', () => {
    it('should connect to Milvus', async () => {
      const health = await milvus.checkHealth();
      expect(health.isHealthy).toBe(true);
    });

    it('should get server version', async () => {
      const version = await milvus.getVersion();
      expect(version.version).toBeDefined();
      expect(version.version.length).toBeGreaterThan(0);
    });
  });

  describe('Collection Operations', () => {
    it('should create a collection', async () => {
      // Drop if exists
      try {
        await milvus.dropCollection({ collection_name: TEST_COLLECTION });
      } catch (e) {
        // Ignore
      }

      const result = await milvus.createCollection({
        collection_name: TEST_COLLECTION,
        fields: [
          {
            name: 'id',
            data_type: DataType.VarChar,
            max_length: 36,
            is_primary_key: true,
          },
          {
            name: 'text',
            data_type: DataType.VarChar,
            max_length: 1000,
          },
          {
            name: 'embedding',
            data_type: DataType.FloatVector,
            dim: 128, // Smaller for testing
          },
        ],
      });

      expect(result.error_code).toBe('Success');
    });

    it('should list collections', async () => {
      const result = await milvus.listCollections();
      expect(result.data).toContainEqual(
        expect.objectContaining({ name: TEST_COLLECTION })
      );
    });

    it('should describe collection', async () => {
      const result = await milvus.describeCollection({
        collection_name: TEST_COLLECTION,
      });

      expect(result.schema.name).toBe(TEST_COLLECTION);
      expect(result.schema.fields).toHaveLength(3);
    });
  });

  describe('Index Operations', () => {
    it('should create HNSW index', async () => {
      const result = await milvus.createIndex({
        collection_name: TEST_COLLECTION,
        field_name: 'embedding',
        index_type: 'HNSW',
        metric_type: 'COSINE',
        params: { M: 16, efConstruction: 64 },
      });

      expect(result.error_code).toBe('Success');
    });

    it('should load collection', async () => {
      const result = await milvus.loadCollection({
        collection_name: TEST_COLLECTION,
      });

      expect(result.error_code).toBe('Success');
    });
  });

  describe('Vector Operations', () => {
    it('should insert vectors', async () => {
      const vectors = [];
      for (let i = 0; i < 10; i++) {
        vectors.push({
          id: `test-${i}`,
          text: `Test document ${i}`,
          embedding: generateTestVector(i).slice(0, 128),
        });
      }

      const result = await milvus.insert({
        collection_name: TEST_COLLECTION,
        data: vectors,
      });

      expect(result.status.error_code).toBe('Success');
      expect(result.insert_cnt).toBe('10');
    });

    it('should flush collection', async () => {
      const result = await milvus.flushSync({
        collection_names: [TEST_COLLECTION],
      });

      expect(result.status.error_code).toBe('Success');
    });

    it('should perform vector search', async () => {
      // Search for vector similar to test-5
      const queryVector = generateTestVector(5).slice(0, 128);

      const result = await milvus.search({
        collection_name: TEST_COLLECTION,
        vector: queryVector,
        limit: 5,
        output_fields: ['id', 'text'],
      });

      expect(result.status.error_code).toBe('Success');
      expect(result.results.length).toBe(5);

      // First result should be test-5 (exact match)
      expect(result.results[0].id).toBe('test-5');
      expect(result.results[0].score).toBeCloseTo(1, 2); // Cosine similarity ~1
    });

    it('should search with filter', async () => {
      const queryVector = generateTestVector(0).slice(0, 128);

      const result = await milvus.search({
        collection_name: TEST_COLLECTION,
        vector: queryVector,
        limit: 5,
        filter: 'id like "test-0%" or id like "test-1%"',
        output_fields: ['id', 'text'],
      });

      expect(result.status.error_code).toBe('Success');
      // Should only return test-0 and test-1
      const ids = result.results.map(r => r.id);
      expect(ids.every(id => id.startsWith('test-0') || id.startsWith('test-1'))).toBe(true);
    });
  });

  describe('Existing Collections', () => {
    // These tests check for production collections that should exist

    it('should have mcp_tools collection (if setup)', async () => {
      const result = await milvus.listCollections();
      const collections = result.data.map((c: any) => c.name);

      // Log what collections exist for debugging
      console.log('Existing Milvus collections:', collections);

      // This is informational - may not exist in fresh installs
      if (collections.includes('mcp_tools')) {
        const desc = await milvus.describeCollection({
          collection_name: 'mcp_tools',
        });
        expect(desc.schema.fields.some((f: any) => f.name === 'embedding')).toBe(true);
      }
    });
  });
});

/**
 * Standalone validation runner (for use outside vitest)
 */
export async function runMilvusValidation(): Promise<TestSuiteResult> {
  const tests: TestResult[] = [];
  const start = Date.now();
  const testCollection = 'validation_' + Date.now();

  try {
    const milvus = await getMilvusClient();

    tests.push(await runTest('Connect to Milvus', async () => {
      const health = await milvus.checkHealth();
      if (!health.isHealthy) throw new Error('Milvus unhealthy');
      return { healthy: health.isHealthy };
    }));

    tests.push(await runTest('Get Milvus version', async () => {
      const version = await milvus.getVersion();
      return { version: version.version };
    }));

    tests.push(await runTest('List collections', async () => {
      const result = await milvus.listCollections();
      return { count: result.data.length, collections: result.data.map((c: any) => c.name).slice(0, 10) };
    }));

    tests.push(await runTest('Create test collection', async () => {
      await milvus.createCollection({
        collection_name: testCollection,
        fields: [
          { name: 'id', data_type: DataType.VarChar, max_length: 36, is_primary_key: true },
          { name: 'embedding', data_type: DataType.FloatVector, dim: 128 },
        ],
      });
      return { created: testCollection };
    }));

    tests.push(await runTest('Create HNSW index', async () => {
      await milvus.createIndex({
        collection_name: testCollection,
        field_name: 'embedding',
        index_type: 'HNSW',
        metric_type: 'COSINE',
        params: { M: 16, efConstruction: 64 },
      });
      return { indexType: 'HNSW' };
    }));

    tests.push(await runTest('Insert and search vectors', async () => {
      await milvus.loadCollection({ collection_name: testCollection });

      // Insert test vectors
      const vectors = Array.from({ length: 5 }, (_, i) => ({
        id: `v${i}`,
        embedding: generateTestVector(i).slice(0, 128),
      }));
      await milvus.insert({ collection_name: testCollection, data: vectors });
      await milvus.flushSync({ collection_names: [testCollection] });

      // Search
      const result = await milvus.search({
        collection_name: testCollection,
        vector: generateTestVector(2).slice(0, 128),
        limit: 3,
      });

      if (result.results[0].id !== 'v2') {
        throw new Error(`Expected 'v2' as top result, got '${result.results[0].id}'`);
      }
      return { topResult: result.results[0].id, score: result.results[0].score };
    }));

    // Cleanup test collection
    try {
      await milvus.dropCollection({ collection_name: testCollection });
    } catch (e) {
      // Ignore cleanup errors
    }

  } catch (error) {
    // If Milvus is not available, add a failed connectivity test
    if (tests.length === 0) {
      tests.push({
        name: 'Connect to Milvus',
        passed: false,
        duration: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } finally {
    await cleanup();
  }

  const passed = tests.filter(t => t.passed).length;
  const failed = tests.filter(t => !t.passed).length;

  return {
    suite: 'Milvus',
    passed,
    failed,
    skipped: 0,
    duration: Date.now() - start,
    tests,
  };
}
