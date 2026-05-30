/**
 * MCPToolIndexingService — deepened schema test (2026-05-11).
 *
 * The current mcp_tools collection has 7 fields (id, tool_name,
 * tool_description, tool_schema, server_id, tags, embedding). Live
 * capture proved this is too shallow — model called azure_list_subscriptions
 * 5× because tool_search returned just name+description+schema with no
 * usage examples / no when-to-use / no aliases.
 *
 * This test pins the deeper schema (11 new fields) and the merged-overlay
 * upsert payload contract.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPToolIndexingService } from '../MCPToolIndexingService.js';
import pino from 'pino';

const silentLogger = pino({ level: 'silent' }) as any;

function makeFakeMilvus() {
  const createCollectionCalls: any[] = [];
  return {
    createCollectionCalls,
    getCollectionStatistics: vi.fn(async () => ({
      stats: [{ key: 'row_count', value: '0' }],
      data: { row_count: '0' },
    })),
    hasCollection: vi.fn(async () => ({ value: false })),
    describeCollection: vi.fn(async () => ({ schema: { fields: [{ name: 'embedding', dim: 768 }] } })),
    query: vi.fn(async () => ({ data: [] })),
    insert: vi.fn(async () => ({ insert_cnt: 0 })),
    flush: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    deleteEntities: vi.fn(async () => ({})),
    createCollection: vi.fn(async (args: any) => {
      createCollectionCalls.push(args);
      return {};
    }),
    createIndex: vi.fn(async () => ({})),
    loadCollection: vi.fn(async () => ({})),
    dropCollection: vi.fn(async () => ({})),
  };
}

function makeFakePrisma() {
  const upserts: any[] = [];
  return {
    upserts,
    $queryRawUnsafe: vi.fn(async () => [{ cnt: 0 }]),
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

function makeFakeEmbeddingService() {
  return {
    generateEmbedding: vi.fn(async () => ({ embedding: new Array(768).fill(0.1) })),
    generateBatchEmbeddings: vi.fn(async (texts: string[]) => ({
      embeddings: texts.map(() => new Array(768).fill(0.1)),
      dimensions: 768,
      provider: 'fake',
      model: 'fake',
    })),
    getInfo: vi.fn(() => ({ provider: 'fake', model: 'fake', dimensions: 768 })),
  };
}

describe('MCPToolIndexingService — deepened schema (2026-05-11)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('ensureMilvusCollectionWithDimension creates a collection with the 11 NEW deepened fields', async () => {
    const milvus = makeFakeMilvus();
    const svc = new MCPToolIndexingService(silentLogger, milvus, undefined);

    // Force inject an embedding service so the schema includes embedding dim.
    (svc as any).embeddingService = makeFakeEmbeddingService();
    (svc as any).embeddingEnabled = true;

    await (svc as any).ensureMilvusCollectionWithDimension('mcp_tools', 768);

    expect(milvus.createCollectionCalls.length).toBe(1);
    const call = milvus.createCollectionCalls[0];
    const fieldNames = call.fields.map((f: any) => f.name);

    // 7 original fields preserved
    expect(fieldNames).toContain('id');
    expect(fieldNames).toContain('tool_name');
    expect(fieldNames).toContain('tool_description');
    expect(fieldNames).toContain('tool_schema');
    expect(fieldNames).toContain('server_id');
    expect(fieldNames).toContain('tags');
    expect(fieldNames).toContain('embedding');

    // 11 NEW deepened fields
    const expectedNew = [
      'usage_examples',
      'when_to_use',
      'when_NOT_to_use',
      'aliases',
      'output_shape',
      'cost_class',
      'requires_capabilities',
      'cloud_provider',
      'service',
      'verb',
      'related_tools',
    ];
    for (const f of expectedNew) {
      expect(fieldNames, `Missing field '${f}' in deepened mcp_tools schema`).toContain(f);
    }
  });

  it('indexToolsInPostgres upserts the deepened metadata fields for hand-curated tools', async () => {
    const milvus = makeFakeMilvus();
    const prisma = makeFakePrisma();
    const svc = new MCPToolIndexingService(silentLogger, milvus, undefined, prisma as any);
    (svc as any).embeddingService = makeFakeEmbeddingService();
    (svc as any).embeddingEnabled = true;

    const tools = [
      {
        type: 'function',
        function: {
          name: 'azure_list_subscriptions',
          description: 'List Azure subscriptions visible to the caller.',
          parameters: {},
        },
        serverId: 'oap-azure-mcp',
      },
    ];

    await (svc as any).indexToolsInPostgres(tools);

    expect(prisma.upserts.length).toBe(1);
    const md = prisma.upserts[0].create.metadata;
    // Hand-curated overlay must shine through.
    expect(md.aliases).toContain('subs');
    expect(md.aliases).toContain('subscriptions');
    expect(md.when_to_use).toContain('Azure subscriptions');
    expect(md.cost_class).toBe('read');
    expect(md.cloud_provider).toBe('azure');
    expect(md.verb).toBe('list');
    expect(Array.isArray(md.usage_examples)).toBe(true);
    expect(md.usage_examples.length).toBeGreaterThanOrEqual(2);
    expect(md.output_shape).toContain('subscriptionId');
  });

  it('indexToolsInPostgres applies inference for tools NOT in the overlay', async () => {
    const milvus = makeFakeMilvus();
    const prisma = makeFakePrisma();
    const svc = new MCPToolIndexingService(silentLogger, milvus, undefined, prisma as any);
    (svc as any).embeddingService = makeFakeEmbeddingService();
    (svc as any).embeddingEnabled = true;

    const tools = [
      {
        type: 'function',
        function: {
          name: 'aws_terminate_instance',
          description: 'Terminate an EC2 instance.',
          parameters: {},
        },
        serverId: 'oap-aws-mcp',
      },
    ];

    await (svc as any).indexToolsInPostgres(tools);

    expect(prisma.upserts.length).toBe(1);
    const md = prisma.upserts[0].create.metadata;
    // Inferred: destructive verb → cost_class=destructive.
    expect(md.cost_class).toBe('destructive');
    expect(md.cloud_provider).toBe('aws');
    expect(md.verb).toBe('terminate');
    // No hand-curated row → curated fields stay empty.
    expect(md.when_to_use).toBe('');
    expect(md.usage_examples).toEqual([]);
  });
});
