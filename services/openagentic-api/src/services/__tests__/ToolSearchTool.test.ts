/**
 * ToolSearchTool / AgentSearchTool — synthetic meta-tools for model-invoked
 * MCP tool / sub-agent discovery.
 *
 * the design notes
 *
 * The api injects these two tool defs into the chat tool array unconditionally
 * (no cascade narrowing). When the model emits `tool_use` for either name,
 * dispatchChatToolCall forwards to /api/internal/{tool,agent}-search and
 * returns a DispatchedToolResult with the discovered defs surfaced as
 * result.discoveredTools / result.discoveredAgents — chatLoop's discovery
 * hook then appends them to the next iteration's tools array.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  TOOL_SEARCH_TOOL,
  isToolSearchTool,
  executeToolSearch,
  type ToolSearchInput,
} from '../ToolSearchTool.js';
import {
  AGENT_SEARCH_TOOL,
  isAgentSearchTool,
  executeAgentSearch,
  type AgentSearchInput,
} from '../AgentSearchTool.js';

describe('TOOL_SEARCH_TOOL — synthetic def', () => {
  it('has function.name === "tool_search"', () => {
    expect(TOOL_SEARCH_TOOL.function.name).toBe('tool_search');
  });
  it('description teaches the model when to call it', () => {
    const d = (TOOL_SEARCH_TOOL.function.description || '').toLowerCase();
    expect(d).toMatch(/search|catalog|tool/);
    expect(d).toMatch(/cloud|kubernetes|github|always-on|always.on/);
  });
  it('parameters schema requires `query`', () => {
    expect((TOOL_SEARCH_TOOL.function.parameters as any).required).toEqual(['query']);
    expect((TOOL_SEARCH_TOOL.function.parameters as any).properties.query.type).toBe('string');
  });
  it('parameters schema has optional `k` with default 8', () => {
    const k = (TOOL_SEARCH_TOOL.function.parameters as any).properties.k;
    expect(k.type).toBe('integer');
    expect(k.default).toBe(8);
  });
  it('isToolSearchTool name guard', () => {
    expect(isToolSearchTool('tool_search')).toBe(true);
    expect(isToolSearchTool('Tool_Search')).toBe(false);
    expect(isToolSearchTool('agent_search')).toBe(false);
  });
});

describe('executeToolSearch — forwards to /api/internal/tool-search', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    process.env.INTERNAL_SERVICE_SECRET = 'test-secret';
  });

  it('POSTs {query, k} with x-internal-secret header', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ tools: [] }), { status: 200 }),
    );
    await executeToolSearch({} as any, { query: 'azure deployment', k: 5 } satisfies ToolSearchInput);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/internal\/tool-search$/);
    expect((init as any).method).toBe('POST');
    expect((init as any).headers['x-internal-secret']).toBe('test-secret');
    expect(JSON.parse((init as any).body)).toEqual({ query: 'azure deployment', k: 5 });
  });

  it('returns ok=true with discoveredTools populated from api response', async () => {
    const fakeTools = [
      { type: 'function', function: { name: 'azure_create_deployment', description: 'd' } },
      { type: 'function', function: { name: 'azure_update_deployment', description: 'd' } },
    ];
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ tools: fakeTools }), { status: 200 }),
    );

    const result = await executeToolSearch({} as any, { query: 'azure deployment' });

    expect(result.ok).toBe(true);
    expect(result.discoveredTools).toEqual(fakeTools);
    expect(typeof result.output).toBe('string');
    expect(result.output).toMatch(/azure_create_deployment/);
  });

  it('degrades gracefully on api 500 (returns ok=true with empty discoveredTools)', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }));
    const result = await executeToolSearch({} as any, { query: 'q' });
    expect(result.ok).toBe(true);
    expect(result.discoveredTools).toEqual([]);
    expect(result.output).toMatch(/no.*tool|0 tools|error/i);
  });

  it('degrades gracefully on network error', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const result = await executeToolSearch({} as any, { query: 'q' });
    expect(result.ok).toBe(true);
    expect(result.discoveredTools).toEqual([]);
  });

  it('default k=8 when caller omits it', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ tools: [] }), { status: 200 }));
    await executeToolSearch({} as any, { query: 'q' });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.k).toBe(8);
  });

  // Q1-fix-2 (2026-05-12) — userPromptHint round-trip.
  it('forwards ctx.userPromptHint as userPromptHint in body when present', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ tools: [] }), { status: 200 }));
    const ctx = {
      userPromptHint:
        'Our cloud bill is up 40% MoM. Find top cost spikes across Azure/AWS/GCP.',
    };
    await executeToolSearch(ctx as any, { query: 'Azure cost query tool' });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.query).toBe('Azure cost query tool');
    expect(body.userPromptHint).toBe(ctx.userPromptHint);
  });

  it('omits userPromptHint when ctx is empty (no-regression on existing callers)', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ tools: [] }), { status: 200 }));
    await executeToolSearch({} as any, { query: 'q' });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body).not.toHaveProperty('userPromptHint');
  });

  it('truncates oversized userPromptHint to bounded length', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ tools: [] }), { status: 200 }));
    const hugeHint = 'A'.repeat(5000);
    await executeToolSearch({ userPromptHint: hugeHint } as any, { query: 'q' });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(typeof body.userPromptHint).toBe('string');
    expect(body.userPromptHint.length).toBeLessThanOrEqual(2048);
  });

  // #51 (2026-06-01) — honest no-match message instead of the false-positive
  // "Found 14 tools … call any of them". When the relevance floor drops
  // every catalog hit (e.g. "azure" with no azure server connected), the
  // route returns {tools:[], connectedServers:[...]} and the T1 tool must
  // tell the model the capability is NOT connected + name what IS, and
  // explicitly tell it NOT to search again — so the loop ends with a
  // user-facing answer instead of spinning.
  it('emits an honest no-match message listing connected servers when tools=[]', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ tools: [], connectedServers: ['openagentic_web', 'aws_knowledge'] }),
        { status: 200 },
      ),
    );
    const result = await executeToolSearch({} as any, { query: 'azure subscriptions list' });
    expect(result.ok).toBe(true);
    expect(result.discoveredTools).toEqual([]);
    const out = result.output ?? '';
    // Honest: names the queried capability + the connected servers.
    expect(out).toMatch(/no connected tool matches/i);
    expect(out).toContain('openagentic_web');
    expect(out).toContain('aws_knowledge');
    // Tells the model to stop searching + tell the user plainly.
    expect(out).toMatch(/do not search again/i);
    expect(out).toMatch(/tell the user/i);
    // Must NOT emit the old false-positive encouragement.
    expect(out).not.toMatch(/call any of them by name/i);
  });

  it('no-match message degrades to a generic-but-honest line when connectedServers absent', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ tools: [] }), { status: 200 }),
    );
    const result = await executeToolSearch({} as any, { query: 'azure subscriptions list' });
    const out = result.output ?? '';
    expect(out).toMatch(/no connected tool matches/i);
    expect(out).toMatch(/do not search again/i);
    expect(out).not.toMatch(/call any of them by name/i);
  });

  it('still renders real matches normally when tools are returned (no regression)', async () => {
    const fakeTools = [
      { type: 'function', function: { name: 'openagentic_web_fetch', description: 'd' } },
    ];
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ tools: fakeTools, connectedServers: ['openagentic_web'] }),
        { status: 200 },
      ),
    );
    const result = await executeToolSearch({} as any, { query: 'fetch a web page' });
    expect(result.discoveredTools).toEqual(fakeTools);
    const out = result.output ?? '';
    expect(out).toMatch(/openagentic_web_fetch/);
    expect(out).toMatch(/call any of them by name/i);
    expect(out).not.toMatch(/no connected tool matches/i);
  });
});

describe('AGENT_SEARCH_TOOL — synthetic def', () => {
  it('has function.name === "agent_search"', () => {
    expect(AGENT_SEARCH_TOOL.function.name).toBe('agent_search');
  });
  it('description teaches Claude Code parallel pattern', () => {
    const d = (AGENT_SEARCH_TOOL.function.description || '').toLowerCase();
    expect(d).toMatch(/agent|sub-agent/);
    expect(d).toMatch(/task/);
    expect(d).toMatch(/parallel|concurrent|multiple/);
  });
  it('isAgentSearchTool name guard', () => {
    expect(isAgentSearchTool('agent_search')).toBe(true);
    expect(isAgentSearchTool('tool_search')).toBe(false);
  });
});

describe('executeAgentSearch — forwards to /api/internal/agent-search', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    process.env.INTERNAL_SERVICE_SECRET = 'test-secret';
  });

  it('returns discoveredAgents on success', async () => {
    const fakeAgents = [
      { type: 'function', function: { name: 'code-reviewer', description: 'agent' } },
    ];
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ agents: fakeAgents }), { status: 200 }),
    );

    const result = await executeAgentSearch({} as any, { query: 'code reviewer' } satisfies AgentSearchInput);

    expect(result.ok).toBe(true);
    expect(result.discoveredAgents).toEqual(fakeAgents);
  });

  it('degrades to empty discoveredAgents on api error', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }));
    const result = await executeAgentSearch({} as any, { query: 'q' });
    expect(result.ok).toBe(true);
    expect(result.discoveredAgents).toEqual([]);
  });
});
