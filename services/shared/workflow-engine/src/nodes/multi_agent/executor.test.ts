/**
 * multi_agent node — executor tests (TDD).
 *
 * Includes the LLM-batch fallback path: when openagentic-proxy is unreachable,
 * the executor falls back to direct chat.completions for each agent spec.
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
    executionId: 'exec-multi-1',
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
  id: 'n_multi',
  type: 'multi_agent',
  data,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('multi_agent/executor', () => {
  function mockProxy(payload: unknown, status = 200) {
    return vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status,
      data: payload,
    } as any);
  }

  it('happy path: posts to openagentic-proxy with parallel orchestration', async () => {
    const post = mockProxy({
      output:
        'A long, substantive aggregated answer that is well over one hundred characters in length to satisfy the substantive output assertion length check on the multi_agent path.',
      results: [
        { status: 'completed', content: 'a1' },
        { status: 'completed', content: 'a2' },
      ],
    });
    const out: any = await execute(
      node({
        agents: [
          { role: 'researcher', taskDescription: 'find X' },
          { role: 'analyst', taskDescription: 'analyze X' },
        ],
        maxConcurrency: 5,
      }),
      null,
      makeCtx(),
    );
    expect(out.content).toContain('aggregated answer');
    expect(out.agents).toHaveLength(2);
    expect(out.source).toBe('multi_agent');
    const body = post.mock.calls[0][1] as any;
    expect(body.orchestration).toBe('parallel');
    expect(body.maxConcurrency).toBe(5);
  });

  it('interpolates template variables in each agent task', async () => {
    const post = mockProxy({
      output: 'long enough output to pass the substantive-output gate '.repeat(5),
      results: [{ status: 'completed' }],
    });
    await execute(
      node({
        agents: [{ role: 'r', taskDescription: 'Hello {{name}}' }],
      }),
      { name: 'world' },
      makeCtx(),
    );
    const body = post.mock.calls[0][1] as any;
    // sharedContext defaults true → 'Context: ...\n\nTask: Hello world'
    expect(body.agents[0].task).toContain('Hello world');
  });

  it('throws when agents array is empty', async () => {
    await expect(execute(node({ agents: [] }), null, makeCtx())).rejects.toThrow(
      /agents/i,
    );
  });

  it('FALLBACK: when openagentic-proxy errors out, falls back to direct LLM batch', async () => {
    // First call (openagentic-proxy) — network error.
    const proxyErr = Object.assign(new Error('ECONNREFUSED'), {
      code: 'ECONNREFUSED',
    });
    const llmResp = {
      status: 200,
      data: { choices: [{ message: { content: 'fallback response' } }] },
    };
    const spy = vi
      .spyOn(axios, 'post')
      .mockRejectedValueOnce(proxyErr) // proxy fails
      .mockResolvedValueOnce(llmResp as any) // first agent fallback
      .mockResolvedValueOnce(llmResp as any); // second agent fallback

    const out: any = await execute(
      node({
        agents: [
          { role: 'r', taskDescription: 't1' },
          { role: 'a', taskDescription: 't2' },
        ],
      }),
      null,
      makeCtx(),
    );

    expect(out.source).toBe('multi_agent_fallback');
    expect(out.agents).toHaveLength(2);
    expect(out.content).toContain('fallback response');
    // 1 proxy + 2 LLM calls
    expect(spy).toHaveBeenCalledTimes(3);
    // Second + third calls go to /chat/completions
    expect(spy.mock.calls[1][0]).toContain('/api/v1/chat/completions');
  });

  it('FALLBACK: per-agent model override flows through to /chat/completions body', async () => {
    const proxyErr = Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const llmResp = {
      status: 200,
      data: { choices: [{ message: { content: 'ok' } }] },
    };
    const spy = vi
      .spyOn(axios, 'post')
      .mockRejectedValueOnce(proxyErr)
      .mockResolvedValueOnce(llmResp as any)
      .mockResolvedValueOnce(llmResp as any);

    await execute(
      node({
        agents: [
          { role: 'r', taskDescription: 't1', model: 'claude-sonnet-4-6' },
          { role: 'a', taskDescription: 't2' }, // no override → falls back to 'auto'
        ],
      }),
      null,
      makeCtx(),
    );

    // call 0 = proxy attempt; call 1 = first agent LLM; call 2 = second.
    const firstAgentBody: any = spy.mock.calls[1][1];
    const secondAgentBody: any = spy.mock.calls[2][1];
    expect(firstAgentBody.model).toBe('claude-sonnet-4-6');
    expect(secondAgentBody.model).toBe('auto');
  });

  it('honors AbortSignal — does NOT fall back when user cancels', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    vi.spyOn(axios, 'post').mockImplementation((_url, _data, config: any) => {
      if (config?.signal?.aborted) {
        return Promise.reject(
          Object.assign(new Error('canceled'), { name: 'CanceledError' }),
        );
      }
      return Promise.resolve({ status: 200, data: {} } as any);
    });
    await expect(
      execute(
        node({ agents: [{ role: 'r', taskDescription: 't' }] }),
        null,
        makeCtx({ signal: ctrl.signal }),
      ),
    ).rejects.toThrow();
  });

  // -------- outputAssertion smoking-gun tests --------

  it('FAKE-SUCCESS CATCH: zero results → multi_agent_count fires', async () => {
    mockProxy({ output: 'something', results: [] });
    const plugin = registry.get('multi_agent')!;
    let caught: any;
    try {
      await runWithAssertions(
        plugin,
        node({ agents: [{ role: 'r', taskDescription: 't' }] }) as any,
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
      output:
        'Some output that is long enough to potentially pass the substantive gate but the majority assertion should fire first since most agents failed.',
      results: [
        { status: 'failed' },
        { status: 'failed' },
        { status: 'failed' },
        { status: 'completed', content: 'x' },
      ],
    });
    const plugin = registry.get('multi_agent')!;
    let caught: any;
    try {
      await runWithAssertions(
        plugin,
        node({
          agents: [
            { role: 'a', taskDescription: 't' },
            { role: 'b', taskDescription: 't' },
            { role: 'c', taskDescription: 't' },
            { role: 'd', taskDescription: 't' },
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

  it('FAKE-SUCCESS CATCH: refusal aggregation → multi_agent_substantive_output fires', async () => {
    // Plain "I couldn't find information" — caught the user's
    // Multi-Research Agent template fake-success bug.
    mockProxy({
      output:
        "I couldn't find information about that topic in any of the available sources I checked, so I have nothing useful to report.",
      results: [
        { status: 'completed', content: 'noinfo' },
        { status: 'completed', content: 'noinfo' },
      ],
    });
    const plugin = registry.get('multi_agent')!;
    let caught: any;
    try {
      await runWithAssertions(
        plugin,
        node({
          agents: [
            { role: 'a', taskDescription: 't' },
            { role: 'b', taskDescription: 't' },
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

  // -------- RED tests for pattern dropdown (TDD 2026-04-26) --------

  it('PATTERN: sequential pattern → orchestration=sequential to openagentic-proxy', async () => {
    const post = mockProxy({
      output: 'Sequential handoff result long enough to satisfy substantive output gate '.repeat(3),
      results: [
        { status: 'completed', content: 'step1' },
        { status: 'completed', content: 'step2' },
      ],
    });
    await execute(
      node({
        pattern: 'sequential',
        agents: [
          { agentId: 'a-1', role: 'first', taskDescription: 't1' },
          { agentId: 'a-2', role: 'second', taskDescription: 't2' },
        ],
      }),
      null,
      makeCtx(),
    );
    const body = post.mock.calls[0][1] as any;
    expect(body.orchestration).toBe('sequential');
  });

  it('PATTERN: supervisor pattern → orchestration=supervisor to openagentic-proxy', async () => {
    const post = mockProxy({
      output: 'Supervisor coordinated workers to produce substantive aggregated output '.repeat(3),
      results: [
        { status: 'completed', content: 'sup' },
        { status: 'completed', content: 'w1' },
      ],
    });
    await execute(
      node({
        pattern: 'supervisor',
        agents: [
          { agentId: 'sup-1', role: 'manager', taskDescription: 'coordinate' },
          { agentId: 'w-1', role: 'worker', taskDescription: 'execute' },
        ],
      }),
      null,
      makeCtx(),
    );
    const body = post.mock.calls[0][1] as any;
    expect(body.orchestration).toBe('supervisor');
  });

  it('PATTERN: debate pattern → orchestration=sequential (debate mapped) to openagentic-proxy', async () => {
    // Agent-proxy doesn't support 'debate' natively; we map to sequential
    // with explicit debate framing in the supervisor prompt path.
    const post = mockProxy({
      output: 'Debate consensus output with sufficient detail for the substantive gate '.repeat(3),
      results: [
        { status: 'completed', content: 'pro' },
        { status: 'completed', content: 'con' },
        { status: 'completed', content: 'consensus' },
      ],
    });
    await execute(
      node({
        pattern: 'debate',
        agents: [
          { agentId: 'a-1', role: 'pro', taskDescription: 'argue for' },
          { agentId: 'a-2', role: 'con', taskDescription: 'argue against' },
          { agentId: 'a-3', role: 'judge', taskDescription: 'decide' },
        ],
      }),
      null,
      makeCtx(),
    );
    const body = post.mock.calls[0][1] as any;
    expect(body.orchestration).toBe('sequential');
  });

  it('PATTERN: parallel is the default when pattern is omitted (back-compat)', async () => {
    const post = mockProxy({
      output: 'Default parallel run output long enough to satisfy substantive output assertion '.repeat(2),
      results: [
        { status: 'completed', content: 'a' },
        { status: 'completed', content: 'b' },
      ],
    });
    await execute(
      node({
        agents: [
          { agentId: 'a-1', role: 'r', taskDescription: 't1' },
          { agentId: 'a-2', role: 'r', taskDescription: 't2' },
        ],
      }),
      null,
      makeCtx(),
    );
    const body = post.mock.calls[0][1] as any;
    expect(body.orchestration).toBe('parallel');
  });

  it('SCHEMA: declares pattern enum (parallel|sequential|supervisor|debate)', () => {
    const schema = schemaJson as unknown as NodeSchema;
    const patternSetting = (schema.settings ?? []).find((s: any) => s.name === 'pattern');
    expect(patternSetting).toBeDefined();
    expect((patternSetting as any).type).toBe('enum');
    expect((patternSetting as any).values).toEqual(
      expect.arrayContaining(['parallel', 'sequential', 'supervisor', 'debate']),
    );
  });

  it('SCHEMA: agents array description guides users toward agentId references', () => {
    const schema = schemaJson as unknown as NodeSchema;
    const agentsSetting = (schema.settings ?? []).find((s: any) => s.name === 'agents');
    expect(agentsSetting).toBeDefined();
    // Description should mention agentId is the recommended path
    expect((agentsSetting as any).description).toMatch(/agentId/i);
  });

  // -------- Subagent telemetry (TDD 2026-04-26 → Tier A 2026-05-13) --------
  // The multi_agent executor emits per-subagent lifecycle frames via
  // ctx.emitNodeProgress so the UI can render the swarm popover. Tier A
  // (2026-05-13) upgraded these to canonical AgenticEvent shape from
  // @agentic-work/llm-sdk builders:
  //   - SubAgentStartedEvent   : { type: 'sub_agent_started', task_id, agent_role, ... }
  //   - SubAgentCompletedEvent : { type: 'sub_agent_completed', task_id, ok, ... }
  //
  // The legacy free-form { eventType: 'subagent.start' | 'subagent.complete' }
  // shape was retired so chatmode + Flows share one swarm-renderer.

  it('SUBAGENT.START: emits canonical sub_agent_started event per spec before posting to openagentic-proxy', async () => {
    mockProxy({
      output: 'good output long enough to satisfy substantive output gate '.repeat(3),
      results: [
        { status: 'completed', content: 'a' },
        { status: 'completed', content: 'b' },
      ],
    });
    const events: any[] = [];
    const ctx = makeCtx({ emitNodeProgress: (p: any) => events.push(p) });
    await execute(
      node({
        agents: [
          { agentId: 'a-1', role: 'researcher', taskDescription: 't1' },
          { agentId: 'a-2', role: 'analyst', taskDescription: 't2' },
        ],
      }),
      null,
      ctx,
    );
    const starts = events.filter((e: any) => e?.event?.type === 'sub_agent_started');
    expect(starts).toHaveLength(2);
    expect(starts[0]).toMatchObject({
      nodeId: 'n_multi',
      event: { type: 'sub_agent_started', task_id: 'a-1', agent_role: 'researcher' },
    });
    expect(starts[1]).toMatchObject({
      nodeId: 'n_multi',
      event: { type: 'sub_agent_started', task_id: 'a-2', agent_role: 'analyst' },
    });
    // Negative: legacy shape must not coexist.
    expect(events.filter((e: any) => e.eventType === 'subagent.start')).toEqual([]);
  });

  it('SUBAGENT.COMPLETE: emits canonical sub_agent_completed event per result with ok flag', async () => {
    mockProxy({
      output: 'consolidated output sufficiently long to satisfy substantive gate '.repeat(2),
      results: [
        { agentId: 'a-1', status: 'completed', content: 'R1 body' },
        { agentId: 'a-2', status: 'failed', error: 'boom' },
      ],
    });
    const events: any[] = [];
    const ctx = makeCtx({ emitNodeProgress: (p: any) => events.push(p) });
    await execute(
      node({
        agents: [
          { agentId: 'a-1', role: 'researcher', taskDescription: 't1' },
          { agentId: 'a-2', role: 'analyst', taskDescription: 't2' },
        ],
      }),
      null,
      ctx,
    );
    const completes = events.filter((e: any) => e?.event?.type === 'sub_agent_completed');
    expect(completes).toHaveLength(2);
    expect(completes[0].event).toMatchObject({ type: 'sub_agent_completed', task_id: 'a-1', ok: true });
    expect(completes[1].event).toMatchObject({ type: 'sub_agent_completed', task_id: 'a-2', ok: false, error: 'boom' });
    // Negative: legacy shape must not coexist.
    expect(events.filter((e: any) => e.eventType === 'subagent.complete')).toEqual([]);
  });

  it('SUBAGENT events are no-op when ctx.emitNodeProgress is undefined (back-compat)', async () => {
    mockProxy({
      output: 'output long enough to satisfy substantive output gate '.repeat(3),
      results: [{ status: 'completed', content: 'x' }],
    });
    // No emitNodeProgress — must not throw
    await expect(execute(
      node({ agents: [{ agentId: 'a-1', role: 'r', taskDescription: 't' }] }),
      null,
      makeCtx(),
    )).resolves.toBeDefined();
  });

  // ─── Pillar 3 — AgentContract validation (warning-only) ─────────────
  // The executor consults each spec's `contract` before posting and
  // after the response. Violations DON'T block — they emit a
  // subagent.contract_violation event so AgentOps + signed traces
  // capture them. Hard enforcement is a follow-up after we've watched
  // the violation rate in dashboards.

  it('CONTRACT (input): emits subagent.contract_violation when input fails the contract', async () => {
    const proxyErr = Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const llmResp = { status: 200, data: { choices: [{ message: { content: 'ok' } }] } };
    vi.spyOn(axios, 'post')
      .mockRejectedValueOnce(proxyErr)
      .mockResolvedValueOnce(llmResp as any);

    const events: any[] = [];
    const ctx = makeCtx({ emitNodeProgress: (p: any) => events.push(p) });

    await execute(
      node({
        agents: [
          {
            role: 'researcher',
            taskDescription: 'invalid input — contract requires {topic} but spec sends nothing',
            contract: {
              input: {
                type: 'object',
                required: ['topic'],
                properties: { topic: { type: 'string' } },
              },
              allowedTools: [],
            },
          },
        ],
      }),
      // Engine input has no `topic` — contract.input requires it.
      { unrelatedField: 'value' },
      ctx,
    );

    const violations = events.filter((e) => e.eventType === 'subagent.contract_violation');
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations[0].payload.kind).toBe('input');
    expect(JSON.stringify(violations[0].payload.errors)).toContain('topic');
  });

  it('CONTRACT (output): emits subagent.contract_violation when output fails the contract', async () => {
    const proxyErr = Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' });
    // The agent returns a string, but the contract demands an object with {summary, sources}.
    const llmResp = { status: 200, data: { choices: [{ message: { content: 'short answer' } }] } };
    vi.spyOn(axios, 'post')
      .mockRejectedValueOnce(proxyErr)
      .mockResolvedValueOnce(llmResp as any);

    const events: any[] = [];
    const ctx = makeCtx({ emitNodeProgress: (p: any) => events.push(p) });

    await execute(
      node({
        agents: [
          {
            role: 'researcher',
            taskDescription: 'must return JSON {summary,sources}',
            contract: {
              output: {
                type: 'object',
                required: ['summary', 'sources'],
                properties: {
                  summary: { type: 'string' },
                  sources: { type: 'array', items: { type: 'string' } },
                },
              },
              allowedTools: [],
            },
          },
        ],
      }),
      { topic: 'climate' },
      ctx,
    );

    const violations = events.filter((e) => e.eventType === 'subagent.contract_violation');
    const outViol = violations.find((v) => v.payload.kind === 'output');
    expect(outViol).toBeTruthy();
  });

  it('CONTRACT (no contract): no contract_violation events when spec.contract is absent', async () => {
    const proxyErr = Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const llmResp = { status: 200, data: { choices: [{ message: { content: 'fine' } }] } };
    vi.spyOn(axios, 'post')
      .mockRejectedValueOnce(proxyErr)
      .mockResolvedValueOnce(llmResp as any);

    const events: any[] = [];
    const ctx = makeCtx({ emitNodeProgress: (p: any) => events.push(p) });

    await execute(
      node({
        agents: [{ role: 'r', taskDescription: 't' }],
      }),
      null,
      ctx,
    );

    const violations = events.filter((e) => e.eventType === 'subagent.contract_violation');
    expect(violations).toEqual([]);
  });

  it('CONTRACT (valid): contract present + matched → no contract_violation events', async () => {
    const proxyErr = Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const llmResp = {
      status: 200,
      data: {
        choices: [
          { message: { content: JSON.stringify({ summary: 'ok', sources: ['https://a'] }) } },
        ],
      },
    };
    vi.spyOn(axios, 'post')
      .mockRejectedValueOnce(proxyErr)
      .mockResolvedValueOnce(llmResp as any);

    const events: any[] = [];
    const ctx = makeCtx({ emitNodeProgress: (p: any) => events.push(p) });

    await execute(
      node({
        agents: [
          {
            role: 'researcher',
            taskDescription: 't',
            contract: {
              input: { type: 'object', required: ['topic'], properties: { topic: { type: 'string' } } },
              output: {
                type: 'object',
                required: ['summary', 'sources'],
                properties: {
                  summary: { type: 'string' },
                  sources: { type: 'array', items: { type: 'string' } },
                },
              },
              allowedTools: [],
            },
          },
        ],
      }),
      { topic: 'cryptography' },
      ctx,
    );

    const violations = events.filter((e) => e.eventType === 'subagent.contract_violation');
    expect(violations).toEqual([]);
  });
});
