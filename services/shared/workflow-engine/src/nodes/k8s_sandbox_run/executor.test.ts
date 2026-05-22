/**
 * k8s_sandbox_run node — executor tests.
 *
 * All K8s operations are mocked at the kubeMcp module boundary — the executor
 * never makes real network calls.
 *
 * Covers:
 *  K1.  apply_and_wait happy path — namespace create, ResourceQuota, NetworkPolicy,
 *       manifest apply, wait succeeds, logs/events captured, namespace deleted
 *  K2.  apply_and_wait timeout — workload never Ready → status:'timeout', namespace
 *       deleted when keepNamespaceOnFailure=false, kept when true
 *  K3.  apply_and_wait workload failure — pod enters Failed phase → status:'failed',
 *       namespace kept (keepNamespaceOnFailure=true) or deleted (false)
 *  K4.  apply_only — no wait, no cleanup; namespace + manifest applied, status:'success'
 *  K5.  cleanup — deletes namespaces matching label selector, returns status:'success'
 *  K6.  ResourceQuota + NetworkPolicy applied before manifest in apply_and_wait
 *  K7.  abort signal mid-poll — waitForReady rejects, namespace cleanup still
 *       runs (keepNamespaceOnFailure=false) or is skipped (true)
 *  K8.  template interpolation — {{trigger.manifestYaml}} in manifest field resolves
 *  K9.  missing manifest for apply_and_wait → throws
 *  K10. missing manifest for apply_only → throws
 *  K11. missing namespaceSelector for cleanup → throws
 *  K12. unknown operation enum → throws
 *  K13. 63-char namespace truncation — long executionId+nodeId is capped
 *  K14. output assertion fires when _assertOnStatus true + status !== 'success'
 *  K15. apply_and_wait with allowEgress=true — NetworkPolicy called with allowEgress=true
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import { execute, buildNamespaceName } from './executor.js';
import type { NodeExecutionContext } from '../types.js';
import * as kubeMcp from './kubeMcp.js';

// ---------------------------------------------------------------------------
// Mock the entire kubeMcp module so executor never touches real K8s
// ---------------------------------------------------------------------------

vi.mock('./kubeMcp.js');

// Typed references to the mocked functions
const mockCreateNamespace = kubeMcp.createNamespace as MockedFunction<typeof kubeMcp.createNamespace>;
const mockApplyResourceQuota = kubeMcp.applyResourceQuota as MockedFunction<typeof kubeMcp.applyResourceQuota>;
const mockApplyNetworkPolicy = kubeMcp.applyNetworkPolicy as MockedFunction<typeof kubeMcp.applyNetworkPolicy>;
const mockApplyManifest = kubeMcp.applyManifest as MockedFunction<typeof kubeMcp.applyManifest>;
const mockWaitForReady = kubeMcp.waitForReady as MockedFunction<typeof kubeMcp.waitForReady>;
const mockCaptureLogs = kubeMcp.captureLogs as MockedFunction<typeof kubeMcp.captureLogs>;
const mockCaptureEvents = kubeMcp.captureEvents as MockedFunction<typeof kubeMcp.captureEvents>;
const mockDeleteNamespace = kubeMcp.deleteNamespace as MockedFunction<typeof kubeMcp.deleteNamespace>;
const mockDeleteNamespacesBySelector = kubeMcp.deleteNamespacesBySelector as MockedFunction<typeof kubeMcp.deleteNamespacesBySelector>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-abc123',
    apiUrl: 'http://test-api',
    mcpProxyUrl: 'http://mcp-proxy',
    authToken: 'Bearer test-token',
    interpolateTemplate: (t: string, input: any) =>
      typeof t === 'string'
        ? t.replace(/\{\{([^}]+)\}\}/g, (_, k) => {
            const key = k.trim();
            return String(input?.[key] ?? '');
          })
        : t,
    getInternalAuthHeaders: () => ({}),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    ...overrides,
  };
}

function makeCtxWithCtrl(overrides: Partial<NodeExecutionContext> = {}): {
  ctx: NodeExecutionContext;
  ctrl: AbortController;
} {
  const ctrl = new AbortController();
  const ctx = makeCtx({ signal: ctrl.signal, ...overrides });
  return { ctx, ctrl };
}

function sandboxNode(data: Record<string, unknown>) {
  return { id: 'node-sandbox-1', type: 'k8s_sandbox_run', data };
}

const MANIFEST = 'apiVersion: v1\nkind: Pod\nmetadata:\n  name: probe\nspec:\n  containers:\n    - name: c\n      image: busybox';

beforeEach(() => {
  vi.resetAllMocks();

  // Set up sensible defaults for all mocks
  mockCreateNamespace.mockResolvedValue(undefined);
  mockApplyResourceQuota.mockResolvedValue(undefined);
  mockApplyNetworkPolicy.mockResolvedValue(undefined);
  mockApplyManifest.mockResolvedValue(['pod/probe']);
  mockWaitForReady.mockResolvedValue('success');
  mockCaptureLogs.mockResolvedValue({ probe: 'hello world\n' });
  mockCaptureEvents.mockResolvedValue([{ reason: 'Scheduled', message: 'Pod assigned' }]);
  mockDeleteNamespace.mockResolvedValue(undefined);
  mockDeleteNamespacesBySelector.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('k8s_sandbox_run/executor', () => {

  // K1 — apply_and_wait happy path
  it('K1: apply_and_wait happy path — all lifecycle steps called, returns success result', async () => {
    const ctx = makeCtx();
    const out: any = await execute(
      sandboxNode({
        operation: 'apply_and_wait',
        manifest: MANIFEST,
        timeoutSeconds: 60,
        cpuLimit: '2',
        memoryLimit: '4Gi',
        allowEgress: false,
        keepNamespaceOnFailure: false,
      }),
      null,
      ctx,
    );

    // Status
    expect(out.status).toBe('success');
    expect(out.namespace).toMatch(/^flows-sandbox-/);
    expect(out.applied).toEqual(['pod/probe']);
    expect(out.logs).toEqual({ probe: 'hello world\n' });
    expect(out.events).toHaveLength(1);

    // All lifecycle steps called once
    expect(mockCreateNamespace).toHaveBeenCalledOnce();
    expect(mockApplyResourceQuota).toHaveBeenCalledWith(ctx, expect.any(String), '2', '4Gi');
    expect(mockApplyNetworkPolicy).toHaveBeenCalledWith(ctx, expect.any(String), false);
    expect(mockApplyManifest).toHaveBeenCalledWith(ctx, expect.any(String), MANIFEST);
    expect(mockWaitForReady).toHaveBeenCalledOnce();
    expect(mockCaptureLogs).toHaveBeenCalledOnce();
    expect(mockCaptureEvents).toHaveBeenCalledOnce();

    // Cleanup happens on success
    expect(mockDeleteNamespace).toHaveBeenCalledOnce();
  });

  // K2 — timeout + namespace cleanup semantics
  it('K2a: apply_and_wait timeout — status:timeout, namespace deleted when keepNamespaceOnFailure=false', async () => {
    mockWaitForReady.mockResolvedValue('timeout');

    const out: any = await execute(
      sandboxNode({
        operation: 'apply_and_wait',
        manifest: MANIFEST,
        timeoutSeconds: 10,
        keepNamespaceOnFailure: false,
      }),
      null,
      makeCtx(),
    );

    expect(out.status).toBe('timeout');
    expect(out.errorReason).toMatch(/ready/i);
    // keepNamespaceOnFailure=false → cleanup runs
    expect(mockDeleteNamespace).toHaveBeenCalledOnce();
  });

  it('K2b: apply_and_wait timeout — namespace kept when keepNamespaceOnFailure=true (default)', async () => {
    mockWaitForReady.mockResolvedValue('timeout');

    const out: any = await execute(
      sandboxNode({
        operation: 'apply_and_wait',
        manifest: MANIFEST,
        timeoutSeconds: 10,
        keepNamespaceOnFailure: true,
      }),
      null,
      makeCtx(),
    );

    expect(out.status).toBe('timeout');
    // keepNamespaceOnFailure=true → no cleanup
    expect(mockDeleteNamespace).not.toHaveBeenCalled();
  });

  // K3 — workload failure
  it('K3a: apply_and_wait failure — pod Failed phase → status:failed, namespace kept (keepNamespaceOnFailure=true)', async () => {
    mockWaitForReady.mockResolvedValue('failed');

    const out: any = await execute(
      sandboxNode({
        operation: 'apply_and_wait',
        manifest: MANIFEST,
        keepNamespaceOnFailure: true,
      }),
      null,
      makeCtx(),
    );

    expect(out.status).toBe('failed');
    expect(mockDeleteNamespace).not.toHaveBeenCalled();
  });

  it('K3b: apply_and_wait failure — pod Failed phase → status:failed, namespace deleted (keepNamespaceOnFailure=false)', async () => {
    mockWaitForReady.mockResolvedValue('failed');

    const out: any = await execute(
      sandboxNode({
        operation: 'apply_and_wait',
        manifest: MANIFEST,
        keepNamespaceOnFailure: false,
      }),
      null,
      makeCtx(),
    );

    expect(out.status).toBe('failed');
    expect(mockDeleteNamespace).toHaveBeenCalledOnce();
  });

  // K4 — apply_only
  it('K4: apply_only — creates namespace + applies manifest, no wait, no cleanup', async () => {
    const out: any = await execute(
      sandboxNode({
        operation: 'apply_only',
        manifest: MANIFEST,
        cpuLimit: '1',
        memoryLimit: '2Gi',
      }),
      null,
      makeCtx(),
    );

    expect(out.status).toBe('success');
    expect(out.namespace).toMatch(/^flows-sandbox-/);
    expect(out.applied).toEqual(['pod/probe']);
    expect(out.logs).toEqual({});
    expect(out.events).toEqual([]);

    // Wait and cleanup NOT called
    expect(mockWaitForReady).not.toHaveBeenCalled();
    expect(mockDeleteNamespace).not.toHaveBeenCalled();

    // Provision steps ARE called
    expect(mockCreateNamespace).toHaveBeenCalledOnce();
    expect(mockApplyResourceQuota).toHaveBeenCalledWith(expect.anything(), expect.any(String), '1', '2Gi');
    expect(mockApplyNetworkPolicy).toHaveBeenCalledOnce();
    expect(mockApplyManifest).toHaveBeenCalledOnce();
  });

  // K5 — cleanup
  it('K5: cleanup — deletes namespaces matching label selector, returns status:success', async () => {
    mockDeleteNamespacesBySelector.mockResolvedValue([
      'flows-sandbox-exec-abc123-node-1',
      'flows-sandbox-exec-abc123-node-2',
    ]);

    const out: any = await execute(
      sandboxNode({
        operation: 'cleanup',
        namespaceSelector: 'flows-sandbox-execution=exec-abc123',
      }),
      null,
      makeCtx(),
    );

    expect(out.status).toBe('success');
    expect(mockDeleteNamespacesBySelector).toHaveBeenCalledWith(
      expect.anything(),
      'flows-sandbox-execution=exec-abc123',
    );
    expect(out.namespace).toContain('flows-sandbox-exec-abc123');
  });

  // K6 — ResourceQuota + NetworkPolicy applied before manifest
  it('K6: ResourceQuota + NetworkPolicy applied before user manifest in apply_and_wait', async () => {
    const callOrder: string[] = [];
    mockCreateNamespace.mockImplementation(async () => { callOrder.push('createNamespace'); });
    mockApplyResourceQuota.mockImplementation(async () => { callOrder.push('applyResourceQuota'); });
    mockApplyNetworkPolicy.mockImplementation(async () => { callOrder.push('applyNetworkPolicy'); });
    mockApplyManifest.mockImplementation(async () => { callOrder.push('applyManifest'); return ['pod/probe']; });

    await execute(
      sandboxNode({ operation: 'apply_and_wait', manifest: MANIFEST }),
      null,
      makeCtx(),
    );

    expect(callOrder).toEqual([
      'createNamespace',
      'applyResourceQuota',
      'applyNetworkPolicy',
      'applyManifest',
    ]);
  });

  // K7 — abort signal mid-poll
  it('K7: abort signal mid-poll — waitForReady rejects, cleanup runs if keepNamespaceOnFailure=false', async () => {
    const { ctx, ctrl } = makeCtxWithCtrl();

    mockWaitForReady.mockImplementation(async () => {
      ctrl.abort();
      throw new Error('Aborted');
    });

    const out: any = await execute(
      sandboxNode({
        operation: 'apply_and_wait',
        manifest: MANIFEST,
        keepNamespaceOnFailure: false,
      }),
      null,
      ctx,
    );

    // Should be failed (not throw) — executor catches abort and returns result
    expect(out.status).toBe('failed');
    expect(out.errorReason).toMatch(/abort/i);
    // keepNamespaceOnFailure=false → cleanup still runs despite abort
    expect(mockDeleteNamespace).toHaveBeenCalledOnce();
  });

  it('K7b: abort signal — namespace kept when keepNamespaceOnFailure=true on abort', async () => {
    const { ctx, ctrl } = makeCtxWithCtrl();

    mockWaitForReady.mockImplementation(async () => {
      ctrl.abort();
      throw new Error('Aborted');
    });

    const out: any = await execute(
      sandboxNode({
        operation: 'apply_and_wait',
        manifest: MANIFEST,
        keepNamespaceOnFailure: true,
      }),
      null,
      ctx,
    );

    expect(out.status).toBe('failed');
    expect(mockDeleteNamespace).not.toHaveBeenCalled();
  });

  // K8 — template interpolation
  it('K8: template interpolation — {{trigger.manifestYaml}} in manifest field resolves before apply', async () => {
    const resolvedManifest = 'apiVersion: v1\nkind: Pod\nmetadata:\n  name: dynamic-probe';

    const out: any = await execute(
      sandboxNode({
        operation: 'apply_and_wait',
        manifest: '{{trigger.manifestYaml}}',
      }),
      { trigger: { manifestYaml: resolvedManifest } },
      makeCtx({
        interpolateTemplate: (t: string, input: any) => {
          if (t === '{{trigger.manifestYaml}}') return resolvedManifest;
          return t;
        },
      }),
    );

    expect(out.status).toBe('success');
    // applyManifest was called with the resolved manifest
    expect(mockApplyManifest).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      resolvedManifest,
    );
  });

  // K9 — missing manifest for apply_and_wait
  it('K9: missing manifest for apply_and_wait → throws descriptive error', async () => {
    await expect(
      execute(
        sandboxNode({ operation: 'apply_and_wait' }),
        null,
        makeCtx(),
      ),
    ).rejects.toThrow(/manifest.*required|required.*manifest/i);
  });

  // K10 — missing manifest for apply_only
  it('K10: missing manifest for apply_only → throws descriptive error', async () => {
    await expect(
      execute(
        sandboxNode({ operation: 'apply_only' }),
        null,
        makeCtx(),
      ),
    ).rejects.toThrow(/manifest.*required|required.*manifest/i);
  });

  // K11 — missing namespaceSelector for cleanup
  it('K11: missing namespaceSelector for cleanup → throws descriptive error', async () => {
    await expect(
      execute(
        sandboxNode({ operation: 'cleanup' }),
        null,
        makeCtx(),
      ),
    ).rejects.toThrow(/namespaceSelector.*required|required.*namespaceSelector/i);
  });

  // K12 — unknown operation
  it('K12: unknown operation enum → throws with operation listed', async () => {
    await expect(
      execute(
        sandboxNode({ operation: 'destroy_cluster', manifest: MANIFEST }),
        null,
        makeCtx(),
      ),
    ).rejects.toThrow(/operation/i);
  });

  // K13 — 63-char namespace truncation
  it('K13: buildNamespaceName — truncates to 63 chars for very long IDs', () => {
    const longExecId = 'execution-id-that-is-extremely-long-and-exceeds-limits-for-sure-xyz';
    const longNodeId = 'node-identifier-that-is-also-very-long-and-overflows-the-limit-abc';
    const ns = buildNamespaceName(longExecId, longNodeId);
    expect(ns.length).toBeLessThanOrEqual(63);
    expect(ns).toMatch(/^flows-sandbox-/);
    // Must not end with a dash
    expect(ns).not.toMatch(/-$/);
  });

  it('K13b: buildNamespaceName — short IDs produce expected format', () => {
    const ns = buildNamespaceName('exec-001', 'node-A');
    expect(ns).toBe('flows-sandbox-exec-001-node-a');
    expect(ns.length).toBeLessThanOrEqual(63);
  });

  // K14 — outputAssertion fires on non-success status
  it('K14: _assertOnStatus flag is set on apply_and_wait result (enables outputAssertion)', async () => {
    // Happy path — flag is set and status is 'success'
    const out: any = await execute(
      sandboxNode({ operation: 'apply_and_wait', manifest: MANIFEST }),
      null,
      makeCtx(),
    );
    expect(out._assertOnStatus).toBe(true);
    expect(out.status).toBe('success');

    // Failing path — flag is also set (assertion evaluates result.status !== 'success')
    vi.resetAllMocks();
    mockCreateNamespace.mockResolvedValue(undefined);
    mockApplyResourceQuota.mockResolvedValue(undefined);
    mockApplyNetworkPolicy.mockResolvedValue(undefined);
    mockApplyManifest.mockResolvedValue(['pod/probe']);
    mockWaitForReady.mockResolvedValue('failed');
    mockCaptureLogs.mockResolvedValue({});
    mockCaptureEvents.mockResolvedValue([]);
    mockDeleteNamespace.mockResolvedValue(undefined);

    const failOut: any = await execute(
      sandboxNode({ operation: 'apply_and_wait', manifest: MANIFEST, keepNamespaceOnFailure: false }),
      null,
      makeCtx(),
    );
    expect(failOut._assertOnStatus).toBe(true);
    expect(failOut.status).toBe('failed');
  });

  // K15 — allowEgress passed through
  it('K15: allowEgress=true passed to applyNetworkPolicy', async () => {
    await execute(
      sandboxNode({
        operation: 'apply_and_wait',
        manifest: MANIFEST,
        allowEgress: true,
      }),
      null,
      makeCtx(),
    );

    expect(mockApplyNetworkPolicy).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      true,
    );
  });

  // Bonus: apply_and_wait — default settings (cpuLimit, memoryLimit) are applied
  it('K16: apply_and_wait — default cpuLimit "2" and memoryLimit "4Gi" used when not specified', async () => {
    await execute(
      sandboxNode({ operation: 'apply_and_wait', manifest: MANIFEST }),
      null,
      makeCtx(),
    );

    expect(mockApplyResourceQuota).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      '2',
      '4Gi',
    );
  });
});
