/**
 * MCPToolIndexingService — skip-gate self-healing tests
 *
 * Task #530 root cause: the time-based "recently indexed, skip" gate
 * (lines ~137-150 of MCPToolIndexingService) only checks
 * `mcp:tools:last_index_time` against a stale TTL. It does NOT check
 * whether the Milvus `mcp_tools` collection actually has rows.
 *
 * Live failure mode (caught 2026-04-29 21:28 UTC):
 *   - pgvector mcp_tools  rows: 270 (search_embedding populated)
 *   - Milvus  mcp_tools collection: row_count = 0
 *   - Redis    mcp:tools:last_index_time = ~7 minutes ago
 *   - Indexer skips because 7m < 1h staleTtl
 *   - ToolRankerService queries Milvus mcp_tools, gets nothing
 *   - All 270 tools fall through to gpt-oss:20b → ranker is a no-op
 *
 * Existing pgvector empty-check (lines 100-109) handles ONE failure
 * mode (pgvector wiped). This test asserts the symmetric Milvus
 * empty-check: if Milvus mcp_tools row_count == 0, force re-index
 * regardless of how recently last_index_time was set.
 *
 * Why pgvector indexing succeeded but Milvus didn't: indexToolsInMilvus
 * swallows errors (line ~800 "Don't throw") AND the indexer can be
 * partway through a run when interrupted. Either way the time-stamp gets
 * set. The skip gate must be self-healing against this divergence.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPToolIndexingService } from '../MCPToolIndexingService.js';
import pino from 'pino';

// Silence service-internal logging during tests
const silentLogger = pino({ level: 'silent' }) as any;

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

function makeFakeRedis(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
    del: vi.fn(async (key: string) => { store.delete(key); }),
  };
}

function makeMilvusClientWithRowCount(rowCount: number) {
  return {
    getCollectionStatistics: vi.fn(async () => ({
      stats: [{ key: 'row_count', value: String(rowCount) }],
      data: { row_count: String(rowCount) },
    })),
    hasCollection: vi.fn(async () => ({ value: true })),
    // Stubs for the rest of the indexing path. Tests that exercise the
    // skip-gate only verify whether indexAllMCPTools tries to call
    // loadMCPToolsFromProxy → so we just need these to exist.
    describeCollection: vi.fn(async () => ({ schema: { fields: [{ name: 'embedding', dim: 768 }] } })),
    query: vi.fn(async () => ({ data: [] })),
    insert: vi.fn(async () => ({ insert_cnt: 0 })),
    flush: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    deleteEntities: vi.fn(async () => ({})),
    createCollection: vi.fn(async () => ({})),
    createIndex: vi.fn(async () => ({})),
    loadCollection: vi.fn(async () => ({})),
    dropCollection: vi.fn(async () => ({})),
  };
}

function makePrismaWithEmbeddedCount(cnt: number) {
  return {
    $queryRawUnsafe: vi.fn(async () => [{ cnt }]),
    mCPTool: { findMany: vi.fn(async () => []), upsert: vi.fn(async () => ({})) },
    $executeRawUnsafe: vi.fn(async () => 0),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCPToolIndexingService skip-gate self-healing', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.SKIP_MCP_TOOL_REINDEX;
    delete process.env.MCP_INDEX_STALE_TTL_MS;
  });

  it('forces re-index when Milvus mcp_tools collection has 0 rows, even if last_index_time is recent', async () => {
    // Arrange: pgvector populated (so the existing pgvector check passes),
    // last_index_time is recent (well within stale TTL), but Milvus is empty.
    const recentTimestamp = (Date.now() - 60_000).toString(); // 1 minute ago
    const redis = makeFakeRedis({
      'mcp:tools:last_index_time': recentTimestamp,
      'mcp:tools:last_index_set_hash': 'whatever-hash',
    });
    const milvus = makeMilvusClientWithRowCount(0);
    const prisma = makePrismaWithEmbeddedCount(270); // pgvector is fine

    const svc = new MCPToolIndexingService(silentLogger, milvus, redis, prisma as any);

    // Spy on loadMCPToolsFromProxy. If the skip gate self-heals, this
    // method gets called. If the gate skips, it does NOT get called.
    const loadSpy = vi
      .spyOn(svc as any, 'loadMCPToolsFromProxy')
      .mockResolvedValue([]);

    // Act
    await svc.indexAllMCPTools(false);

    // Assert: skip gate must have queried Milvus stats AND, on seeing
    // row_count=0, must have proceeded to fetch upstream tools.
    expect(milvus.getCollectionStatistics).toHaveBeenCalledWith({
      collection_name: 'mcp_tools',
    });
    expect(loadSpy).toHaveBeenCalled();
  });

  it('still skips re-index when Milvus has rows AND last_index_time is recent', async () => {
    // Arrange: everything healthy, recent index. Skip gate should fire.
    const recentTimestamp = (Date.now() - 60_000).toString();
    const redis = makeFakeRedis({
      'mcp:tools:last_index_time': recentTimestamp,
      'mcp:tools:last_index_set_hash': 'matching-hash',
    });
    const milvus = makeMilvusClientWithRowCount(270);
    const prisma = makePrismaWithEmbeddedCount(270);

    const svc = new MCPToolIndexingService(silentLogger, milvus, redis, prisma as any);

    // Make the upstream-hash check return the same hash as cached so
    // the upstream-set-hash gate doesn't itself force reindex.
    vi.spyOn(svc as any, 'fetchUpstreamToolSetHash').mockResolvedValue('matching-hash');

    const loadSpy = vi
      .spyOn(svc as any, 'loadMCPToolsFromProxy')
      .mockResolvedValue([]);

    // Act
    await svc.indexAllMCPTools(false);

    // Assert: skip gate fired, no proxy fetch.
    expect(loadSpy).not.toHaveBeenCalled();
  });

  it('treats a Milvus stats query failure as 0 rows (force re-index, fail-safe)', async () => {
    // Arrange: Milvus stats throws — treat as worst-case empty.
    const recentTimestamp = (Date.now() - 60_000).toString();
    const redis = makeFakeRedis({
      'mcp:tools:last_index_time': recentTimestamp,
      'mcp:tools:last_index_set_hash': 'matching-hash',
    });
    const milvus = makeMilvusClientWithRowCount(0);
    milvus.getCollectionStatistics = vi.fn(async () => {
      throw new Error('milvus offline');
    });
    const prisma = makePrismaWithEmbeddedCount(270);

    const svc = new MCPToolIndexingService(silentLogger, milvus, redis, prisma as any);
    vi.spyOn(svc as any, 'fetchUpstreamToolSetHash').mockResolvedValue('matching-hash');

    const loadSpy = vi
      .spyOn(svc as any, 'loadMCPToolsFromProxy')
      .mockResolvedValue([]);

    // Act
    await svc.indexAllMCPTools(false);

    // Assert: must have attempted to load tools (forced re-index path).
    expect(loadSpy).toHaveBeenCalled();
  });
});
