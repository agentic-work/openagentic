/**
 * MilvusMemoryService.upsertUserMemory — symmetric write to the existing
 * searchUserMemories read path (#1085).
 *
 * Context: the read side has existed since H-2 (cross-session memory parity).
 * The write side was never implemented, which is why nothing actually lands
 * in `user_${userId}_memory` collections today — leaving the memory_search T1
 * tool with nothing to retrieve. This test pins the write contract that
 * ConversationCompactionWorker / GenerateImageTool / LargeResultStorageService
 * sidecar emits will depend on.
 *
 * Trust rule: every write MUST scope to the user's collection
 * (`user_${sanitized}_memory`). No cross-user leakage.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';

// Hoist a mock Milvus client + a mock generateEmbedding before the service
// imports them. The service constructs its own MilvusClient from env vars and
// makes embeddings via the mcp-proxy fetch path; both are stubbed here.
const milvusClientMock = vi.hoisted(() => ({
  hasCollection: vi.fn(),
  createCollection: vi.fn(),
  createIndex: vi.fn(),
  loadCollection: vi.fn(),
  insert: vi.fn(),
  flushSync: vi.fn(),
}));

vi.mock('@zilliz/milvus2-sdk-node', () => ({
  MilvusClient: vi.fn().mockImplementation(() => milvusClientMock),
  DataType: {
    VarChar: 21,
    Int64: 5,
    FloatVector: 101,
  },
}));

beforeEach(() => {
  process.env.MILVUS_HOST = 'localhost';
  process.env.MILVUS_PORT = '19530';
  Object.values(milvusClientMock).forEach((fn: any) => fn.mockReset?.());
  // Sane defaults.
  milvusClientMock.hasCollection.mockResolvedValue({ value: true });
  milvusClientMock.createCollection.mockResolvedValue({ error_code: 'Success' });
  milvusClientMock.createIndex.mockResolvedValue({ error_code: 'Success' });
  milvusClientMock.loadCollection.mockResolvedValue({ error_code: 'Success' });
  milvusClientMock.insert.mockResolvedValue({ status: { error_code: 'Success' } });
  milvusClientMock.flushSync.mockResolvedValue({});
});

const SILENT_LOGGER: any = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => SILENT_LOGGER,
};

describe('MilvusMemoryService.upsertUserMemory — write path (#1085)', () => {
  test('inserts into the user-scoped collection `user_${sanitized}_memory` (NEVER a shared one)', async () => {
    const { MilvusMemoryService } = await import('../MilvusMemoryService.js');
    const svc = new MilvusMemoryService(SILENT_LOGGER);
    // Stub embedding so we don't hit mcp-proxy fetch.
    (svc as any).generateEmbedding = vi.fn().mockResolvedValue(new Array(768).fill(0.01));

    await svc.upsertUserMemory('user-abc-123', {
      kind: 'session_summary',
      title: 'Session 2026-05-24 chat',
      content: 'User asked about Azure resource groups across 3 subs.',
    });

    expect(milvusClientMock.insert).toHaveBeenCalledOnce();
    const call = milvusClientMock.insert.mock.calls[0][0];
    expect(call.collection_name).toBe('user_user_abc_123_memory');
    expect(Array.isArray(call.data)).toBe(true);
    expect(call.data.length).toBe(1);
  });

  test('row shape matches the existing searchUserMemories schema (entity_* fields + observations + embedding)', async () => {
    const { MilvusMemoryService } = await import('../MilvusMemoryService.js');
    const svc = new MilvusMemoryService(SILENT_LOGGER);
    (svc as any).generateEmbedding = vi.fn().mockResolvedValue(new Array(768).fill(0.5));

    await svc.upsertUserMemory('u1', {
      kind: 'generated_image',
      title: 'pixel-art astronaut',
      content: 'image of an astronaut on a green bicycle',
      artifactUrl: '/api/images/img_xyz.png',
    });

    const row = milvusClientMock.insert.mock.calls[0][0].data[0];
    // The read path reads entity_id, entity_name, entity_type, observations,
    // created_at and a vector — so the write must populate all of those.
    expect(typeof row.entity_id).toBe('string');
    expect(row.entity_id.length).toBeGreaterThan(0);
    expect(row.entity_name).toBe('pixel-art astronaut');
    expect(row.entity_type).toBe('generated_image');
    expect(row.observations).toContain('astronaut');
    // artifactUrl is preserved inside observations so the model can dereference
    // it via memory_search results without a schema extension.
    expect(row.observations).toContain('/api/images/img_xyz.png');
    expect(typeof row.created_at).toBe('number');
    expect(Array.isArray(row.observations_embedding) || Array.isArray(row.embedding)).toBe(true);
  });

  test('creates the collection if it does not exist (lazy bootstrap)', async () => {
    milvusClientMock.hasCollection.mockResolvedValue({ value: false });

    const { MilvusMemoryService } = await import('../MilvusMemoryService.js');
    const svc = new MilvusMemoryService(SILENT_LOGGER);
    (svc as any).generateEmbedding = vi.fn().mockResolvedValue(new Array(768).fill(0));

    await svc.upsertUserMemory('first-time-user', {
      kind: 'session_summary',
      title: 'first session',
      content: 'hello world',
    });

    expect(milvusClientMock.createCollection).toHaveBeenCalledOnce();
    const createCall = milvusClientMock.createCollection.mock.calls[0][0];
    expect(createCall.collection_name).toBe('user_first_time_user_memory');
    // Insert must still happen after create.
    expect(milvusClientMock.insert).toHaveBeenCalledOnce();
    expect(milvusClientMock.insert.mock.calls[0][0].collection_name).toBe('user_first_time_user_memory');
  });

  test('rejects missing userId (security guard — no cross-user write)', async () => {
    const { MilvusMemoryService } = await import('../MilvusMemoryService.js');
    const svc = new MilvusMemoryService(SILENT_LOGGER);
    (svc as any).generateEmbedding = vi.fn();

    await expect(
      svc.upsertUserMemory('', {
        kind: 'session_summary',
        title: 't',
        content: 'c',
      }),
    ).rejects.toThrow(/userId/i);
    expect(milvusClientMock.insert).not.toHaveBeenCalled();
  });
});
