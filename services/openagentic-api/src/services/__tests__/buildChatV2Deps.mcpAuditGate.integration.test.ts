/**
 * INTEGRATION — audit + approval gate on the MCP-EXECUTION seam.
 *
 * This drives the seam the V2 discovery path uses to EXECUTE a discovered
 * MCP tool MID-TURN: `buildChatV2Deps(...).executeMcpTool(ctx, name, input)`
 * → mcp-proxy POST. It deliberately does NOT go through `dispatchTool.ts`
 * `dispatchBody` (that seam is pinned by
 * routes/chat/pipeline/chat/__tests__/dispatchTool.auditGate.integration.test.ts).
 *
 * WHY THIS EXISTS: in V2 discovery-mode the model is given only meta tools +
 * tool_search; the REAL MCP tools (web_search + every mutating cloud/k8s
 * tool — the writes this gate must protect) are resolved + executed mid-turn
 * through `executeMcpTool` → mcp-proxy. The prior dispatchBody-only audit
 * could be bypassed on that path — live evidence: `web_search` executed,
 * `GET /api/admin/audit-log` returned total:0. `auditMcpExecutionSeam` wraps
 * the executor so EVERY named MCP tool call is audited at the proxy
 * invocation itself.
 *
 * Asserts:
 *   1. READ MCP tool (web_search) → ONE append-only row decision='auto',
 *      classification='READ', and the tool EXECUTES (proxy POST fires).
 *      Never gated → chat never hangs.
 *   2. MUTATING MCP tool (kubectl_apply_manifest), gate ON → 'approval_required'
 *      emitted with {auditId,toolName,args,preview}; awaits the
 *      ApprovalRegistry; approve → proxy POST fires; deny → BLOCKED (proxy
 *      POST NEVER fires).
 *   3. Single-pass dedup: when the dispatch ctx is already marked audited
 *      (dispatchBody seam / before_tool_call hook ran first), the MCP seam
 *      does NOT write a second row and still executes.
 *
 * MUST FAIL if `auditMcpExecutionSeam` wiring is removed from buildChatV2Deps.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { createSpy, updateManySpy, findFirstSpy, sysCreateSpy, usageCreateSpy } = vi.hoisted(() => ({
  createSpy: vi.fn(),
  updateManySpy: vi.fn(),
  findFirstSpy: vi.fn(),
  sysCreateSpy: vi.fn(),
  usageCreateSpy: vi.fn(),
}));

// Real auditAndGate + classifyTool + approvalGatePolicy + ApprovalRegistry run;
// only prisma is mocked so we can assert the audit INSERT + read back the
// gate policy. mCPUsage.create is the best-effort telemetry write inside the
// MCP executor — stub it so it never reaches a real DB.
vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    toolCallAuditLog: { create: createSpy, updateMany: updateManySpy },
    systemConfiguration: { findFirst: findFirstSpy, create: sysCreateSpy },
    mCPUsage: { create: usageCreateSpy },
  },
}));

import { buildChatV2Deps } from '../buildChatV2Deps.js';
import { getApprovalRegistry } from '../approval/ApprovalRegistry.js';
import { AUDIT_DONE_FLAG } from '../approval/auditAndGate.js';

function makeCtx() {
  const emitted: Array<{ event: string; data: any }> = [];
  return {
    ctx: {
      emit: (event: string, data: any) => emitted.push({ event, data }),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      sessionId: 's-mcp',
      userId: 'u-mcp',
      user: { id: 'u-mcp' },
    } as any,
    emitted,
  };
}

/**
 * Build deps with the cross-user cache + L1 disabled (opt-out) so the test
 * exercises ONLY the audit/gate seam + the inner mcp-proxy executor — no
 * Milvus/Redis init. The fetch to mcp-proxy is stubbed.
 */
function makeDeps() {
  return buildChatV2Deps({
    providerManager: { createCompletion: vi.fn() } as any,
    toolResultCache: null,
    l1Cache: null,
    // No hooks → the seam is the ONLY auditor for this call.
    hooks: undefined as any,
  });
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  createSpy.mockResolvedValue({ id: 'mcp-audit-1' });
  updateManySpy.mockResolvedValue({ count: 1 });
  // No DB policy row → resolveApprovalGatePolicy falls back to env/flag default.
  findFirstSpy.mockResolvedValue(null);
  sysCreateSpy.mockResolvedValue({});
  usageCreateSpy.mockResolvedValue({});

  // Stub the mcp-proxy POST so the "tool executes" without a network call.
  fetchSpy = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ result: { executed: true } }),
    text: async () => '',
  });
  globalThis.fetch = fetchSpy as any;
});

