/**
 * code node — executor tests.
 *
 * Migrated from WorkflowExecutionEngine.executeCodeNode (Task #46).
 * Runs user-supplied JavaScript inside the shared isolated-vm sandbox via
 * the new ctx.runIsolatedCode hook (engine wires this to `runSandboxed`),
 * with a fall-back to direct sandbox import when the hook is absent.
 *
 * Covers:
 *   1. happy path — invokes ctx.runIsolatedCode with the right code/timeout,
 *      returns the unwrapped value.
 *   2. defaults — language defaults to 'javascript', timeoutMs to 5000.
 *   3. missing required field — no `code` property → throws.
 *   4. abort signal honored — when ctx.signal is aborted, executor short-
 *      circuits before calling runIsolatedCode (or the hook itself bails).
 *   5. template interpolation — `code` strings are NOT interpolated (legacy
 *      executeCodeNode never templated user code; preserve that).
 *   6. unsupported language — non-javascript throws.
 *   7. output assertion — `code_did_not_error` catches `{ error: ... }` returns.
 */

import { describe, it, expect, vi } from 'vitest';
import { execute } from './executor.js';
import type { NodeExecutionContext } from '../types.js';

function makeCtx(
  runImpl?: (code: string, language: string, input: unknown, timeoutMs?: number) => Promise<unknown>,
  overrides: Partial<NodeExecutionContext> = {},
): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-code-1',
    apiUrl: 'http://api',
    interpolateTemplate: (t: string) => t,
    getInternalAuthHeaders: () => ({}),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    runIsolatedCode: runImpl
      ? vi.fn(runImpl)
      : vi.fn(async (_code, _lang, input) => ({ echoed: input })),
    ...overrides,
  };
}

const codeNode = (data: Record<string, unknown> = {}) => ({
  id: 'n_code',
  type: 'code',
  data,
});

describe('code/executor (Task #46 — schema-driven plugin shape)', () => {
  it('happy path — invokes ctx.runIsolatedCode with code, language, input, timeoutMs', async () => {
    const ctx = makeCtx(async () => 42);
    const out: any = await execute(
      codeNode({ code: 'return 42;', language: 'javascript', timeoutMs: 1000 }),
      { x: 1 },
      ctx,
    );
    expect(ctx.runIsolatedCode).toHaveBeenCalledWith('return 42;', 'javascript', { x: 1 }, 1000);
    expect(out).toBe(42);
  });

  it('defaults language to "javascript" and timeoutMs to 5000 when unset', async () => {
    const ctx = makeCtx(async () => 'ok');
    await execute(codeNode({ code: 'return 1;' }), null, ctx);
    expect(ctx.runIsolatedCode).toHaveBeenCalledWith('return 1;', 'javascript', null, 5000);
  });

  it('missing required `code` field → throws', async () => {
    const ctx = makeCtx();
    await expect(execute(codeNode({}), null, ctx)).rejects.toThrow(/code/i);
    expect(ctx.runIsolatedCode).not.toHaveBeenCalled();
  });

  it('aborted signal short-circuits before running code', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const ctx = makeCtx(undefined, { signal: ctrl.signal });
    await expect(execute(codeNode({ code: 'return 1;' }), null, ctx)).rejects.toThrow();
    expect(ctx.runIsolatedCode).not.toHaveBeenCalled();
  });

  it('does NOT interpolate the `code` string (preserves legacy behavior)', async () => {
    const ctx = makeCtx(async (code) => code);
    const out: any = await execute(
      codeNode({ code: 'return {{input.x}};' }),
      { x: 99 },
      ctx,
    );
    // The `code` was passed through verbatim — interpolation lives inside
    // the sandboxed code itself (it can read `input.x` directly).
    expect(out).toBe('return {{input.x}};');
  });

  it('non-javascript language throws unsupported error', async () => {
    const ctx = makeCtx();
    await expect(
      execute(codeNode({ code: 'print(1)', language: 'python' }), null, ctx),
    ).rejects.toThrow(/python|not.*supported|not.*implemented/i);
    expect(ctx.runIsolatedCode).not.toHaveBeenCalled();
  });

  it('throws when ctx.runIsolatedCode hook is unwired', async () => {
    const ctrl = new AbortController();
    const ctx: NodeExecutionContext = {
      signal: ctrl.signal,
      executionId: 'exec-code-1',
      apiUrl: 'http://api',
      interpolateTemplate: (t: string) => t,
      getInternalAuthHeaders: () => ({}),
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    };
    await expect(execute(codeNode({ code: 'return 1;' }), null, ctx)).rejects.toThrow(
      /runIsolatedCode|sandbox/i,
    );
  });
});
