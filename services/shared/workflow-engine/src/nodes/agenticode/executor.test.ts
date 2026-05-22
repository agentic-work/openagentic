/**
 * openagentic node — executor tests.
 *
 * Migrated from WorkflowExecutionEngine.executeOpenagenticNode (Task #46).
 * Posts to the openagentic-manager service to spawn an isolated session.
 *
 * Covers:
 *   1. happy path — POSTs to <openagenticManagerUrl>/api/execute with
 *      resolved code, language, timeout, executionId; returns the
 *      stdout/stderr/exitCode envelope.
 *   2. defaults — language defaults to 'python', timeout to 30000ms.
 *   3. missing required field — no `code` property → throws.
 *   4. abort signal threads through abortableAxiosPost.
 *   5. template interpolation — `{{input.foo}}` resolved before POST.
 *   6. ECONNREFUSED / ENOTFOUND → "manager not reachable" friendly error.
 *   7. openagenticManagerUrl absent on ctx → throws config error.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execute } from './executor.js';
import type { NodeExecutionContext } from '../types.js';

vi.mock('axios', () => {
  const post = vi.fn();
  return {
    default: { post },
  };
});

import axios from 'axios';
const axiosPost = (axios as any).post as ReturnType<typeof vi.fn>;

function makeCtx(overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-ac-1',
    apiUrl: 'http://api',
    authToken: 'Bearer test-token',
    interpolateTemplate: (t: string, input: any) =>
      typeof t === 'string'
        ? t.replace(/\{\{([^}]+)\}\}/g, (_, k) => {
            const parts = k.trim().split('.');
            let v: any = { input };
            for (const p of parts) v = v?.[p];
            return v !== undefined && typeof v !== 'object' ? String(v) : '';
          })
        : t,
    getInternalAuthHeaders: () => ({ 'X-Internal-Service': 'shh' }),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    openagenticManagerUrl: 'http://openagentic-mgr:8080',
    ...overrides,
  };
}

const acNode = (data: Record<string, unknown> = {}) => ({
  id: 'n_ac',
  type: 'openagentic',
  data,
});

describe('openagentic/executor (Task #46 — schema-driven plugin shape)', () => {
  beforeEach(() => {
    axiosPost.mockReset();
  });

  it('happy path — POSTs to /api/execute with resolved code + language + executionId', async () => {
    axiosPost.mockResolvedValueOnce({
      status: 200,
      data: {
        stdout: 'hello\n',
        stderr: '',
        exitCode: 0,
        sessionStatus: 'completed',
      },
    });
    const ctx = makeCtx();
    const out: any = await execute(
      acNode({ code: 'print("hello")', language: 'python', timeout: 5000 }),
      null,
      ctx,
    );

    expect(axiosPost).toHaveBeenCalledTimes(1);
    const [url, body, config] = axiosPost.mock.calls[0];
    expect(url).toBe('http://openagentic-mgr:8080/api/execute');
    expect(body.code).toBe('print("hello")');
    expect(body.language).toBe('python');
    expect(body.timeout).toBe(5000);
    expect(body.workflowExecutionId).toBe('exec-ac-1');
    expect(config.signal).toBe(ctx.signal);
    expect(config.headers.Authorization).toBe('Bearer test-token');

    expect(out.stdout).toBe('hello\n');
    expect(out.exitCode).toBe(0);
  });

  it('defaults language to "python" and timeout to 30000', async () => {
    axiosPost.mockResolvedValueOnce({ status: 200, data: { stdout: '', stderr: '', exitCode: 0 } });
    const ctx = makeCtx();
    await execute(acNode({ code: 'noop' }), null, ctx);
    const [, body] = axiosPost.mock.calls[0];
    expect(body.language).toBe('python');
    expect(body.timeout).toBe(30000);
  });

  it('missing required `code` → throws', async () => {
    const ctx = makeCtx();
    await expect(execute(acNode({}), null, ctx)).rejects.toThrow(/code/i);
    expect(axiosPost).not.toHaveBeenCalled();
  });

  it('abort signal threads through to axios via ctx.signal', async () => {
    axiosPost.mockResolvedValueOnce({ status: 200, data: { stdout: '', stderr: '', exitCode: 0 } });
    const ctrl = new AbortController();
    const ctx = makeCtx({ signal: ctrl.signal });
    await execute(acNode({ code: 'noop' }), null, ctx);
    const [, , config] = axiosPost.mock.calls[0];
    expect(config.signal).toBe(ctrl.signal);
  });

  it('interpolates {{template}} variables in code before POST', async () => {
    axiosPost.mockResolvedValueOnce({ status: 200, data: { stdout: '', stderr: '', exitCode: 0 } });
    const ctx = makeCtx();
    await execute(
      acNode({ code: 'print("{{input.name}}")' }),
      { name: 'world' },
      ctx,
    );
    const [, body] = axiosPost.mock.calls[0];
    expect(body.code).toBe('print("world")');
  });

  it('ECONNREFUSED → friendly "not reachable" error', async () => {
    axiosPost.mockRejectedValueOnce(Object.assign(new Error('connect ECONNREFUSED'), {
      code: 'ECONNREFUSED',
    }));
    const ctx = makeCtx();
    await expect(execute(acNode({ code: 'noop' }), null, ctx)).rejects.toThrow(
      /not reachable|openagentic-mgr/i,
    );
  });

  it('openagenticManagerUrl missing → throws config error', async () => {
    const ctx = makeCtx({ openagenticManagerUrl: '' });
    await expect(execute(acNode({ code: 'noop' }), null, ctx)).rejects.toThrow(
      /openagenticManagerUrl|manager url|configured/i,
    );
  });
});
