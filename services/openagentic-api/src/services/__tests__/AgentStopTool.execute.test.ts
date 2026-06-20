/**
 * AgentStopTool — RED test for the executor (the chat-pipeline refactor Phase C dispatcher
 * wire-up). The model invokes `agent_stop` to terminate a running sub-agent
 * session. `executeAgentStop` POSTs to openagentic-proxy's `/api/agents/executions/:id/kill`
 * endpoint.
 *
 * Why POST not DELETE: openagentic-proxy's existing route for tearing down an
 * execution is `POST /api/agents/executions/:id/kill` (services/openagentic-proxy/
 * src/routes/executions.ts:32). Using the existing endpoint avoids a new
 * route + middleware contract during a chat-pipeline rip.
 *
 * Contract pinned here:
 *   1. POSTs {OPENAGENTIC_PROXY_URL}/api/agents/executions/:agent_session_id/kill
 *   2. Returns ok:true + agent_session_id on success
 *   3. Returns ok:false on 4xx/5xx
 *   4. Refuses (ok:false) when OPENAGENTIC_PROXY_INTERNAL_KEY missing
 *   5. NEVER throws — surfaces network errors as ok:false
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeAgentStop, type AgentStopDeps } from '../AgentStopTool.js';

function makeFetchOK(body: any) {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
  );
}

function makeFetchError(status: number, body: any = { error: 'boom' }) {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
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

describe('executeAgentStop (the chat-pipeline refactor Phase C dispatcher)', () => {
  const ENV_BACKUP = { ...process.env };

  beforeEach(() => {
    process.env.OPENAGENTIC_PROXY_URL = 'http://test-openagentic-proxy:3300';
    process.env.OPENAGENTIC_PROXY_INTERNAL_KEY = 'test-internal-key-very-long-and-not-dev';
  });

  afterEach(() => {
    process.env = { ...ENV_BACKUP };
  });

  it('case 1: POSTs to /api/agents/executions/:id/kill with auth', async () => {
    const fetchMock = makeFetchOK({ killed: true });
    const result = await executeAgentStop(
      makeCtx(),
      { agent_session_id: 'agent-sess-9' },
      { fetchImpl: fetchMock as any },
    );

    expect(result.ok).toBe(true);
    expect(result.agent_session_id).toBe('agent-sess-9');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/api\/agents\/executions\/agent-sess-9\/kill$/);
    expect((init as any).method).toBe('POST');
    expect((init as any).headers.Authorization).toBe('Bearer test-internal-key-very-long-and-not-dev');
    expect((init as any).headers['X-Agent-Proxy']).toBe('true');
  });

  it('case 2: returns ok:false on proxy 404 (session not found)', async () => {
    const fetchMock = makeFetchError(404, { error: 'execution not found' });
    const result = await executeAgentStop(
      makeCtx(),
      { agent_session_id: 'missing' },
      { fetchImpl: fetchMock as any },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/404|not found/i);
  });

  it('case 3: refuses when OPENAGENTIC_PROXY_INTERNAL_KEY missing (fail-CLOSED)', async () => {
    delete process.env.OPENAGENTIC_PROXY_INTERNAL_KEY;
    const fetchMock = vi.fn();
    const result = await executeAgentStop(
      makeCtx(),
      { agent_session_id: 'a' },
      { fetchImpl: fetchMock as any },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/OPENAGENTIC_PROXY_INTERNAL_KEY|internal key|not configured/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('case 4: network error surfaces as ok:false (never throws)', async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError('fetch failed'); });
    const result = await executeAgentStop(
      makeCtx(),
      { agent_session_id: 'a' },
      { fetchImpl: fetchMock as any },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/fetch failed|network/i);
  });
});

describe('dispatchChatToolCall — agent_stop routing (the chat-pipeline refactor Phase C)', () => {
  const ENV_BACKUP = { ...process.env };

  beforeEach(() => {
    process.env.OPENAGENTIC_PROXY_URL = 'http://test-openagentic-proxy:3300';
    process.env.OPENAGENTIC_PROXY_INTERNAL_KEY = 'test-internal-key-very-long-and-not-dev';
  });

  afterEach(() => {
    process.env = { ...ENV_BACKUP };
  });

  it('dispatchChatToolCall routes agent_stop → executeAgentStop', async () => {
    const { dispatchChatToolCall } = await import('../../routes/chat/pipeline/chat/dispatchChatToolCall.js');

    const fetchMock = makeFetchOK({ killed: true });
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
        { name: 'agent_stop', input: { agent_session_id: 'a' } },
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
