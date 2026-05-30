/**
 * #502 — UI consumer of the `sub_agent_started` / `sub_agent_completed`
 * NDJSON envelopes that the api has been emitting from
 * services/openagentic-api/src/services/TaskTool.ts since Phase E2.
 *
 * Wire shapes (snake_case on the wire, camelCase in the reducer state):
 *
 *   sub_agent_started:
 *     { role, description, model, session_id }
 *
 *   sub_agent_completed:
 *     { role, ok, error, turns, tokens, durationMs, toolsUsed }
 *
 * Mirrors the test pattern at hooks/__tests__/useChatStream.tierFrames.test.ts
 * — these specs exercise the PURE reducers + dispatcher exported from
 * useChatStream.ts. The full fetch / auth / SSE stack is NOT mocked.
 */

import { describe, it, expect } from 'vitest';
import {
  applySubAgentStarted,
  applySubAgentCompleted,
  dispatchSubAgentFrame,
  subAgentVariantFor,
  type SubAgentEntry,
} from '../useChatStream';

describe('applySubAgentStarted — sub_agent_started reducer', () => {
  it('appends a new running entry with description / model preserved', () => {
    const before: SubAgentEntry[] = [];
    const next = applySubAgentStarted(before, {
      type: 'sub_agent_started',
      role: 'cost-analysis',
      description: 'right-size the fleet',
      model: 'sonnet-4',
      session_id: 's1',
    });
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      role: 'cost-analysis',
      description: 'right-size the fleet',
      model: 'sonnet-4',
      status: 'running',
    });
  });

  it('does not mutate the input list (returns a new array)', () => {
    const before: SubAgentEntry[] = [];
    const next = applySubAgentStarted(before, {
      type: 'sub_agent_started',
      role: 'security-analysis',
    });
    expect(next).not.toBe(before);
    expect(before).toHaveLength(0);
  });

  it('drops the frame silently when role is missing (no orphan entry)', () => {
    const before: SubAgentEntry[] = [];
    const next = applySubAgentStarted(before, {
      type: 'sub_agent_started',
    } as any);
    expect(next).toBe(before);
  });

  it('preserves earlier entries when adding a new running sub-agent', () => {
    let m: SubAgentEntry[] = [];
    m = applySubAgentStarted(m, {
      type: 'sub_agent_started',
      role: 'cost-analysis',
    });
    m = applySubAgentStarted(m, {
      type: 'sub_agent_started',
      role: 'growth-analysis',
    });
    expect(m).toHaveLength(2);
    expect(m[0].role).toBe('cost-analysis');
    expect(m[1].role).toBe('growth-analysis');
  });

  it('coerces non-string model to null (defensive against malformed wire payload)', () => {
    const before: SubAgentEntry[] = [];
    const next = applySubAgentStarted(before, {
      type: 'sub_agent_started',
      role: 'cost-analysis',
      model: 999 as any,
    });
    expect(next[0].model).toBeNull();
  });
});

