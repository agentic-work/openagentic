/**
 * mcp_tool — test-mocks short-circuit.
 *
 * When ctx.testMocks contains a matching mcpTool entry, the executor
 * MUST return the mock without hitting the MCP proxy. Companion to
 * resolveMockMcpResponse — verifies the executor wires the resolver
 * into the right place (before axios).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { execute } from './executor.js';
import type { NodeExecutionContext } from '../types.js';
import type { TestMocks } from '../../runtime/testMocks.js';

function makeCtx(overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-mock-1',
    apiUrl: 'http://test-api',
    mcpProxyUrl: 'http://mcp-proxy',
    authToken: 'Bearer user-token',
    interpolateTemplate: (t: string) => t,
    getInternalAuthHeaders: () => ({ 'X-Internal-Secret': 's' }),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any,
    ...overrides,
  } as NodeExecutionContext;
}

const mcpNode = (data: Record<string, unknown>) => ({
  id: 'n_mcp_mocked',
  type: 'mcp_tool',
  data,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('mcp_tool — test-mocks short-circuit', () => {
  it('returns the mock response and DOES NOT post to proxy when toolName matches', async () => {
    const proxySpy = vi.spyOn(axios, 'post');
    const testMocks: TestMocks = {
      mcpTools: [{ toolName: 'k8s_list_pods', response: { pods: [{ name: 'mocked-pod' }] } }],
    };

    const out: any = await execute(
      mcpNode({ toolName: 'k8s_list_pods', toolServer: 'oap-k8s-mcp' }),
      null,
      makeCtx({ testMocks }),
    );

    expect(out).toEqual({ pods: [{ name: 'mocked-pod' }] });
    expect(proxySpy).not.toHaveBeenCalled();
  });

  it('falls through to proxy when no mock matches', async () => {
    const proxySpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: {
        jsonrpc: '2.0',
        id: 1,
        result: { content: [{ type: 'text', text: 'real-response' }], isError: false },
      },
    } as any);
    const testMocks: TestMocks = {
      mcpTools: [{ toolName: 'different_tool', response: 'mocked' }],
    };

    const out: any = await execute(
      mcpNode({ toolName: 'k8s_list_pods', toolServer: 'oap-k8s-mcp' }),
      null,
      makeCtx({ testMocks }),
    );

    expect(out.content).toBe('real-response');
    expect(proxySpy).toHaveBeenCalledOnce();
  });

  it('throws with errorMessage when the mock declares shouldFail', async () => {
    const proxySpy = vi.spyOn(axios, 'post');
    const testMocks: TestMocks = {
      mcpTools: [{
        toolName: 'aws_list_buckets',
        shouldFail: true,
        errorMessage: 'AWS test failure',
        response: null,
      }],
    };

    await expect(
      execute(
        mcpNode({ toolName: 'aws_list_buckets', toolServer: 'oap-aws-mcp' }),
        null,
        makeCtx({ testMocks }),
      ),
    ).rejects.toThrow(/AWS test failure/);
    expect(proxySpy).not.toHaveBeenCalled();
  });

  it('respects server filter on the mock entry', async () => {
    const proxySpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: {
        jsonrpc: '2.0',
        id: 1,
        result: { content: [{ type: 'text', text: 'real' }], isError: false },
      },
    } as any);
    const testMocks: TestMocks = {
      mcpTools: [{ toolName: 'x', server: 'openagentic_aws', response: 'mocked' }],
    };

    // Different server: falls through.
    await execute(
      mcpNode({ toolName: 'x', toolServer: 'oap-azure-mcp' }),
      null,
      makeCtx({ testMocks }),
    );
    expect(proxySpy).toHaveBeenCalledOnce();
  });

  it('honors delay before returning the mock', async () => {
    const testMocks: TestMocks = {
      mcpTools: [{ toolName: 'slow_tool', response: 'r', delay: 50 }],
    };
    const t0 = Date.now();
    await execute(mcpNode({ toolName: 'slow_tool', toolServer: 'x' }), null, makeCtx({ testMocks }));
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });

  it('passes through to proxy when ctx.testMocks is undefined', async () => {
    const proxySpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 200,
      data: {
        jsonrpc: '2.0',
        id: 1,
        result: { content: [{ type: 'text', text: 'real' }], isError: false },
      },
    } as any);
    await execute(mcpNode({ toolName: 't', toolServer: 's' }), null, makeCtx());
    expect(proxySpy).toHaveBeenCalledOnce();
  });
});
