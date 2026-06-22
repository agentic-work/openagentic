/**
 * Regression test — approval-gate bypass fix (2026-06-19).
 *
 * `SubagentOrchestrator` calls `mcpProxy.callTool(server, tool, args)` directly,
 * bypassing the chat path's `runAuditAndGate`. `gateMcpProxyClient` closes that
 * bypass by wrapping the proxy so every orchestrated tool call is audited and
 * (for MUTATING calls) approval-gated.
 *
 * Proves:
 *  - an orchestrated MUTATING call (`kubernetes_delete_pod`) is routed through
 *    the gate (audited as pending) and, when DENIED, the real proxy is NOT
 *    called — the mutation never executes;
 *  - an orchestrated MUTATING call, when APPROVED, IS forwarded to the real proxy;
 *  - a READ call (`kubernetes_get_pods`) passes straight through to the real
 *    proxy (audited 'auto', no approval hang);
 *  - a gate/audit failure on a MUTATING call FAILS SAFE (blocks, no proxy call);
 *  - `getAvailableTools` (read-only discovery) passes through unchanged.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { insertAuditRowMock, decideAuditRowMock, resolveApprovalGatePolicyMock, waitForMock } =
  vi.hoisted(() => ({
    insertAuditRowMock: vi.fn(),
    decideAuditRowMock: vi.fn(),
    resolveApprovalGatePolicyMock: vi.fn(),
    waitForMock: vi.fn(),
  }));

vi.mock('../auditLog.js', () => ({
  insertAuditRow: insertAuditRowMock,
  decideAuditRow: decideAuditRowMock,
  // makePreview is pure; keep the real-ish behavior so emit payloads are sane.
  makePreview: (args: unknown) => JSON.stringify(args ?? {}),
}));

vi.mock('../approvalGatePolicy.js', () => ({
  resolveApprovalGatePolicy: resolveApprovalGatePolicyMock,
}));

vi.mock('../ApprovalRegistry.js', () => ({
  getApprovalRegistry: () => ({ waitFor: waitForMock }),
}));

import { gateMcpProxyClient } from '../auditAndGate.js';

/** Build a spy-able fake MCPProxyClient (matches the orchestrator interface). */
function makeFakeProxy() {
  return {
    callTool: vi.fn().mockResolvedValue({ ok: true, ran: true }),
    getAvailableTools: vi.fn().mockResolvedValue(['kubernetes_get_pods', 'kubernetes_delete_pod']),
    // an extra concrete method to prove the wrap preserves it
    getServers: vi.fn().mockResolvedValue([{ name: 'kubernetes', status: 'running' }]),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  insertAuditRowMock.mockResolvedValue('audit-1');
  decideAuditRowMock.mockResolvedValue(true);
  // Gate ON by default for these tests.
  resolveApprovalGatePolicyMock.mockResolvedValue({ gateMutating: true, timeoutMs: 1000 });
});

describe('gateMcpProxyClient — sub-agent MCP-proxy approval gate', () => {
  it('routes a MUTATING call through the gate and does NOT call the real proxy when DENIED', async () => {
    waitForMock.mockResolvedValue('denied');
    const inner = makeFakeProxy();
    const emit = vi.fn();
    const gated = gateMcpProxyClient(inner, { userId: 'u1', sessionId: 's1', emit });

    await expect(
      gated.callTool('kubernetes', 'kubernetes_delete_pod', { pod: 'web-0' }),
    ).rejects.toThrow(/denied by approval gate/i);

    // Audited as a MUTATING pending row, with sub-agent origin + threaded ctx.
    expect(insertAuditRowMock).toHaveBeenCalledTimes(1);
    const row = insertAuditRowMock.mock.calls[0][0];
    expect(row.toolName).toBe('kubernetes_delete_pod');
    expect(row.serverName).toBe('kubernetes');
    expect(row.classification).toBe('MUTATING');
    expect(row.decision).toBe('pending');
    expect(row.origin).toBe('subagent');
    expect(row.userId).toBe('u1');
    expect(row.sessionId).toBe('s1');

    // The gate waited for a human decision, emitted the SSE prompt...
    expect(waitForMock).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('approval_required', expect.objectContaining({
      toolName: 'kubernetes_delete_pod',
      classification: 'MUTATING',
    }));

    // ...and the REAL proxy was NEVER invoked — the mutation never executed.
    expect(inner.callTool).not.toHaveBeenCalled();
  });

  it('forwards a MUTATING call to the real proxy when APPROVED', async () => {
    waitForMock.mockResolvedValue('approved');
    const inner = makeFakeProxy();
    const gated = gateMcpProxyClient(inner, { userId: 'u1', emit: vi.fn() });

    const result = await gated.callTool('kubernetes', 'kubernetes_delete_pod', { pod: 'web-0' });

    expect(insertAuditRowMock).toHaveBeenCalledTimes(1);
    expect(inner.callTool).toHaveBeenCalledTimes(1);
    expect(inner.callTool).toHaveBeenCalledWith('kubernetes', 'kubernetes_delete_pod', { pod: 'web-0' });
    expect(result).toEqual({ ok: true, ran: true });
  });

  it('passes a READ call straight through (audited auto, no approval wait)', async () => {
    const inner = makeFakeProxy();
    const gated = gateMcpProxyClient(inner, { userId: 'u1', emit: vi.fn() });

    const result = await gated.callTool('kubernetes', 'kubernetes_get_pods', { ns: 'default' });

    // Audited 'auto' as READ — never waits on approval.
    expect(insertAuditRowMock).toHaveBeenCalledTimes(1);
    expect(insertAuditRowMock.mock.calls[0][0].classification).toBe('READ');
    expect(insertAuditRowMock.mock.calls[0][0].decision).toBe('auto');
    expect(waitForMock).not.toHaveBeenCalled();

    // Real proxy WAS called — read executes normally.
    expect(inner.callTool).toHaveBeenCalledWith('kubernetes', 'kubernetes_get_pods', { ns: 'default' });
    expect(result).toEqual({ ok: true, ran: true });
  });

  it('FAILS SAFE on a MUTATING call when the audit INSERT throws (blocks, no proxy call)', async () => {
    insertAuditRowMock.mockRejectedValue(new Error('DB down'));
    const inner = makeFakeProxy();
    const gated = gateMcpProxyClient(inner, { userId: 'u1', logger: { warn: vi.fn(), error: vi.fn() } });

    await expect(
      gated.callTool('kubernetes', 'kubernetes_delete_pod', { pod: 'web-0' }),
    ).rejects.toThrow(/audit unavailable|blocked/i);

    // The mutation NEVER reached the real proxy despite the audit failure.
    expect(inner.callTool).not.toHaveBeenCalled();
  });

  it('passes getAvailableTools through unchanged (read-only discovery)', async () => {
    const inner = makeFakeProxy();
    const gated = gateMcpProxyClient(inner, { userId: 'u1' });

    const tools = await gated.getAvailableTools('kubernetes');
    expect(inner.getAvailableTools).toHaveBeenCalledWith('kubernetes');
    expect(tools).toContain('kubernetes_delete_pod');
    // No audit / no gate on discovery.
    expect(insertAuditRowMock).not.toHaveBeenCalled();
  });

  it('preserves extra concrete methods (e.g. getServers) on the wrapped client', async () => {
    const inner = makeFakeProxy();
    const gated = gateMcpProxyClient(inner, { userId: 'u1' }) as any;
    const servers = await gated.getServers();
    expect(servers).toEqual([{ name: 'kubernetes', status: 'running' }]);
  });
});
