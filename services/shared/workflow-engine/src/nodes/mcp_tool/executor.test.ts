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
 *   - auth: ctx.authToken (NOT internal-secret) + X-AWS-ID-Token / X-Azure-ID-Token
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
      arguments: { namespace: 'agentic-dev', deployment_name: 'openagentic-api' },
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

  it('forwards X-AWS-ID-Token + X-Azure-ID-Token when idToken is present', async () => {
    const post = mockProxy({
      result: { jsonrpc: '2.0', id: 1, result: { content: [], isError: false } },
    });
    await execute(
      mcpNode({ toolName: 't', toolServer: 'openagentic_test', arguments: {} }),
      null,
      makeCtx(),
    );
    const sentConfig: any = post.mock.calls[0][2];
    expect(sentConfig.headers['X-AWS-ID-Token']).toBe('aad-id-token');
    expect(sentConfig.headers['X-Azure-ID-Token']).toBe('aad-id-token');
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
});
