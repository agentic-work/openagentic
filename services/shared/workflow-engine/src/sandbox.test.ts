/**
 * Tests for the sandboxed JS executor used by the workflow engine
 * (code / condition / transform nodes).
 *
 * Security invariants (S0-2 / B1):
 *   - No process, globalThis, require, Function constructor escape.
 *   - Bounded wall time (default 5s).
 *   - Bounded memory (default 256MB).
 *
 * Functional invariants:
 *   - Async return supported.
 *   - Whitelisted globals (JSON, Math, Date, Array, Object, String, Number, Boolean) usable.
 *   - `input` is the sole argument and round-trips object values.
 */
import { describe, it, expect } from 'vitest';
import { runSandboxed } from './sandbox.js';

describe('runSandboxed — security invariants (S0-2 / B1)', () => {
  it('AC1: cannot read process.env', async () => {
    const result = await runSandboxed<unknown>('return typeof process;');
    expect(result.ok).toBe(true);
    if (result.ok) {
      // process must NOT exist inside the sandbox (typeof returns "undefined").
      expect(result.value).toBe('undefined');
    }
  });

  it('AC1b: process.env access throws inside sandbox', async () => {
    const result = await runSandboxed<unknown>('return process.env.PATH;');
    // Either throws ReferenceError or returns undefined — both acceptable; the
    // critical invariant is that the host PATH is never readable.
    if (result.ok) {
      expect(result.value).toBeUndefined();
    } else {
      expect(result.errorType).toBeDefined();
      expect(['runtime', 'security', 'syntax']).toContain(result.errorType);
    }
  });

  it('AC2: cannot escape via Function constructor / constructor.constructor chain', async () => {
    // The classic V8 escape: a function literal's constructor is `Function`,
    // and `Function("...")()` would normally compile arbitrary code.
    // Our sandbox must either reject this or evaluate it inside the same isolate
    // (so it still cannot reach the host's `process`).
    const result = await runSandboxed<unknown>(
      'try { return Function.prototype.constructor.constructor("return typeof process")(); } catch (e) { return "blocked:" + e.message; }'
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Either the constructor chain is blocked (returns "blocked:...") OR
      // it executes but inside the isolate where process is still undefined.
      const v = result.value as string;
      expect(typeof v).toBe('string');
      expect(v === 'undefined' || v.startsWith('blocked:')).toBe(true);
    }
  });

  it('AC3: globalThis.process is undefined', async () => {
    const result = await runSandboxed<unknown>('return typeof globalThis.process;');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('undefined');
    }
  });

  it('AC4: cannot import / require modules', async () => {
    const result = await runSandboxed<unknown>('const fs = require("fs"); return fs.readFileSync("/etc/hostname", "utf8");');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorType === 'runtime' || result.errorType === 'syntax' || result.errorType === 'security').toBe(true);
    }
  });

  it('AC5: blocks infinite loop within timeoutMs', async () => {
    const start = Date.now();
    const result = await runSandboxed<unknown>('while (true) {}', { timeoutMs: 250 });
    const elapsed = Date.now() - start;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorType).toBe('timeout');
    }
    // Allow generous slack — should be terminated well before 5s.
    expect(elapsed).toBeLessThan(3000);
  });

  it('AC6: aborts on memory cap exhaustion', async () => {
    // Allocate huge typed arrays until the cap kicks in.
    const code = `
      const acc = [];
      while (true) {
        acc.push(new Array(1_000_000).fill(0));
      }
    `;
    const result = await runSandboxed<unknown>(code, { memoryCapMb: 16, timeoutMs: 5000 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(['memory', 'timeout', 'runtime']).toContain(result.errorType);
    }
  }, 15000);

  it('AC7: legitimate compute returns correct value', async () => {
    const result = await runSandboxed<number>('return input.x + input.y;', { input: { x: 1, y: 2 } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(3);
    }
  });

  it('AC8: whitelisted globals are available', async () => {
    const result = await runSandboxed<Record<string, unknown>>(
      `return {
        json: JSON.stringify({a: 1}),
        max: Math.max(1, 2, 3),
        date: typeof Date,
        arr: Array.isArray([1,2]),
        obj: typeof Object,
        str: String(42),
        num: Number("3.14"),
        bool: Boolean(0),
      };`,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const v = result.value as Record<string, unknown>;
      expect(v.json).toBe('{"a":1}');
      expect(v.max).toBe(3);
      expect(v.date).toBe('function');
      expect(v.arr).toBe(true);
      expect(v.obj).toBe('function');
      expect(v.str).toBe('42');
      expect(v.num).toBe(3.14);
      expect(v.bool).toBe(false);
    }
  });

  it('AC9: async function bodies can return promises', async () => {
    // `await` is allowed inside the wrapper async function the helper uses.
    const code = `const x = await Promise.resolve(7); return x * 2;`;
    const result = await runSandboxed<number>(code);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(14);
    }
  });
});

describe('runSandboxed — error classification', () => {
  it('classifies syntax errors', async () => {
    const result = await runSandboxed<unknown>('return @@@;');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorType).toBe('syntax');
    }
  });

  it('classifies runtime errors thrown by user code', async () => {
    const result = await runSandboxed<unknown>('throw new Error("boom");');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorType).toBe('runtime');
      expect(result.error).toMatch(/boom/);
    }
  });

  it('returns numbers and strings transparently', async () => {
    const r1 = await runSandboxed<number>('return 42;');
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.value).toBe(42);
    const r2 = await runSandboxed<string>('return "hi";');
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.value).toBe('hi');
  });

  it('returns nested objects via deep copy', async () => {
    const result = await runSandboxed<Record<string, unknown>>('return { a: { b: { c: 1 } } };');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ a: { b: { c: 1 } } });
    }
  });

  it('passes large input objects through untouched', async () => {
    const big = { items: Array.from({ length: 100 }, (_, i) => ({ idx: i, val: `v${i}` })) };
    const result = await runSandboxed<number>('return input.items.length;', { input: big });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(100);
    }
  });
});

describe('runSandboxed — additional globals', () => {
  it('exposes user-supplied globals via the globals option', async () => {
    const result = await runSandboxed<number>('return myConstant + 1;', {
      globals: { myConstant: 41 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(42);
    }
  });

  it('does not leak host fetch unless explicitly provided', async () => {
    const result = await runSandboxed<unknown>('return typeof fetch;');
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Default sandbox excludes fetch — engine must opt in.
      expect(result.value).toBe('undefined');
    }
  });
});
