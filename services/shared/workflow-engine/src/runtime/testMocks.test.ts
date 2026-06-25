/**
 * Test mocks — wire format + resolver primitives.
 *
 * Phase B blocker (#17): the api's WorkflowTestRunner currently
 * instantiates WorkflowExecutionEngine in-process with custom MCP/LLM
 * mocks injected at the executor boundary. To rip the api-side engine,
 * mocks must traverse HTTP to workflows-svc — which means they must be
 * fully serializable. Function-based responses (the legacy
 * `MockMCPTool.response: (args) => any` shape) drop in favor of a
 * static `response` value plus optional regex-string `argMatch`.
 *
 * The resolver is a pure function: takes the tool call + the mocks
 * payload, returns a `{matched, response}` decision the executor
 * applies. No engine state, no IO — testable in isolation.
 */

import { describe, it, expect } from 'vitest';
import { resolveMockMcpResponse, type TestMocks } from './testMocks.js';

const baseMocks: TestMocks = {
  mcpTools: [
    {
      toolName: 'k8s_list_pods',
      response: { pods: [{ name: 'pod-1' }] },
    },
    {
      toolName: 'azure_get_subscription',
      server: 'oap-azure-mcp',
      response: { id: 'sub-x', name: 'dev' },
    },
    {
      toolName: 'aws_list_buckets',
      shouldFail: true,
      errorMessage: 'AWS test failure',
    },
  ],
};

describe('resolveMockMcpResponse', () => {
  it('returns null when no mocks are supplied', () => {
    expect(resolveMockMcpResponse('k8s_list_pods', undefined, undefined)).toBeNull();
    expect(resolveMockMcpResponse('k8s_list_pods', undefined, {})).toBeNull();
    expect(resolveMockMcpResponse('k8s_list_pods', undefined, { mcpTools: [] })).toBeNull();
  });

  it('matches by toolName alone when no server is specified on the mock', () => {
    const r = resolveMockMcpResponse('k8s_list_pods', 'whatever-server', baseMocks);
    expect(r).not.toBeNull();
    expect(r?.matched).toBe(true);
    expect(r?.response).toEqual({ pods: [{ name: 'pod-1' }] });
    expect(r?.shouldFail).toBe(false);
  });

  it('matches by toolName + server when mock specifies server', () => {
    const r = resolveMockMcpResponse('azure_get_subscription', 'oap-azure-mcp', baseMocks);
    expect(r?.matched).toBe(true);
    expect(r?.response).toEqual({ id: 'sub-x', name: 'dev' });
  });

  it('does NOT match when server differs from mock-specified server', () => {
    const r = resolveMockMcpResponse('azure_get_subscription', 'wrong-server', baseMocks);
    expect(r).toBeNull();
  });

  it('does NOT match a different tool name', () => {
    expect(resolveMockMcpResponse('something_else', undefined, baseMocks)).toBeNull();
  });

  it('returns shouldFail=true with errorMessage when the mock declares failure', () => {
    const r = resolveMockMcpResponse('aws_list_buckets', undefined, baseMocks);
    expect(r?.matched).toBe(true);
    expect(r?.shouldFail).toBe(true);
    expect(r?.errorMessage).toBe('AWS test failure');
  });

  it('preserves delay when present', () => {
    const mocks: TestMocks = { mcpTools: [{ toolName: 't', response: 'r', delay: 250 }] };
    const r = resolveMockMcpResponse('t', undefined, mocks);
    expect(r?.delay).toBe(250);
  });

  it('first matching mock wins (FIFO)', () => {
    const mocks: TestMocks = {
      mcpTools: [
        { toolName: 't', response: 'first' },
        { toolName: 't', response: 'second' },
      ],
    };
    const r = resolveMockMcpResponse('t', undefined, mocks);
    expect(r?.response).toBe('first');
  });

  it('case-sensitive on toolName', () => {
    expect(resolveMockMcpResponse('K8S_LIST_PODS', undefined, baseMocks)).toBeNull();
  });

  it('normalizes hyphens vs underscores on server (matches engine\'s normalize)', () => {
    // Engine canonicalizes server names: hyphens → underscores, strip _mcp suffix.
    // Resolver should accept both shapes for the user's `server` filter.
    const mocks: TestMocks = {
      mcpTools: [{ toolName: 'x', server: 'openagentic_azure', response: 'ok' }],
    };
    expect(resolveMockMcpResponse('x', 'oap-azure-mcp', mocks)?.matched).toBe(true);
    expect(resolveMockMcpResponse('x', 'openagentic_azure', mocks)?.matched).toBe(true);
    expect(resolveMockMcpResponse('x', 'something-else', mocks)).toBeNull();
  });
});
