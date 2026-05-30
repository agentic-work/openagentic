/**
 * AgentSendTool — RED test for the executor (chatmode-rip Phase C dispatcher
 * wire-up). The model invokes `agent_send` to push a follow-up message
 * into a running sub-agent session. `executeAgentSend` POSTs to
 * openagentic-proxy's `/api/agents/executions/:id/send` endpoint (auth shared with
 * OpenAgenticProxyClient — `Authorization: Bearer ${OPENAGENTIC_PROXY_INTERNAL_KEY}` +
 * `X-Agent-Proxy: true`).
 *
 * Contract pinned here:
 *   1. POSTs to {OPENAGENTIC_PROXY_URL}/api/agents/executions/:agent_session_id/send
 *   2. Body includes message + parent userId + sessionId
 *   3. Returns ok:true with agent_session_id on success
 *   4. Returns ok:false with error string on 4xx/5xx
 *   5. Refuses (ok:false) when OPENAGENTIC_PROXY_INTERNAL_KEY missing (fail-CLOSED)
 *   6. NEVER throws — surfaces network errors as ok:false
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeAgentSend, type AgentSendDeps } from '../AgentSendTool.js';

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

describe('executeAgentSend (chatmode-rip Phase C dispatcher)', () => {
  const ENV_BACKUP = { ...process.env };

  beforeEach(() => {
    process.env.OPENAGENTIC_PROXY_URL = 'http://test-openagentic-proxy:3300';
    process.env.OPENAGENTIC_PROXY_INTERNAL_KEY = 'test-internal-key-very-long-and-not-dev';
  });

  afterEach(() => {
    process.env = { ...ENV_BACKUP };
  });

  it('case 1: POSTs to /api/agents/executions/:id/send with auth headers', async () => {
    const fetchMock = makeFetchOK({ ok: true });
    const deps: AgentSendDeps = { fetchImpl: fetchMock as any };

    const result = await executeAgentSend(
      makeCtx(),
      { agent_session_id: 'agent-sess-42', message: 'also check us-west-2' },
      deps,
    );

    expect(result.ok).toBe(true);
    expect(result.agent_session_id).toBe('agent-sess-42');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/api\/agents\/executions\/agent-sess-42\/send$/);
    expect((init as any).method).toBe('POST');
    expect((init as any).headers.Authorization).toBe('Bearer test-internal-key-very-long-and-not-dev');
    expect((init as any).headers['X-Agent-Proxy']).toBe('true');
    const body = JSON.parse((init as any).body);
    expect(body.message).toBe('also check us-west-2');
    expect(body.userId).toBe('user-1');
    expect(body.sessionId).toBe('sess-1');
  });

  it('case 2: returns ok:false on proxy 404 (session gone)', async () => {
    const fetchMock = makeFetchError(404, { error: 'session not found' });
    const result = await executeAgentSend(
      makeCtx(),
      { agent_session_id: 'missing', message: 'hi' },
      { fetchImpl: fetchMock as any },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/404|not found/i);
  });

  it('case 3: refuses when OPENAGENTIC_PROXY_INTERNAL_KEY missing (fail-CLOSED)', async () => {
    delete process.env.OPENAGENTIC_PROXY_INTERNAL_KEY;
    const fetchMock = vi.fn();
    const result = await executeAgentSend(
      makeCtx(),
      { agent_session_id: 'a', message: 'hi' },
      { fetchImpl: fetchMock as any },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/OPENAGENTIC_PROXY_INTERNAL_KEY|internal key|not configured/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('case 4: network error surfaces as ok:false (never throws)', async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError('fetch failed'); });
    const result = await executeAgentSend(
      makeCtx(),
      { agent_session_id: 'a', message: 'hi' },
      { fetchImpl: fetchMock as any },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/fetch failed|network/i);
  });
});

describe('dispatchChatToolCall — agent_send routing (chatmode-rip Phase C)', () => {
  const ENV_BACKUP = { ...process.env };

  beforeEach(() => {
    process.env.OPENAGENTIC_PROXY_URL = 'http://test-openagentic-proxy:3300';
    process.env.OPENAGENTIC_PROXY_INTERNAL_KEY = 'test-internal-key-very-long-and-not-dev';
  });

  afterEach(() => {
    process.env = { ...ENV_BACKUP };
  });

  it('dispatchChatToolCall routes agent_send → executeAgentSend', async () => {
    // We assert the inner dispatcher matches the name; the executor is
    // covered above. This validates the wire is in place.
    const { dispatchChatToolCall } = await import('../../routes/chat/pipeline/chat/dispatchChatToolCall.js');

    const fetchMock = makeFetchOK({ ok: true, message_id: 'm-1' });
    // Patch global fetch so the executor's default fetchImpl resolves there
    // (the dispatcher path does not inject a fetch — it uses the global).
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
        { name: 'agent_send', input: { agent_session_id: 'a', message: 'hi' } },
        deps,
      );
      expect((result as any).ok).toBe(true);
      // Verifies fetch was made (route hit) — not the HITL gate, not the
      // MCP fall-through.
      expect(fetchMock).toHaveBeenCalled();
      // None of the MCP / meta dispatch paths should be called.
      expect(deps.executeMcpTool).not.toHaveBeenCalled();
      expect(deps.executeTask).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
