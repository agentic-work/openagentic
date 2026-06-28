/**
 * a2a node — executor tests (TDD).
 *
 * a2a is a thin alias of agent_spawn — it forwards calls to the same
 * openagentic-proxy execute-sync endpoint, but reads `prompt` instead of `task`
 * and tags the result with `source: 'a2a'`.
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
    executionId: 'exec-a2a-1',
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

const a2aNode = (data: Record<string, unknown>) => ({
  id: 'n_a2a',
  type: 'a2a',
  data,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('a2a/executor', () => {
  function mockProxy(payload: unknown, status = 200) {
    return vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status,
      data: payload,
    } as any);
  }

  it('happy path: forwards to openagentic-proxy and tags source=a2a', async () => {
    mockProxy({
      output: 'Peer agent answered.',
      results: [{ status: 'completed' }],
    });
    const out: any = await execute(
      a2aNode({ prompt: 'Ask the peer', agentType: 'general' }),
      null,
      makeCtx(),
    );
    expect(out.source).toBe('a2a');
    expect(out.content).toBe('Peer agent answered.');
    expect(out.status).toBe('completed');
  });

  it('uses prompt as the task body sent to openagentic-proxy', async () => {
    const post = mockProxy({
      output: 'OK',
      results: [{ status: 'completed' }],
    });
    await execute(
      a2aNode({ prompt: 'Hello {{name}}', agentType: 'general' }),
      { name: 'world' },
      makeCtx(),
    );
    expect((post.mock.calls[0][1] as any).agents[0].task).toBe('Hello world');
  });

  it('throws when prompt and task are both missing', async () => {
    await expect(
      execute(a2aNode({ agentType: 'general' }), null, makeCtx()),
    ).rejects.toThrow(/task|prompt/i);
  });

  it('FAKE-SUCCESS CATCH: empty content fails agent_returned_content', async () => {
    mockProxy({ output: '', results: [{ status: 'completed' }] });
    const plugin = registry.get('a2a')!;
    let caught: any;
    try {
      await runWithAssertions(plugin, a2aNode({ prompt: 'p' }) as any, null, makeCtx());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OutputAssertionError);
    expect(caught.failedAssertion).toBe('agent_returned_content');
  });

  it('FAKE-SUCCESS CATCH: status=failed fails agent_completed_status', async () => {
    mockProxy({ output: 'partial', results: [{ status: 'failed' }] });
    const plugin = registry.get('a2a')!;
    let caught: any;
    try {
      await runWithAssertions(plugin, a2aNode({ prompt: 'p' }) as any, null, makeCtx());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OutputAssertionError);
    expect(caught.failedAssertion).toBe('agent_completed_status');
  });

  it('FAKE-SUCCESS CATCH: "I cannot help" refusal fails agent_substantive_output', async () => {
    mockProxy({
      output: "I cannot help with that request right now.",
      results: [{ status: 'completed' }],
    });
    const plugin = registry.get('a2a')!;
    let caught: any;
    try {
      await runWithAssertions(plugin, a2aNode({ prompt: 'p' }) as any, null, makeCtx());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OutputAssertionError);
    expect(caught.failedAssertion).toBe('agent_substantive_output');
  });

  it('throws when openagentic-proxy is unreachable', async () => {
    vi.spyOn(axios, 'post').mockRejectedValueOnce(
      Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    );
    await expect(
      execute(a2aNode({ prompt: 'p' }), null, makeCtx()),
    ).rejects.toThrow(/openagentic-proxy|ECONNREFUSED/i);
  });

  it('schema declares fake-success outputAssertions', () => {
    const schema = schemaJson as unknown as NodeSchema;
    const names = (schema.outputAssertions ?? []).map((a) => a.name);
    expect(names).toContain('agent_returned_content');
    expect(names).toContain('agent_completed_status');
    expect(names).toContain('agent_substantive_output');
  });
});
