/**
 * AgentListTool — RED test for the executor (chatmode-rip Phase C dispatcher
 * wire-up). The model invokes `agent_list` to enumerate live sub-agent
 * sessions tied to this chat. `executeAgentList` GETs from openagentic-proxy's
 * `/api/agents/executions/live?sessionId=:id` endpoint.
 *
 * Contract pinned here:
 *   1. GETs {OPENAGENTIC_PROXY_URL}/api/agents/executions/live with auth headers
 *   2. Filters by sessionId when present
 *   3. Returns ok:true + sessions array on success
 *   4. Returns ok:true + empty sessions on 4xx/5xx (graceful)
 *   5. Refuses (ok:false) when OPENAGENTIC_PROXY_INTERNAL_KEY missing
 *   6. NEVER throws — surfaces network errors as ok:false
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeAgentList, type AgentListDeps } from '../AgentListTool.js';

function makeFetchOK(body: any) {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
  );
}

function makeCtx(overrides: Record<string, any> = {}) {
  return {
    userId: 'user-1',
    sessionId: 'sess-1',
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    ...overrides,
  } as any;
}

describe('executeAgentList (chatmode-rip Phase C dispatcher)', () => {
  const ENV_BACKUP = { ...process.env };

  beforeEach(() => {
    process.env.OPENAGENTIC_PROXY_URL = 'http://test-openagentic-proxy:3300';
    process.env.OPENAGENTIC_PROXY_INTERNAL_KEY = 'test-internal-key-very-long-and-not-dev';
  });

  afterEach(() => {
    process.env = { ...ENV_BACKUP };
  });

  it('case 1: GETs /api/agents/executions/live with auth + chat sessionId', async () => {
    const fakeSessions = [
      { id: 'a-1', agentId: 'cloud-ops', agentName: 'cloud-ops', status: 'running', startedAt: '2026-05-11T13:00:00Z' },
      { id: 'a-2', agentId: 'reviewer', agentName: 'reviewer', status: 'running', startedAt: '2026-05-11T13:05:00Z' },
    ];
    const fetchMock = makeFetchOK({ executions: fakeSessions });

    const result = await executeAgentList(makeCtx(), {}, { fetchImpl: fetchMock as any });

    expect(result.ok).toBe(true);
    expect(result.sessions).toBeDefined();
    expect(result.sessions!.length).toBe(2);
    expect(result.sessions![0]!.agent_session_id).toBe('a-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/api\/agents\/executions\/live/);
    // session filter passed as query param
    expect(String(url)).toMatch(/[?&]sessionId=sess-1/);
    expect((init as any).method ?? 'GET').toMatch(/GET/i);
    expect((init as any).headers.Authorization).toBe('Bearer test-internal-key-very-long-and-not-dev');
    expect((init as any).headers['X-Agent-Proxy']).toBe('true');
  });

  it('case 2: empty sessions array on proxy 500 (graceful — model treats as "none")', async () => {
    const fetchMock = vi.fn(async () => new Response('boom', { status: 500 }));
    const result = await executeAgentList(makeCtx(), {}, { fetchImpl: fetchMock as any });
    expect(result.ok).toBe(true);
    expect(result.sessions).toEqual([]);
  });

  it('case 3: refuses when OPENAGENTIC_PROXY_INTERNAL_KEY missing (fail-CLOSED)', async () => {
    delete process.env.OPENAGENTIC_PROXY_INTERNAL_KEY;
    const fetchMock = vi.fn();
    const result = await executeAgentList(makeCtx(), {}, { fetchImpl: fetchMock as any });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/OPENAGENTIC_PROXY_INTERNAL_KEY|internal key|not configured/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('case 4: network error surfaces as ok:true with empty sessions (graceful)', async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError('fetch failed'); });
    const result = await executeAgentList(makeCtx(), {}, { fetchImpl: fetchMock as any });
    // List is read-only — degrade to empty rather than fail the turn.
    expect(result.ok).toBe(true);
    expect(result.sessions).toEqual([]);
  });
});

describe('dispatchChatToolCall — agent_list routing (chatmode-rip Phase C)', () => {
  const ENV_BACKUP = { ...process.env };

  beforeEach(() => {
    process.env.OPENAGENTIC_PROXY_URL = 'http://test-openagentic-proxy:3300';
    process.env.OPENAGENTIC_PROXY_INTERNAL_KEY = 'test-internal-key-very-long-and-not-dev';
  });

  afterEach(() => {
    process.env = { ...ENV_BACKUP };
  });

  it('dispatchChatToolCall routes agent_list → executeAgentList', async () => {
    const { dispatchChatToolCall } = await import('../../routes/chat/pipeline/chat/dispatchChatToolCall.js');

    const fetchMock = makeFetchOK({ executions: [] });
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as any;
    try {
      const deps: any = {
        executeComposeVisual: vi.fn(),
        executeComposeApp: vi.fn(),
        executeRenderArtifact: vi.fn(),
        executeTask: vi.fn(),
        executeRequestClarification: vi.fn(),
        executeBrowserSandbox: vi.fn(),
        executeMemorize: vi.fn(),
        executeMcpTool: vi.fn(),
        listSubagentTypes: vi.fn(async () => []),
        runSubagent: vi.fn(),
      };
      const ctx: any = {
        userId: 'user-1',
        sessionId: 'sess-1',
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() },
        emit: vi.fn(),
      };
      const result = await dispatchChatToolCall(
        ctx,
        { name: 'agent_list', input: {} },
        deps,
      );
      expect((result as any).ok).toBe(true);
      expect(fetchMock).toHaveBeenCalled();
      expect(deps.executeMcpTool).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
