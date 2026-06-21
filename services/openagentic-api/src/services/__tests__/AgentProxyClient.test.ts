/**
 * OpenAgenticProxyClient — Phase 6, V3 Enterprise Chatmode.
 *
 * Routes V3 chatLoop sub-agent dispatches (Task tool) to the openagentic-proxy
 * service (services/openagentic-proxy/) over HTTP. RIPS the in-api
 * SubagentOrchestrator path from the V3 critical chain.
 *
 * Auth scheme matches the existing api → openagentic-proxy callers
 * (listAgentsFromSOT.ts, AgentSeederFromDefinitions.ts, admin-agents.ts):
 * shared-secret `OPENAGENTIC_PROXY_INTERNAL_KEY` in `Authorization: Bearer ...`
 * + `X-Agent-Proxy: true` header. The openagentic-proxy auth middleware
 * (services/openagentic-proxy/src/middleware/auth.ts:22) accepts either this
 * header pair OR a user Bearer token; the chatmode sub-agent dispatch
 * path uses the internal-key path so the proxy treats us as a trusted
 * service caller.
 *
 * Fail-CLOSED: client refuses to construct without OPENAGENTIC_PROXY_INTERNAL_KEY
 * AND refuses dev-secret literals (same contract as
 * SynthExecuteJwt.mintSynthExecutorJwt).
 *
 * the design notes
 */
import { describe, it, expect, vi } from 'vitest';
import { OpenAgenticProxyClient } from '../OpenAgenticProxyClient.js';

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe('OpenAgenticProxyClient — construction (fail-CLOSED)', () => {
  it('throws when internalKey is empty', () => {
    expect(() =>
      new OpenAgenticProxyClient({
        baseUrl: 'http://openagentic-proxy:3300',
        internalKey: '',
        logger: makeLogger(),
      }),
    ).toThrow(/internalKey/i);
  });

  it('throws when internalKey is a dev-secret literal', () => {
    expect(() =>
      new OpenAgenticProxyClient({
        baseUrl: 'http://openagentic-proxy:3300',
        internalKey: 'dev-secret-replace-me',
        logger: makeLogger(),
      }),
    ).toThrow(/dev-secret/i);
  });

  it('throws when baseUrl is empty', () => {
    expect(() =>
      new OpenAgenticProxyClient({
        baseUrl: '',
        internalKey: 'real-prod-key-XXXXX',
        logger: makeLogger(),
      }),
    ).toThrow(/baseUrl/i);
  });
});

