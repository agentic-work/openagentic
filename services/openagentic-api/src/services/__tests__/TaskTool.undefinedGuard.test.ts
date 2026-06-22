/**
 * P0 #927 — sub-agent dispatch fails with "Cannot read properties of
 * undefined (reading 'length')".
 *
 * Field-observed crash: when the model dispatches Task with a malformed
 * tool_use (missing the input entirely, or buildTaskToolDescription's
 * `agents` argument is undefined because `deps.listAgents()` rejected and
 * the caller didn't catch), the dispatcher throws a TypeError instead of
 * returning a clean tool_error to the model.
 *
 * Fix scope:
 *   1. buildTaskToolDescription(undefined) must NOT throw; must return a
 *      sensible fallback string (the "no agents registered" branch).
 *   2. executeTask(ctx, undefined, deps) must NOT throw; must return a
 *      clean { ok: false, error } the model can apologize about.
 *
 * RED: both currently throw the TypeError.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  buildTaskToolDescription,
  executeTask,
  type TaskInput,
  type TaskDeps,
} from '../TaskTool.js';

function makeCtx() {
  return {
    emit: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    sessionId: 'sess-test',
    userId: 'user-test',
  } as any;
}

function makeDeps(): TaskDeps {
  return {
    listSubagentTypes: vi.fn().mockResolvedValue([]),
    runSubagent: vi.fn().mockResolvedValue({
      ok: true,
      output: 'never reached',
      turns: 0,
      tokens: 0,
      durationMs: 0,
      toolsUsed: [],
    }),
  };
}

describe('TaskTool — #927 undefined-input guards', () => {
  it('buildTaskToolDescription(undefined) does NOT throw — returns the no-agents fallback', async () => {
    // Pre-fix: this throws `TypeError: Cannot read properties of undefined
    // (reading 'length')` because the function body calls `agents.length`
    // without a null guard.
    await expect(
      buildTaskToolDescription(undefined as any),
    ).resolves.toMatch(/no specialized agents|no agents registered|general-purpose/i);
  });

  it('buildTaskToolDescription(null) does NOT throw — returns the no-agents fallback', async () => {
    await expect(
      buildTaskToolDescription(null as any),
    ).resolves.toMatch(/no specialized agents|no agents registered|general-purpose/i);
  });

  it('executeTask(ctx, undefined, deps) does NOT throw — returns ok:false with a clean error', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    // Pre-fix: this might throw `TypeError: Cannot read properties of
    // undefined (reading 'length')` (or similar) when the validation
    // chain hits a downstream field on undefined input. Defensive guard
    // must return a clean tool_error.
    let threw = false;
    let result: any;
    try {
      result = await executeTask(ctx, undefined as any, deps);
    } catch (err) {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(result).toBeDefined();
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe('string');
    expect(result.error.length).toBeGreaterThan(0);
  });

  it('executeTask(ctx, null, deps) does NOT throw — returns ok:false with a clean error', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    let threw = false;
    let result: any;
    try {
      result = await executeTask(ctx, null as any, deps);
    } catch (err) {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(result).toBeDefined();
    expect(result.ok).toBe(false);
  });
});
