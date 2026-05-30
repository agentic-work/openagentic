/**
 * user_context node — executor tests.
 *
 * Migrated from WorkflowExecutionEngine.executeUserContextNode.
 *
 * Calls GET {apiUrl}/api/user-context with userId/sources/query/maxTokens
 * and returns the response body. Failures degrade gracefully to a
 * { context: [], error } shape so the workflow doesn't hard-fail on a
 * transient context-service hiccup.
 *
 * Covers:
 *   - happy path — returns api response body
 *   - default sources (chat/workflow/memory) when not provided
 *   - default maxTokens (2000) when not provided
 *   - contextQuery is interpolated against input
 *   - missing userId still calls the api (matches legacy behavior — the
 *     api itself enforces userId presence)
 *   - upstream error → returns { context: [], error: '<msg>' }
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
    executionId: 'exec-uc-1',
    apiUrl: 'http://test-api',
    userId: 'user-42',
    interpolateTemplate: (t: string, input: any) =>
      typeof t === 'string'
        ? t.replace(/\{\{([^}]+)\}\}/g, (_, k) => String(input?.[k.trim()] ?? ''))
        : t,
    getInternalAuthHeaders: () => ({ 'X-Internal-Secret': 'shh' }),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    ...overrides,
  };
}

const ucNode = (data: Record<string, unknown> = {}) => ({
  id: 'n_uc',
  type: 'user_context',
  data,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('user_context/executor', () => {
  it('happy path — returns the api response body', async () => {
    vi.spyOn(axios, 'get').mockResolvedValueOnce({
      status: 200,
      data: {
        context: [{ source: 'chat', text: 'recent chat...' }],
        userId: 'user-42',
      },
    } as any);

    const out: any = await execute(ucNode(), null, makeCtx());
    expect(out.userId).toBe('user-42');
    expect(out.context).toHaveLength(1);
  });

  it('default sources = chat,workflow,memory when not provided', async () => {
    const get = vi.spyOn(axios, 'get').mockResolvedValueOnce({
      status: 200,
      data: { context: [] },
    } as any);
    await execute(ucNode(), null, makeCtx());
    const sentConfig: any = get.mock.calls[0][1];
    expect(sentConfig.params.sources).toBe('chat,workflow,memory');
  });

  it('forwards explicit contextSources', async () => {
    const get = vi.spyOn(axios, 'get').mockResolvedValueOnce({
      status: 200,
      data: { context: [] },
    } as any);
    await execute(
      ucNode({ contextSources: ['memory', 'chat'] }),
      null,
      makeCtx(),
    );
    const sentConfig: any = get.mock.calls[0][1];
    expect(sentConfig.params.sources).toBe('memory,chat');
  });

  it('default maxTokens=2000 when not provided', async () => {
    const get = vi.spyOn(axios, 'get').mockResolvedValueOnce({
      status: 200,
      data: { context: [] },
    } as any);
    await execute(ucNode(), null, makeCtx());
    const sentConfig: any = get.mock.calls[0][1];
    expect(sentConfig.params.maxTokens).toBe(2000);
  });

  it('forwards explicit contextMaxTokens', async () => {
    const get = vi.spyOn(axios, 'get').mockResolvedValueOnce({
      status: 200,
      data: { context: [] },
    } as any);
    await execute(
      ucNode({ contextMaxTokens: 500 }),
      null,
      makeCtx(),
    );
    const sentConfig: any = get.mock.calls[0][1];
    expect(sentConfig.params.maxTokens).toBe(500);
  });

  it('interpolates contextQuery against input', async () => {
    const get = vi.spyOn(axios, 'get').mockResolvedValueOnce({
      status: 200,
      data: { context: [] },
    } as any);
    await execute(
      ucNode({ contextQuery: 'recent posts about {{topic}}' }),
      { topic: 'k8s' },
      makeCtx(),
    );
    const sentConfig: any = get.mock.calls[0][1];
    expect(sentConfig.params.query).toBe('recent posts about k8s');
  });

  it('forwards userId from ctx', async () => {
    const get = vi.spyOn(axios, 'get').mockResolvedValueOnce({
      status: 200,
      data: { context: [] },
    } as any);
    await execute(ucNode(), null, makeCtx({ userId: 'alice-1' }));
    const sentConfig: any = get.mock.calls[0][1];
    expect(sentConfig.params.userId).toBe('alice-1');
  });

  it('forwards internal auth headers', async () => {
    const get = vi.spyOn(axios, 'get').mockResolvedValueOnce({
      status: 200,
      data: { context: [] },
    } as any);
    await execute(ucNode(), null, makeCtx());
    const sentConfig: any = get.mock.calls[0][1];
    expect(sentConfig.headers['X-Internal-Secret']).toBe('shh');
  });

  it('forwards AbortSignal', async () => {
    const ctrl = new AbortController();
    const get = vi.spyOn(axios, 'get').mockResolvedValueOnce({
      status: 200,
      data: { context: [] },
    } as any);
    await execute(ucNode(), null, makeCtx({ signal: ctrl.signal }));
    const sentConfig: any = get.mock.calls[0][1];
    expect(sentConfig.signal).toBe(ctrl.signal);
  });

  it('upstream error → returns { context: [], error: <msg> } (graceful degrade)', async () => {
    vi.spyOn(axios, 'get').mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    const out: any = await execute(ucNode(), null, makeCtx());
    expect(out.context).toEqual([]);
    expect(out.error).toMatch(/ECONNREFUSED/i);
  });

  // outputAssertion ----------------------------------------------------------

  it('runWithAssertions: happy path with context array passes', async () => {
    vi.spyOn(axios, 'get').mockResolvedValueOnce({
      status: 200,
      data: { context: [{ source: 'chat', text: 'hi' }] },
    } as any);
    const plugin = { schema: schema as any, execute };
    const out: any = await runWithAssertions(plugin, ucNode() as any, null, makeCtx());
    expect(out.context).toHaveLength(1);
  });

  it('runWithAssertions: api outage produces { context: [], error } and FAILS the non_empty_content assertion', async () => {
    vi.spyOn(axios, 'get').mockRejectedValueOnce(new Error('timeout'));
    const plugin = { schema: schema as any, execute };
    let caught: unknown;
    try {
      await runWithAssertions(plugin, ucNode() as any, null, makeCtx());
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(OutputAssertionError);
    expect((caught as OutputAssertionError).failedAssertion).toBe('non_empty_content');
  });
});
