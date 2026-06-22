/**
 * data_source_query node — executor tests.
 *
 * Migrated from WorkflowExecutionEngine.executeDataSourceQueryNode (legacy
 * switch case 'data_source_query'). Distinct from data_query which targets
 * the vector-search endpoint.
 *
 * The executor:
 *   - Requires `dataSourceId`
 *   - Supports mode='raw' (POST /api/data-sources/:id/query with { query })
 *     and mode='nl' (POST /api/data-sources/:id/nl-query with { question }).
 *   - Throws when the upstream returns success:false.
 *   - Returns { rows, columns, rowCount, executionTimeMs, generatedQuery, content }.
 *
 * Covers:
 *   - happy path raw mode — shaped result, correct endpoint
 *   - happy path nl mode — calls /nl-query with { question }
 *   - missing dataSourceId — throws
 *   - missing query in raw mode — throws
 *   - nl mode falls back to {{input.message}} when question is blank
 *   - upstream success:false — throws with error
 *   - abort signal forwarded
 *   - templating — query interpolated against input
 *   - internal auth headers forwarded
 *   - query_returned_rows + no_query_error assertions via runWithAssertions
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
    executionId: 'exec-dsq-1',
    apiUrl: 'http://test-api',
    interpolateTemplate: (t: string, input: any) =>
      typeof t === 'string'
        ? t.replace(/\{\{([^}]+)\}\}/g, (_, k) => {
            const path = k.trim();
            if (path === 'input.message') return String((input as any)?.message ?? '');
            return String((input as any)?.[path] ?? '');
          })
        : t,
    getInternalAuthHeaders: () => ({ 'X-Internal-Secret': 'shh' }),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    ...overrides,
  };
}

const dsqNode = (data: Record<string, unknown> = {}) => ({
  id: 'n_dsq',
  type: 'data_source_query',
  data,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('data_source_query/executor', () => {
  function mockOk(payload: any = {}) {
    return vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: {
        success: true,
        rows: [],
        columns: [],
        rowCount: 0,
        executionTimeMs: 0,
        ...payload,
      },
    } as any);
  }

  it('happy path raw mode — POSTs to /query and shapes the result', async () => {
    const post = mockOk({ rows: [{ id: 1 }, { id: 2 }], rowCount: 2, columns: ['id'] });
    const out: any = await execute(
      dsqNode({ dataSourceId: 'ds-1', query: 'SELECT * FROM users' }),
      null,
      makeCtx(),
    );
    expect(post).toHaveBeenCalledOnce();
    const url = post.mock.calls[0][0];
    const body: any = post.mock.calls[0][1];
    expect(url).toBe('http://test-api/api/data-sources/ds-1/query');
    expect(body).toEqual({ query: 'SELECT * FROM users' });
    expect(out.rows).toEqual([{ id: 1 }, { id: 2 }]);
    expect(out.rowCount).toBe(2);
    expect(out.columns).toEqual(['id']);
    // content is a JSON string of (a slice of) rows for downstream LLM context
    expect(typeof out.content).toBe('string');
    expect(out.content).toMatch(/"id":\s*1/);
  });

  it('happy path nl mode — POSTs to /nl-query with { question } and includes generatedQuery', async () => {
    const post = mockOk({
      rows: [{ count: 5 }],
      rowCount: 1,
      generatedQuery: 'SELECT count(*) FROM users WHERE created_at > now() - 7',
    });
    const out: any = await execute(
      dsqNode({ dataSourceId: 'ds-1', mode: 'nl', question: 'How many users this week?' }),
      null,
      makeCtx(),
    );
    const url = post.mock.calls[0][0];
    const body: any = post.mock.calls[0][1];
    expect(url).toBe('http://test-api/api/data-sources/ds-1/nl-query');
    expect(body).toEqual({ question: 'How many users this week?' });
    expect(out.generatedQuery).toMatch(/SELECT count/);
  });

  it('throws when dataSourceId is missing', async () => {
    const post = vi.spyOn(axios, 'post');
    await expect(
      execute(dsqNode({ query: 'SELECT 1' }), null, makeCtx()),
    ).rejects.toThrow(/dataSourceId/i);
    expect(post).not.toHaveBeenCalled();
  });

  it('throws when raw mode is used without a query', async () => {
    const post = vi.spyOn(axios, 'post');
    await expect(
      execute(dsqNode({ dataSourceId: 'ds-1' }), null, makeCtx()),
    ).rejects.toThrow(/query/i);
    expect(post).not.toHaveBeenCalled();
  });

  it('nl mode — falls back to {{input.message}} when question is blank', async () => {
    const post = mockOk({ rows: [], rowCount: 0 });
    await execute(
      dsqNode({ dataSourceId: 'ds-1', mode: 'nl' }),
      { message: 'how many failed jobs today?' },
      makeCtx(),
    );
    const body: any = post.mock.calls[0][1];
    expect(body.question).toBe('how many failed jobs today?');
  });

  it('throws when nl mode resolves to empty question text', async () => {
    const post = vi.spyOn(axios, 'post');
    await expect(
      execute(
        dsqNode({ dataSourceId: 'ds-1', mode: 'nl' }),
        null,
        makeCtx(),
      ),
    ).rejects.toThrow(/question/i);
    expect(post).not.toHaveBeenCalled();
  });

  it('throws when upstream returns success:false', async () => {
    vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: { success: false, error: 'syntax error near WHERE' },
    } as any);
    await expect(
      execute(
        dsqNode({ dataSourceId: 'ds-1', query: 'SELECT *' }),
        null,
        makeCtx(),
      ),
    ).rejects.toThrow(/syntax error/i);
  });

  it('throws with a generic message when upstream error is missing', async () => {
    vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: { success: false },
    } as any);
    await expect(
      execute(
        dsqNode({ dataSourceId: 'ds-1', query: 'SELECT *' }),
        null,
        makeCtx(),
      ),
    ).rejects.toThrow(/data source query failed/i);
  });

  it('forwards AbortSignal', async () => {
    const ctrl = new AbortController();
    const post = mockOk({});
    await execute(
      dsqNode({ dataSourceId: 'ds-1', query: 'SELECT 1' }),
      null,
      makeCtx({ signal: ctrl.signal }),
    );
    const config: any = post.mock.calls[0][2];
    expect(config.signal).toBe(ctrl.signal);
  });

  it('forwards internal auth headers', async () => {
    const post = mockOk({});
    await execute(
      dsqNode({ dataSourceId: 'ds-1', query: 'SELECT 1' }),
      null,
      makeCtx(),
    );
    const config: any = post.mock.calls[0][2];
    expect(config.headers['X-Internal-Secret']).toBe('shh');
    expect(config.headers['Content-Type']).toBe('application/json');
  });

  it('interpolates query against input', async () => {
    const post = mockOk({});
    await execute(
      dsqNode({
        dataSourceId: 'ds-1',
        query: "SELECT * FROM users WHERE tenant = '{{tenantId}}'",
      }),
      { tenantId: 't42' },
      makeCtx(),
    );
    const body: any = post.mock.calls[0][1];
    expect(body.query).toBe("SELECT * FROM users WHERE tenant = 't42'");
  });

  it('interpolates dataSourceId against input (allows data-driven routing)', async () => {
    const post = mockOk({});
    await execute(
      dsqNode({ dataSourceId: '{{dsId}}', query: 'SELECT 1' }),
      { dsId: 'ds-from-input' },
      makeCtx(),
    );
    const url = post.mock.calls[0][0];
    expect(url).toBe('http://test-api/api/data-sources/ds-from-input/query');
  });

  // outputAssertions ---------------------------------------------------------

  it('runWithAssertions: rows array passes both query_returned_rows and no_query_error', async () => {
    mockOk({ rows: [{ a: 1 }], rowCount: 1 });
    const plugin = { schema: schema as any, execute };
    const out: any = await runWithAssertions(
      plugin,
      dsqNode({ dataSourceId: 'ds-1', query: 'SELECT 1' }) as any,
      null,
      makeCtx(),
    );
    expect(out.rowCount).toBe(1);
  });

  it('runWithAssertions: empty rows still pass (zero rows is a valid count)', async () => {
    // Per the migration spec, empty rows must pass — the user may legitimately
    // want a count check downstream. We assert presence of the array shape only.
    mockOk({ rows: [], rowCount: 0 });
    const plugin = { schema: schema as any, execute };
    const out: any = await runWithAssertions(
      plugin,
      dsqNode({ dataSourceId: 'ds-1', query: 'SELECT 1' }) as any,
      null,
      makeCtx(),
    );
    expect(out.rowCount).toBe(0);
    expect(Array.isArray(out.rows)).toBe(true);
  });

  it('runWithAssertions: non-array rows FAIL query_returned_rows', async () => {
    mockOk({ rows: undefined, rowCount: 0 });
    const plugin = { schema: schema as any, execute };
    let caught: unknown;
    try {
      await runWithAssertions(
        plugin,
        dsqNode({ dataSourceId: 'ds-1', query: 'SELECT 1' }) as any,
        null,
        makeCtx(),
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(OutputAssertionError);
    expect((caught as OutputAssertionError).failedAssertion).toBe('query_returned_rows');
  });
});
