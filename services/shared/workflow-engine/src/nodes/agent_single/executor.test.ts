/**
 * agent_single node — executor tests (TDD).
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
    executionId: 'exec-asingle-1',
    workflowId: 'wf-1',
    apiUrl: 'http://test-api',
    openagenticProxyUrl: 'http://openagentic-proxy:3300',
    openagenticProxyInternalKey: 'k',
    userId: 'u',
    interpolateTemplate: (t: string, input: any) =>
      typeof t === 'string'
        ? t.replace(/\{\{([^}]+)\}\}/g, (_, k) => String(input?.[k.trim()] ?? ''))
        : t,
    getInternalAuthHeaders: () => ({}),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    ...overrides,
  };
}

const node = (data: Record<string, unknown>) => ({
  id: 'n_single',
  type: 'agent_single',
  data,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('agent_single/executor', () => {
  function mockProxy(payload: unknown, status = 200) {
    return vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status,
      data: payload,
    } as any);
  }

  it('happy path: posts one agent spec with orchestration=parallel', async () => {
    const post = mockProxy({
      output: 'Here is your answer.',
      results: [{ status: 'completed', content: 'Here is your answer.' }],
      metrics: { totalTokens: 12 },
    });
    const out: any = await execute(
      node({ prompt: 'do the thing', agentId: 'agent-42' }),
      null,
      makeCtx(),
    );
    expect(out.content).toBe('Here is your answer.');
    expect(out.status).toBe('completed');
    expect(out.source).toBe('agent_single');
    expect(out.agents.length).toBe(1);
    const body = post.mock.calls[0][1] as any;
    expect(body.orchestration).toBe('parallel');
    expect(body.agents[0]).toMatchObject({ agentId: 'agent-42', task: 'do the thing' });
  });

  it('interpolates template variables in prompt and systemPrompt', async () => {
    const post = mockProxy({
      output: 'OK',
      results: [{ status: 'completed' }],
    });
    await execute(
      node({
        prompt: 'Hello {{name}}',
        systemPrompt: 'You are {{role}}',
        agentId: 'a',
      }),
      { name: 'world', role: 'helpful' },
      makeCtx(),
    );
    const body = post.mock.calls[0][1] as any;
    expect(body.agents[0].task).toBe('Hello world');
    expect(body.agents[0].systemPrompt).toBe('You are helpful');
  });

  it('throws when no prompt/task and no agentId is configured', async () => {
    await expect(execute(node({ role: 'custom' }), null, makeCtx())).rejects.toThrow(
      /prompt|task|agentId/i,
    );
  });

  it('throws when openagentic-proxy is unreachable', async () => {
    vi.spyOn(axios, 'post').mockRejectedValueOnce(
      Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    );
    await expect(
      execute(node({ prompt: 'p' }), null, makeCtx()),
    ).rejects.toThrow(/openagentic-proxy|ECONNREFUSED/i);
  });

  it('honors AbortSignal', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    vi.spyOn(axios, 'post').mockImplementationOnce((_url, _data, config: any) => {
      if (config?.signal?.aborted) {
        return Promise.reject(
          Object.assign(new Error('canceled'), { name: 'CanceledError' }),
        );
      }
      return Promise.resolve({ status: 200, data: {} } as any);
    });
    await expect(
      execute(node({ prompt: 'p' }), null, makeCtx({ signal: ctrl.signal })),
    ).rejects.toThrow();
  });

  it('throws when totalBudget exceeded (proxy returns 4xx with cost-budget error)', async () => {
    mockProxy({ error: 'cost budget exceeded: 250c > 200c' }, 400);
    await expect(
      execute(node({ prompt: 'p', totalBudget: 200 }), null, makeCtx()),
    ).rejects.toThrow(/cost budget exceeded/i);
  });

  // -------- outputAssertion smoking-gun tests --------

  it('FAKE-SUCCESS CATCH: empty content fails agent_returned_content', async () => {
    mockProxy({ output: '', results: [{ status: 'completed' }] });
    const plugin = registry.get('agent_single')!;
    let caught: any;
    try {
      await runWithAssertions(plugin, node({ prompt: 'p' }) as any, null, makeCtx());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OutputAssertionError);
    expect(caught.failedAssertion).toBe('agent_returned_content');
  });

  it('FAKE-SUCCESS CATCH: status=failed fails agent_completed_status', async () => {
    mockProxy({ output: 'x', results: [{ status: 'failed' }] });
    const plugin = registry.get('agent_single')!;
    let caught: any;
    try {
      await runWithAssertions(plugin, node({ prompt: 'p' }) as any, null, makeCtx());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OutputAssertionError);
    expect(caught.failedAssertion).toBe('agent_completed_status');
  });

  it('FAKE-SUCCESS CATCH: refusal fails agent_substantive_output', async () => {
    mockProxy({
      output: "I'm sorry, I don't have enough information to answer that.",
      results: [{ status: 'completed' }],
    });
    const plugin = registry.get('agent_single')!;
    let caught: any;
    try {
      await runWithAssertions(plugin, node({ prompt: 'p' }) as any, null, makeCtx());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OutputAssertionError);
    expect(caught.failedAssertion).toBe('agent_substantive_output');
    expect(caught.reason).toBe('output_failed_assertion');
  });

  it('schema declares fake-success outputAssertions', () => {
    const schema = schemaJson as unknown as NodeSchema;
    const names = (schema.outputAssertions ?? []).map((a) => a.name);
    expect(names).toContain('agent_returned_content');
    expect(names).toContain('agent_completed_status');
    expect(names).toContain('agent_substantive_output');
  });
});
