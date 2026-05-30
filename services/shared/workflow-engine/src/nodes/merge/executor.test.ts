/**
 * merge node — executor tests.
 *
 * The merge node combines results from multiple incoming edges.
 * Engine-side graph state (incomingEdges, nodeResults, nodeMap) is
 * surfaced via the optional ctx.getIncomingResults hook.
 *
 * Covers:
 *   1. strategy=array — returns array of incoming values
 *   2. strategy=object — returns labeled object keyed by source label
 *   3. strategy=concat — flattens arrays from all inputs
 *   4. strategy=object (default) — default when not specified
 *   5. single input — passes through without merging
 *   6. no inputs — returns the upstream input as fallback
 *   7. getIncomingResults not provided — falls back to [input] (engine path)
 *   8. outputAssertion: merged result is not null when inputs exist
 */

import { describe, it, expect } from 'vitest';
import { execute } from './executor.js';
import { runWithAssertions } from '../registry.js';
import type { NodeExecutionContext } from '../types.js';
import schema from './schema.json' with { type: 'json' };

function makeCtx(
  overrides: Partial<NodeExecutionContext> = {},
  incomingResults?: Array<{ sourceId: string; label: string; value: unknown }>,
): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-merge-1',
    apiUrl: 'http://api',
    interpolateTemplate: (t: string) => t,
    getInternalAuthHeaders: () => ({}),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    getIncomingResults: incomingResults ? (_nodeId) => incomingResults : undefined,
    ...overrides,
  };
}

const mergeNode = (data: Record<string, unknown> = {}) => ({
  id: 'n_merge',
  type: 'merge',
  data,
});

describe('merge/executor', () => {
  const twoInputs = [
    { sourceId: 'n_a', label: 'node_a', value: { x: 1 } },
    { sourceId: 'n_b', label: 'node_b', value: { y: 2 } },
  ];

  it('strategy=array — returns array of all incoming values', async () => {
    const out = await execute(
      mergeNode({ mergeStrategy: 'array' }),
      null,
      makeCtx({}, twoInputs),
    );
    expect(out).toEqual([{ x: 1 }, { y: 2 }]);
  });

  it('strategy=object — returns labeled object', async () => {
    const out: any = await execute(
      mergeNode({ mergeStrategy: 'object' }),
      null,
      makeCtx({}, twoInputs),
    );
    expect(out.node_a).toEqual({ x: 1 });
    expect(out.node_b).toEqual({ y: 2 });
  });

  it('strategy=concat — flattens array values', async () => {
    const concatInputs = [
      { sourceId: 'n_a', label: 'a', value: [1, 2] },
      { sourceId: 'n_b', label: 'b', value: [3, 4] },
    ];
    const out = await execute(
      mergeNode({ mergeStrategy: 'concat' }),
      null,
      makeCtx({}, concatInputs),
    );
    expect(out).toEqual([1, 2, 3, 4]);
  });

  it('default strategy (object) when mergeStrategy not specified', async () => {
    const out: any = await execute(
      mergeNode(),
      null,
      makeCtx({}, twoInputs),
    );
    // Falls through to default → same as object
    expect(typeof out).toBe('object');
    expect(Array.isArray(out)).toBe(false);
  });

  it('single input — passes through the single value', async () => {
    const oneInput = [{ sourceId: 'n_a', label: 'node_a', value: { x: 1 } }];
    const out = await execute(
      mergeNode({ mergeStrategy: 'array' }),
      null,
      makeCtx({}, oneInput),
    );
    expect(out).toEqual({ x: 1 });
  });

  it('no incoming results — falls back to upstream input', async () => {
    const input = { fallback: true };
    const out = await execute(
      mergeNode({ mergeStrategy: 'array' }),
      input,
      makeCtx({}, []),
    );
    expect(out).toBe(input);
  });

  it('getIncomingResults not provided — wraps input in single-item array (engine provides hook)', async () => {
    // When the hook is absent (e.g. older engine path), executor wraps the
    // single upstream input and uses that.
    const input = { data: 'x' };
    const out = await execute(
      mergeNode({ mergeStrategy: 'array' }),
      input,
      makeCtx(),
    );
    // Single item → passthrough
    expect(out).toBe(input);
  });

  // outputAssertion via runWithAssertions -----------------------------------

  it('runWithAssertions: merged result is not null when inputs exist', async () => {
    const plugin = { schema: schema as any, execute };
    const out = await runWithAssertions(
      plugin,
      mergeNode({ mergeStrategy: 'array' }) as any,
      null,
      makeCtx({}, twoInputs),
    );
    expect(out).not.toBeNull();
    expect(Array.isArray(out)).toBe(true);
  });
});