describe('OpenAgenticProxyClient — executeAgent', () => {
  function makeClient(fetchImpl: any) {
    return new OpenAgenticProxyClient({
      baseUrl: 'http://openagentic-proxy:3300',
      internalKey: 'real-prod-key-XXXXX',
      logger: makeLogger(),
      fetchImpl,
    });
  }

  it('POSTs to /api/agents/execute-sync with internal-key auth headers', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        executionId: 'exec-1',
        status: 'completed',
        results: [
          {
            agentId: 'a1',
            role: 'cloud_operations',
            status: 'success',
            output: 'sub-agent done',
            metrics: { costCents: 0.1, durationMs: 1234, inputTokens: 0, outputTokens: 0 },
            toolCallsExecuted: [],
          },
        ],
      }),
    });
    const client = makeClient(fetchImpl);

    await client.executeAgent({
      userId: 'user-1',
      sessionId: 'session-1',
      parentToolUseId: 'tool-use-abc',
      agentName: 'cloud_operations',
      task: 'audit IAM drift',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://openagentic-proxy:3300/api/agents/execute-sync');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.headers['Authorization']).toBe('Bearer real-prod-key-XXXXX');
    expect(init.headers['X-Agent-Proxy']).toBe('true');
    expect(init.headers['X-Correlation-Id']).toBe('tool-use-abc');
  });

  it('forwards required body fields (userId, sessionId, agents, userMessage)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ executionId: 'e', status: 'completed', results: [] }),
    });
    const client = makeClient(fetchImpl);

    await client.executeAgent({
      userId: 'user-1',
      sessionId: 'session-1',
      parentToolUseId: 'tool-use-abc',
      agentName: 'cloud_operations',
      task: 'audit IAM drift',
      userToken: 'oboToken-XYZ',
    });

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.userId).toBe('user-1');
    expect(body.sessionId).toBe('session-1');
    expect(body.userMessage).toBe('audit IAM drift');
    expect(body.turnId).toBe('tool-use-abc');
    expect(Array.isArray(body.agents)).toBe(true);
    expect(body.agents.length).toBe(1);
    expect(body.agents[0].role).toBe('cloud_operations');
    expect(body.agents[0].task).toBe('audit IAM drift');
    expect(body.userToken).toBe('oboToken-XYZ');
    // OSS: no OBO — userIdToken removed from the request shape; never sent.
    expect(body.userIdToken).toBeUndefined();
    expect(body.orchestration).toBe('sequential');
    expect(body.aggregation).toBe('first');
  });

  it('returns ok:true with output + cost on a 200 response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        executionId: 'e',
        status: 'completed',
        results: [
          {
            agentId: 'a1',
            role: 'cloud_operations',
            status: 'success',
            output: 'final answer',
            metrics: { costCents: 12.5, durationMs: 4321, inputTokens: 100, outputTokens: 50 },
            toolCallsExecuted: [
              { name: 'aws_list_buckets', success: true, durationMs: 100 },
            ],
          },
        ],
      }),
    });
    const client = makeClient(fetchImpl);

    const r = await client.executeAgent({
      userId: 'u',
      sessionId: 's',
      parentToolUseId: 't',
      agentName: 'cloud_operations',
      task: 'go',
    });

    expect(r.ok).toBe(true);
    expect(r.output).toBe('final answer');
    expect(r.costCents).toBeCloseTo(12.5);
    expect(r.durationMs).toBe(4321);
    expect(r.toolsUsed).toEqual(['aws_list_buckets']);
    expect(r.tokens).toBe(150);
  });

  it('returns ok:false on a non-2xx response with error body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => '{"error":"orchestrator crashed"}',
    });
    const client = makeClient(fetchImpl);

    const r = await client.executeAgent({
      userId: 'u',
      sessionId: 's',
      parentToolUseId: 't',
      agentName: 'cloud_operations',
      task: 'go',
    });

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/500/);
  });

  it('returns ok:false on fetch network error (proxy unreachable)', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const client = makeClient(fetchImpl);

    const r = await client.executeAgent({
      userId: 'u',
      sessionId: 's',
      parentToolUseId: 't',
      agentName: 'cloud_operations',
      task: 'go',
    });

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ECONNREFUSED/);
  });

  it('propagates AbortSignal so callers can cancel', async () => {
    const fetchImpl = vi.fn().mockImplementation(async (_url: string, init: any) => {
      // Surface signal back through the result so the assertion below
      // can verify it reached fetch.
      (fetchImpl as any).receivedSignal = init.signal;
      return {
        ok: true,
        status: 200,
        json: async () => ({ executionId: 'e', status: 'completed', results: [] }),
      };
    });
    const client = makeClient(fetchImpl);

    const ac = new AbortController();
    await client.executeAgent({
      userId: 'u',
      sessionId: 's',
      parentToolUseId: 't',
      agentName: 'cloud_operations',
      task: 'go',
      signal: ac.signal,
    });

    expect((fetchImpl as any).receivedSignal).toBe(ac.signal);
  });

  it('returns ok:false when results array is empty (degenerate proxy response)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ executionId: 'e', status: 'completed', results: [] }),
    });
    const client = makeClient(fetchImpl);

    const r = await client.executeAgent({
      userId: 'u',
      sessionId: 's',
      parentToolUseId: 't',
      agentName: 'cloud_operations',
      task: 'go',
    });

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no agent result/i);
  });

  it('marks ok:false when single result has status:error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        executionId: 'e',
        status: 'completed',
        results: [
          {
            agentId: 'a1',
            role: 'cloud_operations',
            status: 'error',
            output: '',
            error: 'sub-agent crashed',
            metrics: { costCents: 0, durationMs: 5, inputTokens: 0, outputTokens: 0 },
            toolCallsExecuted: [],
          },
        ],
      }),
    });
    const client = makeClient(fetchImpl);

    const r = await client.executeAgent({
      userId: 'u',
      sessionId: 's',
      parentToolUseId: 't',
      agentName: 'cloud_operations',
      task: 'go',
    });

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/sub-agent crashed/);
  });
});