describe('MCP-execution seam audit — READ tool (web_search)', () => {
  it('writes ONE audit row decision=auto, classification=READ, and EXECUTES (proxy POST fires)', async () => {
    const { ctx, emitted } = makeCtx();
    const deps = makeDeps();

    const result = await deps.executeMcpTool!(ctx, 'web_search', { query: 'kubernetes 1.30 release notes' });

    // Executed — the mcp-proxy POST fired (READ is never gated).
    expect(result.ok).toBe(true);
    const proxyCalls = fetchSpy.mock.calls.filter(([url]) => String(url).includes('/mcp/tool'));
    expect(proxyCalls).toHaveLength(1);

    // Exactly one append-only audit row, decision=auto / classification=READ.
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy.mock.calls[0][0].data).toMatchObject({
      tool_name: 'web_search',
      classification: 'READ',
      decision: 'auto',
      user_id: 'u-mcp',
      session_id: 's-mcp',
    });

    // No approval gate fired for a READ → chat never hangs.
    expect(emitted.find((e) => e.event === 'approval_required')).toBeUndefined();
  });

  it.each(['get_pods', 'azure_list_subscriptions', 'admin_system_postgres_health_check', 'prometheus_query'])(
    'never gates READ-class MCP tool %s (audited auto, executes)',
    async (toolName) => {
      const { ctx, emitted } = makeCtx();
      const deps = makeDeps();
      const result = await deps.executeMcpTool!(ctx, toolName, {});
      expect(result.ok).toBe(true);
      expect(createSpy.mock.calls[0][0].data.decision).toBe('auto');
      expect(emitted.find((e) => e.event === 'approval_required')).toBeUndefined();
      // Proxy POST fired → the read actually executed (no block).
      expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('/mcp/tool'))).toBe(true);
    },
  );
});

describe('MCP-execution seam audit — MUTATING tool, gate ON', () => {
  it('emits approval_required, awaits the registry, executes on approve', async () => {
    // Force the gate ON regardless of env default.
    findFirstSpy.mockResolvedValue({ value: { gateMutating: true, timeoutMs: 60_000 } });

    const { ctx, emitted } = makeCtx();
    const deps = makeDeps();

    const pending = deps.executeMcpTool!(ctx, 'kubectl_apply_manifest', {
      manifest: 'kind: Deployment',
      namespace: 'prod',
    });

    const auditId = await vi.waitFor(() => {
      const req = emitted.find((e) => e.event === 'approval_required');
      expect(req).toBeDefined();
      return req!.data.auditId as string;
    });

    const req = emitted.find((e) => e.event === 'approval_required')!.data;
    expect(req.toolName).toBe('kubectl_apply_manifest');
    expect(req.classification).toBe('MUTATING');
    expect(req.args).toEqual({ manifest: 'kind: Deployment', namespace: 'prod' });
    expect(req.preview).toBeDefined();

    // Pending row written BEFORE execution.
    expect(createSpy.mock.calls[0][0].data).toMatchObject({
      tool_name: 'kubectl_apply_manifest',
      classification: 'MUTATING',
      decision: 'pending',
    });
    // The mutation has NOT hit the proxy yet — it's paused on the gate.
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('/mcp/tool'))).toBe(false);

    // Human approves.
    expect(getApprovalRegistry().submit(auditId, true)).toBe(true);

    const result = await pending;
    expect(result.ok).toBe(true);
    // NOW the proxy POST fired.
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('/mcp/tool'))).toBe(true);
    expect(emitted.find((e) => e.event === 'approval_resolved')?.data.outcome).toBe('approved');
  });

  it('blocks the mutation (proxy POST NEVER fires) on deny', async () => {
    findFirstSpy.mockResolvedValue({ value: { gateMutating: true, timeoutMs: 60_000 } });
    const { ctx, emitted } = makeCtx();
    const deps = makeDeps();

    const pending = deps.executeMcpTool!(ctx, 'aws_ec2_terminate_instances', { instanceId: 'i-123' });
    const auditId = await vi.waitFor(() => {
      const req = emitted.find((e) => e.event === 'approval_required');
      expect(req).toBeDefined();
      return req!.data.auditId as string;
    });

    getApprovalRegistry().submit(auditId, false);
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/denied/i);
    // The destructive call NEVER reached mcp-proxy.
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('/mcp/tool'))).toBe(false);
  });
});

describe('MCP-execution seam audit — single-pass dedup', () => {
  it('does NOT write a second row when the ctx is already marked audited', async () => {
    const { ctx } = makeCtx();
    // Simulate dispatchBody (or the before_tool_call hook) having audited this
    // exact call: the same per-call ctx object flows dispatchBody →
    // dispatchChatToolCall → executeMcpTool, carrying the flag.
    (ctx as Record<string, unknown>)[AUDIT_DONE_FLAG] = true;

    const deps = makeDeps();
    const result = await deps.executeMcpTool!(ctx, 'web_search', { query: 'x' });

    expect(result.ok).toBe(true);
    // Tool still executed.
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('/mcp/tool'))).toBe(true);
    // No new audit row — the upstream seam owns this call's row.
    expect(createSpy).not.toHaveBeenCalled();
  });
});
