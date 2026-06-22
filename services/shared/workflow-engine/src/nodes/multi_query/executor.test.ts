/**
 * multi_query node — colocated executor unit tests.
 *
 * Covers the deterministic rule-based expander's contract in isolation:
 * original-first ordering, keyword/declarative/paraphrase variant
 * derivation, de-duplication, numQueries cap, the single-word safety net,
 * query templating, and the output envelope shape.
 */

import { describe, it, expect } from 'vitest';
import { execute } from './executor.js';
import type { NodeExecutionContext } from '../types.js';

function makeCtx(overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-mq-1',
    apiUrl: 'http://api',
    interpolateTemplate: (t: string, input: unknown) =>
      t.replace(/\{\{trigger\.(\w+)\}\}/g, (_m, k) => String((input as any)?.[k] ?? '')),
    getInternalAuthHeaders: () => ({}),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    ...overrides,
  } as NodeExecutionContext;
}

const mqNode = (data: Record<string, unknown>) => ({
  id: 'n_mq',
  type: 'multi_query',
  data,
});

describe('multi_query/executor', () => {
  it('expands a question into N distinct variants, original first', async () => {
    const question = 'What are the key features of the OpenAgentic Flows engine?';
    const out: any = await execute(mqNode({ question, numQueries: 4 }), {}, makeCtx());
    const r = out;
    expect(r.original).toBe(question);
    expect(Array.isArray(r.queries)).toBe(true);
    expect(r.queries.length).toBeGreaterThan(1);
    expect(r.queries.length).toBeLessThanOrEqual(4);
    expect(r.count).toBe(r.queries.length);
    // Original phrasing preserved as the first variant.
    expect(r.queries[0]).toBe(question);
    expect(r.method).toBe('rule-based-expansion');
  });

  it('produces a keyword-only variant (stopwords + question words stripped)', async () => {
    const out: any = await execute(
      mqNode({ question: 'What are the key features of the Flows engine?', numQueries: 6 }),
      {},
      makeCtx(),
    );
    const joined = out.queries.join(' | ').toLowerCase();
    // A keyword variant should retain the content terms.
    expect(joined).toContain('key features');
    expect(joined).toContain('flows engine');
    // And at least one variant drops the leading interrogative.
    const hasDeclarative = out.queries.some(
      (q: string) => !/^what\b/i.test(q.trim()) && /flows/i.test(q),
    );
    expect(hasDeclarative).toBe(true);
  });

  it('de-duplicates variants (case + whitespace + trailing punct normalized)', async () => {
    const out: any = await execute(
      mqNode({ question: 'Flows engine', numQueries: 8 }),
      {},
      makeCtx(),
    );
    const norm = out.queries.map((q: string) =>
      q.toLowerCase().replace(/\s+/g, ' ').trim().replace(/[?.!]+$/, ''),
    );
    expect(new Set(norm).size).toBe(norm.length);
  });

  it('caps the variant count at numQueries', async () => {
    const out: any = await execute(
      mqNode({ question: 'What are the architectural decisions behind the platform?', numQueries: 2 }),
      {},
      makeCtx(),
    );
    expect(out.queries.length).toBeLessThanOrEqual(2);
  });

  it('omits the original when includeOriginal=false', async () => {
    const question = 'What are the key features?';
    const out: any = await execute(
      mqNode({ question, numQueries: 4, includeOriginal: false }),
      {},
      makeCtx(),
    );
    expect(out.queries[0]).not.toBe(question);
    expect(out.queries.length).toBeGreaterThan(0);
  });

  it('never returns an empty fan-out for a one-word question', async () => {
    const out: any = await execute(
      mqNode({ question: 'flows', numQueries: 4 }),
      {},
      makeCtx(),
    );
    expect(out.queries.length).toBeGreaterThanOrEqual(1);
    expect(out.queries[0].length).toBeGreaterThan(0);
  });

  it('interpolates {{trigger.X}} in the question', async () => {
    const out: any = await execute(
      mqNode({ question: '{{trigger.question}}', numQueries: 3 }),
      { question: 'How does the engine route between nodes?' },
      makeCtx(),
    );
    expect(out.original).toBe('How does the engine route between nodes?');
    expect(out.queries[0]).toBe('How does the engine route between nodes?');
  });

  it('throws when question is empty', async () => {
    await expect(
      execute(mqNode({ question: '' }), {}, makeCtx()),
    ).rejects.toThrow(/question/i);
  });
});
