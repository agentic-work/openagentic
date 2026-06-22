/**
 * kubeMcp.ts — thin abstraction over the openagentic_kubernetes MCP server.
 *
 * The k8s_sandbox_run executor uses this helper instead of calling
 * abortableAxiosPost directly, so that tests can mock a single import
 * rather than intercepting raw axios calls.
 *
 * All calls route through ctx.mcpProxyUrl + the openagentic_kubernetes server.
 * Auth is forwarded from ctx.authToken (user context) so RBAC applies.
 */

import type { NodeExecutionContext } from '../types.js';
import { abortableAxiosPost } from '../../abortableAxios.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KubeMcpResult {
  content: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Internal: single MCP call
// ---------------------------------------------------------------------------

async function callKubeMcp(
  ctx: NodeExecutionContext,
  toolName: string,
  args: Record<string, unknown>,
): Promise<KubeMcpResult> {
  if (!ctx.mcpProxyUrl) {
    throw new Error('k8s_sandbox_run requires ctx.mcpProxyUrl (MCP_PROXY_URL env)');
  }

  const response = await abortableAxiosPost(
    { signal: ctx.signal },
    `${ctx.mcpProxyUrl}/call`,
    {
      server: 'openagentic_kubernetes',
      tool: toolName,
      arguments: args,
    },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: ctx.authToken || '',
      },
      timeout: 60000,
      validateStatus: () => true,
    },
  );

  if (response.status >= 400) {
    const errMsg =
      (response.data as any)?.error ||
      (response.data as any)?.message ||
      `MCP call failed with HTTP ${response.status}`;
    throw new Error(`openagentic_kubernetes tool "${toolName}" failed: ${errMsg}`);
  }

  const proxyResp = response.data as any;

  // Unwrap proxy envelope → JSONRPC response → MCP result (3-layer, same as mcp_tool)
  if (proxyResp?.error?.code) {
    throw new Error(`openagentic_kubernetes tool "${toolName}" proxy error: ${proxyResp.error.message}`);
  }

  const jsonrpcResp = proxyResp?.result ?? proxyResp;
  if (jsonrpcResp?.error) {
    const msg = jsonrpcResp.error.message || JSON.stringify(jsonrpcResp.error);
    throw new Error(`openagentic_kubernetes tool "${toolName}" JSONRPC error: ${msg}`);
  }

  const mcpResult = jsonrpcResp?.result ?? jsonrpcResp;

  if (mcpResult?.isError) {
    const errContent = mcpResult.content?.[0]?.text || 'Unknown MCP error';
    throw new Error(`openagentic_kubernetes tool "${toolName}" error: ${errContent}`);
  }

  // Normalize content blocks → joined string
  if (mcpResult && Array.isArray(mcpResult.content)) {
    const textContent = mcpResult.content
      .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
      .map((b: any) => b.text)
      .join('\n');
    return { ...mcpResult, content: textContent };
  }

  return mcpResult as KubeMcpResult;
}

// ---------------------------------------------------------------------------
// Public API — one function per K8s lifecycle step
// ---------------------------------------------------------------------------

/** Create a namespace with sandbox labels attached. */
export async function createNamespace(
  ctx: NodeExecutionContext,
  namespace: string,
  executionId: string,
  nodeId: string,
): Promise<void> {
  const manifest = `apiVersion: v1\nkind: Namespace\nmetadata:\n  name: ${namespace}\n  labels:\n    managed-by: openagentic-flows\n    flows-sandbox-execution: ${executionId}\n    flows-sandbox-node: ${nodeId}`;
  await callKubeMcp(ctx, 'kubectl_apply', { manifest });
}

/** Apply a ResourceQuota to cap CPU and memory in the namespace. */
export async function applyResourceQuota(
  ctx: NodeExecutionContext,
  namespace: string,
  cpuLimit: string,
  memoryLimit: string,
): Promise<void> {
  const manifest = `apiVersion: v1\nkind: ResourceQuota\nmetadata:\n  name: sandbox-quota\n  namespace: ${namespace}\nspec:\n  hard:\n    requests.cpu: "${cpuLimit}"\n    limits.cpu: "${cpuLimit}"\n    requests.memory: "${memoryLimit}"\n    limits.memory: "${memoryLimit}"`;
  await callKubeMcp(ctx, 'kubectl_apply', { manifest, namespace });
}

/** Apply a default-deny NetworkPolicy (optionally allowing egress). */
export async function applyNetworkPolicy(
  ctx: NodeExecutionContext,
  namespace: string,
  allowEgress: boolean,
): Promise<void> {
  // Build egress section: empty = deny-all
  const egressSection = allowEgress ? '\n  egress:\n  - {}' : '';
  const manifest = `apiVersion: networking.k8s.io/v1\nkind: NetworkPolicy\nmetadata:\n  name: default-deny\n  namespace: ${namespace}\nspec:\n  podSelector: {}\n  policyTypes:\n  - Ingress\n  - Egress${egressSection}`;
  await callKubeMcp(ctx, 'kubectl_apply', { manifest, namespace });
}

