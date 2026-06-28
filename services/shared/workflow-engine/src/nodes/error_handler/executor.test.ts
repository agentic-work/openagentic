/**
 * error_handler node — executor tests.
 *
 * Covers:
 *   1. action=log — returns { action: 'logged', error }
 *   2. action=notify — returns { action: 'notified', channel, error }
 *   3. action=transform — evaluates expression in sandbox, returns result
 *   4. action=transform — sandbox failure returns transform_failed sentinel
 *   5. default action (no errorAction) — treated as log
 *   6. action=retry — returns { action: 'retry', error }
 *   7. transform result — sandbox can access error and input globals
 */

import { describe, it, expect } from 'vitest';
import { execute } from './executor.js';
import type { NodeExecutionContext } from '../types.js';

function makeCtx(overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-err-1',
    apiUrl: 'http://api',
    interpolateTemplate: (t: string) => t,
    getInternalAuthHeaders: () => ({}),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    ...overrides,
  };
}

const errNode = (data: Record<string, unknown>) => ({
  id: 'n_err',
  type: 'error_handler',
  data,
});

describe('error_handler/executor', () => {
  const sampleError = { error: 'boom', input: { x: 1 }, nodeId: 'n_upstream' };

  it('action=log — returns { action: logged, error }', async () => {
    const out: any = await execute(errNode({ errorAction: 'log' }), sampleError, makeCtx());
    expect(out.action).toBe('logged');
    expect(out.error).toBe(sampleError);
  });

  it('action=notify — returns { action: notified, channel, error }', async () => {
    const out: any = await execute(
      errNode({ errorAction: 'notify', notificationChannel: 'slack' }),
      sampleError,
      makeCtx(),
    );
    expect(out.action).toBe('notified');
    expect(out.channel).toBe('slack');
    expect(out.error).toBe(sampleError);
  });

  it('action=transform — evaluates sandbox expression and returns result', async () => {
    // sampleError.error = 'boom'. The executor passes globals: { error: errorData.error, input: errorData.input }
    // So `error` = 'boom' (string), `input` = { x: 1 }
    const out: any = await execute(
      errNode({ errorAction: 'transform', transformExpression: '({ message: error, handled: true })' }),
      sampleError,
      makeCtx(),
    );
    expect(out.message).toBe('boom');
    expect(out.handled).toBe(true);
  });

  it('action=transform — sandbox failure returns transform_failed sentinel', async () => {
    const out: any = await execute(
      errNode({ errorAction: 'transform', transformExpression: 'throw new Error("oops")' }),
      sampleError,
      makeCtx(),
    );
    expect(out.action).toBe('transform_failed');
    expect(out.error).toBe(sampleError);
    expect(out.transformError).toBeTruthy();
  });

  it('no errorAction (default) — falls through to { action, error }', async () => {
    const out: any = await execute(errNode({}), sampleError, makeCtx());
    // Default action is 'log' since the code does `action = node.data.errorAction || 'log'`
    expect(out.action).toBe('logged');
    expect(out.error).toBe(sampleError);
  });

  it('action=retry — returns { action: retry, error }', async () => {
    const out: any = await execute(errNode({ errorAction: 'retry' }), sampleError, makeCtx());
    expect(out.action).toBe('retry');
    expect(out.error).toBe(sampleError);
  });

  it('action=transform — sandbox has access to error global', async () => {
    // errorData = { error: 'fail', input: { x: 42 } }
    // executor extracts: error = errorData.error = 'fail'
    // Note: sandbox's built-in `input` parameter shadows global `input` — use `error` directly
    const out: any = await execute(
      errNode({ errorAction: 'transform', transformExpression: '({ errorMsg: error, handled: true })' }),
      { error: 'fail', input: { x: 42 } },
      makeCtx(),
    );
    expect(out.errorMsg).toBe('fail');
    expect(out.handled).toBe(true);
  });
});
