/**
 * Sandboxed JavaScript executor for the workflow engine.
 *
 * Replaces the `new Function(...)` pattern previously used by the
 * `code`, `condition`, and `transform` nodes (S0-2 / B1).
 *
 * Implementation: each call spawns a fresh V8 Isolate via the
 * `isolated-vm` native module. Isolates have no access to the
 * host's `process`, `globalThis`, `require`, `Buffer`, or any
 * Node.js globals — they are pure V8 contexts with only the
 * ECMAScript standard library plus whatever globals the caller
 * explicitly injects via `options.globals`.
 *
 * Hard caps:
 *   - timeoutMs (default 5000) — wall time before forced termination.
 *   - memoryCapMb (default 256) — V8 isolate heap cap. isolated-vm
 *     terminates the isolate when this is exceeded.
 *
 * S0-11 / engine-dedup TODO:
 *   This file is duplicated between openagentic-workflows and
 *   openagentic-api because both copies of WorkflowExecutionEngine
 *   are still in active use. When the engines are deduped (S0-11),
 *   collapse to a single shared package import. Until then, KEEP
 *   THE TWO COPIES BYTE-IDENTICAL.
 */

import ivm from 'isolated-vm';

export type SandboxErrorType = 'timeout' | 'memory' | 'syntax' | 'runtime' | 'security' | 'none';

/**
 * Result shape from {@link runSandboxed}. Uses a single shape with always-defined
 * fields (rather than a discriminated union) so that downstream consumers
 * compiled with `strict: false` (which disables `strictNullChecks` and the
 * union-narrowing pass it requires) can still read `result.error` and
 * `result.value` without ceremony.
 *
 * Invariants:
 *   - When `ok === true`, `value` holds the user-code return value;
 *     `error` is `''` and `errorType` is `'none'`.
 *   - When `ok === false`, `error` is a non-empty message and `errorType`
 *     identifies the failure class; `value` is `undefined`.
 */
export interface SandboxResult<T = unknown> {
  ok: boolean;
  value: T | undefined;
  error: string;
  errorType: SandboxErrorType;
}

export interface SandboxOptions {
  /** Hard wall time. Aborted if exceeded. Default: 5000 ms. */
  timeoutMs?: number;
  /** Memory cap (MB). Minimum 8 MB (isolated-vm requirement). Default: 256. */
  memoryCapMb?: number;
  /**
   * Whitelisted globals exposed to user code. Values must be JSON-serialisable
   * (deep-copied across the isolate boundary). Functions are NOT supported here
   * — the host should re-implement any required helpers in pure JS inside
   * `code` or expose them via a future Reference-based bridge.
   */
  globals?: Record<string, unknown>;
  /**
   * Input value passed as the sole argument to the user-authored function.
   * Must be JSON-serialisable.
   */
  input?: unknown;
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MEMORY_CAP_MB = 256;
const MIN_MEMORY_CAP_MB = 8; // isolated-vm minimum

/**
 * Compile + run user code in a V8 isolate, returning the result or a
 * classified error. Never throws.
 */
export async function runSandboxed<T = unknown>(
  code: string,
  options: SandboxOptions = {}
): Promise<SandboxResult<T>> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const memoryCapMb = Math.max(MIN_MEMORY_CAP_MB, options.memoryCapMb ?? DEFAULT_MEMORY_CAP_MB);

  let isolate: ivm.Isolate | null = null;
  try {
    isolate = new ivm.Isolate({ memoryLimit: memoryCapMb });
    const context = await isolate.createContext();
    const jail = context.global;

    // The isolate's global is otherwise empty (no Node globals at all).
    // Expose `global` -> itself for code that pokes at it, and inject
    // any caller-supplied globals as deep copies.
    await jail.set('global', jail.derefInto());

    if (options.globals) {
      for (const [key, value] of Object.entries(options.globals)) {
        await jail.set(key, new ivm.ExternalCopy(value).copyInto({ release: true }));
      }
    }

    // Inject input as a JSON-serialised string and re-parse inside the isolate
    // to avoid any reference leakage across the V8 boundary.
    const inputJson = options.input === undefined ? 'undefined' : JSON.stringify(options.input);
    await jail.set('__sandbox_input_json__', inputJson);

    // Wrap user code in an async function so `await` and early `return` work.
    // The wrapper must:
    //   1. Re-hydrate `input` from JSON inside the isolate.
    //   2. Stringify the result before transferring (so we never carry a
    //      live reference back to the host).
    //   3. Catch user errors and stash them as JSON for the host to re-raise.
    const wrapped = `
      (async () => {
        const input = __sandbox_input_json__ === 'undefined'
          ? undefined
          : JSON.parse(__sandbox_input_json__);
        const __user_fn__ = async function (input) {
          ${code}
        };
        const result = await __user_fn__(input);
        return JSON.stringify({ ok: true, value: result === undefined ? null : result, undef: result === undefined });
      })()
    `;

    let raw: string;
    try {
      raw = await context.eval(wrapped, { timeout: timeoutMs, promise: true }) as unknown as string;
    } catch (err) {
      return classifyIsolateError(err) as SandboxResult<T>;
    }

    let parsed: { ok: true; value: unknown; undef?: boolean };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, value: undefined, error: 'Sandbox returned non-JSON value', errorType: 'runtime' };
    }

    return {
      ok: true,
      value: (parsed.undef ? undefined : parsed.value) as T,
      error: '',
      errorType: 'none',
    };
  } catch (err) {
    return classifyIsolateError(err) as SandboxResult<T>;
  } finally {
    if (isolate && !isolate.isDisposed) {
      try { isolate.dispose(); } catch { /* ignore double-dispose */ }
    }
  }
}

/**
 * Map raw isolated-vm / V8 errors onto our typed SandboxErrorType union.
 * Never throws.
 */
function classifyIsolateError(err: unknown): SandboxResult<unknown> {
  const message = err instanceof Error ? err.message : String(err);

  // isolated-vm-specific signals
  if (/Script execution timed out/i.test(message) || /execution timed out/i.test(message)) {
    return { ok: false, value: undefined, error: message, errorType: 'timeout' };
  }
  if (/Array buffer allocation failed/i.test(message)
    || /memory limit/i.test(message)
    || /Isolate was disposed during execution due to memory limit/i.test(message)
    || /isolate.*disposed/i.test(message)) {
    return { ok: false, value: undefined, error: message, errorType: 'memory' };
  }
  if (/SyntaxError/i.test(message) || (err instanceof SyntaxError)) {
    return { ok: false, value: undefined, error: message, errorType: 'syntax' };
  }

  return { ok: false, value: undefined, error: message, errorType: 'runtime' };
}

// S0-11 / engine-dedup TODO: this file is duplicated between
// openagentic-workflows and openagentic-api because both copies of
// WorkflowExecutionEngine are still in active use. When the engines
// are deduped (S0-11), collapse to a single shared package import.
// Until then, KEEP THE TWO COPIES BYTE-IDENTICAL.
