/**
 * MCPToolIndexingService — tool_tags indexing tests (2026-05-11, #766).
 *
 * Validates:
 *   1. ensureToolTagsCollection creates the 6-field schema at the right dim
 *   2. indexToolTags fan-outs (tool, tag) rows from the deepened metadata
 *   3. extractTagRowsFromTool produces the expected categorization +
 *      weighting (primary tags 1.0, aliases/capabilities 0.5)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPToolIndexingService } from '../MCPToolIndexingService.js';
import pino from 'pino';

const silentLogger = pino({ level: 'silent' }) as any;

function makeFakeMilvus() {
  const createCollectionCalls: any[] = [];
  const insertCalls: any[] = [];
  return {
    createCollectionCalls,
    insertCalls,
    hasCollection: vi.fn(async () => ({ value: false })),
    describeCollection: vi.fn(async () => ({ schema: { fields: [] } })),
    query: vi.fn(async () => ({ data: [] })),
    insert: vi.fn(async (args: any) => {
      insertCalls.push(args);
      return { insert_cnt: (args.data || []).length };
    }),
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

describe('MCPToolIndexingService — tool_tags collection (#766, 2026-05-11)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('ensureToolTagsCollection creates the 6-field tool_tags schema', async () => {
    const milvus = makeFakeMilvus();
    const svc = new MCPToolIndexingService(silentLogger, milvus);
    (svc as any).embeddingService = makeFakeEmbeddingService();
    (svc as any).embeddingEnabled = true;

    await (svc as any).ensureToolTagsCollection(768);

    expect(milvus.createCollectionCalls.length).toBe(1);
    const call = milvus.createCollectionCalls[0];
    expect(call.collection_name).toBe('tool_tags');
    const fieldNames = call.fields.map((f: any) => f.name);
    for (const f of ['id', 'tool_id', 'tag_name', 'tag_category', 'weight', 'tag_embedding']) {
      expect(fieldNames).toContain(f);
    }
    // PK is composite id
    const idField = call.fields.find((f: any) => f.name === 'id');
    expect(idField.is_primary_key).toBe(true);
    // Vector dim must propagate
    const vecField = call.fields.find((f: any) => f.name === 'tag_embedding');
    expect(vecField.dim).toBe(768);
  });

  it('extractTagRowsFromTool produces the canonical (category, name, weight) rows for azure_list_subscriptions', () => {
    const milvus = makeFakeMilvus();
    const svc = new MCPToolIndexingService(silentLogger, milvus);

    // Use the real merged-overlay output for azure_list_subscriptions
    // by feeding a minimal MergedToolMetadata. Mirror what
    // mergeOverlayWithInference returns for the hand-curated entry.
    const merged = {
      when_to_use: '',
      when_NOT_to_use: '',
      usage_examples: [],
      aliases: 'subs, subscriptions, azure subs',
      output_shape: '',
      cost_class: 'read' as const,
      requires_capabilities: 'azure',
      cloud_provider: 'azure',
      service: 'arm',
      verb: 'list',
      related_tools: '',
    };

    const rows = (svc as any).extractTagRowsFromTool(
      'azure_list_subscriptions',
      'oap-azure-mcp',
      merged,
    );

    // Build a quick (category, name) → weight lookup.
    const lookup = new Map<string, number>();
    for (const r of rows) {
      lookup.set(`${r.tag_category}::${r.tag_name}`, r.weight);
    }

    // Primary tags (weight 1.0)
    expect(lookup.get('cloud_provider::azure')).toBe(1.0);
    expect(lookup.get('verb::list')).toBe(1.0);
    expect(lookup.get('service::arm')).toBe(1.0);
    expect(lookup.get('cost_class::read')).toBe(1.0);

    // Capability (weight 0.5)
    expect(lookup.get('capability::azure')).toBe(0.5);

    // Aliases (weight 0.5)
    expect(lookup.get('resource_type::subs')).toBe(0.5);
    expect(lookup.get('resource_type::subscriptions')).toBe(0.5);
    expect(lookup.get('resource_type::azure subs')).toBe(0.5);

    // FK to mcp_tools.id
    expect(rows.every((r: any) => r.tool_id === 'oap-azure-mcp_azure_list_subscriptions')).toBe(true);
  });

  it('indexToolTags batches tag rows into Milvus and uses composite PK id', async () => {
    const milvus = makeFakeMilvus();
    const svc = new MCPToolIndexingService(silentLogger, milvus);
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

    await svc.indexToolTags(tools);

    expect(milvus.insertCalls.length).toBe(1);
    const insertedData = milvus.insertCalls[0].data;
    expect(milvus.insertCalls[0].collection_name).toBe('tool_tags');

    // Every row id must be `<tool_id>::<tag_name>` shape.
    for (const row of insertedData) {
      expect(row.id.includes('::')).toBe(true);
      expect(row.id.startsWith(row.tool_id + '::')).toBe(true);
      expect(row.id.endsWith(row.tag_name)).toBe(true);
      expect(typeof row.weight).toBe('number');
      expect(typeof row.tag_category).toBe('string');
    }

    // Each tool contributes at least 4 primary tags (cloud_provider, verb,
    // service, cost_class) when inference produces them. azure_list_subs:
    // service='arm' inferred; aws_terminate: cost_class='destructive' inferred.
    const azureRows = insertedData.filter((r: any) =>
      r.tool_id === 'oap-azure-mcp_azure_list_subscriptions',
    );
    expect(azureRows.length).toBeGreaterThanOrEqual(4);

    const awsRows = insertedData.filter((r: any) =>
      r.tool_id === 'oap-aws-mcp_aws_terminate_instance',
    );
    expect(awsRows.length).toBeGreaterThanOrEqual(3);
    const awsCostClassRow = awsRows.find((r: any) => r.tag_category === 'cost_class');
    expect(awsCostClassRow?.tag_name).toBe('destructive');
  });
});
