/**
 * switch node — executor tests.
 *
 * After Task #45 the executor owns BOTH evaluation AND routing. The engine
 * wires `ctx.routeBranches` (calls `notifySkippedBranch` for each skipped
 * target id, then `executeNode` for each followed target id) and
 * `ctx.getOutgoingEdges` (returns the node's outgoing edges).
 *
 * Covers:
 *   1. expression evaluates and matched case is found → matching edge followed
 *   2. no match → falls back to default case
 *   3. no match and no default → matchedCase is 'none', no edges followed
 *   4. expression is interpolated before evaluation
 *   5. switchValue is always a string in the result
 *   6. unchosen edges are added to skip[] for notifySkippedBranch
 *   7. result shape exposes matched + evaluatedExpression for outputAssertions
 */

import { describe, it, expect, vi } from 'vitest';
import { execute } from './executor.js';
import type { NodeExecutionContext } from '../types.js';

interface CtxOverrides extends Partial<NodeExecutionContext> {
  outgoingEdges?: Array<{ target: string; label?: string; sourceHandle?: string }>;
}

function makeCtx(overrides: CtxOverrides = {}): {
  ctx: NodeExecutionContext;
  routed: { follow: string[]; skip: string[] } | null;
} {
  const ctrl = new AbortController();
  const state: { value: { follow: string[]; skip: string[] } | null } = { value: null };
  const outgoingEdges = overrides.outgoingEdges ?? [];
  const { outgoingEdges: _drop, ...rest } = overrides;
  const ctx: NodeExecutionContext = {
    signal: ctrl.signal,
    executionId: 'exec-switch-1',
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
    routeBranches: vi.fn(async (_id, decision) => {
      state.value = { follow: decision.follow, skip: decision.skip };
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

const switchNode = (data: Record<string, unknown>) => ({
  id: 'n_switch',
  type: 'switch',
  data,
});

const cases = [
  { value: 'a', label: 'Case A' },
  { value: 'b', label: 'Case B' },
  { value: 'default', label: 'Default' },
];

describe('switch/executor (Task #45 — schema-driven plugin shape)', () => {
  it('matched case found — follows that edge, skips others', async () => {
    const harness = makeCtx({
      outgoingEdges: [
        { target: 'n_a', sourceHandle: 'a' },
        { target: 'n_b', sourceHandle: 'b' },
        { target: 'n_default', sourceHandle: 'default' },
      ],
    });
    const out: any = await execute(
      switchNode({ expression: '"a"', cases }),
      null,
      harness.ctx,
    );
    expect(out.switchValue).toBe('a');
    expect(out.matched).toBe('Case A');
    expect(harness.routed?.follow).toEqual(['n_a']);
    expect(harness.routed?.skip).toEqual(['n_b', 'n_default']);
  });

  it('no match → falls back to default case edge', async () => {
    const harness = makeCtx({
      outgoingEdges: [
        { target: 'n_a', sourceHandle: 'a' },
        { target: 'n_default', sourceHandle: 'default' },
      ],
    });
    const out: any = await execute(
      switchNode({ expression: '"z"', cases }),
      null,
      harness.ctx,
    );
    expect(out.matched).toBe('Default');
    expect(harness.routed?.follow).toEqual(['n_default']);
    expect(harness.routed?.skip).toEqual(['n_a']);
  });

  it('no match and no default → matched is "none", no edges followed', async () => {
    const harness = makeCtx({
      outgoingEdges: [{ target: 'n_a', sourceHandle: 'a' }],
    });
    const out: any = await execute(
      switchNode({ expression: '"z"', cases: [{ value: 'a', label: 'A' }] }),
      null,
      harness.ctx,
    );
    expect(out.matched).toBe('none');
    expect(harness.routed?.follow).toEqual([]);
    // 'a' edge is skipped because nothing matched
    expect(harness.routed?.skip).toEqual(['n_a']);
  });

  it('expression is interpolated then evaluated', async () => {
    const harness = makeCtx({
      outgoingEdges: [
        { target: 'n_a', sourceHandle: 'a' },
        { target: 'n_b', sourceHandle: 'b' },
      ],
    });
    const out: any = await execute(
      switchNode({ expression: '"{{input.status}}"', cases }),
      { status: 'b' },
      harness.ctx,
    );
    expect(out.switchValue).toBe('b');
    expect(out.matched).toBe('Case B');
    expect(harness.routed?.follow).toEqual(['n_b']);
  });

  it('switchValue is returned as string', async () => {
    const harness = makeCtx({
      outgoingEdges: [{ target: 'n_42', sourceHandle: '42' }],
    });
    const out: any = await execute(
      switchNode({ expression: '42', cases: [{ value: '42', label: 'Forty Two' }] }),
      null,
      harness.ctx,
    );
    expect(out.switchValue).toBe('42');
    expect(out.matched).toBe('Forty Two');
  });

  it('result shape includes matched + evaluatedExpression for outputAssertions', async () => {
    const harness = makeCtx({
      outgoingEdges: [{ target: 'n_a', sourceHandle: 'a' }],
    });
    const out: any = await execute(
      switchNode({ expression: '"a"', cases: [{ value: 'a', label: 'A' }] }),
      null,
      harness.ctx,
    );
    expect(typeof out.matched).toBe('string');
    expect(out.evaluatedExpression).not.toBeUndefined();
  });

  it('match by source-handle when edge has no sourceHandle, falls back to position match', async () => {
    // First edge with no sourceHandle still receives the match if it's the only match.
    const harness = makeCtx({
      outgoingEdges: [{ target: 'n_only' }],
    });
    const out: any = await execute(
      switchNode({ expression: '"a"', cases: [{ value: 'a', label: 'A' }] }),
      null,
      harness.ctx,
    );
    // single edge → engine fallback follows it
    expect(harness.routed?.follow).toEqual(['n_only']);
    expect(out.matched).toBe('A');
  });
});
