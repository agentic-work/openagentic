/**
 * data_query node — executor tests.
 *
 * Migrated from WorkflowExecutionEngine.executeDataQueryNode.
 *
 * Posts to {apiUrl}/api/v1/vector/search with collection/query/topK/filters
 * and returns { collection, results, resultCount }.
 *
 * Covers:
 *   - happy path — returns shaped result
 *   - default collection name = 'default'
 *   - collectionName alternate field accepted
 *   - query interpolated against input
 *   - falls back to input.query / input.message / serialised input when
 *     no explicit query is configured
 *   - filters as JSON string interpolated then parsed
 *   - topK forwarded
 *   - HTTP 500 throws (legacy behavior — validateStatus:true + status>=400)
 *   - missing-collection still works (uses 'default')
 *   - abort signal forwarded
 *   - non_empty_content assertion via runWithAssertions
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { execute } from './executor.js';
import { runWithAssertions } from '../registry.js';
import { OutputAssertionError } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import schema from './schema.json' with { type: 'json' };

function makeCtx(overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-dq-1',
    apiUrl: 'http://test-api',
    interpolateTemplate: (t: string, input: any) =>
      typeof t === 'string'
        ? t.replace(/\{\{([^}]+)\}\}/g, (_, k) => String(input?.[k.trim()] ?? ''))
        : t,
    getInternalAuthHeaders: () => ({ 'X-Internal-Secret': 'shh' }),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    ...overrides,
  };
}

const dqNode = (data: Record<string, unknown> = {}) => ({
  id: 'n_dq',
  type: 'data_query',
  data,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('data_query/executor', () => {
  function mockOk(results: any[] = [{ id: 1, score: 0.9 }]) {
    return vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: { results },
    } as any);
  }

  it('happy path — returns { collection, results, resultCount }', async () => {
    mockOk([{ id: 'a' }, { id: 'b' }]);
    const out: any = await execute(
      dqNode({ collection: 'docs', query: 'who is alice' }),
      null,
      makeCtx(),
    );
    expect(out.collection).toBe('docs');
    expect(out.results).toHaveLength(2);
    expect(out.resultCount).toBe(2);
  });

  it("default collection = 'default' when not provided", async () => {
    const post = mockOk();
    await execute(dqNode({ query: 'x' }), null, makeCtx());
    const sentBody: any = post.mock.calls[0][1];
    expect(sentBody.collection).toBe('default');
  });

  it('accepts collectionName as an alternate field', async () => {
    const post = mockOk();
    await execute(
      dqNode({ collectionName: 'tenant_docs', query: 'x' }),
      null,
      makeCtx(),
    );
    const sentBody: any = post.mock.calls[0][1];
    expect(sentBody.collection).toBe('tenant_docs');
  });

  it('interpolates query against input', async () => {
    const post = mockOk();
    await execute(
      dqNode({ collection: 'docs', query: 'find {{topic}}' }),
      { topic: 'kubernetes' },
      makeCtx(),
    );
    const sentBody: any = post.mock.calls[0][1];
    expect(sentBody.query).toBe('find kubernetes');
  });

  it('falls back to input.query when query setting is absent', async () => {
    const post = mockOk();
    await execute(
      dqNode({ collection: 'docs' }),
      { query: 'fallback-q' },
      makeCtx(),
    );
    const sentBody: any = post.mock.calls[0][1];
    expect(sentBody.query).toBe('fallback-q');
  });

  it('falls back to input.message when query+input.query absent', async () => {
    const post = mockOk();
    await execute(
      dqNode({ collection: 'docs' }),
      { message: 'msg-fallback' },
      makeCtx(),
    );
    const sentBody: any = post.mock.calls[0][1];
    expect(sentBody.query).toBe('msg-fallback');
  });

  it('falls back to raw string input', async () => {
    const post = mockOk();
    await execute(dqNode({ collection: 'docs' }), 'plain-str', makeCtx());
    const sentBody: any = post.mock.calls[0][1];
    expect(sentBody.query).toBe('plain-str');
  });

  it('forwards limit as topK', async () => {
    const post = mockOk();
    await execute(
      dqNode({ collection: 'docs', query: 'x', limit: 25 }),
      null,
      makeCtx(),
    );
    const sentBody: any = post.mock.calls[0][1];
    expect(sentBody.topK).toBe(25);
  });

  it('default topK=10 when limit absent', async () => {
    const post = mockOk();
    await execute(dqNode({ collection: 'docs', query: 'x' }), null, makeCtx());
    const sentBody: any = post.mock.calls[0][1];
    expect(sentBody.topK).toBe(10);
  });

  it('parses filters as JSON string after interpolation', async () => {
    const post = mockOk();
    await execute(
      dqNode({
        collection: 'docs',
        query: 'x',
        filters: '{"tenant":"{{tenantId}}"}',
      }),
      { tenantId: 't42' },
      makeCtx(),
    );
    const sentBody: any = post.mock.calls[0][1];
    expect(sentBody.filters).toEqual({ tenant: 't42' });
  });

  it('passes object filters through as-is', async () => {
    const post = mockOk();
    await execute(
      dqNode({
        collection: 'docs',
        query: 'x',
        filters: { tenant: 't1', status: 'active' },
      }),
      null,
      makeCtx(),
    );
    const sentBody: any = post.mock.calls[0][1];
    expect(sentBody.filters).toEqual({ tenant: 't1', status: 'active' });
  });

  it('throws on non-2xx (HTTP 500)', async () => {
    vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 500,
      statusText: 'Internal Server Error',
      data: { error: 'boom' },
    } as any);
    await expect(
      execute(dqNode({ collection: 'docs', query: 'x' }), null, makeCtx()),
    ).rejects.toThrow(/Data query failed/i);
  });

  it('forwards AbortSignal', async () => {
    const ctrl = new AbortController();
    const post = mockOk();
    await execute(
      dqNode({ collection: 'docs', query: 'x' }),
      null,
      makeCtx({ signal: ctrl.signal }),
    );
    const sentConfig: any = post.mock.calls[0][2];
    expect(sentConfig.signal).toBe(ctrl.signal);
  });

  it('forwards internal auth headers', async () => {
    const post = mockOk();
    await execute(
      dqNode({ collection: 'docs', query: 'x' }),
      null,
      makeCtx(),
    );
    const sentConfig: any = post.mock.calls[0][2];
    expect(sentConfig.headers['X-Internal-Secret']).toBe('shh');
  });

  // outputAssertion ----------------------------------------------------------

  it('runWithAssertions: results array passes non_empty_content', async () => {
    mockOk([{ id: 'a' }]);
    const plugin = { schema: schema as any, execute };
    const out: any = await runWithAssertions(
      plugin,
      dqNode({ collection: 'docs', query: 'x' }) as any,
      null,
      makeCtx(),
    );
    expect(out.resultCount).toBe(1);
  });

  it('runWithAssertions: empty results FAIL non_empty_content', async () => {
    mockOk([]);
    const plugin = { schema: schema as any, execute };
    let caught: unknown;
    try {
      await runWithAssertions(
        plugin,
        dqNode({ collection: 'docs', query: 'x' }) as any,
        null,
        makeCtx(),
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(OutputAssertionError);
    expect((caught as OutputAssertionError).failedAssertion).toBe('non_empty_content');
  });
});
