/**
 * k8s_sandbox_run node executor.
 *
 * A higher-level bounded experiment runner for ephemeral Kubernetes workloads.
 * Unlike mcp_tool (generic CLI passthrough), this node manages the full
 * sandbox lifecycle:
 *
 *   apply_and_wait — create isolated namespace, enforce ResourceQuota +
 *                    NetworkPolicy, apply manifest, wait for Ready, capture
 *                    logs+events, delete namespace (with keepNamespaceOnFailure
 *                    semantics on error paths).
 *
 *   apply_only     — create namespace + apply, no wait/cleanup. Caller must
 *                    later call operation=cleanup to tear down.
 *
 *   cleanup        — delete sandbox namespaces matching a label selector.
 *
 * Under the hood all K8s operations route through the openagentic_kubernetes MCP
 * server via the kubeMcp abstraction layer (so tests can mock that one
 * import without touching raw axios).
 *
 * Cleanup guarantees:
 *   - apply_and_wait wraps execution in try-finally. If keepNamespaceOnFailure
 *     is false, cleanup always runs. If true, cleanup runs on success only.
 *   - Abort signal: when ctx.signal fires mid-poll, waitForReady rejects with
 *     'Aborted'. The outer catch handles namespace cleanup per the
 *     keepNamespaceOnFailure setting and re-throws.
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import {
  createNamespace,
  applyResourceQuota,
  applyNetworkPolicy,
  applyManifest,
  waitForReady,
  captureLogs,
  captureEvents,
  deleteNamespace,
  deleteNamespacesBySelector,
} from './kubeMcp.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SandboxResult {
  namespace: string;
  applied: string[];
  events: unknown[];
  logs: Record<string, string>;
  status: 'success' | 'timeout' | 'failed';
  errorReason?: string;
  /** Internal flag consumed by outputAssertion — true when assertion is armed. */
  _assertOnStatus?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a unique sandbox namespace name from executionId + nodeId.
 * Format: flows-sandbox-{executionId}-{nodeId}, truncated to 63 chars.
 * Kubernetes namespace names must be ≤63 characters and DNS-label safe.
 */
export function buildNamespaceName(executionId: string, nodeId: string): string {
  const prefix = 'flows-sandbox-';
  // Sanitize: lowercase, replace non-alphanumeric with dashes
  const sanitize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  const id = sanitize(executionId);
  const nid = sanitize(nodeId);
  const candidate = `${prefix}${id}-${nid}`;
  // Truncate to 63 chars, removing any trailing dash
  return candidate.slice(0, 63).replace(/-$/, '');
}

// ---------------------------------------------------------------------------
// Operation handlers
// ---------------------------------------------------------------------------

