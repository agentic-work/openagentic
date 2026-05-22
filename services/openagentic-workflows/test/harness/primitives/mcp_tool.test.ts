/**
 * mcp_tool node — Phase D template-critical primitive contract.
 *
 * Public contract under test:
 *   - POSTs `{ server, tool, arguments }` to `${mcpProxyUrl}/call`.
 *   - Returns the unwrapped MCP tool result. Content blocks are joined
 *     into a single `content` string for downstream nodes.
 *
 * MCP proxy mocked via MSW. We hit the canonical http://mcp-proxy:8082
 * URL that workflows-svc wires via MCP_PROXY_URL.
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';

describe('mcp_tool node — MCP proxy dispatch', () => {
  it('forwards tool + args to the MCP proxy and unwraps content blocks', async () => {
    // Wire the env var the engine reads when constructing ctx.mcpProxyUrl.
    process.env.MCP_PROXY_URL = 'http://mcp-proxy:8082';

    let receivedBody: { server: string; tool: string; arguments: unknown } | null = null;
    harnessServer.use(
      http.post('http://mcp-proxy:8082/call', async ({ request }) => {
        receivedBody = (await request.json()) as typeof receivedBody;
        return HttpResponse.json({
          result: {
            result: {
              content: [
                { type: 'text', text: 'Found 3 pods in namespace agentic-dev.' },
              ],
            },
          },
        });
      }),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'mcp',
            type: 'mcp_tool',
            data: {
              toolName: 'k8s_list_pods',
              toolServer: 'openagentic-k8s',
              arguments: { namespace: 'agentic-dev' },
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'mcp' }],
      },
      input: {},
    });

    expect(result.status).toBe('completed');
    expect(receivedBody).not.toBeNull();
    expect(receivedBody).toMatchObject({
      server: 'openagentic_k8s',
      tool: 'k8s_list_pods',
      arguments: { namespace: 'agentic-dev' },
    });

    const out = result.outputs.mcp as { content: string };
    expect(out.content).toContain('Found 3 pods');
  });
});
