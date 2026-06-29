/**
 * MilvusMemoryService.generateEmbedding — in-process via UniversalEmbeddingService.
 *
 * Bug context (2026-05-24): the previous implementation did an HTTP fetch to
 * `${MCP_PROXY_URL}/v1/embeddings`, which mcp-proxy proxied BACK to the api's
 * own `/api/embeddings` route — a circular hop. Live mcp-proxy logs showed
 * `"API embeddings error: 400 - input is required"` on every call, breaking
 * ALL semantic memory recall (memory_search returned [] for every query).
 *
 * Fix: replace the network call with a direct in-process invocation of
 * `UniversalEmbeddingService.generateEmbedding(text)`. Same pod, same process,
 * no network, no auth. This test pins that contract.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';

// Hoist mocks before service imports them.
const universalEmbedderMock = vi.hoisted(() => ({
  generateEmbedding: vi.fn(),
}));

vi.mock('../UniversalEmbeddingService.js', () => ({
  UniversalEmbeddingService: vi.fn().mockImplementation(() => universalEmbedderMock),
}));

// Stub out @zilliz/milvus2-sdk-node so the service constructor doesn't try
// to instantiate a real Milvus client.
vi.mock('@zilliz/milvus2-sdk-node', () => ({
  MilvusClient: vi.fn().mockImplementation(() => ({})),
  DataType: {
    VarChar: 21,
    Int64: 5,
    FloatVector: 101,
  },
}));

beforeEach(() => {
  process.env.MILVUS_HOST = 'localhost';
  process.env.MILVUS_PORT = '19530';
  universalEmbedderMock.generateEmbedding.mockReset();
  universalEmbedderMock.generateEmbedding.mockResolvedValue({
    embedding: new Array(768).fill(0.1),
    dimensions: 768,
    model: 'nomic-embed-text',
    provider: 'ollama',
    usage: {},
  });
});

const SILENT_LOGGER: any = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => SILENT_LOGGER,
};

describe('MilvusMemoryService.generateEmbedding — in-process via UniversalEmbeddingService', () => {
  test('uses UniversalEmbeddingService in-process (NO network fetch to mcp-proxy)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const { MilvusMemoryService } = await import('../MilvusMemoryService.js');
    const svc = new MilvusMemoryService(SILENT_LOGGER);

    const result: number[] = await (svc as any).generateEmbedding('hello');

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(768);
    expect(universalEmbedderMock.generateEmbedding).toHaveBeenCalledWith('hello');
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  test('throws a descriptive error when UniversalEmbeddingService returns an invalid result', async () => {
    universalEmbedderMock.generateEmbedding.mockResolvedValueOnce({
      embedding: undefined,
      dimensions: 0,
      model: 'broken',
      provider: 'ollama',
    } as any);

    const { MilvusMemoryService } = await import('../MilvusMemoryService.js');
    const svc = new MilvusMemoryService(SILENT_LOGGER);

    await expect((svc as any).generateEmbedding('hello')).rejects.toThrow(/Embedding failed/);
  });
});
