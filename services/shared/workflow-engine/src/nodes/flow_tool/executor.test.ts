/**
 * flow_tool — executor unit tests (RED first per TDD).
 *
 * The flow_tool node wraps another saved Flow + exposes it as a callable
 * "tool". Args from the caller are mapped to the wrapped flow's trigger
 * input via `inputMapping`; an `outputExtract` path pulls the desired
 * value out of the wrapped flow's final state.
 *
 * V1 scope: callable from a parent flow only (the agent dynamic-tool
 * integration is V1.1). The executor depends on the same
 * `ctx.executeSubWorkflow` hook sub_workflow uses, plus a new
 * `ctx.subFlowDepth` integer for recursion limiting.
 */

import { describe, it, expect, vi } from 'vitest';
import { execute } from './executor.js';
import type { NodeExecutionContext } from '../types.js';

function makeCtx(
  executeSubWorkflow: ReturnType<typeof vi.fn>,
  subFlowDepth = 0,
): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-ft-1',
    tenantId: 'tenant-a',
    apiUrl: 'http://api',
    interpolateTemplate: (t: string, input: unknown) => {
      const root = input as Record<string, unknown> | null;
      return String(t).replace(/\{\{\s*(?:input|args)\.([\w.]+)\s*\}\}/g, (_, path) => {
        const segments = String(path).split('.');
        let cursor: unknown = root;
        for (const seg of segments) {
          if (cursor && typeof cursor === 'object' && seg in (cursor as Record<string, unknown>)) {
            cursor = (cursor as Record<string, unknown>)[seg];
          } else {
            return '';
          }
        }
        return typeof cursor === 'string' ? cursor : JSON.stringify(cursor ?? '');
      });
    },
    getInternalAuthHeaders: () => ({}),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    executeSubWorkflow,
    subFlowDepth,
  } as unknown as NodeExecutionContext;
}

const mk = (data: Record<string, unknown>) => ({
  id: 'n_ft',
  type: 'flow_tool',
  data,
});

describe('flow_tool/executor', () => {
  it('maps args via inputMapping and invokes executeSubWorkflow with the resolved trigger input', async () => {
    const sub = vi.fn(async () => ({
      success: true,
      output: { webhook_response: { body: { summary: 'logs summarized: 0 errors found' } } },
    }));
    const ctx = makeCtx(sub);
    const out = await execute(
      mk({
        flowId: 'wf-leaf-1',
        toolName: 'analyze_logs',
        toolDescription: 'Analyze Loki logs.',
        inputMapping: {
          time_window: '{{args.time_window}}',
          namespace: '{{args.namespace}}',
        },
        outputExtract: 'webhook_response.body.summary',
      }),
      { time_window: '15m', namespace: 'openagentic' },
      ctx,
    );
    expect(sub).toHaveBeenCalledOnce();
    const [calledFlowId, calledInput] = sub.mock.calls[0];
    expect(calledFlowId).toBe('wf-leaf-1');
    expect(calledInput).toMatchObject({
      time_window: '15m',
      namespace: 'openagentic',
    });
    const o = out as {
      value: unknown;
      extracted: string;
      flowId: string;
      toolName: string;
    };
    expect(o.value).toBe('logs summarized: 0 errors found');
    expect(o.extracted).toBe('webhook_response.body.summary');
    expect(o.flowId).toBe('wf-leaf-1');
    expect(o.toolName).toBe('analyze_logs');
  });

  it('returns the full sub-flow output when outputExtract is empty', async () => {
    const subOutput = { a: 1, b: 'two' };
    const sub = vi.fn(async () => ({ success: true, output: subOutput }));
    const out = await execute(
      mk({ flowId: 'wf-leaf-2', inputMapping: {} }),
      {},
      makeCtx(sub),
    );
    const o = out as { value: unknown };
    expect(o.value).toEqual(subOutput);
  });

  it('throws with a clear error when flowId is missing', async () => {
    await expect(
      execute(mk({}), {}, makeCtx(vi.fn())),
    ).rejects.toThrow(/flowId/i);
  });

  it('throws when executeSubWorkflow hook is not wired', async () => {
    const ctrl = new AbortController();
    const ctx = {
      signal: ctrl.signal,
      executionId: 'exec-no-hook',
      apiUrl: 'http://api',
      interpolateTemplate: (t: string) => t,
      getInternalAuthHeaders: () => ({}),
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      // no executeSubWorkflow
    } as unknown as NodeExecutionContext;
    await expect(
      execute(mk({ flowId: 'wf-1' }), {}, ctx),
    ).rejects.toThrow(/executeSubWorkflow|engine.*hook|not.*wired/i);
  });

  it('propagates sub-flow failure as node_error', async () => {
    const sub = vi.fn(async () => ({ success: false, output: null, error: 'leaf node x failed' }));
    await expect(
      execute(mk({ flowId: 'wf-broken' }), {}, makeCtx(sub)),
    ).rejects.toThrow(/leaf node x failed|flow_tool/i);
  });

  it('enforces recursion depth cap (default 3) via subFlowDepth', async () => {
    const sub = vi.fn(async () => ({ success: true, output: {} }));
    const ctx = makeCtx(sub, /* current depth */ 3);
    await expect(
      execute(mk({ flowId: 'wf-deep' }), {}, ctx),
    ).rejects.toThrow(/depth|recursion|nested/i);
    expect(sub).not.toHaveBeenCalled();
  });

  it('resolves outputExtract via dot path (foo.bar[0].name pattern)', async () => {
    const sub = vi.fn(async () => ({
      success: true,
      output: { results: { items: [{ name: 'first' }, { name: 'second' }] } },
    }));
    const out = await execute(
      mk({ flowId: 'wf-leaf-3', outputExtract: 'results.items.0.name' }),
      {},
      makeCtx(sub),
    );
    const o = out as { value: unknown };
    expect(o.value).toBe('first');
  });

  it('inputMapping values are passed through ctx.interpolateTemplate', async () => {
    const sub = vi.fn(async () => ({ success: true, output: {} }));
    await execute(
      mk({
        flowId: 'wf-mapping',
        inputMapping: {
          // literal pass-through
          mode: 'fast',
          // nested args resolution
          window: '{{args.window}}',
        },
      }),
      { window: '5m' },
      makeCtx(sub),
    );
    const [, calledInput] = sub.mock.calls[0];
    expect(calledInput).toEqual({ mode: 'fast', window: '5m' });
  });
});
