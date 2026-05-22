/**
 * Sev-0 #793 — `synth_execute` meta-tool client must NOT throw on malformed
 * or partial responses from synth-executor.
 *
 * Live evidence: dev crashed during a synth code-gen attempt because the
 * client called `.substring()` on a field that was undefined. The exact crash
 * site was `SynthExecutorClient.execute()` line 93 — the structured-log
 * `intent: request.intent.substring(0, 100)` block runs BEFORE the inner
 * try/catch, so when the model emits a `synth_execute({code, ...})` tool call
 * without an `intent` arg (despite the schema saying required, models lie),
 * the un-guarded `.substring` blows up the entire chat loop.
 *
 * Fix discipline (TDD):
 *   1. RED — three cases covering the most-likely undefined-field paths:
 *      a) request.intent omitted entirely (no intent field at all)
 *      b) request.intent set to undefined (explicit undefined)
 *      c) executor returns {success:false, error} with no stdout/result/etc
 *   2. GREEN — narrow every `.substring()` call site to `String(x ?? '')`.
 *      Don't widen the type signature; narrow at the call site. The wrapper
 *      `executeSynthExecute` must return a clean `{ok:false, error}` envelope
 *      that chatLoop can surface back to the model without crashing.
 *
 * Plan: feedback_real_provider_testing_regime_chatmode_pivot (TDD red→green).
 */
import { describe, it, expect, vi } from 'vitest';
import pino from 'pino';
import { executeSynthExecute } from '../SynthExecuteTool.js';
import { SynthExecutorClient } from '../SynthExecutorClient.js';

const TEST_KEY = 'test-signing-key-not-for-production-but-not-dev-secret';

describe('Sev-0 #793 — synth_execute client must not throw on undefined fields', () => {
  it('executeSynthExecute returns ok:false envelope when intent is undefined (no throw)', async () => {
    // Real executor would never be reached — the substring crash fires
    // BEFORE the await. We use the real SynthExecutorClient here (not a
    // mock) so we exercise the exact line-93 code path that crashed live.
    process.env.SERVICE_JWT_KEY = TEST_KEY;
    const logger = pino({ level: 'silent' });
    const client = new SynthExecutorClient({ baseUrl: 'http://nowhere.invalid', logger });

    // Stub fetch so if execution somehow reaches the network, we don't make
    // a real call. After the fix lands the test should NOT reach this stub.
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        execution_id: 'exec-1',
        success: false,
        error: 'subprocess blocked',
        execution_time_ms: 1,
        code_hash: 'h',
        started_at: '',
        completed_at: '',
      }),
    }) as any;

    try {
      const result = await executeSynthExecute(
        { userId: 'u-793', sessionId: 's-793', logger: { warn: () => {} } },
        // intent intentionally undefined — model emitted only `code`
        { code: 'print(1)', intent: undefined as any },
        { client },
      );
      // Must not throw. Must return a clean envelope.
      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
      expect(typeof result.error).toBe('string');
    } finally {
      global.fetch = originalFetch;
      delete process.env.SERVICE_JWT_KEY;
    }
  });

  it('executeSynthExecute returns ok:false envelope when executor returns {success:false, error} with no stdout/result fields', async () => {
    // Mock the client (not the network) so we control the executor response
    // shape directly. The malformed-error case: executor blocks the run and
    // returns only `{success:false, error:"subprocess blocked"}` — every
    // other field undefined. The wrapper must NOT crash chatLoop.
    const mockClient = {
      execute: vi.fn().mockResolvedValue({
        executionId: 'exec-1',
        success: false,
        error: 'subprocess blocked',
        // Intentionally undefined: stdout, stderr, result, executionTimeMs,
        // memoryUsedBytes, codeHash, startedAt, completedAt
      }),
    };

    const result = await executeSynthExecute(
      { userId: 'u-793', sessionId: 's-793', logger: { warn: () => {} } },
      { code: 'print(1)', intent: 'unit-test' },
      { client: mockClient as any },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('subprocess blocked');
    expect(result.output).toBeUndefined();
  });

  it('SynthExecutorClient.execute does not throw when request.intent is undefined; logs without crashing', async () => {
    // Direct probe of the line-93 crash site. After the fix, calling
    // execute() with intent=undefined must NOT throw — instead it should
    // log a sanitized empty string and proceed (or return a structured
    // ok:false envelope from the outer catch).
    process.env.SERVICE_JWT_KEY = TEST_KEY;
    const logger = pino({ level: 'silent' });
    const client = new SynthExecutorClient({ baseUrl: 'http://test.invalid', logger });

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        execution_id: 'exec-793',
        success: false,
        error: 'no-op',
        execution_time_ms: 0,
        code_hash: '',
        started_at: '',
        completed_at: '',
      }),
    }) as any;

    try {
      const response = await client.execute({
        executionId: 'exec-793',
        code: 'print(1)',
        intent: undefined as any,
        userId: 'user-793',
        sessionId: 'session-793',
      });
      // The client's outer try/catch wraps any throw into a success:false
      // response envelope. Either way, no exception escapes.
      expect(response).toBeDefined();
      expect(response.executionId).toBe('exec-793');
    } finally {
      global.fetch = originalFetch;
      delete process.env.SERVICE_JWT_KEY;
    }
  });
});
