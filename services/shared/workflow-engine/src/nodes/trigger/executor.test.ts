/**
 * trigger node — executor tests.
 *
 * Migrated from WorkflowExecutionEngine.executeTrigger.
 *
 * The trigger node is the workflow's entry point. It:
 *   - Publishes the input on the execution context as __trigger__ data
 *     so downstream nodes can resolve {{trigger.body.*}} and {{trigger.*}}
 *     template references.
 *   - Returns the input as-is so downstream nodes have something to template
 *     against.
 *
 * Also exercises:
 *   - happy path (input passes through, setTriggerData hook called)
 *   - object input → flat keys + nested body shape
 *   - non-object input → only nested body shape (no flat keys)
 *   - null input → triggerData is just { body: null }
 *   - aborted signal — throws
 *   - interpolation — none required (no settings to interpolate)
 *   - non_empty_content assertion exercised via runWithAssertions
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
    executionId: 'exec-trigger-1',
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

const triggerNode = (data: Record<string, unknown> = {}) => ({
  id: 'n_trigger',
  type: 'trigger',
  data,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('trigger/executor', () => {
  it('happy path — returns the input unchanged', async () => {
    const out = await execute(
      triggerNode({ triggerType: 'manual' }),
      { message: 'hello', topic: 'cats' },
      makeCtx(),
    );
    expect(out).toEqual({ message: 'hello', topic: 'cats' });
  });

  it('publishes object input as both flat keys and nested body via setTriggerData', async () => {
    const setTriggerData = vi.fn();
    await execute(
      triggerNode(),
      { message: 'hi', userId: 'u1' },
      makeCtx({ setTriggerData }),
    );
    expect(setTriggerData).toHaveBeenCalledOnce();
    const td = setTriggerData.mock.calls[0][0];
    // flat keys: trigger.message
    expect(td.message).toBe('hi');
    expect(td.userId).toBe('u1');
    // canonical nested: trigger.body.message
    expect(td.body).toEqual({ message: 'hi', userId: 'u1' });
  });

  it('non-object input — only nested body, no flat-key spread', async () => {
    const setTriggerData = vi.fn();
    await execute(triggerNode(), 'plain-string-input', makeCtx({ setTriggerData }));
    const td = setTriggerData.mock.calls[0][0];
    expect(td.body).toBe('plain-string-input');
    // no spread of string characters as flat keys
    expect(Object.keys(td)).toEqual(['body']);
  });

  it('null input — triggerData is just { body: null }', async () => {
    const setTriggerData = vi.fn();
    await execute(triggerNode(), null, makeCtx({ setTriggerData }));
    const td = setTriggerData.mock.calls[0][0];
    expect(td).toEqual({ body: null });
  });

  it('array input — only nested body (arrays not spread as flat keys)', async () => {
    const setTriggerData = vi.fn();
    await execute(triggerNode(), [1, 2, 3], makeCtx({ setTriggerData }));
    const td = setTriggerData.mock.calls[0][0];
    expect(td.body).toEqual([1, 2, 3]);
    expect(Object.keys(td)).toEqual(['body']);
  });

  it('does NOT throw when setTriggerData hook is absent', async () => {
    await expect(
      execute(triggerNode(), { x: 1 }, makeCtx()),
    ).resolves.toEqual({ x: 1 });
  });

  it('throws when signal is already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      execute(triggerNode(), { a: 1 }, makeCtx({ signal: ctrl.signal })),
    ).rejects.toThrow(/abort/i);
  });

  // Interpolation: trigger node has no string settings to interpolate,
  // but we still exercise that the templater (if called) is harmless.
  it('does not call interpolateTemplate when no settings need it', async () => {
    const interpolateTemplate = vi.fn((t: string) => t);
    await execute(triggerNode(), { ok: true }, makeCtx({ interpolateTemplate }));
    expect(interpolateTemplate).not.toHaveBeenCalled();
  });

  // outputAssertion -----------------------------------------------------------

  it('runWithAssertions: non-empty input passes non_empty_content', async () => {
    const plugin = { schema: schema as any, execute };
    const out = await runWithAssertions(
      plugin,
      triggerNode() as any,
      { foo: 'bar' },
      makeCtx(),
    );
    expect(out).toEqual({ foo: 'bar' });
  });

  it('runWithAssertions: null input fails non_empty_content', async () => {
    const plugin = { schema: schema as any, execute };
    let caught: unknown;
    try {
      await runWithAssertions(plugin, triggerNode() as any, null, makeCtx());
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(OutputAssertionError);
    expect((caught as OutputAssertionError).failedAssertion).toBe('non_empty_content');
  });

  it('runWithAssertions: empty-object input passes (presence not size)', async () => {
    const plugin = { schema: schema as any, execute };
    // An empty object IS still a published trigger event — different from null.
    const out = await runWithAssertions(plugin, triggerNode() as any, {}, makeCtx());
    expect(out).toEqual({});
  });
});
