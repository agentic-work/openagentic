/**
 * #51 (2026-06-01) — tool_search relevance floor.
 *
 * LIVE BUG (openagentic, gpt-oss:20b): "show me my azure subscriptions" spun
 * forever because tool_search returned the top-N of the WHOLE catalog by
 * cosine with NO relevance threshold. A query with no real match ("azure"
 * against a catalog of only aws/web tools) still returned 14 irrelevant
 * tools + "call any of them" — a false positive. The model never learned
 * "there is no azure tool" and looped the discovery turn until max-iter
 * leaked {"k":5,"query":"azure_list"} as the answer.
 *
 * Fix: searchTools applies a raw-COSINE relevance floor (default 0.55,
 * env-tunable via TOOL_SEARCH_MIN_COSINE, read per-call). Hits whose raw
 * Milvus cosine is below the floor are dropped BEFORE the tools conversion.
 * A genuine on-topic match (cosine ~0.6–0.85) survives; an off-topic
 * catalog-best (~0.3–0.5) is filtered → searchTools returns [].
 *
 * The threshold is read from the raw, PRE-cloud-boost cosine (applyCloud
 * Boosting multiplies rrfScore, which can push a boosted score >1.0). We
 * stash `rawCosine = hit.score` so the floor is immune to boosting.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

let ToolSemanticCacheService: any;

beforeAll(async () => {
  // Constructor requires these — set before import/instantiate.
  process.env.MILVUS_HOST = process.env.MILVUS_HOST || '127.0.0.1';
  process.env.MILVUS_PORT = process.env.MILVUS_PORT || '19530';
  // UniversalEmbeddingService (constructed in the ctor) needs an embedding
  // model id or it throws. We override embeddingService after construction,
  // but the ctor must succeed first.
  process.env.EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'stub-embed';
  process.env.EMBEDDING_OLLAMA_MODEL = process.env.EMBEDDING_OLLAMA_MODEL || 'stub-embed';
  ({ ToolSemanticCacheService } = await import('../ToolSemanticCacheService.js'));
});

afterEach(() => {
  delete process.env.TOOL_SEARCH_MIN_COSINE;
});

/**
 * Build a service instance with the Milvus client + embedding service
 * stubbed so searchTools runs end-to-end against `hits` without any real
 * network/Milvus/embedding I/O.
 */
function buildSvc(hits: Array<{ score: number; tool_name: string; server_name: string }>) {
  const svc = new ToolSemanticCacheService();
  // Force-initialized so searchTools doesn't throw.
  (svc as any)._isInitialized = true;
  // Stub the PRIVATE generateEmbedding so the dimension-validated embedding
  // path is bypassed (it reads a module-global EMBEDDING_DIMENSIONS). We only
  // exercise the relevance-floor filter, which runs over the search hits.
  (svc as any).generateEmbedding = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
  // Stub Milvus client search to return our crafted hits.
  (svc as any).client = {
    search: vi.fn().mockResolvedValue({
      results: hits.map((h) => ({
        score: h.score,
        tool_name: h.tool_name,
        server_name: h.server_name,
        description: `desc for ${h.tool_name}`,
        parameters_json: '{}',
        metadata: '{}',
        tags: '',
        synthetic_queries: '',
      })),
    }),
  };
  return svc;
}

describe('ToolSemanticCacheService.searchTools — relevance floor (#51)', () => {
  it('returns [] when every hit is below the default cosine floor (the azure false-positive)', async () => {
    // "azure" against an aws/web catalog: best hits are off-topic, low cosine.
    const svc = buildSvc([
      { score: 0.42, tool_name: 'aws_search_documentation', server_name: 'aws_knowledge' },
      { score: 0.38, tool_name: 'openagentic_web_fetch', server_name: 'openagentic_web' },
      { score: 0.30, tool_name: 'aws_list_buckets', server_name: 'aws_knowledge' },
    ]);
    const tools = await svc.searchTools('azure subscriptions list', 8);
    expect(tools).toEqual([]);
  });

  it('keeps hits that clear the default floor (real web/aws match — no regression)', async () => {
    const svc = buildSvc([
      { score: 0.81, tool_name: 'openagentic_web_fetch', server_name: 'openagentic_web' },
      { score: 0.67, tool_name: 'openagentic_web_search', server_name: 'openagentic_web' },
      { score: 0.40, tool_name: 'aws_list_buckets', server_name: 'aws_knowledge' }, // below floor → dropped
    ]);
    const tools = await svc.searchTools('fetch a web page', 8);
    const names = tools.map((t: any) => t.name);
    expect(names).toContain('openagentic_web_fetch');
    expect(names).toContain('openagentic_web_search');
    expect(names).not.toContain('aws_list_buckets');
  });

  it('TOOL_SEARCH_MIN_COSINE env override changes the cut (read per-call)', async () => {
    const hits = [
      { score: 0.50, tool_name: 'aws_search_documentation', server_name: 'aws_knowledge' },
    ];
    // Default 0.55 → dropped.
    const dropped = await buildSvc(hits).searchTools('aws docs', 8);
    expect(dropped).toEqual([]);

    // Lowered to 0.45 → kept.
    process.env.TOOL_SEARCH_MIN_COSINE = '0.45';
    const kept = await buildSvc(hits).searchTools('aws docs', 8);
    expect(kept.map((t: any) => t.name)).toContain('aws_search_documentation');
  });

  it('does not crash when a hit lacks an explicit score (treated as 0 → filtered)', async () => {
    const svc = new ToolSemanticCacheService();
    (svc as any)._isInitialized = true;
    (svc as any).generateEmbedding = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
    (svc as any).client = {
      search: vi.fn().mockResolvedValue({
        results: [
          // no `score` field at all
          { tool_name: 'mystery_tool', server_name: 'unknown', description: 'd', parameters_json: '{}', metadata: '{}' },
          { score: 0.79, tool_name: 'openagentic_web_fetch', server_name: 'openagentic_web', description: 'd', parameters_json: '{}', metadata: '{}' },
        ],
      }),
    };
    const tools = await svc.searchTools('fetch a web page', 8);
    const names = tools.map((t: any) => t.name);
    expect(names).toContain('openagentic_web_fetch');
    expect(names).not.toContain('mystery_tool');
  });
});
