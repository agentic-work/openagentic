/**
 * MCPToolIndexingService — dimension type-coerce regression test
 *
 * LIVE bug caught 2026-04-30 (after #530+#530b):
 *   - `ensureMilvusCollectionWithDimension` checks
 *     `embeddingField.dim === dimension` to decide if the existing
 *     collection's embedding column matches what we want to insert.
 *   - Milvus describeCollection returns `dim` as a STRING ("768"); the
 *     `dimension` parameter is a NUMBER (768). `===` returns false → the
 *     code drops + recreates the collection on every call.
 *   - In live, the indexer ran twice during boot (skip-gate fix re-indexes
 *     when row_count=0). First call created collection + flushed 270 rows.
 *     Second call described the collection, saw `dim:"768" !== 768`,
 *     dropped the collection, recreated it, re-inserted... and a third
 *     race chimed in with the same coerce bug, dropping the just-flushed
 *     270 rows again. End state: collection empty, ToolRanker semantic
 *     stage returned 0 rows for every chat turn.
 *
 * Fix: coerce both sides to Number before comparison. `Number("768") === 768`.
 *
 * Mirror: `ToolSemanticCacheService.ts:220` already does `Number(embeddingField.dim)`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPToolIndexingService } from '../MCPToolIndexingService.js';
import pino from 'pino';

const silentLogger = pino({ level: 'silent' }) as any;

// Full schema (matching deepened 2026-05-11 contract). The dimension-coerce
// test uses this so a dim-match doesn't trigger the schema-deepening
// drop+recreate path (separate test covers schema-fields migration).
const FULL_SCHEMA_FIELD_NAMES = [
  'id', 'tool_name', 'tool_description', 'tool_schema',
  'server_id', 'tags',
  'usage_examples', 'when_to_use', 'when_NOT_to_use',
  'aliases', 'output_shape', 'cost_class',
  'requires_capabilities', 'cloud_provider', 'service',
  'verb', 'related_tools',
];

function makeMilvusClient(opts: { existingDim: number | string }) {
  const calls: { name: string; args: any }[] = [];
  const record = (name: string) => async (args: any) => {
    calls.push({ name, args });
    if (name === 'hasCollection') return { value: true };
    if (name === 'describeCollection') {
      return {
        schema: {
          fields: [
            ...FULL_SCHEMA_FIELD_NAMES.map((n) => ({ name: n, data_type: 'VarChar' })),
            { name: 'embedding', dim: opts.existingDim },
          ],
        },
      };
    }
    if (name === 'createCollection') return {};
    if (name === 'dropCollection') return {};
    if (name === 'createIndex') return {};
    if (name === 'loadCollection') return {};
    if (name === 'flush') return { status: { error_code: 'Success' } };
    return {};
  };
  return {
    calls,
    hasCollection: vi.fn(record('hasCollection')),
    describeCollection: vi.fn(record('describeCollection')),
    dropCollection: vi.fn(record('dropCollection')),
    createCollection: vi.fn(record('createCollection')),
    createIndex: vi.fn(record('createIndex')),
    loadCollection: vi.fn(record('loadCollection')),
    flush: vi.fn(record('flush')),
  };
}

describe('MCPToolIndexingService — dimension type-coerce (LIVE 2026-04-30)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('does NOT drop+recreate when describeCollection returns dim as STRING "768" matching numeric 768', async () => {
    // Live behavior: Milvus returns string "768" for embedding.dim.
    const milvus = makeMilvusClient({ existingDim: '768' });
    const svc = new MCPToolIndexingService(silentLogger, milvus as any);

    // Call the private method via bracket-access. We're testing behavior,
    // not implementation, but we need access to drive the path directly.
    await (svc as any).ensureMilvusCollectionWithDimension('mcp_tools', 768);

    // The collection MUST be left intact when dimensions match
    // (after type coercion).
    expect(milvus.dropCollection).not.toHaveBeenCalled();
    // And we MUST NOT recreate on every restart.
    expect(milvus.createCollection).not.toHaveBeenCalled();
  });

  it('does NOT drop+recreate when describeCollection returns dim as NUMBER 768 matching numeric 768', async () => {
    // Number-vs-number sanity case (had this case been the only one,
    // the bug wouldn't have shipped).
    const milvus = makeMilvusClient({ existingDim: 768 });
    const svc = new MCPToolIndexingService(silentLogger, milvus as any);

    await (svc as any).ensureMilvusCollectionWithDimension('mcp_tools', 768);

    expect(milvus.dropCollection).not.toHaveBeenCalled();
    expect(milvus.createCollection).not.toHaveBeenCalled();
  });

  it('DOES drop+recreate on a real dimension mismatch (string "1536" vs numeric 768)', async () => {
    // Real dimension mismatch (e.g. switching embedding model from
    // OpenAI text-embedding-3-large 1536-d to nomic-embed-text 768-d).
    const milvus = makeMilvusClient({ existingDim: '1536' });
    const svc = new MCPToolIndexingService(silentLogger, milvus as any);

    await (svc as any).ensureMilvusCollectionWithDimension('mcp_tools', 768);

    expect(milvus.dropCollection).toHaveBeenCalledTimes(1);
    expect(milvus.createCollection).toHaveBeenCalledTimes(1);
  });
});