describe('applySubAgentCompleted — sub_agent_completed reducer', () => {
  it('marks the matching role as ok with merged stats', () => {
    let m: SubAgentEntry[] = [];
    m = applySubAgentStarted(m, {
      type: 'sub_agent_started',
      role: 'cost-analysis',
    });
    m = applySubAgentCompleted(m, {
      type: 'sub_agent_completed',
      role: 'cost-analysis',
      ok: true,
      turns: 5,
      tokens: 1247,
      durationMs: 3800,
      toolsUsed: ['azure_retail_prices', 'azure_sku_compatibility'],
    });
    expect(m[0]).toMatchObject({
      role: 'cost-analysis',
      status: 'ok',
      stats: {
        turns: 5,
        tokens: 1247,
        wallMs: 3800,
        toolsUsed: ['azure_retail_prices', 'azure_sku_compatibility'],
      },
    });
  });

  it('marks failed sub-agents as status=error with the error message', () => {
    let m: SubAgentEntry[] = [];
    m = applySubAgentStarted(m, {
      type: 'sub_agent_started',
      role: 'cost-analysis',
    });
    m = applySubAgentCompleted(m, {
      type: 'sub_agent_completed',
      role: 'cost-analysis',
      ok: false,
      error: 'sub-agent threw: ECONNRESET',
      turns: 0,
      tokens: 0,
      durationMs: 0,
    });
    expect(m[0].status).toBe('error');
    expect(m[0].error).toBe('sub-agent threw: ECONNRESET');
  });

  it('does not mutate the input list (returns a new array)', () => {
    let m: SubAgentEntry[] = [];
    m = applySubAgentStarted(m, {
      type: 'sub_agent_started',
      role: 'cost-analysis',
    });
    const before = m;
    const next = applySubAgentCompleted(before, {
      type: 'sub_agent_completed',
      role: 'cost-analysis',
      ok: true,
      turns: 1,
      tokens: 100,
      durationMs: 500,
    });
    expect(next).not.toBe(before);
    expect(before[0].status).toBe('running');
  });

  it('drops the frame silently when no matching running entry exists', () => {
    const before: SubAgentEntry[] = [];
    const next = applySubAgentCompleted(before, {
      type: 'sub_agent_completed',
      role: 'ghost',
      ok: true,
      turns: 1,
      tokens: 100,
      durationMs: 500,
    });
    expect(next).toBe(before);
  });

  it('only completes the FIRST running entry with the matching role', () => {
    // Defensive — if the same role somehow runs twice, the second
    // sub_agent_completed should not retroactively flip an already-ok one.
    let m: SubAgentEntry[] = [];
    m = applySubAgentStarted(m, { type: 'sub_agent_started', role: 'cost-analysis' });
    m = applySubAgentCompleted(m, {
      type: 'sub_agent_completed',
      role: 'cost-analysis',
      ok: true,
      turns: 5,
      tokens: 100,
      durationMs: 500,
    });
    m = applySubAgentStarted(m, { type: 'sub_agent_started', role: 'cost-analysis' });
    m = applySubAgentCompleted(m, {
      type: 'sub_agent_completed',
      role: 'cost-analysis',
      ok: false,
      error: 'second run blew up',
      turns: 1,
      tokens: 50,
      durationMs: 100,
    });
    // First entry stays ok; second flips to error.
    expect(m).toHaveLength(2);
    expect(m[0].status).toBe('ok');
    expect(m[1].status).toBe('error');
  });
});

describe('dispatchSubAgentFrame — case-statement wire-up', () => {
  it('routes a sub_agent_started frame to applySubAgentStarted', () => {
    const out = dispatchSubAgentFrame(
      'sub_agent_started',
      {
        type: 'sub_agent_started',
        role: 'cost-analysis',
        description: 'right-size the fleet',
        model: 'sonnet-4',
        session_id: 's1',
      },
      [],
    );
    expect(out.subAgents).toHaveLength(1);
    expect(out.subAgents[0]).toMatchObject({
      role: 'cost-analysis',
      status: 'running',
    });
  });

  it('routes a sub_agent_completed frame to applySubAgentCompleted', () => {
    const seed: SubAgentEntry[] = [
      {
        role: 'cost-analysis',
        description: undefined,
        model: null,
        status: 'running',
        sessionId: undefined,
      },
    ];
    const out = dispatchSubAgentFrame(
      'sub_agent_completed',
      {
        type: 'sub_agent_completed',
        role: 'cost-analysis',
        ok: true,
        turns: 5,
        tokens: 1247,
        durationMs: 3800,
        toolsUsed: ['azure_retail_prices'],
      },
      seed,
    );
    expect(out.subAgents[0]).toMatchObject({
      role: 'cost-analysis',
      status: 'ok',
      stats: { turns: 5, tokens: 1247, wallMs: 3800 },
    });
  });

  it('passes through unknown frame types as a no-op (returns prev list by reference)', () => {
    const prev: SubAgentEntry[] = [
      {
        role: 'cost-analysis',
        description: undefined,
        model: null,
        status: 'running',
        sessionId: undefined,
      },
    ];
    const out = dispatchSubAgentFrame('something_else', { type: 'something_else' }, prev);
    expect(out.subAgents).toBe(prev);
  });
});

describe('subAgentVariantFor — variant mapping for SubAgentCard', () => {
  it('maps cost-analysis variants', () => {
    expect(subAgentVariantFor('cost-analysis')).toBe('c');
    expect(subAgentVariantFor('cost_analysis')).toBe('c');
  });

  it('maps growth-analysis variants', () => {
    expect(subAgentVariantFor('growth-analysis')).toBe('g');
    expect(subAgentVariantFor('growth_analysis')).toBe('g');
  });

  it('maps security-analysis variants', () => {
    expect(subAgentVariantFor('security-analysis')).toBe('s');
    expect(subAgentVariantFor('security_analysis')).toBe('s');
  });

  it('maps kubernetes / k8s variants', () => {
    expect(subAgentVariantFor('kubernetes')).toBe('k');
    expect(subAgentVariantFor('k8s')).toBe('k');
  });

  it('falls back to c (amber) for unknown roles', () => {
    expect(subAgentVariantFor('whatever-else')).toBe('c');
    expect(subAgentVariantFor('')).toBe('c');
  });
});
