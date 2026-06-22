/**
 * Test E — approval-gate built-in hook behavior (integration).
 *
 * Registers the built-in hooks into a fresh HookRunner and drives the
 * before_tool_call point. The four approval modules are mocked so we can
 * assert the audit INSERT, the approval_required emit, the registry await, and
 * the blocked/un-blocked return for approve/deny/timeout/read/gate-off.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from 'pino';

const {
  classifyToolMock,
  resolvePolicyMock,
  insertAuditRowMock,
  decideAuditRowMock,
  makePreviewMock,
  waitForMock,
} = vi.hoisted(() => ({
  classifyToolMock: vi.fn(),
  resolvePolicyMock: vi.fn(),
  insertAuditRowMock: vi.fn(),
  decideAuditRowMock: vi.fn(),
  makePreviewMock: vi.fn(() => '{"preview":true}'),
  waitForMock: vi.fn(),
}));

vi.mock('../../services/approval/classifyTool.js', () => ({
  classifyTool: classifyToolMock,
  MUTATING_VERBS: ['delete'],
}));
vi.mock('../../services/approval/approvalGatePolicy.js', () => ({
  resolveApprovalGatePolicy: resolvePolicyMock,
}));
vi.mock('../../services/approval/auditLog.js', () => ({
  insertAuditRow: insertAuditRowMock,
  decideAuditRow: decideAuditRowMock,
  makePreview: makePreviewMock,
}));
vi.mock('../../services/approval/ApprovalRegistry.js', () => ({
  getApprovalRegistry: () => ({ waitFor: waitForMock }),
}));

// The permissions hook (priority 10) hits PermissionService — stub it to always allow,
// so it never blocks before our gate runs.
vi.mock('../../services/PermissionService.js', () => ({
  getPermissionService: () => ({
    evaluate: vi.fn().mockResolvedValue({ approved: true, behavior: 'allow' }),
  }),
}));
// DLP hooks — stub to allow.
vi.mock('../../services/DLPScannerService.js', () => ({
  getDLPScanner: () => ({
    scan: () => ({ findings: [], severity: 'none', action: 'allow' }),
    scanAndAct: (t: string) => ({ text: t, blocked: false, result: { findings: [], severity: 'none', action: 'allow' } }),
  }),
}));

import { HookRunner } from '../hooks.js';
import { registerBuiltInHooks, type ToolCallHookData } from '../built-in-hooks.js';

function makeLogger(): Logger {
  const l: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() };
  l.child = () => l;
  return l as Logger;
}

function buildRunner() {
  const logger = makeLogger();
  const runner = new HookRunner(logger);
  registerBuiltInHooks(runner, logger);
  return { runner, logger };
}

function makeData(emit: (e: string, d: unknown) => void): ToolCallHookData {
  return {
    toolName: 'kubectl_delete_pod',
    serverName: 'kubernetes',
    arguments: { pod: 'web-0' },
    userId: 'u1',
    sessionId: 's1',
    messageId: 'm1',
    emit,
  };
}

function ctx(logger: Logger) {
  return { userId: 'u1', sessionId: 's1', messageId: 'm1', logger, meta: {} };
}

beforeEach(() => {
  vi.clearAllMocks();
  insertAuditRowMock.mockResolvedValue('audit-123');
  decideAuditRowMock.mockResolvedValue(true);
  makePreviewMock.mockReturnValue('{"pod":"web-0"}');
});

describe('approval-gate hook — READ', () => {
  it('audits decision=auto, does not block, emits no approval_required', async () => {
    classifyToolMock.mockReturnValue('READ');
    resolvePolicyMock.mockResolvedValue({ gateMutating: true, timeoutMs: 300000 });
    const { runner, logger } = buildRunner();
    const events: Array<{ e: string; d: unknown }> = [];
    const data = makeData((e, d) => events.push({ e, d }));
    const out = await runner.runModifying('before_tool_call', data, ctx(logger));
    expect(out.blocked).toBeFalsy();
    expect(insertAuditRowMock).toHaveBeenCalledWith(expect.objectContaining({ decision: 'auto', classification: 'READ' }));
    expect(events.find((x) => x.e === 'approval_required')).toBeUndefined();
  });
});

describe('approval-gate hook — gate OFF', () => {
  it('mutating + gate off → audited auto, not blocked, no emit', async () => {
    classifyToolMock.mockReturnValue('MUTATING');
    resolvePolicyMock.mockResolvedValue({ gateMutating: false, timeoutMs: 300000 });
    const { runner, logger } = buildRunner();
    const events: Array<{ e: string; d: unknown }> = [];
    const data = makeData((e, d) => events.push({ e, d }));
    const out = await runner.runModifying('before_tool_call', data, ctx(logger));
    expect(out.blocked).toBeFalsy();
    expect(insertAuditRowMock).toHaveBeenCalledWith(expect.objectContaining({ decision: 'auto' }));
    expect(events.find((x) => x.e === 'approval_required')).toBeUndefined();
  });
});

describe('approval-gate hook — MUTATING + gate ON', () => {
  beforeEach(() => {
    classifyToolMock.mockReturnValue('MUTATING');
    resolvePolicyMock.mockResolvedValue({ gateMutating: true, timeoutMs: 300000 });
  });

  it('approved → inserts pending, emits approval_required, returns un-blocked', async () => {
    waitForMock.mockResolvedValue('approved');
    const { runner, logger } = buildRunner();
    const events: Array<{ e: string; d: any }> = [];
    const data = makeData((e, d) => events.push({ e, d }));
    const out = await runner.runModifying('before_tool_call', data, ctx(logger));

    expect(insertAuditRowMock).toHaveBeenCalledWith(expect.objectContaining({ decision: 'pending', classification: 'MUTATING' }));
    const required = events.find((x) => x.e === 'approval_required');
    expect(required).toBeDefined();
    expect(required!.d.auditId).toBe('audit-123');
    expect(required!.d.toolName).toBe('kubectl_delete_pod');
    expect(required!.d.args).toEqual({ pod: 'web-0' });
    expect(required!.d.preview).toBeDefined();
    expect(out.blocked).toBeFalsy();
  });

  it('denied → returns blocked with a denied reason', async () => {
    waitForMock.mockResolvedValue('denied');
    const { runner, logger } = buildRunner();
    const data = makeData(() => {});
    const out = await runner.runModifying('before_tool_call', data, ctx(logger));
    expect(out.blocked).toBe(true);
    expect(out.blockReason).toMatch(/denied/i);
  });

  it('timed_out → records timed_out decision, blocks, emits approval_resolved', async () => {
    waitForMock.mockResolvedValue('timed_out');
    const { runner, logger } = buildRunner();
    const events: Array<{ e: string; d: any }> = [];
    const data = makeData((e, d) => events.push({ e, d }));
    const out = await runner.runModifying('before_tool_call', data, ctx(logger));
    expect(decideAuditRowMock).toHaveBeenCalledWith('audit-123', 'timed_out', null);
    expect(out.blocked).toBe(true);
    expect(out.blockReason).toMatch(/timed out/i);
    expect(events.find((x) => x.e === 'approval_resolved')).toBeDefined();
  });

  it('pending INSERT throws → blocks (fail-safe, never executes)', async () => {
    insertAuditRowMock.mockRejectedValueOnce(new Error('DB down'));
    const { runner, logger } = buildRunner();
    const data = makeData(() => {});
    const out = await runner.runModifying('before_tool_call', data, ctx(logger));
    expect(out.blocked).toBe(true);
  });
});
