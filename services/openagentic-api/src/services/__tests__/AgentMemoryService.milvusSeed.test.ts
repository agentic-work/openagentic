/**
 * Memory.1 — RED test: user_memories Milvus collection boot-seed.
 *
 * Asserts that getUserMemoriesService().ensureCollection() calls
 * milvusClient.createCollection with a schema that includes the required
 * fields (memory_id PK, user_id varchar, key varchar, value varchar,
 * category varchar, value_embedding FloatVector, created_at int64,
 * confidence float) and creates a COSINE/FLAT index on `value_embedding`.
 *
 * RED until UserMemoriesService (or equivalent) is implemented in
 * services/UserMemoriesService.ts and wired into 06-rag.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataType } from '@zilliz/milvus2-sdk-node';

// ── Milvus client mock ──────────────────────────────────────────────────────

const hasCollectionMock = vi.fn();
const createCollectionMock = vi.fn();
const createIndexMock = vi.fn();
const loadCollectionMock = vi.fn();
const insertMock = vi.fn();
const searchMock = vi.fn();

vi.mock('@zilliz/milvus2-sdk-node', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zilliz/milvus2-sdk-node')>();
  return {
    ...actual,
    MilvusClient: vi.fn().mockImplementation(() => ({
      hasCollection: hasCollectionMock,
      createCollection: createCollectionMock,
      createIndex: createIndexMock,
      loadCollection: loadCollectionMock,
      insert: insertMock,
      search: searchMock,
    })),
  };
});

// ── UniversalEmbeddingService mock ──────────────────────────────────────────

const generateEmbeddingMock = vi.fn();
vi.mock('../UniversalEmbeddingService.js', () => ({
  UniversalEmbeddingService: vi.fn().mockImplementation(() => ({
    getInfo: () => ({ dimensions: 768 }),
    generateEmbedding: generateEmbeddingMock,
  })),
}));

// ── Set Milvus env so constructor doesn't throw ─────────────────────────────

beforeEach(() => {
  process.env.MILVUS_HOST = 'localhost';
  process.env.MILVUS_PORT = '19530';
  vi.clearAllMocks();
  hasCollectionMock.mockResolvedValue({ value: false });
  createCollectionMock.mockResolvedValue({ error_code: 'Success' });
  createIndexMock.mockResolvedValue({ error_code: 'Success' });
  loadCollectionMock.mockResolvedValue({ error_code: 'Success' });
});

// ── Import SUT (after mocks are wired) ─────────────────────────────────────

import {
  getUserMemoriesService,
  __resetUserMemoriesServiceForTests,
} from '../UserMemoriesService.js';

beforeEach(() => {
  __resetUserMemoriesServiceForTests();
});

describe('UserMemoriesService.ensureCollection()', () => {
  it('calls createCollection with a "user_memories" collection name', async () => {
    const svc = getUserMemoriesService();
    await svc.ensureCollection();
    expect(createCollectionMock).toHaveBeenCalledOnce();
    const args = createCollectionMock.mock.calls[0][0];
    expect(args.collection_name).toBe('user_memories');
  });

  it('schema includes memory_id as primary key', async () => {
    const svc = getUserMemoriesService();
    await svc.ensureCollection();
    const { fields } = createCollectionMock.mock.calls[0][0];
    const pk = fields.find((f: any) => f.is_primary_key === true);
    expect(pk).toBeDefined();
    expect(pk.name).toBe('memory_id');
  });

  it('schema includes user_id, key, value, category as VarChar fields', async () => {
    const svc = getUserMemoriesService();
    await svc.ensureCollection();
    const { fields } = createCollectionMock.mock.calls[0][0];
    const fieldNames = fields.map((f: any) => f.name);
    expect(fieldNames).toContain('user_id');
    expect(fieldNames).toContain('key');
    expect(fieldNames).toContain('value');
    expect(fieldNames).toContain('category');
  });

  it('schema includes value_embedding as FloatVector with dim=768', async () => {
    const svc = getUserMemoriesService();
    await svc.ensureCollection();
    const { fields } = createCollectionMock.mock.calls[0][0];
    const vec = fields.find((f: any) => f.name === 'value_embedding');
    expect(vec).toBeDefined();
    expect(vec.data_type).toBe(DataType.FloatVector);
    expect(vec.dim).toBe(768);
  });

  it('schema includes created_at (Int64) and confidence (Float)', async () => {
    const svc = getUserMemoriesService();
    await svc.ensureCollection();
    const { fields } = createCollectionMock.mock.calls[0][0];
    const createdAt = fields.find((f: any) => f.name === 'created_at');
    const confidence = fields.find((f: any) => f.name === 'confidence');
    expect(createdAt?.data_type).toBe(DataType.Int64);
    expect(confidence?.data_type).toBe(DataType.Float);
  });

  it('creates a COSINE FLAT index on value_embedding', async () => {
    const svc = getUserMemoriesService();
    await svc.ensureCollection();
    const indexCalls = createIndexMock.mock.calls;
    const vecIdx = indexCalls.find((c: any[]) => c[0].field_name === 'value_embedding');
    expect(vecIdx).toBeDefined();
    expect(vecIdx[0].metric_type).toBe('COSINE');
    expect(vecIdx[0].index_type).toBe('FLAT');
  });

  it('does NOT call createCollection when collection already exists', async () => {
    hasCollectionMock.mockResolvedValue({ value: true });
    const svc = getUserMemoriesService();
    await svc.ensureCollection();
    expect(createCollectionMock).not.toHaveBeenCalled();
  });

  it('calls loadCollection after ensure completes', async () => {
    const svc = getUserMemoriesService();
    await svc.ensureCollection();
    expect(loadCollectionMock).toHaveBeenCalledOnce();
  });

  it('is idempotent — second call skips createCollection', async () => {
    const svc = getUserMemoriesService();
    await svc.ensureCollection();
    await svc.ensureCollection();
    expect(createCollectionMock).toHaveBeenCalledOnce();
  });
});
