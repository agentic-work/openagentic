/**
 * mcp_tool — OBO routing parity with chatmode (Flows-3).
 *
 * User directive 2026-05-13: "mcps are in mcp-proxy and should and can be
 * used by flows using the current users auth/roles/rbac- same as chatmode".
 *
 * The chatmode pipeline routes every MCP invocation through mcp-proxy with
 * the user's real Azure AD `access_token` as `Authorization: Bearer <jwt>`
 * plus the user's `id_token` as `X-Azure-ID-Token` + `X-AWS-ID-Token` for
 * Azure OBO / AWS Identity Center federation. (See chatmode's
 * `buildMcpProxyHeaders` in `services/openagentic-api/src/services/
 * buildChatV2Deps.ts`.)
 *
 * This file pins the same contract for the Flows `mcp_tool` node so the
 * mcp-proxy sees the same upn/oid for a flow-driven call as it sees for a
 * chatmode-driven call. Without this, every MCP that uses OBO (openagentic_aws.*,
 * openagentic_azure.*, openagentic_gcp.*, etc.) would 401 from inside a flow even though
 * the user is fully entitled in chatmode.
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
        email: 'mcp-tester@phatoldsungmail.onmicrosoft.com',
        accessToken: 'eyJ.fake.jwt',
      },
    });

    expect(result.status).toBe('completed');
    expect(receivedAuth).toMatch(/^Bearer eyJ\./);
  });

  it('forwards user ID token as both X-Azure-ID-Token and X-AWS-ID-Token (OBO + AWS Identity Center)', async () => {
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
    expect(azureIdToken).toBe('eyJ.id.jwt');
    expect(awsIdToken).toBe('eyJ.id.jwt');
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
