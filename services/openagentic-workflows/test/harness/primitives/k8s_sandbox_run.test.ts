/**
 * k8s_sandbox_run node — Phase E1 primitive contract.
 *
 * Public contract: routes through the openagentic_kubernetes MCP server via
 * `${mcpProxyUrl}/call`. The `apply_only` operation does three sequential
 * kubectl_apply calls (namespace, ResourceQuota, NetworkPolicy, user manifest)
 * and returns `{ namespace, applied[], events[], logs, status:'success' }`.
 *
 * apply_and_wait additionally polls `kubectl_get pods`. We exercise apply_only
 * here to keep the contract test deterministic without simulating Pod Ready
 * polling — apply_and_wait has its own coverage in the executor unit suite.
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';

describe('k8s_sandbox_run node — apply_only lifecycle', () => {
  it('creates namespace + quota + netpol + manifest and returns success', async () => {
    process.env.MCP_PROXY_URL = 'http://mcp-proxy:8082';

    const calls: Array<{ tool: string; args: any }> = [];
    harnessServer.use(
      http.post('http://mcp-proxy:8082/call', async ({ request }) => {
        const body = (await request.json()) as Record<string, any>;
        calls.push({ tool: body.tool, args: body.arguments });
        // Return a minimal MCP-style envelope (matches mcp_tool.test pattern).
        return HttpResponse.json({
          result: {
            result: {
              content: [
                { type: 'text', text: 'pod/sandbox-probe created\nservice/sandbox-svc created' },
              ],
            },
          },
        });
      }),
    );

    const manifest = `apiVersion: v1
kind: Pod
metadata:
  name: sandbox-probe
spec:
  containers:
  - name: probe
    image: busybox:1.36
    command: ['echo', 'hi']
    restartPolicy: Never`;

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'sb',
            type: 'k8s_sandbox_run',
            data: {
              operation: 'apply_only',
              manifest,
              cpuLimit: '500m',
              memoryLimit: '256Mi',
              allowEgress: false,
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'sb' }],
      },
      input: {},
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.sb as {
      namespace: string;
      applied: string[];
      status: string;
    };
    expect(out.status).toBe('success');
    expect(out.namespace).toMatch(/^flows-sandbox-/);
    expect(Array.isArray(out.applied)).toBe(true);
    // 4 kubectl_apply calls: namespace, ResourceQuota, NetworkPolicy, user manifest
    const applyCalls = calls.filter((c) => c.tool === 'kubectl_apply');
    expect(applyCalls.length).toBeGreaterThanOrEqual(4);
  });
});
