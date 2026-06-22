/**
 * LearnedPatternsService — TDD for the Milvus-backed pattern memory.
 *
 * Spec: user direction 2026-05-11 — model self-curates a memory of useful tool
 * chains via pattern_save + pattern_recall T1 meta-tools. This service owns
 * the `learned_patterns` Milvus collection lifecycle (ensureCollection),
 * the upsert path (save), and the search path (recall + recall_count++).
 *
 * Mirrors `MilvusMemoryService` for shape and `ToolSemanticCacheService` for
 * collection-create discipline (single-vector schema, auto-detect embedding
 * dim, COSINE metric, FLAT index for small datasets).
 *
 * RBAC: every recall MUST filter `user_id == "<ctx>" OR shared == true`;
 * every save MUST scope the row to `user_id = ctx.userId`. The arch test
 * pins this from the source side.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the MilvusClient SDK BEFORE importing the SUT so the singleton
// inside the service binds to our spy.
const hasCollectionSpy = vi.fn();
const createCollectionSpy = vi.fn();
const createIndexSpy = vi.fn();
const loadCollectionSpy = vi.fn();
const insertSpy = vi.fn();
const searchSpy = vi.fn();
const querySpy = vi.fn();
const upsertSpy = vi.fn();
const deleteSpy = vi.fn();
const describeCollectionSpy = vi.fn();
const dropCollectionSpy = vi.fn();

vi.mock('@zilliz/milvus2-sdk-node', () => ({
  MilvusClient: vi.fn().mockImplementation(() => ({
    hasCollection: hasCollectionSpy,
    createCollection: createCollectionSpy,
    createIndex: createIndexSpy,
    loadCollection: loadCollectionSpy,
    insert: insertSpy,
    search: searchSpy,
    query: querySpy,
    upsert: upsertSpy,
    delete: deleteSpy,
    describeCollection: describeCollectionSpy,
    dropCollection: dropCollectionSpy,
    checkHealth: vi.fn().mockResolvedValue({ isHealthy: true }),
  })),
  DataType: {
    VarChar: 21,
    FloatVector: 101,
    Int64: 5,
    Bool: 1,
    Float: 10,
  },
  MetricType: { COSINE: 'COSINE' },
  IndexType: { FLAT: 'FLAT', IVF_FLAT: 'IVF_FLAT' },
}));

// Mock the embedding service — service generates an embedding for the
// user_prompt + tool_sequence_summary + business_goal_tags blob and uses
// the returned dim for collection schema.
const embedSpy = vi.fn();
const embeddingDimSpy = vi.fn();
// Production code calls `generateEmbedding(text): Promise<EmbeddingResult>` where
// EmbeddingResult = { embedding: number[], dimensions, model, provider }. Tests
// assert on `embedSpy` (the input text); we wrap so the call shape matches the
// production API while preserving the spy assertions.
vi.mock('../UniversalEmbeddingService.js', () => ({
  UniversalEmbeddingService: vi.fn().mockImplementation(() => ({
    generateEmbedding: async (text: string) => {
      const embedding = await embedSpy(text);
      return { embedding, dimensions: embeddingDimSpy(), model: 'test-embed', provider: 'test' };
    },
    getInfo: () => ({ dimensions: embeddingDimSpy(), model: 'test-embed' }),
    isConfigured: vi.fn().mockResolvedValue(true),
  })),
}));

import { LearnedPatternsService } from '../LearnedPatternsService.js';

const FAKE_DIM = 768;
const FAKE_EMBEDDING = Array.from({ length: FAKE_DIM }, () => 0.1);

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  embeddingDimSpy.mockReturnValue(FAKE_DIM);
  embedSpy.mockResolvedValue(FAKE_EMBEDDING);
  process.env.MILVUS_HOST = 'localhost';
  process.env.MILVUS_PORT = '19530';
});

describe('LearnedPatternsService — ensureCollection', () => {
  it('creates the learned_patterns collection on first call when missing', async () => {
    hasCollectionSpy.mockResolvedValueOnce({ value: false });
    createCollectionSpy.mockResolvedValueOnce({ status: { error_code: 'Success' } });
    createIndexSpy.mockResolvedValue({ status: { error_code: 'Success' } });
    loadCollectionSpy.mockResolvedValueOnce({ status: { error_code: 'Success' } });

    const svc = new LearnedPatternsService(makeLogger());
    await svc.ensureCollection();

    expect(hasCollectionSpy).toHaveBeenCalledWith({
      collection_name: 'learned_patterns',
    });
    expect(createCollectionSpy).toHaveBeenCalledTimes(1);
    const created = createCollectionSpy.mock.calls[0][0];
    expect(created.collection_name).toBe('learned_patterns');
    // Required fields per spec
    const fieldNames = (created.fields as Array<{ name: string }>).map(
      (f) => f.name,
    );
    expect(fieldNames).toContain('pattern_id');
    expect(fieldNames).toContain('user_id');
    expect(fieldNames).toContain('business_goal_tags');
    expect(fieldNames).toContain('user_prompt');
    expect(fieldNames).toContain('prompt_embedding');
    expect(fieldNames).toContain('tool_sequence_summary');
    expect(fieldNames).toContain('tool_sequence_names');
    expect(fieldNames).toContain('outcome');
    expect(fieldNames).toContain('notes');
    expect(fieldNames).toContain('shared');
    expect(fieldNames).toContain('created_at');
    expect(fieldNames).toContain('recall_count');
  });

  it('skips creation when collection already exists', async () => {
    hasCollectionSpy.mockResolvedValueOnce({ value: true });
    loadCollectionSpy.mockResolvedValueOnce({ status: { error_code: 'Success' } });

    const svc = new LearnedPatternsService(makeLogger());
    await svc.ensureCollection();

    expect(createCollectionSpy).not.toHaveBeenCalled();
    expect(loadCollectionSpy).toHaveBeenCalledTimes(1);
  });

  it('drops + recreates the collection when existing prompt_embedding dim does not match current embedding service dim (Sev-1 known issue: Azure OpenAI 1536 → in-cluster nomic-embed-text 768 cutover left stale schema)', async () => {
    // Existing collection has 1536-dim prompt_embedding (from a previous
    // embedding model), but the current embedding service reports 768 dim.
    // Without drop+recreate, every save() would fail with "embedding dim
    // mismatch" inside Milvus.
    hasCollectionSpy.mockResolvedValueOnce({ value: true });
    describeCollectionSpy.mockResolvedValueOnce({
      schema: {
        fields: [
          { name: 'pattern_id', data_type: 21 },
          {
            name: 'prompt_embedding',
            data_type: 101,
            type_params: [{ key: 'dim', value: '1536' }],
          },
        ],
      },
    });
    dropCollectionSpy.mockResolvedValueOnce({ status: { error_code: 'Success' } });
    createCollectionSpy.mockResolvedValueOnce({ status: { error_code: 'Success' } });
    createIndexSpy.mockResolvedValue({ status: { error_code: 'Success' } });
    loadCollectionSpy.mockResolvedValueOnce({ status: { error_code: 'Success' } });

    embeddingDimSpy.mockReturnValue(768); // current embedding service

    const svc = new LearnedPatternsService(makeLogger());
    await svc.ensureCollection();

    expect(describeCollectionSpy).toHaveBeenCalledWith({
      collection_name: 'learned_patterns',
    });
    expect(dropCollectionSpy).toHaveBeenCalledWith({
      collection_name: 'learned_patterns',
    });
    expect(createCollectionSpy).toHaveBeenCalledTimes(1);
    const created = createCollectionSpy.mock.calls[0][0];
    const promptField = (created.fields as Array<{ name: string; dim?: number }>).find(
      (f) => f.name === 'prompt_embedding',
    );
    expect(promptField?.dim).toBe(768);
  });

  it('does NOT drop the collection when existing dim already matches', async () => {
    hasCollectionSpy.mockResolvedValueOnce({ value: true });
    describeCollectionSpy.mockResolvedValueOnce({
      schema: {
        fields: [
          {
            name: 'prompt_embedding',
            data_type: 101,
            type_params: [{ key: 'dim', value: '768' }],
          },
        ],
      },
    });
    loadCollectionSpy.mockResolvedValueOnce({ status: { error_code: 'Success' } });
    embeddingDimSpy.mockReturnValue(768);

    const svc = new LearnedPatternsService(makeLogger());
    await svc.ensureCollection();

    expect(dropCollectionSpy).not.toHaveBeenCalled();
    expect(createCollectionSpy).not.toHaveBeenCalled();
  });

  it('creates COSINE vector index on prompt_embedding', async () => {
    hasCollectionSpy.mockResolvedValueOnce({ value: false });
    createCollectionSpy.mockResolvedValueOnce({ status: { error_code: 'Success' } });
    createIndexSpy.mockResolvedValue({ status: { error_code: 'Success' } });
    loadCollectionSpy.mockResolvedValueOnce({ status: { error_code: 'Success' } });

    const svc = new LearnedPatternsService(makeLogger());
    await svc.ensureCollection();

    // The very first createIndex call must target prompt_embedding with COSINE
    const firstIdx = createIndexSpy.mock.calls.find(
      (c) => c[0]?.field_name === 'prompt_embedding',
    );
    expect(firstIdx).toBeDefined();
    expect(firstIdx[0].metric_type).toBe('COSINE');
  });
});

describe('LearnedPatternsService — save', () => {
  beforeEach(() => {
    hasCollectionSpy.mockResolvedValue({ value: true });
    loadCollectionSpy.mockResolvedValue({ status: { error_code: 'Success' } });
    insertSpy.mockResolvedValue({
      status: { error_code: 'Success' },
      IDs: { str_id: { data: ['pat-uuid-1'] } },
    });
  });

  it('inserts a pattern row scoped to ctx.userId with all required fields', async () => {
    const svc = new LearnedPatternsService(makeLogger());
    await svc.ensureCollection();

    const result = await svc.save(
      {
        user_prompt: 'audit my k8s clusters for cost',
        tool_sequence_summary:
          'List k8s clusters, then call k8s_get_cost per cluster, then synthesize a sankey.',
        tool_sequence_names: ['k8s_list_clusters', 'k8s_get_cost', 'compose_visual'],
        business_goal_tags: ['cost-optimization', 'capacity-planning'],
        outcome: 'success',
        notes: 'gpt-oss:20b confused k8s namespaces with clusters first; retry helped.',
        shared: false,
      },
      'user-abc',
    );

    expect(result.pattern_id).toBeDefined();
    expect(typeof result.pattern_id).toBe('string');
    expect(result.indexed_at).toBeDefined();

    expect(insertSpy).toHaveBeenCalledTimes(1);
    const inserted = insertSpy.mock.calls[0][0];
    expect(inserted.collection_name).toBe('learned_patterns');
    expect(inserted.data).toHaveLength(1);
    const row = inserted.data[0];
    expect(row.user_id).toBe('user-abc');
    expect(row.user_prompt).toBe('audit my k8s clusters for cost');
    // CSV joining for tool_sequence_names + business_goal_tags
    expect(row.tool_sequence_names).toContain('k8s_list_clusters');
    expect(row.tool_sequence_names).toContain('compose_visual');
    expect(row.business_goal_tags).toContain('cost-optimization');
    expect(row.outcome).toBe('success');
    expect(row.shared).toBe(false);
    expect(row.recall_count).toBe(0);
    expect(row.prompt_embedding).toHaveLength(FAKE_DIM);
  });

  it('generates the embedding by calling UniversalEmbeddingService.embed with the assembled query blob', async () => {
    const svc = new LearnedPatternsService(makeLogger());
    await svc.ensureCollection();

    await svc.save(
      {
        user_prompt: 'audit my k8s clusters',
        tool_sequence_summary: 'list clusters, get costs, visualize',
        tool_sequence_names: ['k8s_list_clusters', 'k8s_get_cost'],
        business_goal_tags: ['cost-optimization'],
        outcome: 'success',
      },
      'user-abc',
    );

    expect(embedSpy).toHaveBeenCalledTimes(1);
    const embedBlob = embedSpy.mock.calls[0][0];
    // The blob must include the prompt, the summary, and the tags so
    // semantic recall can hit on any of them.
    expect(embedBlob).toContain('audit my k8s clusters');
    expect(embedBlob).toContain('list clusters');
    expect(embedBlob).toContain('cost-optimization');
  });

  it('defaults shared to false when not supplied', async () => {
    const svc = new LearnedPatternsService(makeLogger());
    await svc.ensureCollection();
    await svc.save(
      {
        user_prompt: 'x',
        tool_sequence_summary: 'y',
        tool_sequence_names: ['t'],
        business_goal_tags: ['inventory'],
        outcome: 'success',
      },
      'user-abc',
    );
    const row = insertSpy.mock.calls[0][0].data[0];
    expect(row.shared).toBe(false);
  });
});

describe('LearnedPatternsService — recall', () => {
  beforeEach(() => {
    hasCollectionSpy.mockResolvedValue({ value: true });
    loadCollectionSpy.mockResolvedValue({ status: { error_code: 'Success' } });
  });

  it('searches the collection with a user-scoped filter (user_id == "X" OR shared == true)', async () => {
    searchSpy.mockResolvedValueOnce({
      status: { error_code: 'Success' },
      results: [],
    });
    const svc = new LearnedPatternsService(makeLogger());
    await svc.ensureCollection();
    await svc.recall('audit my k8s', { userId: 'user-abc' });

    expect(searchSpy).toHaveBeenCalledTimes(1);
    const searchArgs = searchSpy.mock.calls[0][0];
    expect(searchArgs.collection_name).toBe('learned_patterns');
    // Filter must enforce the RBAC predicate
    const filterExpr = String(searchArgs.filter ?? searchArgs.expr ?? '');
    expect(filterExpr).toMatch(/user_id\s*==\s*"user-abc"/);
    expect(filterExpr).toMatch(/shared\s*==\s*true/);
    // OR connective
    expect(filterExpr.toUpperCase()).toMatch(/\bOR\b|\|\|/);
  });

  it('returns top-K hits with pattern fields + similarity', async () => {
    searchSpy.mockResolvedValueOnce({
      status: { error_code: 'Success' },
      results: [
        {
          pattern_id: 'pat-1',
          user_id: 'user-abc',
          tool_sequence_summary: 'list k8s clusters, get cost, sankey',
          tool_sequence_names: 'k8s_list_clusters,k8s_get_cost,compose_visual',
          business_goal_tags: 'cost-optimization,capacity-planning',
          outcome: 'success',
          notes: 'worked best when filtering by namespace first',
          shared: false,
          created_at: 1700000000000,
          recall_count: 3,
          score: 0.91,
        },
      ],
    });

    const svc = new LearnedPatternsService(makeLogger());
    await svc.ensureCollection();
    const hits = await svc.recall('audit my k8s', { userId: 'user-abc' });

    expect(hits).toHaveLength(1);
    const h = hits[0];
    expect(h.pattern_id).toBe('pat-1');
    expect(h.summary).toMatch(/sankey/);
    expect(h.tool_names).toContain('k8s_list_clusters');
    expect(h.outcome).toBe('success');
    expect(h.notes).toMatch(/namespace/);
    expect(h.similarity).toBe(0.91);
    expect(h.recency_days).toBeGreaterThanOrEqual(0);
  });

  it('honours the limit option (default 5, max 10)', async () => {
    searchSpy.mockResolvedValueOnce({
      status: { error_code: 'Success' },
      results: [],
    });
    const svc = new LearnedPatternsService(makeLogger());
    await svc.ensureCollection();
    await svc.recall('x', { userId: 'user-abc', limit: 7 });
    expect(searchSpy.mock.calls[0][0].limit).toBe(7);
  });

  it('filters by business_goal_tags when provided', async () => {
    searchSpy.mockResolvedValueOnce({
      status: { error_code: 'Success' },
      results: [],
    });
    const svc = new LearnedPatternsService(makeLogger());
    await svc.ensureCollection();
    await svc.recall('x', {
      userId: 'user-abc',
      businessGoalTags: ['cost-optimization', 'security-audit'],
    });
    const filterExpr = String(
      searchSpy.mock.calls[0][0].filter ??
        searchSpy.mock.calls[0][0].expr ??
        '',
    );
    expect(filterExpr).toMatch(/cost-optimization|security-audit/);
  });

  it('increments recall_count for each returned pattern via upsert', async () => {
    searchSpy.mockResolvedValueOnce({
      status: { error_code: 'Success' },
      results: [
        {
          pattern_id: 'pat-1',
          user_id: 'user-abc',
          tool_sequence_summary: 's1',
          tool_sequence_names: 'a,b',
          business_goal_tags: 'cost-optimization',
          outcome: 'success',
          notes: '',
          shared: false,
          created_at: Date.now(),
          recall_count: 2,
          score: 0.8,
        },
        {
          pattern_id: 'pat-2',
          user_id: 'user-abc',
          tool_sequence_summary: 's2',
          tool_sequence_names: 'c,d',
          business_goal_tags: 'inventory',
          outcome: 'partial',
          notes: '',
          shared: false,
          created_at: Date.now(),
          recall_count: 0,
          score: 0.7,
        },
      ],
    });
    // upsert is fire-and-forget but we still assert it fired.
    upsertSpy.mockResolvedValue({ status: { error_code: 'Success' } });
    insertSpy.mockResolvedValue({ status: { error_code: 'Success' } });

    const svc = new LearnedPatternsService(makeLogger());
    await svc.ensureCollection();
    const hits = await svc.recall('x', { userId: 'user-abc' });
    expect(hits).toHaveLength(2);
    // Either upsert (preferred — atomic) or delete+insert; at minimum the
    // service must signal that it bumped recall_count.
    const bumpCalled =
      upsertSpy.mock.calls.length > 0 ||
      (deleteSpy.mock.calls.length > 0 && insertSpy.mock.calls.length > 0);
    expect(bumpCalled).toBe(true);
  });

  it('returns [] when collection is empty (no hits)', async () => {
    searchSpy.mockResolvedValueOnce({
      status: { error_code: 'Success' },
      results: [],
    });
    const svc = new LearnedPatternsService(makeLogger());
    await svc.ensureCollection();
    const hits = await svc.recall('nothing matches', { userId: 'user-abc' });
    expect(hits).toEqual([]);
  });
});
