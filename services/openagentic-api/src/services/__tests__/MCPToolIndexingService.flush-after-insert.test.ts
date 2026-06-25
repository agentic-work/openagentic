/**
 * MCPToolIndexingService — flush-after-insert tests
 *
 * Task #530b root cause (caught live 2026-04-29 21:40 UTC, follow-up to skip-gate fix):
 *   - indexToolsInMilvus → clearAndInsertMilvusData calls client.insert(...)
 *     but NEVER calls client.flush(). Milvus gRPC mode does not auto-flush;
 *     rows stay in the segment buffer and are invisible to subsequent
 *     getCollectionStatistics({collection_name:'mcp_tools'}) calls.
 *   - Live evidence: pgvector mcp_tools.search_embedding populated for 270
 *     rows, but Milvus row_count = 0. ToolRankerService queries Milvus,
 *     gets nothing, all 270 tools fall through unranked.
 *   - The sibling ToolSemanticCacheService.indexBatchInMilvus DOES flush
 *     after insert (ToolSemanticCacheService.ts:776-779) — that path
 *     is healthy at 270 rows. Mirror its pattern here.
 *
 * Fix: add `await this.milvusClient.flush({ collection_names: ['mcp_tools'] })`
 * immediately after the insert in clearAndInsertMilvusData. Wrap in
 * try/catch — flush failure must warn, not throw, since pgvector is the
 * source of truth and Milvus is the resilience replica.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPToolIndexingService } from '../MCPToolIndexingService.js';
import pino from 'pino';

const silentLogger = pino({ level: 'silent' }) as any;

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

function makeMilvusClientCapturingCalls() {
  const calls: { name: string; args: any }[] = [];
  const record = (name: string) => async (args: any) => {
    calls.push({ name, args });
    if (name === 'hasCollection') return { value: true };
    if (name === 'describeCollection') {
      return { schema: { fields: [{ name: 'embedding', dim: 768 }] } };
    }
    if (name === 'query') return { data: [] };
    if (name === 'insert') return { insert_cnt: 2, status: { error_code: 'Success' } };
    if (name === 'flush') return { status: { error_code: 'Success' } };
    return {};
  };
  return {
    calls,
    hasCollection: vi.fn(record('hasCollection')),
    describeCollection: vi.fn(record('describeCollection')),
    query: vi.fn(record('query')),
    insert: vi.fn(record('insert')),
    flush: vi.fn(record('flush')),
    delete: vi.fn(record('delete')),
    deleteEntities: vi.fn(record('deleteEntities')),
    createCollection: vi.fn(record('createCollection')),
    createIndex: vi.fn(record('createIndex')),
    loadCollection: vi.fn(record('loadCollection')),
    dropCollection: vi.fn(record('dropCollection')),
    getCollectionStatistics: vi.fn(async () => ({ data: { row_count: '0' } })),
  };
}

function makeFakeEmbeddingService() {
  return {
    getInfo: () => ({ provider: 'fake', model: 'fake-em', dimensions: 768 }),
    generateBatchEmbeddings: vi.fn(async (texts: string[]) => ({
      embeddings: texts.map(() => new Array(768).fill(0.1)),
      dimensions: 768,
      provider: 'fake',
      model: 'fake-em',
    })),
    generateEmbedding: vi.fn(async () => ({ embedding: new Array(768).fill(0.1) })),
  };
}

const fakeTools = [
  {
    type: 'function',
    function: { name: 'tool_a', description: 'first tool', parameters: {} },
    serverId: 'srv1',
  },
  {
    type: 'function',
    function: { name: 'tool_b', description: 'second tool', parameters: {} },
    serverId: 'srv1',
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCPToolIndexingService flush-after-insert (Milvus mirror persistence)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls flush({collection_names:["mcp_tools"]}) after insert in indexToolsInMilvus', async () => {
    const milvus = makeMilvusClientCapturingCalls();
    const svc = new MCPToolIndexingService(silentLogger, milvus);

    // Inject a fake embedding service so the path runs.
    (svc as any).embeddingService = makeFakeEmbeddingService();
    (svc as any).embeddingEnabled = true;

    // Act: invoke the private method directly (this is the unit under test).
    await (svc as any).indexToolsInMilvus(fakeTools);

    // Assert: flush was called with the right collection name AFTER insert.
    expect(milvus.flush).toHaveBeenCalledWith({
      collection_names: ['mcp_tools'],
    });

    // Ordering: insert call index < flush call index
    const insertIdx = milvus.calls.findIndex((c) => c.name === 'insert');
    const flushIdx = milvus.calls.findIndex((c) => c.name === 'flush');
    expect(insertIdx).toBeGreaterThanOrEqual(0);
    expect(flushIdx).toBeGreaterThan(insertIdx);
  });

  it('does NOT throw when flush itself fails — pgvector remains source of truth', async () => {
    const milvus = makeMilvusClientCapturingCalls();
    milvus.flush = vi.fn(async () => {
      throw new Error('milvus flush offline');
    });

    const svc = new MCPToolIndexingService(silentLogger, milvus);
    (svc as any).embeddingService = makeFakeEmbeddingService();
    (svc as any).embeddingEnabled = true;

    // Should not throw — indexToolsInMilvus already swallows errors so the
    // outer indexAllMCPTools pipeline keeps running. Specifically: insert
    // succeeded, only flush failed; pgvector path is the SoT and must not
    // be impacted.
    await expect((svc as any).indexToolsInMilvus(fakeTools)).resolves.toBeUndefined();

    expect(milvus.insert).toHaveBeenCalled();
    expect(milvus.flush).toHaveBeenCalled();
  });
});
