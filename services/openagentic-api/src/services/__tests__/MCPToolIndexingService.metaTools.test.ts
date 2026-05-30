/**
 * MCPToolIndexingService — RED test for meta-tool indexing
 * (chatmode-rip Phase C indexer extension).
 *
 * The 7 meta-tools that were removed from the T1 catalog (per
 * toolRegistry.ts header comment) MUST be discoverable via `tool_search`,
 * which queries the Milvus `mcp_tools` collection. Today they aren't
 * indexed — so a model that searches "make a chart" never sees
 * compose_visual in the top results.
 *
 * This test pins:
 *   1. The service exposes `indexBuiltInMetaTools(tools)` that inserts
 *      the meta-tool defs into pgvector + Milvus with `source='builtin'`
 *      and a `tool_*` server prefix so they're distinguishable from
 *      MCP-server-registered tools.
 *   2. `indexAllMCPTools()` calls `indexBuiltInMetaTools()` so the boot
 *      path indexes them automatically.
 *   3. Meta-tools are persisted with the proper shape (name, description,
 *      schema, server_id='builtin').
 *
 * The indexer is idempotent — pgvector uses upsert(server_id, name) so
 * repeated calls don't duplicate rows.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPToolIndexingService } from '../MCPToolIndexingService.js';
import pino from 'pino';

const silentLogger = pino({ level: 'silent' }) as any;

// The 7 meta-tools that should land in the index (per the chatmode-rip
// plan + toolRegistry.ts header). delegate_to_agents was already ripped
// per #412; memory_search and memory_recall both surface the memory
// search lookup.
const EXPECTED_META_TOOL_NAMES = [
  'compose_visual',
  'compose_app',
  'render_artifact',
  'request_clarification',
  'browser_sandbox_exec',
  'memorize',
  'memory_search',
];

function makeFakeMilvus() {
  return {
    getCollectionStatistics: vi.fn(async () => ({
      stats: [{ key: 'row_count', value: '270' }],
      data: { row_count: '270' },
    })),
    hasCollection: vi.fn(async () => ({ value: true })),
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

function makeFakePrisma() {
  const upserts: any[] = [];
  return {
    upserts,
    $queryRawUnsafe: vi.fn(async () => [{ cnt: 270 }]),
    $executeRawUnsafe: vi.fn(async () => 0),
    mCPTool: {
      findMany: vi.fn(async () => []),
      upsert: vi.fn(async (args: any) => {
        upserts.push(args);
        return { id: `tool-${upserts.length}`, ...args.create };
      }),
    },
  };
}

describe('MCPToolIndexingService meta-tool indexing (chatmode-rip Phase C)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes indexBuiltInMetaTools() that upserts the 7 meta-tool defs', async () => {
    const milvus = makeFakeMilvus();
    const prisma = makeFakePrisma();
    const svc = new MCPToolIndexingService(silentLogger, milvus, undefined, prisma as any);

    // The new method MUST exist on the service.
    expect(typeof (svc as any).indexBuiltInMetaTools).toBe('function');
    await (svc as any).indexBuiltInMetaTools();

    const upsertedNames = prisma.upserts.map((u) => u.create.name);
    for (const expectedName of EXPECTED_META_TOOL_NAMES) {
      expect(
        upsertedNames.includes(expectedName),
        `meta-tool '${expectedName}' must be indexed (got: ${upsertedNames.join(', ')})`,
      ).toBe(true);
    }
  });

  it('persists meta-tools with server_id="builtin" so tool_search can rank them alongside MCP tools', async () => {
    const milvus = makeFakeMilvus();
    const prisma = makeFakePrisma();
    const svc = new MCPToolIndexingService(silentLogger, milvus, undefined, prisma as any);

    await (svc as any).indexBuiltInMetaTools();

    expect(prisma.upserts.length).toBeGreaterThan(0);
    for (const u of prisma.upserts) {
      expect(u.create.server_id).toBe('builtin');
      // Each meta-tool must carry a non-empty description so the
      // semantic ranker has something to embed.
      expect(typeof u.create.description).toBe('string');
      expect(u.create.description.length).toBeGreaterThan(0);
      // Where-clause uniqueness key uses (server_id, name) — verifies the
      // upsert is idempotent across boots.
      expect(u.where.server_id_name.server_id).toBe('builtin');
      expect(u.where.server_id_name.name).toBe(u.create.name);
    }
  });

  it('indexBuiltInMetaTools is idempotent — second call uses upsert (no duplicate rows)', async () => {
    const milvus = makeFakeMilvus();
    const prisma = makeFakePrisma();
    const svc = new MCPToolIndexingService(silentLogger, milvus, undefined, prisma as any);

    await (svc as any).indexBuiltInMetaTools();
    const firstCount = prisma.upserts.length;
    await (svc as any).indexBuiltInMetaTools();
    const secondCount = prisma.upserts.length;

    // Both runs hit the upsert path with the SAME unique key (server_id='builtin' + name).
    // Prisma upsert handles the dedup; here we only assert second run still emitted
    // the same logical upserts (not e.g. silently skipped, which would mean a row
    // could end up stale forever).
    expect(secondCount).toBe(firstCount * 2);
    // Idempotency contract: every second-pass upsert reuses the same composite
    // key the first pass used.
    const firstKeys = prisma.upserts
      .slice(0, firstCount)
      .map((u) => `${u.where.server_id_name.server_id}|${u.where.server_id_name.name}`)
      .sort();
    const secondKeys = prisma.upserts
      .slice(firstCount)
      .map((u) => `${u.where.server_id_name.server_id}|${u.where.server_id_name.name}`)
      .sort();
    expect(secondKeys).toEqual(firstKeys);
  });

  it('indexAllMCPTools triggers indexBuiltInMetaTools on the success path', async () => {
    const milvus = makeFakeMilvus();
    const prisma = makeFakePrisma();
    const svc = new MCPToolIndexingService(silentLogger, milvus, undefined, prisma as any);

    // Stub the upstream MCP fetch so we don't actually hit the network.
    vi.spyOn(svc as any, 'loadMCPToolsFromProxy').mockResolvedValue([
      {
        type: 'function',
        function: { name: 'azure_list_subscriptions', description: 'd' },
        serverId: 'azure-mcp',
      },
    ]);

    const metaSpy = vi.spyOn(svc as any, 'indexBuiltInMetaTools');

    await svc.indexAllMCPTools(true /* force re-index */);

    expect(metaSpy).toHaveBeenCalled();
  });
});
