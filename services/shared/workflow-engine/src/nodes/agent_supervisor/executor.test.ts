/**
 * agent_supervisor node — executor tests (TDD).
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
    executionId: 'exec-sup-1',
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
  id: 'n_sup',
  type: 'agent_supervisor',
  data,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('agent_supervisor/executor', () => {
  function mockProxy(payload: unknown, status = 200) {
    return vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status,
      data: payload,
    } as any);
  }

  it('happy path: posts supervisor + worker specs with orchestration=supervisor', async () => {
    const post = mockProxy({
      output: 'Supervisor merged result',
      results: [
        { status: 'completed', content: 'sup' },
        { status: 'completed', content: 'w1' },
        { status: 'completed', content: 'w2' },
      ],
    });
    const out: any = await execute(
      node({
        supervisorPrompt: 'Coordinate the work on {{topic}}',
        agents: [
          { role: 'researcher' },
          { role: 'fact-checker' },
        ],
      }),
      { topic: 'AI' },
      makeCtx(),
    );
    expect(out.content).toBe('Supervisor merged result');
    expect(out.orchestration).toBe('supervisor');
    expect(out.agents).toHaveLength(3);
    const body = post.mock.calls[0][1] as any;
    expect(body.orchestration).toBe('supervisor');
    expect(body.agents[0].role).toBe('supervisor');
    expect(body.agents[0].task).toBe('Coordinate the work on AI');
    expect(body.agents).toHaveLength(3); // supervisor + 2 workers
  });

  it('accepts goal alias for supervisorPrompt', async () => {
    const post = mockProxy({
      output: 'OK',
      results: [{ status: 'completed' }],
    });
    await execute(
      node({
        goal: 'Solve the problem',
        agents: [{ role: 'r' }],
      }),
      null,
      makeCtx(),
    );
    expect((post.mock.calls[0][1] as any).agents[0].task).toBe('Solve the problem');
  });

  it('throws when agents (workers) array is empty', async () => {
    await expect(
      execute(node({ supervisorPrompt: 'go', agents: [] }), null, makeCtx()),
    ).rejects.toThrow(/agents|workers/i);
  });

  it('throws when openagentic-proxy is unreachable', async () => {
    vi.spyOn(axios, 'post').mockRejectedValueOnce(
      Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    );
    await expect(
      execute(
        node({ supervisorPrompt: 'go', agents: [{ role: 'r' }] }),
        null,
        makeCtx(),
      ),
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
        node({ supervisorPrompt: 'go', agents: [{ role: 'r' }] }),
        null,
        makeCtx({ signal: ctrl.signal }),
      ),
    ).rejects.toThrow();
  });

  // -------- outputAssertion smoking-gun tests --------

  it('FAKE-SUCCESS CATCH: supervisor returns no agent results → multi_agent_count fires', async () => {
    mockProxy({ output: 'top-level only', results: [] });
    const plugin = registry.get('agent_supervisor')!;
    let caught: any;
    try {
      await runWithAssertions(
        plugin,
        node({ supervisorPrompt: 'go', agents: [{ role: 'r' }] }) as any,
        null,
        makeCtx(),
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OutputAssertionError);
    expect(caught.failedAssertion).toBe('multi_agent_count');
  });

  it('FAKE-SUCCESS CATCH: half the workers fail → multi_agent_majority_succeeded fires', async () => {
    mockProxy({
      output: 'some output',
      results: [
        { status: 'completed', content: 'sup' },
        { status: 'failed' },
        { status: 'failed' },
        { status: 'failed' },
      ],
    });
    const plugin = registry.get('agent_supervisor')!;
    let caught: any;
    try {
      await runWithAssertions(
        plugin,
        node({
          supervisorPrompt: 'go',
          agents: [{ role: 'a' }, { role: 'b' }, { role: 'c' }],
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

  it('FAKE-SUCCESS CATCH: refusal output → multi_agent_substantive_output fires', async () => {
    mockProxy({
      output: 'Sorry, I cannot complete this request without additional info.',
      results: [
        { status: 'completed', content: 'sup' },
        { status: 'completed', content: 'w' },
      ],
    });
    const plugin = registry.get('agent_supervisor')!;
    let caught: any;
    try {
      await runWithAssertions(
        plugin,
        node({
          supervisorPrompt: 'go',
          agents: [{ role: 'a' }, { role: 'b' }],
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
