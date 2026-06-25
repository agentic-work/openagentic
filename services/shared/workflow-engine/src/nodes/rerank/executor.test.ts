/**
 * rerank node — colocated executor unit tests.
 *
 * Covers the deterministic lexical reranker's contract in isolation (no
 * engine): chunk extraction from common retriever shapes, relevance
 * ordering, top-N trim, the empty-candidate degenerate case, query
 * templating, and the output envelope shape.
 */

import { describe, it, expect } from 'vitest';
import { execute } from './executor.js';
import type { NodeExecutionContext } from '../types.js';

function makeCtx(overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-rerank-1',
    apiUrl: 'http://api',
    // Default interpolate: resolve {{trigger.X}} from a tiny context bag on input.
    interpolateTemplate: (t: string, input: unknown) =>
      t.replace(/\{\{trigger\.(\w+)\}\}/g, (_m, k) => String((input as any)?.[k] ?? '')),
    getInternalAuthHeaders: () => ({}),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    ...overrides,
  } as NodeExecutionContext;
}

const rerankNode = (data: Record<string, unknown>) => ({
  id: 'n_rerank',
  type: 'rerank',
  data,
});

// A knowledge_search-shaped upstream payload: { result: { results: [...] } }.
const searchEnvelope = {
  result: {
    query: 'flows engine',
    resultCount: 4,
    results: [
      { id: 'a', content: 'The billing dashboard shows monthly invoices and payment history.', score: 0.40 },
      { id: 'b', content: 'OpenAgentic Flows is a deterministic node-graph workflow engine with registry-backed plugins.', score: 0.55 },
      { id: 'c', content: 'Kubernetes pods can be listed via the k8s MCP tool.', score: 0.30 },
      { id: 'd', content: 'The Flows engine executes a node graph end-to-end; each node is a plugin.', score: 0.50 },
    ],
  },
};

describe('rerank/executor', () => {
  it('reorders chunks so the most query-relevant lands first', async () => {
    const out: any = await execute(
      rerankNode({ query: 'flows workflow engine node graph', topN: 4 }),
      searchEnvelope,
      makeCtx(),
    );
    const r = out;
    expect(r.inputCount).toBe(4);
    expect(r.outputCount).toBe(4);
    // The two flows-engine chunks (b, d) must rank above the unrelated ones (a, c).
    const orderedIds = r.chunks.map((c: any) => c.id);
    const idxB = orderedIds.indexOf('b');
    const idxD = orderedIds.indexOf('d');
    const idxA = orderedIds.indexOf('a');
    const idxC = orderedIds.indexOf('c');
    expect(idxB).toBeLessThan(idxA);
    expect(idxB).toBeLessThan(idxC);
    expect(idxD).toBeLessThan(idxA);
    expect(idxD).toBeLessThan(idxC);
    // Top chunk carries a rerankScore + rerankRank.
    expect(r.chunks[0].rerankRank).toBe(1);
    expect(typeof r.chunks[0].rerankScore).toBe('number');
    expect(r.chunks[0].rerankScore).toBeGreaterThan(0);
    expect(r.method).toBe('lexical-bm25');
  });

  it('trims to topN', async () => {
    const out: any = await execute(
      rerankNode({ query: 'flows engine', topN: 2 }),
      searchEnvelope,
      makeCtx(),
    );
    expect(out.inputCount).toBe(4);
    expect(out.outputCount).toBe(2);
    expect(out.chunks).toHaveLength(2);
  });

  it('reports reordered=true when the kept order differs from input order', async () => {
    const out: any = await execute(
      rerankNode({ query: 'flows workflow engine', topN: 4 }),
      searchEnvelope,
      makeCtx(),
    );
    // Input order is a,b,c,d; the relevant b/d should rise, so reordered.
    expect(out.reordered).toBe(true);
  });

  it('extracts chunks from a flat results array (knowledge_search un-nested)', async () => {
    const out: any = await execute(
      rerankNode({ query: 'engine', topN: 5 }),
      { results: [{ content: 'the flows engine' }, { content: 'unrelated text' }] },
      makeCtx(),
    );
    expect(out.inputCount).toBe(2);
  });

  it('accepts a bare array as input', async () => {
    const out: any = await execute(
      rerankNode({ query: 'engine', topN: 5 }),
      [{ content: 'engine one' }, { content: 'engine two engine' }],
      makeCtx(),
    );
    expect(out.inputCount).toBe(2);
    // The chunk with two "engine" hits should outrank the single-hit chunk.
    expect(out.chunks[0].content).toContain('engine two');
  });

  it('returns a well-formed empty envelope on an empty candidate set', async () => {
    const out: any = await execute(
      rerankNode({ query: 'anything', topN: 5 }),
      { results: [] },
      makeCtx(),
    );
    expect(out.inputCount).toBe(0);
    expect(out.outputCount).toBe(0);
    expect(out.chunks).toEqual([]);
    expect(out.reordered).toBe(false);
  });

  it('interpolates {{trigger.X}} in the query', async () => {
    const out: any = await execute(
      rerankNode({ query: '{{trigger.q}}', topN: 4 }),
      { results: [{ content: 'flows engine details' }], q: 'flows engine' },
      makeCtx(),
    );
    // input here is the object carrying both `results` AND the trigger bag `q`.
    expect(out.query).toBe('flows engine');
  });

  it('throws when query is empty', async () => {
    await expect(
      execute(rerankNode({ query: '' }), searchEnvelope, makeCtx()),
    ).rejects.toThrow(/query/i);
  });

  it('preserves original chunk fields on output', async () => {
    const out: any = await execute(
      rerankNode({ query: 'flows engine', topN: 1 }),
      searchEnvelope,
      makeCtx(),
    );
    const top = out.chunks[0];
    expect(top).toHaveProperty('id');
    expect(top).toHaveProperty('content');
    expect(top).toHaveProperty('score');
    expect(top).toHaveProperty('rerankScore');
  });
});
