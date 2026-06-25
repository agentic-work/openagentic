/**
 * agentOpsApi — pure mappers from raw API responses to the shapes
 * AgentOpsView consumes (AgentHealthMetrics + AgentRun).
 *
 * Tests cover:
 *   - mapAgentToHealthMetrics: pulls 24h-window stats from
 *     prisma.agent + agent_executions; defaults to zero metrics when
 *     no executions exist (idle agent).
 *   - mapExecutionToAgentRun: extracts {id, agentId, agentName, status,
 *     durationMs, costCents, startedAt, error} from one row.
 *   - statusFromExecution: queued / running / success / error mapping
 *     from the engine's status enum + error column.
 */
import { describe, it, expect } from 'vitest';
import {
  mapAgentToHealthMetrics,
  mapExecutionToAgentRun,
  statusFromExecution,
} from '../agentOpsApi';

describe('statusFromExecution', () => {
  it('queued when no started_at AND no completed_at', () => {
    expect(statusFromExecution({})).toBe('queued');
  });
  it('running when started_at present but no completed_at + no error', () => {
    expect(
      statusFromExecution({ started_at: new Date().toISOString() }),
    ).toBe('running');
  });
  it('error when error column is set', () => {
    expect(
      statusFromExecution({ started_at: 't', completed_at: 't', error: 'boom' }),
    ).toBe('error');
  });
  it('success when both timestamps present and no error', () => {
    expect(
      statusFromExecution({ started_at: 't', completed_at: 't' }),
    ).toBe('success');
  });
});

describe('mapExecutionToAgentRun', () => {
  it('maps a successful execution end-to-end', () => {
    const run = mapExecutionToAgentRun({
      id: 'r-1',
      agent_id: 'a-1',
      agent_name: 'Researcher',
      started_at: '2026-04-26T10:00:00.000Z',
      completed_at: '2026-04-26T10:00:02.500Z',
      cost_cents: 9.12,
      error: null,
    });
    expect(run).toEqual({
      id: 'r-1',
      agentId: 'a-1',
      agentName: 'Researcher',
      status: 'success',
      durationMs: 2500,
      costCents: 9.12,
      startedAt: '2026-04-26T10:00:00.000Z',
      error: undefined,
    });
  });

  it('surfaces the error message and 0 duration on a failed run', () => {
    const run = mapExecutionToAgentRun({
      id: 'r-2',
      agent_id: 'a-2',
      agent_name: 'Writer',
      started_at: '2026-04-26T10:00:00.000Z',
      completed_at: null,
      cost_cents: 0,
      error: 'rate limit hit',
    });
    expect(run.status).toBe('error');
    expect(run.durationMs).toBe(0);
    expect(run.error).toBe('rate limit hit');
  });

  it('falls back to "unknown" agent name when not provided', () => {
    const run = mapExecutionToAgentRun({
      id: 'r-3',
      agent_id: 'a-3',
      started_at: '2026-04-26T10:00:00.000Z',
    } as any);
    expect(run.agentName).toBe('unknown');
  });
});

describe('mapAgentToHealthMetrics', () => {
  it('rolls up a 24h window from execution rows', () => {
    const m = mapAgentToHealthMetrics(
      { id: 'a-1', name: 'Researcher', display_name: 'Researcher', agent_type: 'research' },
      [
        { started_at: '2026-04-26T10:00:00Z', completed_at: '2026-04-26T10:00:02Z', cost_cents: 5, error: null },
        { started_at: '2026-04-26T10:01:00Z', completed_at: '2026-04-26T10:01:04Z', cost_cents: 10, error: null },
        { started_at: '2026-04-26T10:02:00Z', completed_at: '2026-04-26T10:02:01Z', cost_cents: 3, error: 'oops' },
      ],
    );
    expect(m).toEqual({
      agentId: 'a-1',
      agentName: 'Researcher',
      agentType: 'research',
      runCount24h: 3,
      successRate: 2 / 3,
      // p50 of [2000, 4000, 1000] sorted = [1000, 2000, 4000] → 2000
      p50DurationMs: 2000,
      totalCostCents: 18,
    });
  });

  it('returns zero-metrics for an agent with no executions (idle)', () => {
    const m = mapAgentToHealthMetrics(
      { id: 'a-x', name: 'Archiver', display_name: 'Archiver', agent_type: 'archive' },
      [],
    );
    expect(m).toEqual({
      agentId: 'a-x',
      agentName: 'Archiver',
      agentType: 'archive',
      runCount24h: 0,
      successRate: 0,
      p50DurationMs: 0,
      totalCostCents: 0,
    });
  });

  it('uses display_name when present, falls back to name otherwise', () => {
    const m1 = mapAgentToHealthMetrics(
      { id: 'a1', name: 'raw_name', display_name: 'Pretty Name', agent_type: 't' },
      [],
    );
    expect(m1.agentName).toBe('Pretty Name');
    const m2 = mapAgentToHealthMetrics(
      { id: 'a2', name: 'raw_only', agent_type: 't' } as any,
      [],
    );
    expect(m2.agentName).toBe('raw_only');
  });
});
