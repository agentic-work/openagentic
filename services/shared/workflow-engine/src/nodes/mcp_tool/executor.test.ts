/**
 * mcp_tool node — executor tests.
 *
 * Migrated from WorkflowExecutionEngine.executeMCPToolNode (heaviest node in
 * batch 3 — preserves all parameter-coercion logic).
 *
 * Critical behavior pinned:
 *   - server-name normalization: hyphens → underscores; trailing _mcp stripped
 *   - smart parameter coercion when arguments are blank but input is present
 *     (web_search/k8s/loki special cases + generic object pass-through)
 *   - LLM-output fields filtered when generic-passing input
 *   - web_search/web_news_search routed through openagentic_web
 *   - auth: service-internal key (or ctx.authToken); OSS never forwards
 *     X-AWS-ID-Token / X-Azure-ID-Token (local-auth only — no OBO)
 *   - 3-layer error unwrapping: proxy envelope → JSONRPC → mcpResult
 *   - content-block normalization (array of {type:'text', text} → joined string)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { execute } from './executor.js';
import type { NodeExecutionContext } from '../types.js';

function makeCtx(overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-mcp-1',
    apiUrl: 'http://test-api',
    mcpProxyUrl: 'http://mcp-proxy',
    authToken: 'Bearer user-token',
    idToken: 'aad-id-token',
    interpolateTemplate: (t: string, input: any) =>
      typeof t === 'string'
        ? t.replace(/\{\{([^}]+)\}\}/g, (_, k) => String(input?.[k.trim()] ?? ''))
        : t,
    getInternalAuthHeaders: () => ({ 'X-Internal-Secret': 'sekret' }),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    ...overrides,
  };
}

const mcpNode = (data: Record<string, unknown>) => ({
  id: 'n_mcp',
  type: 'mcp_tool',
  data,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('mcp_tool/executor', () => {
  function mockProxy(payload: unknown, status = 200) {
    return vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status,
      data: payload,
    } as any);
  }

  it('happy path: posts to /call and returns unwrapped MCP result', async () => {
    const post = mockProxy({
      server: 'openagentic_azure',
      tool: 'list_kvs',
      result: {
        jsonrpc: '2.0',
        id: 1,
        result: { content: [{ type: 'text', text: 'kv1\nkv2' }], isError: false },
      },
    });
    const out: any = await execute(
      mcpNode({ toolName: 'list_kvs', toolServer: 'openagentic_azure', arguments: {} }),
      null,
      makeCtx(),
    );
    expect(out.content).toBe('kv1\nkv2');
    expect(out.isError).toBe(false);
    expect(post.mock.calls[0][0]).toBe('http://mcp-proxy/call');
    expect(post.mock.calls[0][1]).toEqual({
      server: 'openagentic_azure',
      tool: 'list_kvs',
      arguments: {},
    });
  });

  it('normalizes server name: hyphens → underscores, trailing _mcp stripped', async () => {
    const post = mockProxy({
      result: { jsonrpc: '2.0', id: 1, result: { content: [], isError: false } },
    });
    await execute(
      mcpNode({ toolName: 't', toolServer: 'oap-azure-mcp', arguments: {} }),
      null,
      makeCtx(),
    );
    expect(post.mock.calls[0][1]).toMatchObject({ server: 'openagentic_azure' });
  });

  it('falls back to serverName when toolServer is unset', async () => {
    const post = mockProxy({
      result: { jsonrpc: '2.0', id: 1, result: { content: [], isError: false } },
    });
    await execute(
      mcpNode({ toolName: 't', serverName: 'openagentic_aws', arguments: {} }),
      null,
      makeCtx(),
    );
    expect(post.mock.calls[0][1]).toMatchObject({ server: 'openagentic_aws' });
  });

  it('routes web_search through openagentic_web', async () => {
    const post = mockProxy({
      result: { jsonrpc: '2.0', id: 1, result: { content: [], isError: false } },
    });
    await execute(
      mcpNode({ toolName: 'web_search', toolServer: 'something_else', arguments: { query: 'q' } }),
      null,
      makeCtx(),
    );
    expect(post.mock.calls[0][1]).toMatchObject({ server: 'openagentic_web' });
  });

  it('templates string arguments against input', async () => {
    const post = mockProxy({
      result: { jsonrpc: '2.0', id: 1, result: { content: [], isError: false } },
    });
    await execute(
      mcpNode({
        toolName: 't',
        toolServer: 'openagentic_azure',
        arguments: { name: '{{topic}}', n: 7 },
      }),
      { topic: 'cats' },
      makeCtx(),
    );
    expect(post.mock.calls[0][1]).toMatchObject({
      arguments: { name: 'cats', n: 7 },
    });
  });

  it('coerces empty args + input string → web_search query', async () => {
    const post = mockProxy({
      result: { jsonrpc: '2.0', id: 1, result: { content: [], isError: false } },
    });
    await execute(
      mcpNode({ toolName: 'web_search', toolServer: 'openagentic_web', arguments: {} }),
      'how are cats raised',
      makeCtx(),
    );
    expect(post.mock.calls[0][1]).toMatchObject({
      arguments: { query: 'how are cats raised' },
    });
  });

  it('coerces empty args + k8s tool → namespace/deployment_name from input', async () => {
    const post = mockProxy({
      result: { jsonrpc: '2.0', id: 1, result: { content: [], isError: false } },
    });
    await execute(
      mcpNode({ toolName: 'k8s_describe', toolServer: 'openagentic_k8s', arguments: {} }),
      { deployment_name: 'openagentic-api' },
      makeCtx(),
    );
    expect(post.mock.calls[0][1]).toMatchObject({
      arguments: { namespace: 'openagentic', deployment_name: 'openagentic-api' },
    });
  });

  it('strips LLM output fields when generic-passing input object', async () => {
    const post = mockProxy({
      result: { jsonrpc: '2.0', id: 1, result: { content: [], isError: false } },
    });
    await execute(
      mcpNode({ toolName: 'echo', toolServer: 'openagentic_test', arguments: {} }),
      {
        content: 'leaked-llm-content',
        model: 'leaked-model',
        usage: { x: 1 },
        provider: 'leaked',
        _costMeta: { x: 1 },
        actualParam: 'real-value',
      },
      makeCtx(),
    );
    const sentArgs = (post.mock.calls[0][1] as any).arguments;
    expect(sentArgs.content).toBeUndefined();
    expect(sentArgs.model).toBeUndefined();
    expect(sentArgs.usage).toBeUndefined();
    expect(sentArgs.provider).toBeUndefined();
    expect(sentArgs._costMeta).toBeUndefined();
    expect(sentArgs.actualParam).toBe('real-value');
  });

  it('strips internal __sharedContext / __nodeId / __executionId from args', async () => {
    const post = mockProxy({
      result: { jsonrpc: '2.0', id: 1, result: { content: [], isError: false } },
    });
    await execute(
      mcpNode({
        toolName: 't',
        toolServer: 'openagentic_test',
        arguments: { real: 'x', __sharedContext: 'leak', __nodeId: 'leak', __executionId: 'leak' },
      }),
      null,
      makeCtx(),
    );
    const sentArgs = (post.mock.calls[0][1] as any).arguments;
    expect(sentArgs.real).toBe('x');
    expect(sentArgs.__sharedContext).toBeUndefined();
    expect(sentArgs.__nodeId).toBeUndefined();
    expect(sentArgs.__executionId).toBeUndefined();
  });

  it('forwards user authToken (not internal-secret)', async () => {
    const post = mockProxy({
      result: { jsonrpc: '2.0', id: 1, result: { content: [], isError: false } },
    });
    await execute(
      mcpNode({ toolName: 't', toolServer: 'openagentic_test', arguments: {} }),
      null,
      makeCtx(),
    );
    const sentConfig: any = post.mock.calls[0][2];
    expect(sentConfig.headers.Authorization).toBe('Bearer user-token');
    // Internal secret should NOT be on the request to mcp-proxy
    expect(sentConfig.headers['X-Internal-Secret']).toBeUndefined();
  });

  it('OSS: never forwards X-AWS-ID-Token / X-Azure-ID-Token even when idToken is present (no OBO)', async () => {
    const post = mockProxy({
      result: { jsonrpc: '2.0', id: 1, result: { content: [], isError: false } },
    });
    await execute(
      mcpNode({ toolName: 't', toolServer: 'openagentic_test', arguments: {} }),
      null,
      makeCtx(),
    );
    const sentConfig: any = post.mock.calls[0][2];
    // OSS is local-auth only — no OBO (On-Behalf-Of) ID-token forwarding.
    expect(sentConfig.headers['X-AWS-ID-Token']).toBeUndefined();
    expect(sentConfig.headers['X-Azure-ID-Token']).toBeUndefined();
  });

  it('omits ID-token headers when idToken is undefined', async () => {
    const post = mockProxy({
      result: { jsonrpc: '2.0', id: 1, result: { content: [], isError: false } },
    });
    await execute(
      mcpNode({ toolName: 't', toolServer: 'openagentic_test', arguments: {} }),
      null,
      makeCtx({ idToken: undefined }),
    );
    const sentConfig: any = post.mock.calls[0][2];
    expect(sentConfig.headers['X-AWS-ID-Token']).toBeUndefined();
    expect(sentConfig.headers['X-Azure-ID-Token']).toBeUndefined();
  });

  it('throws on HTTP 4xx/5xx with proxy error message', async () => {
    mockProxy({ error: 'oh no' }, 500);
    await expect(
      execute(
        mcpNode({ toolName: 't', toolServer: 'openagentic_test', arguments: {} }),
        null,
        makeCtx(),
      ),
    ).rejects.toThrow(/MCP tool "t" failed.*oh no/);
  });

  it('throws on proxy-level error envelope (status 200 + error.code)', async () => {
    mockProxy({ error: { code: 'TOOL_NOT_FOUND', message: 'no such tool' } });
    await expect(
      execute(
        mcpNode({ toolName: 't', toolServer: 'openagentic_test', arguments: {} }),
        null,
        makeCtx(),
      ),
    ).rejects.toThrow(/no such tool/);
  });

  it('throws on JSONRPC-level error', async () => {
    mockProxy({
      result: {
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32601, message: 'method not found' },
      },
    });
    await expect(
      execute(
        mcpNode({ toolName: 't', toolServer: 'openagentic_test', arguments: {} }),
        null,
        makeCtx(),
      ),
    ).rejects.toThrow(/method not found/);
  });

  it('throws when mcpResult.isError === true', async () => {
    mockProxy({
      result: {
        jsonrpc: '2.0',
        id: 1,
        result: { content: [{ type: 'text', text: 'aws denied' }], isError: true },
      },
    });
    await expect(
      execute(
        mcpNode({ toolName: 't', toolServer: 'openagentic_test', arguments: {} }),
        null,
        makeCtx(),
      ),
    ).rejects.toThrow(/aws denied/);
  });

  it('throws when content text contains JSON {success:false, error}', async () => {
    mockProxy({
      result: {
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ success: false, error: 'AccessDenied', error_type: 'IAM' }),
            },
          ],
          isError: false,
        },
      },
    });
    await expect(
      execute(
        mcpNode({ toolName: 't', toolServer: 'openagentic_test', arguments: {} }),
        null,
        makeCtx(),
      ),
    ).rejects.toThrow(/IAM.*AccessDenied/);
  });

  it('throws on top-level success:false flat result', async () => {
    mockProxy({
      result: {
        jsonrpc: '2.0',
        id: 1,
        result: { success: false, error_message: 'flat err', error_type: 'X' },
      },
    });
    await expect(
      execute(
        mcpNode({ toolName: 't', toolServer: 'openagentic_test', arguments: {} }),
        null,
        makeCtx(),
      ),
    ).rejects.toThrow(/flat err/);
  });

  it('forwards AbortSignal', async () => {
    const ctrl = new AbortController();
    const post = mockProxy({
      result: { jsonrpc: '2.0', id: 1, result: { content: [], isError: false } },
    });
    await execute(
      mcpNode({ toolName: 't', toolServer: 'openagentic_test', arguments: {} }),
      null,
      makeCtx({ signal: ctrl.signal }),
    );
    const sentConfig: any = post.mock.calls[0][2];
    expect(sentConfig.signal).toBe(ctrl.signal);
  });

  it('throws when ctx.mcpProxyUrl is unset', async () => {
    await expect(
      execute(
        mcpNode({ toolName: 't', toolServer: 'openagentic_test', arguments: {} }),
        null,
        makeCtx({ mcpProxyUrl: undefined }),
      ),
    ).rejects.toThrow(/mcp.*proxy/i);
  });

  // ---------------------------------------------------------------------------
  // APPROVAL GATE + AUDIT (HIGH-severity bypass fix, 2026-06-20)
  //
  // The workflow engine ran mcp_tool calls DIRECTLY against the proxy with NO
  // gate + NO audit — a Flow could `kubernetes_delete_pod` / `aws_*_modify`
  // with no human approval and no audit row. The executor now routes every
  // call through `ctx.gateMcpCall` (wired by the engine to the api's
  // runAuditAndGate, origin 'subagent') BEFORE the proxy. These tests pin:
  //   - a blocked MUTATING call NEVER reaches the proxy and throws
  //   - the gate is consulted with the resolved tool/server/args (→ audited)
  //   - a READ (allowed) call passes through to the proxy unchanged
  //   - FAIL SAFE: a gate hook error blocks a mutating call (never executes)
  // ---------------------------------------------------------------------------
  describe('approval gate', () => {
    it('blocks a MUTATING tool (kubernetes_delete_pod) and NEVER hits the proxy', async () => {
      const post = vi.spyOn(axios, 'post');
      const gateMcpCall = vi.fn().mockResolvedValue({
        allowed: false,
        blockReason: "Mutating tool 'kubernetes_delete_pod' denied by approval gate",
        classification: 'MUTATING',
      });

      await expect(
        execute(
          mcpNode({
            toolName: 'kubernetes_delete_pod',
            toolServer: 'openagentic_kubernetes',
            arguments: { namespace: 'prod', name: 'api-0' },
          }),
          null,
          makeCtx({ gateMcpCall }),
        ),
      ).rejects.toThrow(/denied by approval gate/);

      // Gate was consulted with the resolved call (this is what gets audited).
      expect(gateMcpCall).toHaveBeenCalledTimes(1);
      expect(gateMcpCall.mock.calls[0][0]).toMatchObject({
        toolName: 'kubernetes_delete_pod',
        serverName: 'openagentic_kubernetes',
        args: { namespace: 'prod', name: 'api-0' },
      });
      // The mutation NEVER reached the proxy.
      expect(post).not.toHaveBeenCalled();
    });

    it('lets a READ tool through to the proxy after the gate allows it', async () => {
      const gateMcpCall = vi.fn().mockResolvedValue({
        allowed: true,
        classification: 'READ',
      });
      const post = mockProxy({
        result: {
          jsonrpc: '2.0',
          id: 1,
          result: { content: [{ type: 'text', text: 'pod-a\npod-b' }], isError: false },
        },
      });

      const out: any = await execute(
        mcpNode({
          toolName: 'kubernetes_list_pods',
          toolServer: 'openagentic_kubernetes',
          arguments: { namespace: 'prod' },
        }),
        null,
        makeCtx({ gateMcpCall }),
      );

      expect(gateMcpCall).toHaveBeenCalledTimes(1);
      expect(gateMcpCall.mock.calls[0][0]).toMatchObject({
        toolName: 'kubernetes_list_pods',
      });
      // Gate allowed → proxy WAS hit, result returned normally.
      expect(post).toHaveBeenCalledTimes(1);
      expect(post.mock.calls[0][0]).toBe('http://mcp-proxy/call');
      expect(out.content).toBe('pod-a\npod-b');
    });

    it('FAIL SAFE: a gate hook error blocks a MUTATING call (no proxy call)', async () => {
      const post = vi.spyOn(axios, 'post');
      const gateMcpCall = vi.fn().mockRejectedValue(new Error('api unreachable'));

      await expect(
        execute(
          mcpNode({
            toolName: 'aws_ec2_terminate_instances',
            toolServer: 'openagentic_aws',
            arguments: { instance_ids: ['i-123'] },
          }),
          null,
          makeCtx({ gateMcpCall }),
        ),
      ).rejects.toThrow(/approval gate unavailable for a mutating call/);

      expect(post).not.toHaveBeenCalled();
    });

    it('FAIL SAFE (degraded): a gate hook error lets an obvious READ through', async () => {
      const gateMcpCall = vi.fn().mockRejectedValue(new Error('api unreachable'));
      const post = mockProxy({
        result: { jsonrpc: '2.0', id: 1, result: { content: [], isError: false } },
      });

      await execute(
        mcpNode({
          toolName: 'list_kvs',
          toolServer: 'openagentic_azure',
          arguments: {},
        }),
        null,
        makeCtx({ gateMcpCall }),
      );

      // READ degrades to allow-and-proceed (never hangs / never over-blocks).
      expect(post).toHaveBeenCalledTimes(1);
    });
  });
});
