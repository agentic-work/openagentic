/**
 * agentOpsApi — shape mappers for the Pillar 4 AgentOps view.
 *
 * Pure functions: take raw API response rows (prisma.agent + the
 * per-agent execution log) and return the structures AgentOpsView /
 * AgentHealthCard / AgentRunsTable consume.
 *
 * Kept pure + side-effect-free so they unit-test cleanly and the
 * AgentOpsView container can wire them to whatever data-fetch hook
 * (REST, SWR, react-query) the rest of the admin shell uses.
 */

import type { AgentHealthMetrics } from './AgentHealthCard';
import type { AgentRun } from './AgentRunsTable';

interface RawAgent {
  id: string;
  name: string;
  display_name?: string | null;
  agent_type: string;
}

interface RawExecution {
  id?: string;
  agent_id?: string;
  agent_name?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  cost_cents?: number | null;
  error?: string | null;
}

export function statusFromExecution(
  e: RawExecution,
): AgentRun['status'] {
  if (e.error) return 'error';
  if (e.started_at && e.completed_at) return 'success';
  if (e.started_at && !e.completed_at) return 'running';
  return 'queued';
}

function durationOf(e: RawExecution): number {
  if (!e.started_at || !e.completed_at) return 0;
  const start = new Date(e.started_at).getTime();
  const end = new Date(e.completed_at).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, end - start);
}

export function mapExecutionToAgentRun(e: RawExecution): AgentRun {
  return {
    id: e.id ?? '',
    agentId: e.agent_id ?? '',
    agentName: e.agent_name ?? 'unknown',
    status: statusFromExecution(e),
    durationMs: durationOf(e),
    costCents: e.cost_cents ?? 0,
    startedAt: e.started_at ?? '',
    error: e.error ?? undefined,
  };
}

function p50(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  // Odd length: middle element. Even length: lower-middle (matches our test fixture).
  return sorted.length % 2 === 1 ? sorted[mid] : sorted[mid - 1];
}

export function mapAgentToHealthMetrics(
  agent: RawAgent,
  executions: RawExecution[],
): AgentHealthMetrics {
  const runCount24h = executions.length;
  const succ = executions.filter((e) => statusFromExecution(e) === 'success').length;
  const successRate = runCount24h === 0 ? 0 : succ / runCount24h;
  const durations = executions
    .map(durationOf)
    .filter((d) => d > 0);
  const totalCostCents = executions.reduce((acc, e) => acc + (e.cost_cents ?? 0), 0);

  return {
    agentId: agent.id,
    agentName: agent.display_name || agent.name,
    agentType: agent.agent_type,
    runCount24h,
    successRate,
    p50DurationMs: p50(durations),
    totalCostCents,
  };
}
