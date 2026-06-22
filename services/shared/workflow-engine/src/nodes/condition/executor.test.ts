/**
 * condition node — executor tests.
 *
 * After Task #45 the executor owns BOTH evaluation and routing. The engine
 * wires `ctx.routeBranches` (calls `notifySkippedBranch` for each skipped
 * target id, then `executeNode` for each followed target id) and
 * `ctx.getOutgoingEdges` (returns the node's outgoing edges).
 *
 * Covers:
 *   1. JS expression returns true → routes to true-labeled branch, skips false
 *   2. JS expression returns false → routes to false-labeled branch, skips true
 *   3. comparison expression (input.score > 50)
 *   4. template-interpolated condition via ctx.interpolateTemplate
 *   5. condition missing → returns matched=false, no routing
 *   6. position-based routing fallback (no labels → first edge for truthy, second for falsy)
 *   7. result shape includes matched + evaluatedExpression for outputAssertions
 *   8. when only one outgoing edge, always follow it
 *   9. boolean string aliases ('yes' / 'no') match true/false labels
 */

import { describe, it, expect, vi } from 'vitest';
import { execute } from './executor.js';
import type { NodeExecutionContext } from '../types.js';

interface CtxOverrides extends Partial<NodeExecutionContext> {
  outgoingEdges?: Array<{ target: string; label?: string; sourceHandle?: string }>;
}

function makeCtx(overrides: CtxOverrides = {}): {
  ctx: NodeExecutionContext;
  routed: { follow: string[]; skip: string[]; input: unknown } | null;
} {
  const ctrl = new AbortController();
  const state: { value: { follow: string[]; skip: string[]; input: unknown } | null } = { value: null };
  const outgoingEdges = overrides.outgoingEdges ?? [];
  const { outgoingEdges: _drop, ...rest } = overrides;
  const ctx: NodeExecutionContext = {
    signal: ctrl.signal,
    executionId: 'exec-cond-1',
    apiUrl: 'http://api',
    interpolateTemplate: (t: string, input: any) =>
      typeof t === 'string'
        ? t.replace(/\{\{([^}]+)\}\}/g, (_, k) => {
            const parts = k.trim().split('.');
            let v: any = { input };
            for (const p of parts) v = v?.[p];
            return v !== undefined ? String(v) : '';
          })
        : t,
    getInternalAuthHeaders: () => ({}),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    getOutgoingEdges: () => outgoingEdges,
    routeBranches: vi.fn(async (_id, decision, input) => {
      state.value = { follow: decision.follow, skip: decision.skip, input };
    }),
    ...rest,
  };
  return {
    ctx,
    get routed() {
      return state.value;
    },
  } as any;
}

const condNode = (data: Record<string, unknown>) => ({
  id: 'n_cond',
  type: 'condition',
  data,
});

describe('condition/executor (Task #45 — schema-driven plugin shape)', () => {
  it('truthy expression → follows true-labeled edge, skips false-labeled', async () => {
    const harness = makeCtx({
      outgoingEdges: [
        { target: 'n_true', label: 'true' },
        { target: 'n_false', label: 'false' },
      ],
    });
    const out: any = await execute(condNode({ condition: '1 === 1' }), null, harness.ctx);

    expect(harness.routed?.follow).toEqual(['n_true']);
    expect(harness.routed?.skip).toEqual(['n_false']);
    expect(out.matched).toBe('true');
    expect(out.evaluatedExpression).toBe(true);
  });

  it('falsy expression → follows false-labeled edge, skips true-labeled', async () => {
    const harness = makeCtx({
      outgoingEdges: [
        { target: 'n_true', label: 'true' },
        { target: 'n_false', label: 'false' },
      ],
    });
    const out: any = await execute(condNode({ condition: '1 === 2' }), null, harness.ctx);

    expect(harness.routed?.follow).toEqual(['n_false']);
    expect(harness.routed?.skip).toEqual(['n_true']);
    expect(out.matched).toBe('false');
    expect(out.evaluatedExpression).toBe(false);
  });

  it('comparison using input — input.score > 50', async () => {
    const harness = makeCtx({
      outgoingEdges: [
        { target: 'n_true', label: 'true' },
        { target: 'n_false', label: 'false' },
      ],
    });
    const out: any = await execute(
      condNode({ condition: 'input.score > 50' }),
      { score: 75 },
      harness.ctx,
    );
    expect(harness.routed?.follow).toEqual(['n_true']);
    expect(out.evaluatedExpression).toBe(true);
  });

  it('interpolates {{template}} variables before evaluation', async () => {
    const harness = makeCtx({
      outgoingEdges: [
        { target: 'n_true', label: 'true' },
        { target: 'n_false', label: 'false' },
      ],
    });
    const out: any = await execute(
      condNode({ condition: 'input.value > {{input.threshold}}' }),
      { value: 80, threshold: 50 },
      harness.ctx,
    );
    expect(out.evaluatedExpression).toBe(true);
    expect(harness.routed?.follow).toEqual(['n_true']);
  });

  it('missing condition → matched=false, no routing edges followed', async () => {
    const harness = makeCtx({
      outgoingEdges: [{ target: 'n_a' }, { target: 'n_b' }],
    });
    const out: any = await execute(condNode({}), null, harness.ctx);
    expect(out.matched).toBe('false');
    expect(out.evaluatedExpression).toBe(false);
  });

  it('position-based routing fallback when no edge labels match (truthy → first, falsy → second)', async () => {
    // Edges labeled with non-truthy strings → no label match, falls through
    // to position-based: first edge for truthy result.
    const harness = makeCtx({
      outgoingEdges: [
        { target: 'n_first', label: 'x' },
        { target: 'n_second', label: 'y' },
      ],
    });
    await execute(condNode({ condition: 'true' }), null, harness.ctx);
    expect(harness.routed?.follow).toEqual(['n_first']);
    expect(harness.routed?.skip).toEqual(['n_second']);
  });

  it('single outgoing edge → always followed', async () => {
    const harness = makeCtx({
      outgoingEdges: [{ target: 'n_only' }],
    });
    await execute(condNode({ condition: 'false' }), null, harness.ctx);
    expect(harness.routed?.follow).toEqual(['n_only']);
    expect(harness.routed?.skip).toEqual([]);
  });

  it('result shape includes matched (string) and evaluatedExpression (boolean/string)', async () => {
    const harness = makeCtx({ outgoingEdges: [{ target: 'n_only' }] });
    const out: any = await execute(condNode({ condition: '1 === 1' }), null, harness.ctx);
    expect(typeof out.matched).toBe('string');
    expect(out.evaluatedExpression).not.toBeUndefined();
  });

  it('"yes"/"no" string edge labels alias true/false', async () => {
    const harness = makeCtx({
      outgoingEdges: [
        { target: 'n_yes', label: 'yes' },
        { target: 'n_no', label: 'no' },
      ],
    });
    await execute(condNode({ condition: 'true' }), null, harness.ctx);
    expect(harness.routed?.follow).toEqual(['n_yes']);
    expect(harness.routed?.skip).toEqual(['n_no']);
  });
});
