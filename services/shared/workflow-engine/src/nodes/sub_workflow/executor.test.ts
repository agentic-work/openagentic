/**
 * sub_workflow node — executor tests.
 *
 * Migrated from WorkflowExecutionEngine.executeSubWorkflowNode.
 *
 * Invokes another saved workflow by id via the optional
 * ctx.executeSubWorkflow hook (the engine wires this to a recursive
 * `executeWorkflow(...)` call). Returns the sub-workflow's output on
 * success; throws when the sub-workflow reports failure or when the hook
 * is missing in production wiring.
 *
 * Covers:
 *   - happy path — returns output from { success:true, output }
 *   - missing-required-field (workflowId) — throws
 *   - passInput=true (default) — wraps non-object input as { data: input }
 *   - passInput=true with object — passes through verbatim
 *   - passInput=false — sub-workflow gets {}
 *   - sub-workflow failure — throws with error message
 *   - hook missing — throws (engine wiring is required)
 *   - aborted signal — throws
 *   - workflowId is interpolated against input
 *   - subworkflow_completed_successfully assertion via runWithAssertions
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execute } from './executor.js';
import { runWithAssertions } from '../registry.js';
import { OutputAssertionError } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import schema from './schema.json' with { type: 'json' };

function makeCtx(overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-sw-1',
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

const swNode = (data: Record<string, unknown>) => ({
  id: 'n_sw',
  type: 'sub_workflow',
  data,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('sub_workflow/executor', () => {
  it('happy path — returns the sub-workflow output', async () => {
    const executeSubWorkflow = vi.fn().mockResolvedValue({
      success: true,
      output: { result: 'sub-done' },
    });
    const out: any = await execute(
      swNode({ workflowId: 'wf-123' }),
      { foo: 'bar' },
      makeCtx({ executeSubWorkflow }),
    );
    expect(executeSubWorkflow).toHaveBeenCalledOnce();
    expect(executeSubWorkflow.mock.calls[0][0]).toBe('wf-123');
    expect(out).toEqual({ result: 'sub-done' });
  });

  it('throws when workflowId is missing (required field)', async () => {
    const executeSubWorkflow = vi.fn();
    await expect(
      execute(swNode({}), null, makeCtx({ executeSubWorkflow })),
    ).rejects.toThrow(/workflowId/i);
    expect(executeSubWorkflow).not.toHaveBeenCalled();
  });

  it('passInput=true (default) — object input passes through verbatim', async () => {
    const executeSubWorkflow = vi
      .fn()
      .mockResolvedValue({ success: true, output: 'ok' });
    await execute(
      swNode({ workflowId: 'wf-1' }),
      { a: 1, b: 2 },
      makeCtx({ executeSubWorkflow }),
    );
    expect(executeSubWorkflow.mock.calls[0][1]).toEqual({ a: 1, b: 2 });
  });

  it('passInput=true — non-object input wrapped as { data: <input> }', async () => {
    const executeSubWorkflow = vi
      .fn()
      .mockResolvedValue({ success: true, output: 'ok' });
    await execute(
      swNode({ workflowId: 'wf-1' }),
      'plain-string',
      makeCtx({ executeSubWorkflow }),
    );
    expect(executeSubWorkflow.mock.calls[0][1]).toEqual({ data: 'plain-string' });
  });

  it('passInput=false — sub-workflow receives {}', async () => {
    const executeSubWorkflow = vi
      .fn()
      .mockResolvedValue({ success: true, output: 'ok' });
    await execute(
      swNode({ workflowId: 'wf-1', passInput: false }),
      { secret: 'do not forward' },
      makeCtx({ executeSubWorkflow }),
    );
    expect(executeSubWorkflow.mock.calls[0][1]).toEqual({});
  });

  it('sub-workflow failure — throws with error message', async () => {
    const executeSubWorkflow = vi.fn().mockResolvedValue({
      success: false,
      output: undefined,
      error: 'inner-fail',
    });
    await expect(
      execute(swNode({ workflowId: 'wf-1' }), null, makeCtx({ executeSubWorkflow })),
    ).rejects.toThrow(/inner-fail/);
  });

  it('sub-workflow failure with no error string — throws generic message', async () => {
    const executeSubWorkflow = vi
      .fn()
      .mockResolvedValue({ success: false, output: undefined });
    await expect(
      execute(swNode({ workflowId: 'wf-1' }), null, makeCtx({ executeSubWorkflow })),
    ).rejects.toThrow(/sub-workflow failed/i);
  });

  it('throws when ctx.executeSubWorkflow hook is missing', async () => {
    await expect(
      execute(swNode({ workflowId: 'wf-1' }), null, makeCtx()),
    ).rejects.toThrow(/executeSubWorkflow/i);
  });

  it('throws when signal is already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const executeSubWorkflow = vi
      .fn()
      .mockResolvedValue({ success: true, output: 'ok' });
    await expect(
      execute(
        swNode({ workflowId: 'wf-1' }),
        null,
        makeCtx({ signal: ctrl.signal, executeSubWorkflow }),
      ),
    ).rejects.toThrow(/abort/i);
    expect(executeSubWorkflow).not.toHaveBeenCalled();
  });

  it('interpolates workflowId against input', async () => {
    const executeSubWorkflow = vi
      .fn()
      .mockResolvedValue({ success: true, output: 'ok' });
    await execute(
      swNode({ workflowId: '{{wfId}}' }),
      { wfId: 'wf-from-template' },
      makeCtx({ executeSubWorkflow }),
    );
    expect(executeSubWorkflow.mock.calls[0][0]).toBe('wf-from-template');
  });

  // outputAssertion ----------------------------------------------------------

  it('runWithAssertions: successful sub-workflow output passes', async () => {
    const executeSubWorkflow = vi
      .fn()
      .mockResolvedValue({ success: true, output: { final: 'value' } });
    const plugin = { schema: schema as any, execute };
    const out: any = await runWithAssertions(
      plugin,
      swNode({ workflowId: 'wf-ok' }) as any,
      null,
      makeCtx({ executeSubWorkflow }),
    );
    expect(out).toEqual({ final: 'value' });
  });

  // The subworkflow_completed_successfully assertion is implicit — the
  // executor throws on failure, so runWithAssertions never sees a "failed
  // sub-workflow result". The check is a defense-in-depth guard against a
  // future executor that might forget to throw.
  it('runWithAssertions: null sub-workflow output FAILS subworkflow_completed_successfully', async () => {
    const executeSubWorkflow = vi
      .fn()
      .mockResolvedValue({ success: true, output: null });
    const plugin = { schema: schema as any, execute };
    let caught: unknown;
    try {
      await runWithAssertions(
        plugin,
        swNode({ workflowId: 'wf-empty' }) as any,
        null,
        makeCtx({ executeSubWorkflow }),
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(OutputAssertionError);
    expect((caught as OutputAssertionError).failedAssertion).toBe(
      'subworkflow_completed_successfully',
    );
  });
});
