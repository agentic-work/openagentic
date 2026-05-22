/**
 * BrowserSandboxExecTool — TDD spec.
 *
 * This module closes the last gap in the task #158 pipe:
 *   API emit `browser_exec_request` → UI runs sandbox → POST back result
 *
 * Tested here:
 *   1. Tool schema has the right shape (function-calling spec)
 *   2. isBrowserSandboxTool() recognises the canonical name and aliases
 *   3. executeBrowserSandbox():
 *        a. emits a `browser_exec_request` on context.emit
 *        b. registers the requestId with SandboxResultStore.awaitResult
 *        c. returns the resolved envelope as tool output
 *        d. handles timeout — returns ok:false, timedOut:true
 *        e. concurrent requests don't cross-resolve
 *   4. Tool definition is complete enough for OpenAI / Anthropic schema validation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// ── Hoist mocks before the module under test loads ─────────────────────────

const { awaitResultMock, resolveMock, getStoreMock } = vi.hoisted(() => {
  const awaitResultMock = vi.fn();
  const resolveMock = vi.fn();
  const getStoreMock = vi.fn(() => ({
    awaitResult: awaitResultMock,
    resolve: resolveMock,
  }));
  return { awaitResultMock, resolveMock, getStoreMock };
});

vi.mock('../SandboxResultStore.js', () => ({
  getSandboxResultStore: getStoreMock,
}));

// ── Stable envelope factory ─────────────────────────────────────────────────

function makeEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    requestId: 'req-abc',
    ok: true,
    stdout: 'Hello world\n',
    stderr: '',
    durationMs: 120,
    timedOut: false,
    ...overrides,
  };
}

// ── Import after mocks ──────────────────────────────────────────────────────

import {
  BROWSER_SANDBOX_EXEC_TOOL,
  isBrowserSandboxTool,
  executeBrowserSandbox,
} from '../BrowserSandboxExecTool.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeContext(emitFn = vi.fn()) {
  return {
    emit: emitFn,
    messageId: 'msg-001',
    streamContext: { sessionId: 'sess-001', userId: 'user-001' },
  } as any;
}

// ── Suites ───────────────────────────────────────────────────────────────────

describe('BROWSER_SANDBOX_EXEC_TOOL schema', () => {
  it('has type=function', () => {
    expect(BROWSER_SANDBOX_EXEC_TOOL.type).toBe('function');
  });

  it('has name=browser_sandbox_exec', () => {
    expect(BROWSER_SANDBOX_EXEC_TOOL.function.name).toBe('browser_sandbox_exec');
  });

  it('has required params: code and language', () => {
    const { required, properties } = BROWSER_SANDBOX_EXEC_TOOL.function.parameters;
    expect(required).toContain('code');
    expect(required).toContain('language');
    expect(properties.language.enum).toEqual(expect.arrayContaining(['python', 'js']));
  });

  it('has optional timeout_ms', () => {
    const { properties } = BROWSER_SANDBOX_EXEC_TOOL.function.parameters;
    expect(properties.timeout_ms).toBeDefined();
    expect(properties.timeout_ms.type).toBe('number');
  });
});

describe('executeBrowserSandbox — ctx shape compatibility (sev-0 fix 2026-05-07)', () => {
  beforeEach(() => {
    awaitResultMock.mockReset();
    resolveMock.mockReset();
    awaitResultMock.mockResolvedValue(makeEnvelope());
  });

  it('reads sessionId from top-level ctx (production chat-pipeline RunCtx shape)', async () => {
    const emitSpy = vi.fn();
    const ctx = {
      emit: emitSpy,
      messageId: 'msg-flat',
      sessionId: 'sess-flat-001',
      userId: 'user-flat',
    } as any;

    await executeBrowserSandbox(ctx, { code: 'print(1)', language: 'python' });

    expect(emitSpy).toHaveBeenCalledWith(
      'browser_exec_request',
      expect.objectContaining({ sessionId: 'sess-flat-001' }),
    );
  });

  it('does NOT crash when ctx.streamContext is undefined (the sev-0 regression)', async () => {
    const emitSpy = vi.fn();
    const ctx = {
      emit: emitSpy,
      messageId: 'msg-no-stream',
      sessionId: 'sess-x',
    } as any;

    await expect(
      executeBrowserSandbox(ctx, { code: 'print(2)', language: 'python' }),
    ).resolves.toMatchObject({ ok: true });
  });

  it('still reads streamContext.sessionId for back-compat callers', async () => {
    const emitSpy = vi.fn();
    const ctx = {
      emit: emitSpy,
      messageId: 'msg-nested',
      streamContext: { sessionId: 'sess-nested', userId: 'user-nested' },
    } as any;

    await executeBrowserSandbox(ctx, { code: 'print(3)', language: 'python' });

    expect(emitSpy).toHaveBeenCalledWith(
      'browser_exec_request',
      expect.objectContaining({ sessionId: 'sess-nested' }),
    );
  });

  it('emits empty sessionId when neither shape provides one (no crash)', async () => {
    const emitSpy = vi.fn();
    const ctx = { emit: emitSpy } as any;

    await expect(
      executeBrowserSandbox(ctx, { code: 'print(4)', language: 'python' }),
    ).resolves.toMatchObject({ ok: true });

    expect(emitSpy).toHaveBeenCalledWith(
      'browser_exec_request',
      expect.objectContaining({ sessionId: '' }),
    );
  });
});

describe('isBrowserSandboxTool', () => {
  it('recognises canonical name', () => {
    expect(isBrowserSandboxTool('browser_sandbox_exec')).toBe(true);
  });

  it('recognises aliases the model might emit', () => {
    for (const alias of ['browser_exec', 'run_code', 'execute_code']) {
      expect(isBrowserSandboxTool(alias)).toBe(true);
    }
  });

  it('rejects unknown names', () => {
    expect(isBrowserSandboxTool('synth_synthesize')).toBe(false);
    expect(isBrowserSandboxTool('')).toBe(false);
  });
});

describe('executeBrowserSandbox', () => {
  beforeEach(() => {
    awaitResultMock.mockReset();
    resolveMock.mockReset();
    awaitResultMock.mockResolvedValue(makeEnvelope());
  });

  it('emits a browser_exec_request event on context.emit', async () => {
    const emitSpy = vi.fn();
    const ctx = makeContext(emitSpy);

    await executeBrowserSandbox(ctx, { code: 'print(1+1)', language: 'python' });

    expect(emitSpy).toHaveBeenCalledWith(
      'browser_exec_request',
      expect.objectContaining({
        code: 'print(1+1)',
        language: 'python',
        requestId: expect.any(String),
      }),
    );
  });

  it('registers with SandboxResultStore using the same requestId', async () => {
    const emitSpy = vi.fn();
    const ctx = makeContext(emitSpy);

    await executeBrowserSandbox(ctx, { code: 'print(42)', language: 'python' });

    const emittedRequestId = emitSpy.mock.calls[0][1].requestId;
    expect(awaitResultMock).toHaveBeenCalledWith(emittedRequestId, expect.any(Number));
  });

  it('returns the resolved envelope formatted as a tool result string', async () => {
    const ctx = makeContext();
    const result = await executeBrowserSandbox(ctx, {
      code: "print('hi')",
      language: 'python',
    });

    expect(result).toMatchObject({
      ok: true,
      stdout: 'Hello world\n',
    });
  });

  it('uses timeout_ms from input when provided', async () => {
    const ctx = makeContext();
    await executeBrowserSandbox(ctx, {
      code: 'console.log(1)',
      language: 'js',
      timeout_ms: 10_000,
    });
    expect(awaitResultMock).toHaveBeenCalledWith(expect.any(String), 10_000);
  });

  it('falls back to 30 s timeout when none is given', async () => {
    const ctx = makeContext();
    await executeBrowserSandbox(ctx, { code: 'x=1', language: 'python' });
    expect(awaitResultMock).toHaveBeenCalledWith(expect.any(String), 30_000);
  });

  it('surfaces timeout envelope when store resolves with timedOut:true', async () => {
    awaitResultMock.mockResolvedValue(
      makeEnvelope({ ok: false, timedOut: true, errorCode: 'TIMEOUT', stdout: '' }),
    );
    const ctx = makeContext();
    const result = await executeBrowserSandbox(ctx, { code: 'import time; time.sleep(999)', language: 'python' });
    expect(result.timedOut).toBe(true);
    expect(result.ok).toBe(false);
  });

  it('concurrent requests get distinct requestIds', async () => {
    const ids: string[] = [];
    awaitResultMock.mockImplementation((id: string) => {
      ids.push(id);
      return Promise.resolve(makeEnvelope({ requestId: id }));
    });

    const ctx = makeContext();
    await Promise.all([
      executeBrowserSandbox(ctx, { code: 'a=1', language: 'python' }),
      executeBrowserSandbox(ctx, { code: 'b=2', language: 'python' }),
      executeBrowserSandbox(ctx, { code: 'c=3', language: 'python' }),
    ]);

    const unique = new Set(ids);
    expect(unique.size).toBe(3);
  });
});
