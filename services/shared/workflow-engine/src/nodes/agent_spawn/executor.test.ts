/**
 * agent_spawn node — executor tests (TDD).
 *
 * Migrated from WorkflowExecutionEngine.executeAgentSpawnNode. Spawns a single
 * agent via openagentic-proxy `/api/agents/execute-sync` and unwraps the response.
 *
 * Critical behavior pinned:
 *   - Templated task interpolation (task or taskDescription).
 *   - Legacy role mapping (researcher -> reasoning, coder -> code_execution, ...).
 *   - Agent-proxy auth headers when ctx.openagenticProxyInternalKey is set.
 *   - Returns { content, output, status, agentType, agentId, executionId, tokenUsage }.
 *   - Throws clearly when openagentic-proxy is unreachable.
 *   - Honors AbortSignal (axios's CanceledError surfaces).
 *
 * outputAssertion coverage (the "fake success" smoking gun):
 *   - Empty content fails `agent_returned_content`.
 *   - status='failed' fails `agent_completed_status`.
 *   - "I couldn't find information" / "I'm sorry, I can't ..." fails
 *     `agent_substantive_output`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { execute } from './executor.js';
import schemaJson from './schema.json' with { type: 'json' };
import { runWithAssertions, registry } from '../registry.js';
import { OutputAssertionError } from '../types.js';
import type { NodeExecutionContext, NodeSchema } from '../types.js';

function makeCtx(overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-as-1',
    workflowId: 'wf-1',
    apiUrl: 'http://test-api',
    openagenticProxyUrl: 'http://openagentic-proxy:3300',
    openagenticProxyInternalKey: 'aproxy-secret',
    userId: 'u_test',
    interpolateTemplate: (t: string, input: any) =>
      typeof t === 'string'
        ? t.replace(/\{\{([^}]+)\}\}/g, (_, k) => String(input?.[k.trim()] ?? ''))
        : t,
    getInternalAuthHeaders: () => ({ 'X-Internal-Secret': 'internal' }),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    ...overrides,
  };
}

const spawnNode = (data: Record<string, unknown>) => ({
  id: 'n_spawn',
  type: 'agent_spawn',
  data,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('agent_spawn/executor', () => {
  function mockProxy(payload: unknown, status = 200) {
    return vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status,
      data: payload,
    } as any);
  }

  it('happy path: posts to /api/agents/execute-sync and returns unwrapped result', async () => {
    const post = mockProxy({
      executionId: 'apx-1',
      output: 'Sky is blue because Rayleigh scattering favors short wavelengths.',
      results: [{ status: 'completed' }],
      metrics: { totalTokens: 42 },
    });
    const out: any = await execute(
      spawnNode({ task: 'Why is the sky blue?', agentType: 'researcher' }),
      null,
      makeCtx(),
    );
    expect(out.content).toContain('Rayleigh');
    expect(out.status).toBe('completed');
    expect(out.executionId).toBe('apx-1');
    expect(out.source).toBe('agent_spawn');
    // role 'researcher' must be mapped to 'reasoning' (legacy ROLE_TO_AGENT_TYPE)
    expect(post.mock.calls[0][0]).toBe('http://openagentic-proxy:3300/api/agents/execute-sync');
    expect(post.mock.calls[0][1]).toMatchObject({
      agents: [expect.objectContaining({ role: 'reasoning' })],
      orchestration: 'parallel',
      sessionId: 'exec-as-1',
      userId: 'u_test',
    });
  });

  it('interpolates {{...}} variables in task', async () => {
    const post = mockProxy({
      output: 'OK',
      results: [{ status: 'completed' }],
    });
    await execute(
      spawnNode({ task: 'Look up {{symbol}}', agentType: 'general' }),
      { symbol: 'AAPL' },
      makeCtx(),
    );
    const body = post.mock.calls[0][1] as any;
    expect(body.agents[0].task).toBe('Look up AAPL');
  });

  it('falls back to taskDescription alias', async () => {
    const post = mockProxy({
      output: 'OK',
      results: [{ status: 'completed' }],
    });
    await execute(
      spawnNode({ taskDescription: 'Hello world', agentType: 'general' }),
      null,
      makeCtx(),
    );
    expect((post.mock.calls[0][1] as any).agents[0].task).toBe('Hello world');
  });

  it('throws when no task is provided', async () => {
    await expect(
      execute(spawnNode({ agentType: 'general' }), null, makeCtx()),
    ).rejects.toThrow(/task/i);
  });

  it('attaches X-Agent-Proxy + Bearer auth + X-User-Id headers', async () => {
    const post = mockProxy({
      output: 'OK',
      results: [{ status: 'completed' }],
    });
    await execute(spawnNode({ task: 't' }), null, makeCtx());
    const headers = (post.mock.calls[0][2] as any).headers;
    expect(headers.Authorization).toBe('Bearer aproxy-secret');
    expect(headers['X-Agent-Proxy']).toBe('true');
    expect(headers['X-User-Id']).toBe('u_test');
    expect(headers['X-Workflow-Execution']).toBe('exec-as-1');
  });

  it('throws clearly when openagentic-proxy is unreachable (network error)', async () => {
    vi.spyOn(axios, 'post').mockRejectedValueOnce(
      Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    );
    await expect(
      execute(spawnNode({ task: 't' }), null, makeCtx()),
    ).rejects.toThrow(/openagentic-proxy|ECONNREFUSED/i);
  });

  it('honors AbortSignal — propagates axios CancelError', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    vi.spyOn(axios, 'post').mockImplementationOnce((_url, _data, config: any) => {
      // simulate axios honoring signal pre-flight
      if (config?.signal?.aborted) {
        return Promise.reject(
          Object.assign(new Error('canceled'), { name: 'CanceledError' }),
        );
      }
      return Promise.resolve({ status: 200, data: {} } as any);
    });
    await expect(
      execute(spawnNode({ task: 't' }), null, makeCtx({ signal: ctrl.signal })),
    ).rejects.toThrow();
  });

  it('throws when ctx.openagenticProxyUrl is not configured', async () => {
    const ctx = makeCtx();
    (ctx as any).openagenticProxyUrl = undefined;
    await expect(
      execute(spawnNode({ task: 't' }), null, ctx),
    ).rejects.toThrow(/openagenticProxyUrl|openagentic-proxy|OPENAGENTIC_PROXY_URL/i);
  });

  // -------- outputAssertion smoking-gun tests --------

  it('FAKE-SUCCESS CATCH: agent returns empty content → outputAssertion fires', async () => {
    mockProxy({
      output: '',
      results: [{ status: 'completed' }],
    });
    const plugin = registry.get('agent_spawn')!;
    expect(plugin).toBeDefined();
    let caught: any;
    try {
      await runWithAssertions(plugin, spawnNode({ task: 't' }) as any, null, makeCtx());
    } catch (e: any) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OutputAssertionError);
    expect(caught.failedAssertion).toBe('agent_returned_content');
    expect(caught.reason).toBe('output_failed_assertion');
  });

  it('FAKE-SUCCESS CATCH: agent returns status=failed → outputAssertion fires', async () => {
    mockProxy({
      output: 'partial result',
      results: [{ status: 'failed' }],
    });
    const plugin = registry.get('agent_spawn')!;
    let caught: any;
    try {
      await runWithAssertions(plugin, spawnNode({ task: 't' }) as any, null, makeCtx());
    } catch (e: any) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OutputAssertionError);
    expect(caught.failedAssertion).toBe('agent_completed_status');
    expect(caught.reason).toBe('output_failed_assertion');
  });

  it('FAKE-SUCCESS CATCH: agent returns "I could not find information" → outputAssertion fires', async () => {
    // This is the smoking-gun case the user hit with the Multi-Research Agent
    // template — the agent "completed" but actually failed to do its job.
    mockProxy({
      output: "I couldn't find information about that topic in the available sources.",
      results: [{ status: 'completed' }],
    });
    const plugin = registry.get('agent_spawn')!;
    let caught: any;
    try {
      await runWithAssertions(plugin, spawnNode({ task: 't' }) as any, null, makeCtx());
    } catch (e: any) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OutputAssertionError);
    expect(caught.failedAssertion).toBe('agent_substantive_output');
    expect(caught.reason).toBe('output_failed_assertion');
  });

  it('FAKE-SUCCESS CATCH: agent returns "Sorry, I cannot help" → outputAssertion fires', async () => {
    mockProxy({
      output: 'Sorry, I cannot help with that request.',
      results: [{ status: 'completed' }],
    });
    const plugin = registry.get('agent_spawn')!;
    let caught: any;
    try {
      await runWithAssertions(plugin, spawnNode({ task: 't' }) as any, null, makeCtx());
    } catch (e: any) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OutputAssertionError);
    expect(caught.failedAssertion).toBe('agent_substantive_output');
  });

  // -------- schema sanity --------

  it('schema declares the three fake-success outputAssertions', () => {
    const schema = schemaJson as unknown as NodeSchema;
    const names = (schema.outputAssertions ?? []).map((a) => a.name);
    expect(names).toContain('agent_returned_content');
    expect(names).toContain('agent_completed_status');
    expect(names).toContain('agent_substantive_output');
  });
});
