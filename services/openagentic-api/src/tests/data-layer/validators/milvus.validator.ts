/**
 * Milvus Standalone Validator
 *
 * Run this to validate Milvus is working correctly.
 * Does not depend on any test framework.
 */

import { MilvusClient, DataType } from '@zilliz/milvus2-sdk-node';
import type { TestResult, TestSuiteResult } from '../setup.js';
import { runTest, generateTestVector, TEST_CONFIG } from '../setup.js';

const TEST_COLLECTION = 'validation_test_' + Date.now();

/**
 * Run full Milvus validation
 */
export async function runMilvusValidation(): Promise<TestSuiteResult> {
  const tests: TestResult[] = [];
  const start = Date.now();
  let milvus: MilvusClient | null = null;

  try {
    milvus = new MilvusClient({
      address: TEST_CONFIG.MILVUS_ADDRESS,
      token: TEST_CONFIG.MILVUS_TOKEN,
      timeout: TEST_CONFIG.CONNECTION_TIMEOUT,
    });

    // Test 1: Basic connectivity
    tests.push(await runTest('Connect to Milvus', async () => {
      const health = await milvus!.checkHealth();
      if (!health.isHealthy) {
        throw new Error('Milvus is not healthy');
      }
      return { healthy: health.isHealthy };
    }));

    // Test 2: Get server version
    tests.push(await runTest('Get Milvus version', async () => {
      const version = await milvus!.getVersion();
      return { version: version.version };
    }));

    // Test 3: List collections
    tests.push(await runTest('List collections', async () => {
      const result = await milvus!.listCollections();
      const collections = result.data.map((c: any) => c.name);
      return {
        count: collections.length,
        collections: collections.slice(0, 10), // First 10 for brevity
      };
    }));

    // Test 4: Create test collection
    tests.push(await runTest('Create collection', async () => {
      const result = await milvus!.createCollection({
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
            dim: 128,
          },
        ],
      });

      if (result.error_code !== 'Success') {
        throw new Error(`Create failed: ${result.reason}`);
      }
      return { collection: TEST_COLLECTION, created: true };
    }));

    // Test 5: Create HNSW index
    tests.push(await runTest('Create HNSW index', async () => {
      const result = await milvus!.createIndex({
        collection_name: TEST_COLLECTION,
        field_name: 'embedding',
        index_type: 'HNSW',
        metric_type: 'COSINE',
        params: { M: 16, efConstruction: 64 },
      });

      if (result.error_code !== 'Success') {
        throw new Error(`Index creation failed: ${result.reason}`);
      }
      return { indexType: 'HNSW', metricType: 'COSINE' };
    }));

    // Test 6: Load collection
    tests.push(await runTest('Load collection', async () => {
      const result = await milvus!.loadCollection({
        collection_name: TEST_COLLECTION,
      });

      if (result.error_code !== 'Success') {
        throw new Error(`Load failed: ${result.reason}`);
      }
      return { loaded: true };
    }));

    // Test 7: Insert vectors
    tests.push(await runTest('Insert vectors', async () => {
      const vectors = [];
      for (let i = 0; i < 10; i++) {
        vectors.push({
          id: `test-${i}`,
          text: `Test document ${i}`,
          embedding: generateTestVector(i).slice(0, 128),
        });
      }

      const result = await milvus!.insert({
        collection_name: TEST_COLLECTION,
        data: vectors,
      });

      if (result.status.error_code !== 'Success') {
        throw new Error(`Insert failed: ${result.status.reason}`);
      }
      return { inserted: parseInt(result.insert_cnt) };
    }));

    // Test 8: Flush collection
    tests.push(await runTest('Flush collection', async () => {
      const result = await milvus!.flushSync({
        collection_names: [TEST_COLLECTION],
      });

      if (result.status.error_code !== 'Success') {
        throw new Error(`Flush failed: ${result.status.reason}`);
      }
      return { flushed: true };
    }));

    // Test 9: Vector search
    tests.push(await runTest('Vector search', async () => {
      const queryVector = generateTestVector(5).slice(0, 128);

      const result = await milvus!.search({
        collection_name: TEST_COLLECTION,
        vector: queryVector,
        limit: 5,
        output_fields: ['id', 'text'],
      });

      if (result.status.error_code !== 'Success') {
        throw new Error(`Search failed: ${result.status.reason}`);
      }

      if (result.results.length === 0) {
        throw new Error('No search results returned');
      }

      // First result should be test-5 (exact match)
      const topResult = result.results[0];
      if (topResult.id !== 'test-5') {
        throw new Error(`Expected top result 'test-5', got '${topResult.id}'`);
      }

      return {
        topResult: topResult.id,
        topScore: topResult.score?.toFixed(4),
        totalResults: result.results.length,
      };
    }));

    // Test 10: Search with filter
    tests.push(await runTest('Search with filter', async () => {
      const queryVector = generateTestVector(0).slice(0, 128);

      const result = await milvus!.search({
        collection_name: TEST_COLLECTION,
        vector: queryVector,
        limit: 5,
        filter: 'id like "test-0%" or id like "test-1%"',
        output_fields: ['id'],
      });

      if (result.status.error_code !== 'Success') {
        throw new Error(`Filtered search failed: ${result.status.reason}`);
      }

      const ids = result.results.map((r: any) => r.id);
      const allMatch = ids.every((id: string) =>
        id.startsWith('test-0') || id.startsWith('test-1')
      );

      if (!allMatch) {
        throw new Error(`Filter not applied correctly: ${ids.join(', ')}`);
      }

      return { filteredResults: ids };
    }));

    // Check for production collections (informational)
    tests.push(await runTest('Check existing collections', async () => {
      const result = await milvus!.listCollections();
      const collections = result.data.map((c: any) => c.name);

      const productionCollections = [
        'mcp_tools',
        'knowledge_base',
        'document_chunks',
      ].filter(c => collections.includes(c));

      return {
        productionCollections,
        hasToolsCollection: collections.includes('mcp_tools'),
      };
    }));

  } catch (error) {
    if (tests.length === 0) {
      tests.push({
        name: 'Connect to Milvus',
        passed: false,
        duration: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } finally {
    // Cleanup test collection
    if (milvus) {
      try {
        await milvus.dropCollection({ collection_name: TEST_COLLECTION });
      } catch (e) {
        // Ignore cleanup errors
      }
      await milvus.closeConnection();
    }
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