/** Apply the user's manifest YAML into the namespace. Returns list of applied resource names. */
export async function applyManifest(
  ctx: NodeExecutionContext,
  namespace: string,
  manifestYaml: string,
): Promise<string[]> {
  const result = await callKubeMcp(ctx, 'kubectl_apply', { manifest: manifestYaml, namespace });
  // Parse applied resource names from the content string (e.g. "pod/sandbox-probe created")
  const applied: string[] = [];
  const lines = (result?.content || '').split('\n');
  for (const line of lines) {
    const match = line.match(/^(\S+)\s+(created|configured|unchanged)/);
    if (match) applied.push(match[1]);
  }
  return applied.length > 0 ? applied : ['(applied)'];
}

/** Poll until all pods in the namespace are Ready or the signal is aborted. */
export async function waitForReady(
  ctx: NodeExecutionContext,
  namespace: string,
  timeoutMs: number,
): Promise<'success' | 'timeout' | 'failed'> {
  const deadline = Date.now() + timeoutMs;
  const pollIntervalMs = 3000;

  while (true) {
    if (ctx.signal.aborted) {
      return 'failed';
    }

    const result = await callKubeMcp(ctx, 'kubectl_get', {
      resource: 'pods',
      namespace,
      output: 'json',
    });

    const content = result?.content || '';
    let podsData: any;
    try {
      podsData = JSON.parse(content);
    } catch {
      // Content not JSON — might be an error message or empty namespace
      // If no items could be parsed, treat as still starting
      podsData = null;
    }

    const items: any[] = podsData?.items ?? [];

    if (items.length > 0) {
      const allReady = items.every((pod: any) => {
        const phase = pod?.status?.phase;
        if (phase === 'Succeeded') return true;
        if (phase === 'Failed') return false;
        const conditions: any[] = pod?.status?.conditions ?? [];
        const readyCond = conditions.find((c: any) => c.type === 'Ready');
        return readyCond?.status === 'True';
      });

      const anyFailed = items.some((pod: any) => pod?.status?.phase === 'Failed');

      if (anyFailed) return 'failed';
      if (allReady) return 'success';
    }

    if (Date.now() >= deadline) {
      return 'timeout';
    }

    // Wait before next poll, respecting abort signal
    await new Promise<void>((resolve, reject) => {
      if (ctx.signal.aborted) {
        reject(new Error('Aborted'));
        return;
      }
      const timer = setTimeout(resolve, pollIntervalMs);
      ctx.signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new Error('Aborted'));
        },
        { once: true },
      );
    });
  }
}

/** Capture pod logs from all pods in the namespace. Returns Record<podName, logText>. */
export async function captureLogs(
  ctx: NodeExecutionContext,
  namespace: string,
): Promise<Record<string, string>> {
  const result = await callKubeMcp(ctx, 'kubectl_get', {
    resource: 'pods',
    namespace,
    output: 'json',
  });

  let podsData: any;
  try {
    podsData = JSON.parse(result?.content || '');
  } catch {
    return {};
  }

  const items: any[] = podsData?.items ?? [];
  const logs: Record<string, string> = {};

  for (const pod of items) {
    const podName: string = pod?.metadata?.name;
    if (!podName) continue;
    try {
      const logResult = await callKubeMcp(ctx, 'kubectl_logs', { pod: podName, namespace });
      logs[podName] = logResult?.content || '';
    } catch {
      logs[podName] = '(log capture failed)';
    }
  }

  return logs;
}

/** Get events from a namespace. Returns raw event objects. */
export async function captureEvents(
  ctx: NodeExecutionContext,
  namespace: string,
): Promise<unknown[]> {
  try {
    const result = await callKubeMcp(ctx, 'kubectl_get', {
      resource: 'events',
      namespace,
      output: 'json',
    });

    let eventsData: any;
    try {
      eventsData = JSON.parse(result?.content || '');
    } catch {
      return [];
    }

    return eventsData?.items ?? [];
  } catch {
    return [];
  }
}

/** Delete a namespace. */
export async function deleteNamespace(
  ctx: NodeExecutionContext,
  namespace: string,
): Promise<void> {
  await callKubeMcp(ctx, 'kubectl_delete', { resource: 'namespace', name: namespace });
}

/** List namespaces matching a label selector and delete each one. */
export async function deleteNamespacesBySelector(
  ctx: NodeExecutionContext,
  labelSelector: string,
): Promise<string[]> {
  const result = await callKubeMcp(ctx, 'kubectl_get', {
    resource: 'namespaces',
    selector: labelSelector,
    output: 'json',
  });

  let nsData: any;
  try {
    nsData = JSON.parse(result?.content || '');
  } catch {
    return [];
  }

  const namespaces: string[] = (nsData?.items ?? []).map(
    (ns: any) => ns?.metadata?.name as string,
  ).filter(Boolean);

  for (const ns of namespaces) {
    await callKubeMcp(ctx, 'kubectl_delete', { resource: 'namespace', name: ns });
  }

  return namespaces;
}
