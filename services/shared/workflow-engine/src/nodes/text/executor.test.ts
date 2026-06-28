/**
 * text node — executor tests.
 *
 * The text node is a passthrough annotation. Tests cover:
 *   1. happy path — return input unchanged
 *   2. abort signal honored
 *   3. no template interpolation, no side effects
 */

import { describe, it, expect } from 'vitest';
import { execute } from './executor.js';
import { runWithAssertions } from '../registry.js';
import type { NodeExecutionContext } from '../types.js';
import schema from './schema.json' with { type: 'json' };

function makeCtx(overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-1',
    apiUrl: 'http://api',
    interpolateTemplate: (t: string) => t,
    getInternalAuthHeaders: () => ({}),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    ...overrides,
  };
}

const textNode = (data: Record<string, unknown> = {}) => ({
  id: 'n_text',
  type: 'text',
  data,
});

describe('text/executor', () => {
  it('returns the upstream input unchanged (object)', async () => {
    const input = { foo: 1, bar: 'two' };
    const out = await execute(textNode(), input, makeCtx());
    expect(out).toBe(input); // identity preserved
  });

  it('returns the upstream input unchanged (string)', async () => {
    const out = await execute(textNode(), 'hello', makeCtx());
    expect(out).toBe('hello');
  });

  it('returns null when input is null', async () => {
    const out = await execute(textNode({ text: 'doc note' }), null, makeCtx());
    expect(out).toBeNull();
  });

  it('does not interpolate the annotation text (no template work happens)', async () => {
    let called = 0;
    const ctx = makeCtx({
      interpolateTemplate: (t: string) => {
        called++;
        return t;
      },
    });
    await execute(textNode({ text: '{{trigger.body.x}}' }), { x: 1 }, ctx);
    expect(called).toBe(0);
  });

  it('honors aborted signal', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const ctx = makeCtx({ signal: ctrl.signal });
    await expect(execute(textNode(), 'data', ctx)).rejects.toThrow(/aborted/);
  });

  // Schema integration --------------------------------------------------------

  it('integrates with runWithAssertions (no assertions => no failure)', async () => {
    const plugin = { schema: schema as any, execute };
    const out = await runWithAssertions(plugin, textNode() as any, { x: 1 }, makeCtx());
    expect(out).toEqual({ x: 1 });
  });
});
