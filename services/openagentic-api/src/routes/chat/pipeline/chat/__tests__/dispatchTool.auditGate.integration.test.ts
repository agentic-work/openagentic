/**
 * INTEGRATION — audit + approval gate on the LIVE chat dispatch seam.
 *
 * This exercises the seam the live `runChat → chatLoop` path ALWAYS calls:
 * `makeDispatch(...) → dispatchBody`. It does NOT drive the before_tool_call
 * hook in isolation (that's covered by pipeline/__tests__/approval-gate-hook.test.ts).
 * It proves that EVERY tool call dispatched through the live seam is audited —
 * which is the gap that caused `tool_search` to execute on open-dev with
 * `GET /api/admin/audit-log` returning total:0 (the before_tool_call hook
 * silently no-op'd because deps.hooks was unwired).
 *
 * Asserts:
 *   1. READ tool (tool_search) → one append-only row, decision='auto',
 *      classification='READ', tool EXECUTES (never gated → chat never hangs).
 *   2. MUTATING tool (gate ON) → 'approval_required' emitted with
 *      {auditId,toolName,args,preview}; loop awaits the ApprovalRegistry;
 *      approve → executes; the pending row is written.
 *   3. Single-pass: when the ctx is already marked audited (the hook ran
 *      first), the dispatch seam does NOT write a second row.
 *
 * MUST FAIL if the dispatch-seam audit wiring regresses.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { createSpy, updateManySpy, findFirstSpy, sysCreateSpy } = vi.hoisted(() => ({
  createSpy: vi.fn(),
  updateManySpy: vi.fn(),
  findFirstSpy: vi.fn(),
  sysCreateSpy: vi.fn(),
}));

// Real auditAndGate + classifyTool + approvalGatePolicy + ApprovalRegistry run;
// only the DB (prisma) is mocked so we can assert the INSERT.
vi.mock('../../../../../utils/prisma.js', () => ({
  prisma: {
    toolCallAuditLog: { create: createSpy, updateMany: updateManySpy },
    systemConfiguration: { findFirst: findFirstSpy, create: sysCreateSpy },
  },
}));

// Stub the inner meta-tool/MCP dispatcher so the tool "executes" trivially.
vi.mock('../dispatchChatToolCall.js', () => ({
  dispatchChatToolCall: vi.fn().mockResolvedValue({ ok: true, output: { executed: true } }),
}));

import { makeDispatch } from '../dispatchTool.js';
import { dispatchChatToolCall } from '../dispatchChatToolCall.js';
import { getApprovalRegistry } from '../../../../../services/approval/ApprovalRegistry.js';
import { AUDIT_DONE_FLAG } from '../../../../../services/approval/auditAndGate.js';
import { featureFlags } from '../../../../../config/featureFlags.js';

function makeRunCtx() {
  const emitted: Array<{ event: string; data: any }> = [];
  return {
    ctx: {
      emit: (event: string, data: any) => emitted.push({ event, data }),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      sessionId: 's-int',
      userId: 'u-int',
    } as any,
    emitted,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  createSpy.mockResolvedValue({ id: 'audit-int-1' });
  updateManySpy.mockResolvedValue({ count: 1 });
  // No DB policy row → resolveApprovalGatePolicy falls back to env/feature flag.
  findFirstSpy.mockResolvedValue(null);
  sysCreateSpy.mockResolvedValue({});
  (dispatchChatToolCall as any).mockResolvedValue({ ok: true, output: { executed: true } });
});

describe('dispatch-seam audit — READ tool (tool_search)', () => {
  it('writes ONE append-only audit row decision=auto, classification=READ, and EXECUTES (never gated)', async () => {
    const { ctx, emitted } = makeRunCtx();
    const dispatch = makeDispatch({ v2Deps: {} as any });

    const result = await dispatch(ctx, { name: 'tool_search', input: { query: 'kubernetes pods' } });

    // Executed (READ is never gated → chat never hangs).
    expect(result.ok).toBe(true);
    expect(dispatchChatToolCall).toHaveBeenCalledTimes(1);

    // Exactly one append-only row, decision=auto / classification=READ.
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy.mock.calls[0][0].data).toMatchObject({
      tool_name: 'tool_search',
      classification: 'READ',
      decision: 'auto',
      user_id: 'u-int',
      session_id: 's-int',
    });

    // No approval gate fired for a READ.
    expect(emitted.find((e) => e.event === 'approval_required')).toBeUndefined();
  });

  it.each(['get_pods', 'list_subscriptions', 'web_search', 'agent_search', 'agent_list'])(
    'never gates READ-class tool %s (audited auto, executes)',
    async (toolName) => {
      const { ctx, emitted } = makeRunCtx();
      const dispatch = makeDispatch({ v2Deps: {} as any });
      const result = await dispatch(ctx, { name: toolName, input: {} });
      expect(result.ok).toBe(true);
      expect(createSpy.mock.calls[0][0].data.decision).toBe('auto');
      expect(emitted.find((e) => e.event === 'approval_required')).toBeUndefined();
    },
  );
});

describe('dispatch-seam audit — MUTATING tool, gate ON', () => {
  it('emits approval_required, awaits the registry, and executes on approve', async () => {
    // Force the gate ON regardless of env default.
    findFirstSpy.mockResolvedValue({ value: { gateMutating: true, timeoutMs: 60_000 } });

    const { ctx, emitted } = makeRunCtx();
    const dispatch = makeDispatch({ v2Deps: {} as any });

    const pending = dispatch(ctx, {
      name: 'kubectl_delete_pod',
      input: { pod: 'web-0', namespace: 'prod' },
    });

    // Wait for the approval_required emit (the gate is now awaiting a human).
    const auditId = await vi.waitFor(() => {
      const req = emitted.find((e) => e.event === 'approval_required');
      expect(req).toBeDefined();
      return req!.data.auditId as string;
    });

    const req = emitted.find((e) => e.event === 'approval_required')!.data;
    expect(req.toolName).toBe('kubectl_delete_pod');
    expect(req.classification).toBe('MUTATING');
    expect(req.args).toEqual({ pod: 'web-0', namespace: 'prod' });
    expect(req.preview).toBeDefined();

    // Pending row was written BEFORE execution.
    expect(createSpy.mock.calls[0][0].data).toMatchObject({
      tool_name: 'kubectl_delete_pod',
      classification: 'MUTATING',
      decision: 'pending',
    });
    // Tool has NOT executed yet — it's paused on the gate.
    expect(dispatchChatToolCall).not.toHaveBeenCalled();

    // Human approves.
    expect(getApprovalRegistry().submit(auditId, true)).toBe(true);

    const result = await pending;
    expect(result.ok).toBe(true);
    expect(dispatchChatToolCall).toHaveBeenCalledTimes(1);
    expect(emitted.find((e) => e.event === 'approval_resolved')?.data.outcome).toBe('approved');
  });

  it('blocks (no execution) on deny', async () => {
    findFirstSpy.mockResolvedValue({ value: { gateMutating: true, timeoutMs: 60_000 } });
    const { ctx, emitted } = makeRunCtx();
    const dispatch = makeDispatch({ v2Deps: {} as any });

    const pending = dispatch(ctx, { name: 'delete_resource', input: { id: 'r1' } });
    const auditId = await vi.waitFor(() => {
      const req = emitted.find((e) => e.event === 'approval_required');
      expect(req).toBeDefined();
      return req!.data.auditId as string;
    });

    getApprovalRegistry().submit(auditId, false);
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/denied/i);
    expect(dispatchChatToolCall).not.toHaveBeenCalled();
  });
});

describe('dispatch-seam audit — single-pass dedup', () => {
  it('does NOT write a second row when the hook already audited this ctx', async () => {
    const { ctx } = makeRunCtx();
    // Simulate the before_tool_call hook having already audited this call:
    // chatLoop forwards the flag onto the per-call dispatch ctx.
    (ctx as Record<string, unknown>)[AUDIT_DONE_FLAG] = true;

    const dispatch = makeDispatch({ v2Deps: {} as any });
    const result = await dispatch(ctx, { name: 'tool_search', input: { query: 'x' } });

    expect(result.ok).toBe(true);
    expect(dispatchChatToolCall).toHaveBeenCalledTimes(1);
    // No new audit row — the hook owns this call's row.
    expect(createSpy).not.toHaveBeenCalled();
  });
});

describe('classifyTool READ_OVERRIDE coverage (runtime-safety)', () => {
  it('keeps the env default observable for documentation', () => {
    // Sanity: the gate default is governed by featureFlags.approvalGateMutating.
    expect(typeof featureFlags.approvalGateMutating).toBe('boolean');
  });
});
