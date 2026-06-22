/**
 * human_approval node — executor tests.
 *
 * Migrated from WorkflowExecutionEngine.executeApprovalNode (legacy switch
 * cases 'approval' and 'human_approval'). The same plugin is registered
 * under both type names — see registry.ts where 'human_approval' is the
 * canonical form and 'approval' is an alias.
 *
 * The executor:
 *   - Reads approver / count / timeout / message / channels from node.data
 *   - Defers DB persistence + execution-state checkpoint + event emission
 *     + notification dispatch to the optional ctx.pauseForApproval hook
 *   - Returns { status: 'awaiting_approval', approvalId, message, approvers,
 *     expiresAt } so the engine's existing pause logic can stop downstream
 *     execution and emit `execution_paused`.
 *
 * The engine pauses on result.status === 'awaiting_approval'; the
 * outputAssertion only checks `non_empty_message` because awaiting_approval
 * is a legitimate paused state and `result.status === 'approved'` is set
 * later by canAutoApprove or by the resume path.
 *
 * Covers:
 *   - happy path — pauseForApproval invoked, shaped return
 *   - default approvers=[], requiredCount=1, timeout=86400, channels=['in_app']
 *   - default message synthesised from nodeId when blank
 *   - explicit message interpolated against input
 *   - missing pauseForApproval hook — throws (engine wiring required)
 *   - aborted signal — throws
 *   - underlying DB failure (hook rejects) — propagates
 *   - non_empty_message assertion via runWithAssertions
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
    executionId: 'exec-approval-1',
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

const apNode = (data: Record<string, unknown> = {}) => ({
  id: 'n_approval',
  type: 'human_approval',
  data,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('human_approval/executor', () => {
  function makePauseHook(
    overrides: Partial<{ id: string; message: string; timeout_at: Date | string }> = {},
  ) {
    return vi.fn().mockResolvedValue({
      id: overrides.id ?? 'appr-1',
      message: overrides.message ?? 'Approval required',
      timeout_at: overrides.timeout_at ?? new Date('2026-04-26T00:00:00Z'),
    });
  }

  it('happy path — invokes pauseForApproval and returns awaiting_approval shape', async () => {
    const pauseForApproval = makePauseHook();
    const out: any = await execute(
      apNode({
        approvers: ['alice', 'bob'],
        requiredCount: 2,
        timeout: 3600,
        message: 'Please review',
      }),
      { topic: 'cats' },
      makeCtx({ pauseForApproval }),
    );
    expect(pauseForApproval).toHaveBeenCalledOnce();
    const call = pauseForApproval.mock.calls[0][0];
    expect(call.nodeId).toBe('n_approval');
    expect(call.approvers).toEqual(['alice', 'bob']);
    expect(call.requiredCount).toBe(2);
    expect(call.timeoutSeconds).toBe(3600);
    expect(call.message).toBe('Please review');
    expect(call.notificationChannels).toEqual(['in_app']);
    expect(call.input).toEqual({ topic: 'cats' });

    expect(out.status).toBe('awaiting_approval');
    expect(out.approvalId).toBe('appr-1');
    expect(out.message).toBeTruthy();
    expect(out.approvers).toEqual(['alice', 'bob']);
    expect(out.expiresAt).toBeTruthy();
  });

  it('default approvers=[], requiredCount=1, timeout=86400, channels=[in_app], timeoutAction=reject', async () => {
    const pauseForApproval = makePauseHook();
    await execute(apNode({}), null, makeCtx({ pauseForApproval }));
    const call = pauseForApproval.mock.calls[0][0];
    expect(call.approvers).toEqual([]);
    expect(call.requiredCount).toBe(1);
    expect(call.timeoutSeconds).toBe(86400);
    expect(call.timeoutAction).toBe('reject');
    expect(call.notificationChannels).toEqual(['in_app']);
  });

  it('synthesises a default message when none is configured', async () => {
    const pauseForApproval = makePauseHook();
    await execute(apNode({}), null, makeCtx({ pauseForApproval }));
    const call = pauseForApproval.mock.calls[0][0];
    // Default message references the node id so the reviewer has context.
    expect(call.message).toMatch(/n_approval/);
    expect(call.message.length).toBeGreaterThan(0);
  });

  it('interpolates the message against input', async () => {
    const pauseForApproval = makePauseHook();
    await execute(
      apNode({ message: 'Approve {{action}}?' }),
      { action: 'sending email' },
      makeCtx({ pauseForApproval }),
    );
    const call = pauseForApproval.mock.calls[0][0];
    expect(call.message).toBe('Approve sending email?');
  });

  it('forwards custom notificationChannels', async () => {
    const pauseForApproval = makePauseHook();
    await execute(
      apNode({ notificationChannels: ['email', 'slack'] }),
      null,
      makeCtx({ pauseForApproval }),
    );
    const call = pauseForApproval.mock.calls[0][0];
    expect(call.notificationChannels).toEqual(['email', 'slack']);
  });

  it('throws when pauseForApproval hook is missing', async () => {
    await expect(
      execute(apNode({ message: 'x' }), null, makeCtx()),
    ).rejects.toThrow(/pauseForApproval/i);
  });

  it('throws when signal is already aborted (without invoking the hook)', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const pauseForApproval = makePauseHook();
    await expect(
      execute(
        apNode({ message: 'x' }),
        null,
        makeCtx({ signal: ctrl.signal, pauseForApproval }),
      ),
    ).rejects.toThrow(/abort/i);
    expect(pauseForApproval).not.toHaveBeenCalled();
  });

  it('propagates DB / hook errors verbatim', async () => {
    const pauseForApproval = vi.fn().mockRejectedValue(new Error('DB unavailable'));
    await expect(
      execute(apNode({ message: 'x' }), null, makeCtx({ pauseForApproval })),
    ).rejects.toThrow(/DB unavailable/);
  });

  it('result.expiresAt mirrors the persisted approval timeout_at', async () => {
    const ts = new Date('2026-12-31T23:59:59Z');
    const pauseForApproval = makePauseHook({ timeout_at: ts });
    const out: any = await execute(
      apNode({ message: 'x' }),
      null,
      makeCtx({ pauseForApproval }),
    );
    expect(out.expiresAt).toBe(ts);
  });

  // outputAssertion ----------------------------------------------------------

  it('runWithAssertions: non-empty message passes non_empty_message', async () => {
    const pauseForApproval = makePauseHook();
    const plugin = { schema: schema as any, execute };
    const out: any = await runWithAssertions(
      plugin,
      apNode({ message: 'Please approve' }) as any,
      null,
      makeCtx({ pauseForApproval }),
    );
    expect(out.message).toBeTruthy();
    expect(out.status).toBe('awaiting_approval');
  });

  it('runWithAssertions: hook returning empty message FAILS non_empty_message', async () => {
    const pauseForApproval = makePauseHook({ message: '' });
    // Force the executor's return-message to also be empty by configuring
    // an empty message — the executor passes it through verbatim.
    const plugin = { schema: schema as any, execute };
    let caught: unknown;
    try {
      await runWithAssertions(
        plugin,
        // Empty string message, blank input — executor will pass '' through.
        { id: 'n_approval', type: 'human_approval', data: { message: '' } } as any,
        null,
        makeCtx({ pauseForApproval }),
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(OutputAssertionError);
    expect((caught as OutputAssertionError).failedAssertion).toBe('non_empty_message');
  });
});
