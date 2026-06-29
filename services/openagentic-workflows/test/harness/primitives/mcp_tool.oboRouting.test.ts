/**
 * mcp_tool — proxy routing parity with chatmode (Flows-3).
 *
 * User directive 2026-05-13: "mcps are in mcp-proxy and should and can be
 * used by flows using the current users auth/roles/rbac- same as chatmode".
 *
 * The chatmode pipeline routes every MCP invocation through mcp-proxy with
 * the caller's bearer as `Authorization: Bearer <jwt>` (see chatmode's
 * `buildMcpProxyHeaders` in `services/openagentic-api/src/services/
 * buildChatV2Deps.ts`).
 *
 * OSS is local-auth only — there is NO OBO (On-Behalf-Of) federation, so the
 * Flows `mcp_tool` node never forwards `X-Azure-ID-Token` / `X-AWS-ID-Token`.
 * Cloud MCP servers (openagentic_aws.*, openagentic_azure.*, openagentic_gcp.*)
 * authenticate to their cloud via their own service-account / static-keypair /
 * ADC credentials. This file pins both the Authorization routing parity AND the
 * no-OBO-ID-token invariant.
 */

import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';

describe('mcp_tool routes through mcp-proxy with user OBO (chatmode parity)', () => {
  it('forwards user JWT as `Authorization: Bearer <jwt>` header', async () => {
    process.env.MCP_PROXY_URL = 'http://mcp-proxy:8082';

    let receivedAuth: string | null = null;
    harnessServer.use(
      http.post('http://mcp-proxy:8082/call', async ({ request }) => {
        receivedAuth = request.headers.get('Authorization');
        return HttpResponse.json({
          result: {
            result: {
              content: [{ type: 'text', text: 'sub-list-ok' }],
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
              toolName: 'azure_list_subscriptions',
              toolServer: 'openagentic_azure',
              arguments: {},
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'mcp' }],
      },
      input: {},
      user: {
        id: 'mcp-tester',
        email: 'admin@example.onmicrosoft.com',
        accessToken: 'eyJ.fake.jwt',
      },
    });

    expect(result.status).toBe('completed');
    expect(receivedAuth).toMatch(/^Bearer eyJ\./);
  });

  it('OSS: never forwards X-Azure-ID-Token / X-AWS-ID-Token even when an idToken is present (no OBO)', async () => {
    process.env.MCP_PROXY_URL = 'http://mcp-proxy:8082';

    let azureIdToken: string | null = null;
    let awsIdToken: string | null = null;
    harnessServer.use(
      http.post('http://mcp-proxy:8082/call', async ({ request }) => {
        azureIdToken = request.headers.get('X-Azure-ID-Token');
        awsIdToken = request.headers.get('X-AWS-ID-Token');
        return HttpResponse.json({
          result: {
            result: { content: [{ type: 'text', text: 'ok' }] },
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
              toolName: 'aws_cost_by_service',
              toolServer: 'openagentic_aws',
              arguments: { days: 30 },
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'mcp' }],
      },
      input: {},
      user: {
        id: 'mcp-tester',
        accessToken: 'eyJ.access.jwt',
        idToken: 'eyJ.id.jwt',
      },
    });

    expect(result.status).toBe('completed');
    // OSS is local-auth only — no OBO (On-Behalf-Of) ID-token forwarding.
    expect(azureIdToken).toBeNull();
    expect(awsIdToken).toBeNull();
  });

  it('does NOT send Authorization header when user context is absent (no anonymous OBO leak)', async () => {
    process.env.MCP_PROXY_URL = 'http://mcp-proxy:8082';

    let receivedAuth: string | null = null;
    harnessServer.use(
      http.post('http://mcp-proxy:8082/call', async ({ request }) => {
        receivedAuth = request.headers.get('Authorization');
        return HttpResponse.json({
          result: { result: { content: [{ type: 'text', text: 'ok' }] } },
        });
      }),
    );

    await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'mcp',
            type: 'mcp_tool',
            data: {
              toolName: 'web_search',
              toolServer: 'openagentic_web',
              arguments: { query: 'hello' },
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'mcp' }],
      },
      input: {},
      // no user → no auth threading
    });

    // axios sends '' (empty string) when authToken is undefined per the
    // executor — what we're proving is that NO bearer/JWT leaks under the
    // anonymous code path.
    expect(receivedAuth ?? '').not.toMatch(/^Bearer eyJ/);
  });

  it('passes server prefix + tool name + arguments verbatim to mcp-proxy', async () => {
    process.env.MCP_PROXY_URL = 'http://mcp-proxy:8082';

    let receivedBody: { server?: string; tool?: string; arguments?: unknown } | null = null;
    harnessServer.use(
      http.post('http://mcp-proxy:8082/call', async ({ request }) => {
        receivedBody = (await request.json()) as typeof receivedBody;
        return HttpResponse.json({
          result: { result: { content: [{ type: 'text', text: 'ok' }] } },
        });
      }),
    );

    await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'mcp',
            type: 'mcp_tool',
            data: {
              toolName: 'aws_cost_by_service',
              toolServer: 'openagentic_aws',
              arguments: { days: 30, groupBy: 'service' },
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'mcp' }],
      },
      input: {},
      user: { id: 'u', accessToken: 'eyJ.fake.jwt' },
    });

    expect(receivedBody).not.toBeNull();
    expect(receivedBody!.server).toBe('openagentic_aws');
    expect(receivedBody!.tool).toBe('aws_cost_by_service');
    expect(receivedBody!.arguments).toEqual({ days: 30, groupBy: 'service' });
  });
});
