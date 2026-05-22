/**
 * agent_pool node — executor tests (TDD).
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
    executionId: 'exec-pool-1',
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
  id: 'n_pool',
  type: 'agent_pool',
  data,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('agent_pool/executor', () => {
  function mockProxy(payload: unknown, status = 200) {
    return vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status,
      data: payload,
    } as any);
  }

  it('happy path: posts N agents with orchestration=parallel', async () => {
    const post = mockProxy({
      output: 'Merged answer',
      results: [
        { status: 'completed', content: 'A1' },
        { status: 'completed', content: 'A2' },
      ],
    });
    const out: any = await execute(
      node({
        agents: [
          { role: 'researcher', task: 'r1' },
          { role: 'analyst', task: 'a1' },
        ],
        concurrency: 5,
      }),
      null,
      makeCtx(),
    );
    expect(out.content).toBe('Merged answer');
    expect(out.agents.length).toBe(2);
    expect(out.orchestration).toBe('parallel');
    const body = post.mock.calls[0][1] as any;
    expect(body.agents).toHaveLength(2);
    expect(body.maxConcurrency).toBe(5);
  });

  it('interpolates template variables in each agent task', async () => {
    const post = mockProxy({
      output: 'OK',
      results: [{ status: 'completed' }],
    });
    await execute(
      node({
        agents: [{ role: 'r', task: 'Hello {{name}}' }],
      }),
      { name: 'world' },
      makeCtx(),
    );
    expect((post.mock.calls[0][1] as any).agents[0].task).toBe('Hello world');
  });

  it('throws when agents array is empty', async () => {
    await expect(execute(node({ agents: [] }), null, makeCtx())).rejects.toThrow(
      /agents/i,
    );
  });

  it('throws when agents array is missing', async () => {
    await expect(execute(node({}), null, makeCtx())).rejects.toThrow(/agents/i);
  });

  it('throws when openagentic-proxy is unreachable', async () => {
    vi.spyOn(axios, 'post').mockRejectedValueOnce(
      Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    );
    await expect(
      execute(node({ agents: [{ role: 'r', task: 't' }] }), null, makeCtx()),
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
      execute(
        node({ agents: [{ role: 'r', task: 't' }] }),
        null,
        makeCtx({ signal: ctrl.signal }),
      ),
    ).rejects.toThrow();
  });

  // -------- outputAssertion smoking-gun tests --------

  it('FAKE-SUCCESS CATCH: zero agents executed → multi_agent_count fires', async () => {
    mockProxy({ output: 'something', results: [] });
    const plugin = registry.get('agent_pool')!;
    let caught: any;
    try {
      await runWithAssertions(
        plugin,
        node({ agents: [{ role: 'r', task: 't' }] }) as any,
        null,
        makeCtx(),
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OutputAssertionError);
    expect(caught.failedAssertion).toBe('multi_agent_count');
  });

  it('FAKE-SUCCESS CATCH: half the agents fail → multi_agent_majority_succeeded fires', async () => {
    mockProxy({
      output: 'partial',
      results: [
        { status: 'failed' },
        { status: 'failed' },
        { status: 'completed', content: 'ok' },
      ],
    });
    const plugin = registry.get('agent_pool')!;
    let caught: any;
    try {
      await runWithAssertions(
        plugin,
        node({
          agents: [
            { role: 'a', task: 't' },
            { role: 'b', task: 't' },
            { role: 'c', task: 't' },
          ],
        }) as any,
        null,
        makeCtx(),
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OutputAssertionError);
    expect(caught.failedAssertion).toBe('multi_agent_majority_succeeded');
  });

  it('FAKE-SUCCESS CATCH: aggregated refusal → multi_agent_substantive_output fires', async () => {
    mockProxy({
      output: "I couldn't find any information on that topic.",
      results: [
        { status: 'completed', content: "I couldn't find anything." },
        { status: 'completed', content: "I couldn't find anything either." },
      ],
    });
    const plugin = registry.get('agent_pool')!;
    let caught: any;
    try {
      await runWithAssertions(
        plugin,
        node({
          agents: [
            { role: 'a', task: 't' },
            { role: 'b', task: 't' },
          ],
        }) as any,
        null,
        makeCtx(),
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OutputAssertionError);
    expect(caught.failedAssertion).toBe('multi_agent_substantive_output');
    expect(caught.reason).toBe('output_failed_assertion');
  });

  it('schema declares the multi-agent fake-success outputAssertions', () => {
    const schema = schemaJson as unknown as NodeSchema;
    const names = (schema.outputAssertions ?? []).map((a) => a.name);
    expect(names).toContain('multi_agent_count');
    expect(names).toContain('multi_agent_majority_succeeded');
    expect(names).toContain('multi_agent_substantive_output');
  });
});
