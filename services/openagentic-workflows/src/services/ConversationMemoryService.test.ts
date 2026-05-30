/**
 * ConversationMemoryService — V1.1 vector backend tests.
 *
 * `search(memoryId, query, limit)` is the new method this commit adds.
 * Behaviour:
 *  - Embeds the query via POST {apiUrl}/api/embeddings.
 *  - Brute-force cosine similarity over rows for memoryId + tenant_id
 *    that have metadata.embedding populated.
 *  - Returns top-K matches sorted desc by score.
 *
 * Storage strategy: on `write`, we embed content lazily and persist the
 * embedding into the row's existing `metadata` JSON column (no schema
 * migration needed). This test pins both the search ranking AND the
 * embed-on-write side-effect.
 *
 * Tests run before the implementation lands → expect RED.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Prisma + axios mocks via vi.hoisted so they exist when vi.mock factories run.
const { mockFindMany, mockCreate, mockCount, mockDeleteMany, mockPost } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockCreate: vi.fn(),
  mockCount: vi.fn(),
  mockDeleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  mockPost: vi.fn(),
}));

vi.mock('../utils/prisma.js', () => ({
  prisma: {
    conversationMemory: {
      findMany: mockFindMany,
      create: mockCreate,
      count: mockCount,
      deleteMany: mockDeleteMany,
    },
  },
}));

vi.mock('axios', () => ({
  default: { post: mockPost },
}));

import { ConversationMemoryService } from './ConversationMemoryService.js';

const QUERY_EMBED = [1, 0, 0, 0];
const CLOSE_EMBED = [0.99, 0.14, 0, 0]; // cos≈0.99
const MID_EMBED = [0.5, 0.5, 0.5, 0.5]; // cos≈0.5
const FAR_EMBED = [-1, 0, 0, 0]; // cos≈-1

function makeService() {
  return new ConversationMemoryService({
    apiUrl: 'http://api',
    internalAuthHeaders: () => ({ 'X-Internal-Secret': 'secret' }),
    executionId: 'exec-1',
  });
}

beforeEach(() => {
  mockFindMany.mockReset();
  mockCreate.mockReset();
  mockCount.mockReset().mockResolvedValue(1);
  mockPost.mockReset();
});

describe('ConversationMemoryService.search', () => {
  it('embeds the query via /api/embeddings and ranks rows by cosine similarity (desc)', async () => {
    mockPost.mockResolvedValue({
      data: { data: [{ embedding: QUERY_EMBED }] },
    });
    mockFindMany.mockResolvedValue([
      {
        role: 'user',
        content: 'far row',
        timestamp: new Date('2026-01-01'),
        metadata: { embedding: FAR_EMBED },
      },
      {
        role: 'assistant',
        content: 'close row',
        timestamp: new Date('2026-01-02'),
        metadata: { embedding: CLOSE_EMBED },
      },
      {
        role: 'user',
        content: 'mid row',
        timestamp: new Date('2026-01-03'),
        metadata: { embedding: MID_EMBED },
      },
    ]);

    const svc = makeService();
    const result = await svc.search({
      tenantId: 'tenant-a',
      memoryId: 'sess-1',
      query: 'How do I restart a pod?',
      limit: 2,
    });

    expect(mockPost).toHaveBeenCalledOnce();
    const [url, body, opts] = mockPost.mock.calls[0];
    expect(url).toBe('http://api/api/embeddings');
    expect((body as any).input).toBe('How do I restart a pod?');
    expect((opts as any).headers['X-Internal-Secret']).toBe('secret');

    expect(result.matches).toHaveLength(2);
    expect(result.matches[0].content).toBe('close row');
    expect(result.matches[1].content).toBe('mid row');
    expect(result.matches[0].score).toBeGreaterThan(result.matches[1].score);
    expect(result.count).toBe(2);
  });

  it('filters out rows missing metadata.embedding', async () => {
    mockPost.mockResolvedValue({
      data: { data: [{ embedding: QUERY_EMBED }] },
    });
    mockFindMany.mockResolvedValue([
      { role: 'user', content: 'with embed', timestamp: new Date(), metadata: { embedding: CLOSE_EMBED } },
      { role: 'user', content: 'no embed', timestamp: new Date(), metadata: {} },
      { role: 'user', content: 'null metadata', timestamp: new Date(), metadata: null },
    ]);

    const svc = makeService();
    const result = await svc.search({
      tenantId: 'tenant-a',
      memoryId: 'sess-1',
      query: 'pod restart',
      limit: 5,
    });

    expect(result.matches.map((m) => m.content)).toEqual(['with embed']);
    expect(result.count).toBe(1);
  });

  it('honors the tenant scope in the Prisma findMany call', async () => {
    mockPost.mockResolvedValue({ data: { data: [{ embedding: QUERY_EMBED }] } });
    mockFindMany.mockResolvedValue([]);

    const svc = makeService();
    await svc.search({
      tenantId: 'tenant-x',
      memoryId: 'sess-99',
      query: 'anything',
      limit: 3,
    });

    expect(mockFindMany).toHaveBeenCalledOnce();
    const args = mockFindMany.mock.calls[0][0];
    expect(args.where.memory_id).toBe('sess-99');
    expect(args.where.tenant_id).toBe('tenant-x');
    // Exclude summary rows
    expect(args.where.role).toEqual({ not: 'summary' });
  });

  it('returns empty result + does not crash when embedding API fails', async () => {
    mockPost.mockRejectedValue(new Error('embed api down'));
    mockFindMany.mockResolvedValue([
      { role: 'user', content: 'x', timestamp: new Date(), metadata: { embedding: CLOSE_EMBED } },
    ]);

    const svc = makeService();
    const result = await svc.search({
      tenantId: 'tenant-a',
      memoryId: 'sess-1',
      query: 'pod restart',
      limit: 5,
    });

    expect(result.matches).toEqual([]);
    expect(result.count).toBe(0);
  });
});

describe('ConversationMemoryService.write — embedding side-effect', () => {
  it('embeds the content and persists it in metadata.embedding', async () => {
    mockPost.mockResolvedValue({ data: { data: [{ embedding: CLOSE_EMBED }] } });
    mockCount.mockResolvedValue(1);
    mockCreate.mockResolvedValue({});

    const svc = makeService();
    await svc.write({
      tenantId: 'tenant-a',
      memoryId: 'sess-1',
      role: 'user',
      content: 'How do I restart a pod?',
    });

    expect(mockPost).toHaveBeenCalledOnce();
    expect(mockCreate).toHaveBeenCalledOnce();
    const createArgs = mockCreate.mock.calls[0][0];
    expect(createArgs.data.metadata).toMatchObject({
      embedding: CLOSE_EMBED,
    });
  });

  it('still writes the row when embedding fails (best-effort)', async () => {
    mockPost.mockRejectedValue(new Error('embed api down'));
    mockCount.mockResolvedValue(1);
    mockCreate.mockResolvedValue({});

    const svc = makeService();
    const result = await svc.write({
      tenantId: 'tenant-a',
      memoryId: 'sess-1',
      role: 'user',
      content: 'msg',
    });

    expect(result.written).toBe(true);
    expect(mockCreate).toHaveBeenCalledOnce();
    const createArgs = mockCreate.mock.calls[0][0];
    // metadata should be undefined or not contain an embedding (best-effort)
    if (createArgs.data.metadata) {
      expect(createArgs.data.metadata.embedding).toBeUndefined();
    }
  });
});
