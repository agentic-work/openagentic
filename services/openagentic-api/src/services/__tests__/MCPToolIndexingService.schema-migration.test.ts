/**
 * MCPToolIndexingService — schema migration test (2026-05-11).
 *
 * On boot the ensureMilvusCollectionWithDimension must:
 *   - Detect when an EXISTING mcp_tools collection lacks one or more of
 *     the 11 deepened fields and drop+recreate it.
 *   - Skip the drop when the existing collection already has all 11 fields
 *     AND the embedding dimension matches.
 *
 * Milvus does NOT support ALTER COLLECTION — drop+recreate is the only
 * migration path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPToolIndexingService } from '../MCPToolIndexingService.js';
import pino from 'pino';

const silentLogger = pino({ level: 'silent' }) as any;

const ALL_DEEP_FIELDS = [
  'id', 'tool_name', 'tool_description', 'tool_schema',
  'server_id', 'tags',
  'usage_examples', 'when_to_use', 'when_NOT_to_use',
  'aliases', 'output_shape', 'cost_class',
  'requires_capabilities', 'cloud_provider', 'service',
  'verb', 'related_tools',
  'embedding',
];

function makeMilvusWithExistingSchema(existingFieldNames: string[], embedDim: number) {
  const dropCalls: any[] = [];
  const createCalls: any[] = [];
  return {
    dropCalls,
    createCalls,
    hasCollection: vi.fn(async () => ({ value: true })),
    describeCollection: vi.fn(async () => ({
      schema: {
        fields: existingFieldNames.map((n) =>
          n === 'embedding' ? { name: 'embedding', dim: embedDim } : { name: n },
        ),
      },
    })),
    dropCollection: vi.fn(async (a: any) => { dropCalls.push(a); return {}; }),
    createCollection: vi.fn(async (a: any) => { createCalls.push(a); return {}; }),
    createIndex: vi.fn(async () => ({})),
    loadCollection: vi.fn(async () => ({})),
  };
}

describe('MCPToolIndexingService — schema migration (2026-05-11)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('drops + recreates when existing collection lacks deepened fields', async () => {
    // Old schema = pre-2026-05-11 (7 fields only).
    const oldFields = [
      'id', 'tool_name', 'tool_description', 'tool_schema',
      'server_id', 'tags', 'embedding',
    ];
    const milvus = makeMilvusWithExistingSchema(oldFields, 768);
    const svc = new MCPToolIndexingService(silentLogger, milvus as any, undefined);

    await (svc as any).ensureMilvusCollectionWithDimension('mcp_tools', 768);

    expect(milvus.dropCalls.length).toBe(1);
    expect(milvus.createCalls.length).toBe(1);
  });

  it('does NOT drop when existing collection already has all 11 deepened fields', async () => {
    const milvus = makeMilvusWithExistingSchema(ALL_DEEP_FIELDS, 768);
    const svc = new MCPToolIndexingService(silentLogger, milvus as any, undefined);

    await (svc as any).ensureMilvusCollectionWithDimension('mcp_tools', 768);

    expect(milvus.dropCalls.length).toBe(0);
    expect(milvus.createCalls.length).toBe(0);
  });

  it('drops + recreates when dimension mismatches even if fields are present', async () => {
    // All deep fields present but embedding dim is 1024 — required is 768.
    const milvus = makeMilvusWithExistingSchema(ALL_DEEP_FIELDS, 1024);
    const svc = new MCPToolIndexingService(silentLogger, milvus as any, undefined);

    await (svc as any).ensureMilvusCollectionWithDimension('mcp_tools', 768);

    expect(milvus.dropCalls.length).toBe(1);
    expect(milvus.createCalls.length).toBe(1);
  });

  it('drops + recreates when ANY ONE deepened field is missing', async () => {
    // Missing only `aliases` — must trigger drop.
    const missingAliases = ALL_DEEP_FIELDS.filter((f) => f !== 'aliases');
    const milvus = makeMilvusWithExistingSchema(missingAliases, 768);
    const svc = new MCPToolIndexingService(silentLogger, milvus as any, undefined);

    await (svc as any).ensureMilvusCollectionWithDimension('mcp_tools', 768);

    expect(milvus.dropCalls.length).toBe(1);
    expect(milvus.createCalls.length).toBe(1);
  });
});