async function runApplyAndWait(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<SandboxResult> {
  const {
    manifest: rawManifest,
    timeoutSeconds = 300,
    cpuLimit = '2',
    memoryLimit = '4Gi',
    allowEgress = false,
    keepNamespaceOnFailure = true,
  } = node.data as Record<string, any>;

  if (!rawManifest) {
    throw new Error('k8s_sandbox_run: manifest is required for apply_and_wait');
  }

  const manifestYaml = ctx.interpolateTemplate(String(rawManifest), input);
  const namespace = buildNamespaceName(ctx.executionId, node.id);
  const timeoutMs = Number(timeoutSeconds) * 1000;

  ctx.logger.info(
    { nodeId: node.id, namespace, operation: 'apply_and_wait' },
    '[k8s_sandbox_run] Starting apply_and_wait',
  );

  // Provision the sandbox
  await createNamespace(ctx, namespace, ctx.executionId, node.id);
  await applyResourceQuota(ctx, namespace, String(cpuLimit), String(memoryLimit));
  await applyNetworkPolicy(ctx, namespace, Boolean(allowEgress));
  const applied = await applyManifest(ctx, namespace, manifestYaml);

  ctx.logger.info(
    { nodeId: node.id, namespace, applied },
    '[k8s_sandbox_run] Manifest applied, waiting for Ready',
  );

  // Wait / capture / teardown
  let runStatus: 'success' | 'timeout' | 'failed';
  let logs: Record<string, string> = {};
  let events: unknown[] = [];
  let errorReason: string | undefined;

  try {
    runStatus = await waitForReady(ctx, namespace, timeoutMs);

    // Capture diagnostic data regardless of outcome
    try {
      [logs, events] = await Promise.all([
        captureLogs(ctx, namespace),
        captureEvents(ctx, namespace),
      ]);
    } catch (diagErr: any) {
      ctx.logger.warn(
        { nodeId: node.id, namespace, err: diagErr?.message },
        '[k8s_sandbox_run] Log/event capture failed (non-fatal)',
      );
    }

    if (runStatus === 'timeout') {
      errorReason = `Workload did not become Ready within ${timeoutSeconds}s`;
    } else if (runStatus === 'failed') {
      errorReason = 'One or more pods entered Failed phase';
    }
  } catch (waitErr: any) {
    // Abort signal or unexpected error during poll
    const isAbort =
      ctx.signal.aborted ||
      waitErr?.message?.toLowerCase().includes('abort');
    runStatus = 'failed';
    errorReason = isAbort ? 'Execution aborted' : waitErr?.message;

    ctx.logger.warn(
      { nodeId: node.id, namespace, err: errorReason },
      '[k8s_sandbox_run] Wait phase threw — treating as failed',
    );
  } finally {
    // Cleanup decision: always clean on success, respect keepNamespaceOnFailure on failure
    const shouldClean =
      runStatus! === 'success' || !keepNamespaceOnFailure;

    if (shouldClean) {
      try {
        await deleteNamespace(ctx, namespace);
        ctx.logger.info({ nodeId: node.id, namespace }, '[k8s_sandbox_run] Namespace deleted');
      } catch (cleanErr: any) {
        ctx.logger.warn(
          { nodeId: node.id, namespace, err: cleanErr?.message },
          '[k8s_sandbox_run] Namespace deletion failed (non-fatal)',
        );
      }
    } else {
      ctx.logger.info(
        { nodeId: node.id, namespace, keepNamespaceOnFailure },
        '[k8s_sandbox_run] Keeping namespace for debugging',
      );
    }
  }

  return {
    namespace,
    applied,
    events,
    logs,
    status: runStatus!,
    ...(errorReason ? { errorReason } : {}),
    _assertOnStatus: true,
  };
}

async function runApplyOnly(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<SandboxResult> {
  const {
    manifest: rawManifest,
    cpuLimit = '2',
    memoryLimit = '4Gi',
    allowEgress = false,
  } = node.data as Record<string, any>;

  if (!rawManifest) {
    throw new Error('k8s_sandbox_run: manifest is required for apply_only');
  }

  const manifestYaml = ctx.interpolateTemplate(String(rawManifest), input);
  const namespace = buildNamespaceName(ctx.executionId, node.id);

  ctx.logger.info(
    { nodeId: node.id, namespace, operation: 'apply_only' },
    '[k8s_sandbox_run] Starting apply_only (no wait, no cleanup)',
  );

  await createNamespace(ctx, namespace, ctx.executionId, node.id);
  await applyResourceQuota(ctx, namespace, String(cpuLimit), String(memoryLimit));
  await applyNetworkPolicy(ctx, namespace, Boolean(allowEgress));
  const applied = await applyManifest(ctx, namespace, manifestYaml);

  ctx.logger.info(
    { nodeId: node.id, namespace, applied },
    '[k8s_sandbox_run] apply_only complete — namespace retained for caller cleanup',
  );

  return {
    namespace,
    applied,
    events: [],
    logs: {},
    status: 'success',
  };
}

async function runCleanup(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<SandboxResult> {
  const { namespaceSelector: rawSelector } = node.data as Record<string, any>;

  if (!rawSelector) {
    throw new Error('k8s_sandbox_run: namespaceSelector is required for cleanup');
  }

  const selector = ctx.interpolateTemplate(String(rawSelector), input);

  ctx.logger.info(
    { nodeId: node.id, selector, operation: 'cleanup' },
    '[k8s_sandbox_run] Starting cleanup by label selector',
  );

  const deleted = await deleteNamespacesBySelector(ctx, selector);

  ctx.logger.info(
    { nodeId: node.id, selector, deleted },
    '[k8s_sandbox_run] Cleanup complete',
  );

  return {
    namespace: deleted.join(','),
    applied: [],
    events: [],
    logs: {},
    status: 'success',
  };
}

// ---------------------------------------------------------------------------
// Main executor
// ---------------------------------------------------------------------------

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  const { operation = 'apply_and_wait' } = node.data as Record<string, any>;

  switch (operation) {
    case 'apply_and_wait':
      return runApplyAndWait(node, input, ctx);

    case 'apply_only':
      return runApplyOnly(node, input, ctx);

    case 'cleanup':
      return runCleanup(node, input, ctx);

    default:
      throw new Error(
        `k8s_sandbox_run: unknown operation "${operation}". Must be one of: apply_and_wait, apply_only, cleanup`,
      );
  }
}
