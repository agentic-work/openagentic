/**
 * Regression: mcp_tool downstream input — MCP standard envelope lift.
 *
 * Open concern from `9c4363ff` (output_parser E2E close-out): the live
 * mcp-proxy now wraps openagentic_kubernetes.k8s_list_pods (and other MCP tools)
 * in the MCP-standard envelope `{ content, structuredContent, isError }`.
 * The mcp_tool node executor surfaces that envelope verbatim — so a
 * downstream extract_key on `path='pods'` (or filter_data on
 * `items='{{input.pods}}'`, or any top-level field reference) returns
 * `found:false` / empty because the pods array is nested under
 * `structuredContent.pods` instead.
 *
 * Pins the canonical mcp_tool → typed-node contract:
 *
 *   When the upstream MCP response has a `structuredContent` object,
 *   the mcp_tool executor MUST lift its keys to top level so downstream
 *   nodes can reference them as `{{input.<field>}}` / `path='<field>'`.
 *   `structuredContent` MUST remain as a sibling for back-compat with
 *   callers that already deep-path through it (slug 3 — k8s_get_pod_logs
 *   crashloop-triage template, chatmode ToolEnvelopeSplitter).
 *
 * Phase 3 of the systematic-debug fix per
 * reports/flows-shared-context-fix/2026-05-14/evidence.md.
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';

const MCP_ENVELOPE_PODS = {
  result: {
    result: {
      content: [
        {
          type: 'text',
          text: 'Pods in namespace openagentic (2 total): foo (Running), bar (Pending).',
        },
      ],
      structuredContent: {
        success: true,
        namespace: 'openagentic',
        pods: [
          { name: 'foo', status: 'Running', restarts: 0 },
          { name: 'bar', status: 'Pending', restarts: 5 },
        ],
        count: 2,
      },
      isError: false,
    },
  },
};

describe('mcp_tool downstream input — MCP envelope structuredContent lift', () => {
  it('extract_key path="pods" finds the array at top level after mcp_tool unwraps the envelope', async () => {
    process.env.MCP_PROXY_URL = 'http://mcp-proxy:8082';
    harnessServer.use(
      http.post('http://mcp-proxy:8082/call', async () =>
        HttpResponse.json(MCP_ENVELOPE_PODS),
      ),
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
              toolServer: 'openagentic_kubernetes',
              arguments: { namespace: 'openagentic' },
            },
          },
          {
            id: 'extract',
            type: 'extract_key',
            data: { path: 'pods', default: '[]' },
          },
        ],
        edges: [
          { id: 'e1', source: 'trigger', target: 'mcp' },
          { id: 'e2', source: 'mcp', target: 'extract' },
        ],
      },
      input: {},
      user: { id: 'mcp-tester', accessToken: 'eyJ.fake.jwt' },
    });

    expect(result.status).toBe('completed');

    // mcp_tool output: structuredContent fields lifted to top level,
    // structuredContent kept as sibling for back-compat.
    const mcpOut = result.outputs.mcp as {
      content?: string;
      isError?: boolean;
      pods?: Array<Record<string, unknown>>;
      structuredContent?: { pods?: Array<Record<string, unknown>> };
    };
    expect(Array.isArray(mcpOut.pods)).toBe(true);
    expect(mcpOut.pods?.length).toBe(2);
    expect(Array.isArray(mcpOut.structuredContent?.pods)).toBe(true); // back-compat
    expect(typeof mcpOut.content).toBe('string');
    expect(mcpOut.isError).toBe(false);

    // Downstream extract_key sees pods at top level.
    const extractOut = result.outputs.extract as {
      value?: Array<Record<string, unknown>>;
      found?: boolean;
    };
    expect(extractOut.found).toBe(true);
    expect(Array.isArray(extractOut.value)).toBe(true);
    expect(extractOut.value?.length).toBe(2);
    expect(extractOut.value?.[0]).toMatchObject({ name: 'foo', status: 'Running' });
  });

  it('filter_data with items="{{input.pods}}" filters the lifted top-level pods array', async () => {
    process.env.MCP_PROXY_URL = 'http://mcp-proxy:8082';
    harnessServer.use(
      http.post('http://mcp-proxy:8082/call', async () =>
        HttpResponse.json(MCP_ENVELOPE_PODS),
      ),
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
              toolServer: 'openagentic_kubernetes',
              arguments: { namespace: 'openagentic' },
            },
          },
          {
            id: 'filter',
            type: 'filter_data',
            data: {
              items: '{{input.pods}}',
              field: 'status',
              operator: 'neq',
              value: 'Running',
            },
          },
        ],
        edges: [
          { id: 'e1', source: 'trigger', target: 'mcp' },
          { id: 'e2', source: 'mcp', target: 'filter' },
        ],
      },
      input: {},
      user: { id: 'mcp-tester', accessToken: 'eyJ.fake.jwt' },
    });

    expect(result.status).toBe('completed');
    const filterOut = result.outputs.filter as {
      filtered?: Array<{ name?: string; status?: string }>;
      totalCount?: number;
      droppedCount?: number;
    };
    expect(filterOut.totalCount).toBe(2);
    expect(filterOut.filtered?.length).toBe(1);
    expect(filterOut.filtered?.[0].name).toBe('bar');
    expect(filterOut.droppedCount).toBe(1);
  });

  it('select_data with input="{{input.pods}}" projects fields off the lifted top-level pods array', async () => {
    process.env.MCP_PROXY_URL = 'http://mcp-proxy:8082';
    harnessServer.use(
      http.post('http://mcp-proxy:8082/call', async () =>
        HttpResponse.json(MCP_ENVELOPE_PODS),
      ),
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
              toolServer: 'openagentic_kubernetes',
              arguments: { namespace: 'openagentic' },
            },
          },
          {
            id: 'pick',
            type: 'select_data',
            data: {
              input: '{{input.pods}}',
              fields: ['name', 'status'],
              mode: 'pick',
            },
          },
        ],
        edges: [
          { id: 'e1', source: 'trigger', target: 'mcp' },
          { id: 'e2', source: 'mcp', target: 'pick' },
        ],
      },
      input: {},
      user: { id: 'mcp-tester', accessToken: 'eyJ.fake.jwt' },
    });

    expect(result.status).toBe('completed');
    const picked = result.outputs.pick as Array<Record<string, unknown>>;
    expect(Array.isArray(picked)).toBe(true);
    expect(picked.length).toBe(2);
    expect(Object.keys(picked[0]).sort()).toEqual(['name', 'status']);
    expect((picked[0] as Record<string, unknown>).restarts).toBeUndefined();
  });

  it('FastMCP-wrapped structuredContent.result peels and lifts the python dict to top level', async () => {
    // Live shape captured 2026-05-14 against openagentic_kubernetes.k8s_list_pods:
    // FastMCP wraps the python tool's return dict under a sole `result`
    // key inside structuredContent. The lift must peel that single wrap
    // so downstream nodes see {success, pods, ...} not {result: {...}}.
    process.env.MCP_PROXY_URL = 'http://mcp-proxy:8082';
    harnessServer.use(
      http.post('http://mcp-proxy:8082/call', async () =>
        HttpResponse.json({
          result: {
            jsonrpc: '2.0',
            id: 1,
            result: {
              content: [{ type: 'text', text: 'Pods listed.' }],
              structuredContent: {
                result: {
                  success: true,
                  namespace: 'openagentic',
                  pods: [
                    { name: 'foo', status: 'Running' },
                    { name: 'bar', status: 'Pending' },
                  ],
                  count: 2,
                },
              },
              isError: false,
            },
          },
        }),
      ),
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
              toolServer: 'openagentic_kubernetes',
              arguments: { namespace: 'openagentic' },
            },
          },
          {
            id: 'extract',
            type: 'extract_key',
            data: { path: 'pods', default: '[]' },
          },
        ],
        edges: [
          { id: 'e1', source: 'trigger', target: 'mcp' },
          { id: 'e2', source: 'mcp', target: 'extract' },
        ],
      },
      input: {},
      user: { id: 'mcp-tester', accessToken: 'eyJ.fake.jwt' },
    });

    expect(result.status).toBe('completed');
    const mcpOut = result.outputs.mcp as {
      pods?: Array<Record<string, unknown>>;
      success?: boolean;
      namespace?: string;
      content?: string;
      structuredContent?: Record<string, unknown>;
    };
    expect(Array.isArray(mcpOut.pods)).toBe(true);
    expect(mcpOut.pods?.length).toBe(2);
    expect(mcpOut.success).toBe(true);
    expect(mcpOut.namespace).toBe('openagentic');
    // structuredContent kept as sibling for back-compat (still with the
    // original FastMCP wrap untouched).
    expect(mcpOut.structuredContent).toBeDefined();

    const extractOut = result.outputs.extract as { value?: unknown; found?: boolean };
    expect(extractOut.found).toBe(true);
    expect(Array.isArray(extractOut.value)).toBe(true);
    expect((extractOut.value as unknown[]).length).toBe(2);
  });

  it('non-envelope mcp output (no structuredContent) passes through unchanged', async () => {
    // Some MCPs return their python dict at top level without the
    // FastMCP content/structuredContent envelope. The lift must be a
    // no-op in that case so existing templates keep working.
    process.env.MCP_PROXY_URL = 'http://mcp-proxy:8082';
    harnessServer.use(
      http.post('http://mcp-proxy:8082/call', async () =>
        HttpResponse.json({
          result: {
            result: {
              success: true,
              namespace: 'openagentic',
              pods: [{ name: 'foo', status: 'Running' }],
              count: 1,
            },
          },
        }),
      ),
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
              toolServer: 'openagentic_kubernetes',
              arguments: { namespace: 'openagentic' },
            },
          },
          {
            id: 'extract',
            type: 'extract_key',
            data: { path: 'pods', default: '[]' },
          },
        ],
        edges: [
          { id: 'e1', source: 'trigger', target: 'mcp' },
          { id: 'e2', source: 'mcp', target: 'extract' },
        ],
      },
      input: {},
      user: { id: 'mcp-tester', accessToken: 'eyJ.fake.jwt' },
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.extract as { value?: unknown; found?: boolean };
    expect(out.found).toBe(true);
    expect(Array.isArray(out.value)).toBe(true);
    expect((out.value as unknown[]).length).toBe(1);
  });
});
