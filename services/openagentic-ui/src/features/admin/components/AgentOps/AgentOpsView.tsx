/**
 * AgentOpsView — Pillar 4 admin surface composing the fleet of
 * registered agents + their recent runs.
 *
 * Pure-presentational: caller fetches `agents` (per-agent 24h
 * metrics) + `runs` (recent activity) and supplies them. No data
 * fetching here so it stays testable + reusable across the admin
 * shell-v2 routing layer and future embedded contexts.
 *
 * Layout:
 *   ┌ page heading + 4 fleet KPI cards ─────────────────────────┐
 *   ├ grid of AgentHealthCard, one per registered agent ────────┤
 *   └ AgentRunsTable with the latest runs across the fleet ─────┘
 */

import React from 'react';
import { AgentHealthCard, type AgentHealthMetrics } from './AgentHealthCard';
import { AgentRunsTable, type AgentRun } from './AgentRunsTable';

export interface AgentOpsViewProps {
  agents: AgentHealthMetrics[];
  runs: AgentRun[];
  loading: boolean;
  onSelectAgent: (agentId: string) => void;
  onSelectRun: (runId: string) => void;
}

interface FleetRollUp {
  totalAgents: number;
  totalRuns24h: number;
  /** Weighted successRate across all agents, weighted by their runCount24h. */
  fleetSuccessRate: number;
  /** Sum of totalCostCents across all agents (24h window). */
  fleetCostCents: number;
}

function rollUp(agents: AgentHealthMetrics[]): FleetRollUp {
  const totalAgents = agents.length;
  const totalRuns24h = agents.reduce((acc, a) => acc + a.runCount24h, 0);
  const fleetCostCents = agents.reduce((acc, a) => acc + a.totalCostCents, 0);
  const fleetSuccessRate = totalRuns24h === 0
    ? 0
    : agents.reduce((acc, a) => acc + a.successRate * a.runCount24h, 0) / totalRuns24h;
  return { totalAgents, totalRuns24h, fleetSuccessRate, fleetCostCents };
}

const Kpi: React.FC<{ testid: string; label: string; value: string }> = ({ testid, label, value }) => (
  <div
    data-testid={testid}
    style={{
      flex: 1,
      minWidth: 140,
      padding: 14,
      borderRadius: 10,
      background: 'var(--color-bg-secondary, #161b22)',
      border: '1px solid var(--color-border, #2a2a2a)',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}
  >
    <span
      style={{
        fontSize: 10,
        color: 'var(--color-text-tertiary, #6e7681)',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
      }}
    >
      {label}
    </span>
    <span
      style={{
        fontSize: 22,
        fontWeight: 700,
        fontFamily: 'ui-monospace, monospace',
      }}
    >
      {value}
    </span>
  </div>
);

export const AgentOpsView: React.FC<AgentOpsViewProps> = ({
  agents,
  runs,
  loading,
  onSelectAgent,
  onSelectRun,
}) => {
  const fleet = rollUp(agents);

  const renderKpis = () => {
    if (loading || agents.length === 0) {
      return (
        <>
          <Kpi testid="kpi-total-agents" label="Agents" value="—" />
          <Kpi testid="kpi-total-runs-24h" label="Runs 24h" value="—" />
          <Kpi testid="kpi-fleet-success" label="Success" value="—" />
          <Kpi testid="kpi-fleet-cost" label="Cost 24h" value="—" />
        </>
      );
    }
    return (
      <>
        <Kpi testid="kpi-total-agents" label="Agents" value={String(fleet.totalAgents)} />
        <Kpi testid="kpi-total-runs-24h" label="Runs 24h" value={String(fleet.totalRuns24h)} />
        <Kpi
          testid="kpi-fleet-success"
          label="Success"
          value={`${Math.round(fleet.fleetSuccessRate * 100)}%`}
        />
        <Kpi testid="kpi-fleet-cost" label="Cost 24h" value={`$${(fleet.fleetCostCents / 100).toFixed(2)}`} />
      </>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, padding: 24 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>AgentOps</h1>
        <p style={{ fontSize: 13, color: 'var(--color-text-tertiary, #6e7681)' }}>
          Fleet view of registered agents — health, recent activity, and 24-hour cost roll-ups.
        </p>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {renderKpis()}
      </div>

      <section>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--color-text-secondary, #8b949e)' }}>
          Agents
        </h2>
        {agents.length === 0 ? (
          <div
            style={{
              padding: 24,
              textAlign: 'center',
              color: 'var(--color-text-tertiary, #6e7681)',
              fontSize: 13,
              border: '1px dashed var(--color-border, #2a2a2a)',
              borderRadius: 10,
            }}
          >
            No registered agents.
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 12,
            }}
          >
            {agents.map((a) => (
              <AgentHealthCard key={a.agentId} metrics={a} onClick={onSelectAgent} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--color-text-secondary, #8b949e)' }}>
          Recent runs
        </h2>
        <AgentRunsTable runs={runs} loading={loading} onSelect={onSelectRun} />
      </section>
    </div>
  );
};
