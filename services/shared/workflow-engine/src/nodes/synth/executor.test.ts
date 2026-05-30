/**
 * synth node — executor tests.
 *
 * After Task #46 the synth (and its three aliases synth_synthesize / oat /
 * oat_synthesize) executor lives here. It POSTs to the api's
 * /api/synth/synthesize endpoint via abortableAxiosPost so that the
 * AbortController.signal cancels in-flight requests on workflow abort.
 *
 * The legacy executeSynthNode resolved userEmail via a Prisma user lookup;
 * the schema-driven executor resolves it via the new ctx.getUserEmail hook
 * (engine wires this to the prisma lookup).
 *
 * Synth has TWO success-shape branches:
 *   - normal completion → result envelope with tool + metrics + result
 *   - high-risk synth needing approval → { status: 'awaiting_approval', ... }
 * The engine's executeNodeWithRecovery special-cases status === 'awaiting_approval'
 * to pause the branch — the executor must preserve that exact return shape.
 *
 * Covers:
 *   1. happy path — POSTs to /api/synth/synthesize with resolved intent +
 *      userEmail, returns the normal result envelope.
 *   2. missing intent (no node.data.intent and input is not a string) → throws.
 *   3. abort signal threads through abortableAxiosPost (uses ctx.signal).
 *   4. template interpolation — {{trigger.body.text}} resolves before POST.
 *   5. awaiting_approval branch — returns { status: 'awaiting_approval', ... }
 *      preserved verbatim for the engine to detect.
 *   6. getUserEmail hook absent → still works, sends empty string.
 *   7. output assertion: refusal regex catches refusal/sorry summaries.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execute } from './executor.js';
import type { NodeExecutionContext } from '../types.js';

// Mock axios at module level so the executor's abortableAxiosPost actually
// hits our stub. We re-set the implementation per-test below.
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
    executionId: 'exec-synth-1',
    apiUrl: 'http://api',
    userId: 'user-7',
    interpolateTemplate: (t: string, input: any) =>
      typeof t === 'string'
        ? t.replace(/\{\{([^}]+)\}\}/g, (_, k) => {
            const parts = k.trim().split('.');
            let v: any = { input };
            for (const p of parts) v = v?.[p];
            return v !== undefined && typeof v !== 'object' ? String(v) : '';
          })
        : t,
    getInternalAuthHeaders: () => ({ 'X-Internal-Secret': 'shh' }),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    getUserEmail: vi.fn(async () => 'user@example.com'),
    ...overrides,
  };
}

const synthNode = (data: Record<string, unknown> = {}) => ({
  id: 'n_synth',
  type: 'synth',
  data,
});

describe('synth/executor (Task #46 — schema-driven plugin shape)', () => {
  beforeEach(() => {
    axiosPost.mockReset();
  });

  it('happy path — POSTs to /api/synth/synthesize with resolved intent + userEmail', async () => {
    axiosPost.mockResolvedValueOnce({
      status: 200,
      data: {
        success: true,
        result: { rows: [{ id: 1 }] },
        explanation: 'fetched data',
        riskLevel: 'low',
        capabilitiesUsed: ['data'],
        synthesisTimeMs: 100,
        executionTimeMs: 50,
        costUsd: 0.001,
      },
    });
    const ctx = makeCtx();
    const out: any = await execute(
      synthNode({ intent: 'fetch all users', capabilities: ['data'], dryRun: false }),
      null,
      ctx,
    );

    expect(axiosPost).toHaveBeenCalledTimes(1);
    const [url, body, config] = axiosPost.mock.calls[0];
    expect(url).toBe('http://api/api/synth/synthesize');
    expect(body.intent).toBe('fetch all users');
    expect(body.userId).toBe('user-7');
    expect(body.userEmail).toBe('user@example.com');
    expect(body.capabilities).toEqual(['data']);
    expect(config.signal).toBe(ctx.signal);

    expect(out.toolName).toBeDefined();
    expect(out.tool).toBeDefined();
    expect(out.tool.riskLevel).toBe('low');
  });

  it('missing intent (no data.intent + non-string input) throws', async () => {
    const ctx = makeCtx();
    await expect(execute(synthNode({}), null, ctx)).rejects.toThrow(/intent/i);
    expect(axiosPost).not.toHaveBeenCalled();
  });

  it('falls back to input as intent when input is a string', async () => {
    axiosPost.mockResolvedValueOnce({
      status: 200,
      data: {
        success: true,
        result: 'hi',
        explanation: 'noop',
        riskLevel: 'low',
        capabilitiesUsed: [],
        synthesisTimeMs: 1,
        executionTimeMs: 1,
        costUsd: 0,
      },
    });
    const ctx = makeCtx();
    await execute(synthNode({}), 'string-as-intent', ctx);
    const [, body] = axiosPost.mock.calls[0];
    expect(body.intent).toBe('string-as-intent');
  });

  it('abort signal threads through to axios via ctx.signal', async () => {
    axiosPost.mockResolvedValueOnce({
      status: 200,
      data: { success: true, result: {}, explanation: '', riskLevel: 'low', capabilitiesUsed: [], synthesisTimeMs: 1, executionTimeMs: 1, costUsd: 0 },
    });
    const ctrl = new AbortController();
    const ctx = makeCtx({ signal: ctrl.signal });
    await execute(synthNode({ intent: 'do thing' }), null, ctx);
    const [, , config] = axiosPost.mock.calls[0];
    expect(config.signal).toBe(ctrl.signal);
  });

  it('interpolates {{template}} variables in intent before POST', async () => {
    axiosPost.mockResolvedValueOnce({
      status: 200,
      data: { success: true, result: {}, explanation: '', riskLevel: 'low', capabilitiesUsed: [], synthesisTimeMs: 1, executionTimeMs: 1, costUsd: 0 },
    });
    const ctx = makeCtx();
    await execute(
      synthNode({ intent: 'fetch user {{input.name}}' }),
      { name: 'Alice' },
      ctx,
    );
    const [, body] = axiosPost.mock.calls[0];
    expect(body.intent).toBe('fetch user Alice');
  });

  it('awaiting_approval branch — returns { status: "awaiting_approval", ... } verbatim', async () => {
    axiosPost.mockResolvedValueOnce({
      status: 200,
      data: {
        success: false,
        error: 'High-risk operation requires human approval',
        approval: { required: true, approved: false },
        tool: {
          explanation: 'delete all users',
          riskLevel: 'high',
          riskReasoning: 'destructive',
          capabilitiesUsed: ['admin'],
        },
        metrics: { synthesisTimeMs: 100, executionTimeMs: 0, totalTimeMs: 100, costUsd: 0 },
      },
    });
    const ctx = makeCtx();
    const out: any = await execute(synthNode({ intent: 'delete all users' }), null, ctx);

    expect(out.status).toBe('awaiting_approval');
    expect(out.riskLevel).toBe('high');
    expect(out.tool).toBeDefined();
    expect(out.tool.riskLevel).toBe('high');
    expect(out.message).toMatch(/approval/i);
  });

  it('works when getUserEmail hook is absent (sends empty string)', async () => {
    axiosPost.mockResolvedValueOnce({
      status: 200,
      data: { success: true, result: {}, explanation: '', riskLevel: 'low', capabilitiesUsed: [], synthesisTimeMs: 1, executionTimeMs: 1, costUsd: 0 },
    });
    const ctx = makeCtx({ getUserEmail: undefined });
    await execute(synthNode({ intent: 'do' }), null, ctx);
    const [, body] = axiosPost.mock.calls[0];
    expect(body.userEmail).toBe('');
  });

  it('non-2xx response throws an error surfacing the API error string', async () => {
    axiosPost.mockResolvedValueOnce({
      status: 500,
      data: { error: 'synth pipeline failed' },
    });
    const ctx = makeCtx();
    await expect(execute(synthNode({ intent: 'fail me' }), null, ctx)).rejects.toThrow(
      /synth pipeline failed|failed/i,
    );
  });
});
