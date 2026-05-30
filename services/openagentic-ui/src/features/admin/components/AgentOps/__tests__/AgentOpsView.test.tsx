/**
 * AgentOpsView — composed admin view for Pillar 4.
 *
 * Layout:
 *   <header> page heading + 4 fleet KPI cards
 *   <section> grid of AgentHealthCard per agent
 *   <section> AgentRunsTable with the latest runs
 *
 * Tests cover the composition (KPI roll-up + section rendering) +
 * loading + empty states. The two leaf components are already
 * unit-tested; here we just confirm the view wires them right.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentOpsView } from '../AgentOpsView';
import type { AgentHealthMetrics } from '../AgentHealthCard';
import type { AgentRun } from '../AgentRunsTable';

const agents: AgentHealthMetrics[] = [
  { agentId: 'a1', agentName: 'Researcher', agentType: 'research', runCount24h: 50, successRate: 0.98, p50DurationMs: 2400, totalCostCents: 412.5 },
  { agentId: 'a2', agentName: 'Writer',     agentType: 'writing',  runCount24h: 30, successRate: 0.85, p50DurationMs: 1900, totalCostCents: 224.0 },
  { agentId: 'a3', agentName: 'Critic',     agentType: 'review',   runCount24h: 12, successRate: 0.62, p50DurationMs: 3100, totalCostCents: 80.0  },
];

const runs: AgentRun[] = [
  { id: 'r1', agentId: 'a1', agentName: 'Researcher', status: 'success', durationMs: 2400, costCents: 8, startedAt: '2026-04-26T17:00:00Z' },
  { id: 'r2', agentId: 'a2', agentName: 'Writer',     status: 'error',   durationMs: 800,  costCents: 4, startedAt: '2026-04-26T17:01:00Z', error: 'rate limit' },
];

describe('AgentOpsView', () => {
  it('renders the page heading', () => {
    render(<AgentOpsView agents={agents} runs={runs} loading={false} onSelectAgent={() => {}} onSelectRun={() => {}} />);
    expect(screen.getByRole('heading', { name: /agent ?ops/i })).toBeTruthy();
  });

  it('renders one health card per agent', () => {
    render(<AgentOpsView agents={agents} runs={runs} loading={false} onSelectAgent={() => {}} onSelectRun={() => {}} />);
    // Agent names appear in BOTH health cards + runs table; assert at
    // least one occurrence per agent (Critic only exists in agents,
    // not runs, so it's the strict signal that the card grid rendered).
    expect(screen.getByText('Critic')).toBeTruthy();
    // Researcher + Writer appear in both — use getAllByText.
    expect(screen.getAllByText('Researcher').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Writer').length).toBeGreaterThanOrEqual(1);
  });

  it('renders fleet KPI cards: total agents / total runs 24h / fleet success rate / fleet cost', () => {
    render(<AgentOpsView agents={agents} runs={runs} loading={false} onSelectAgent={() => {}} onSelectRun={() => {}} />);
    // 3 agents
    expect(screen.getByTestId('kpi-total-agents').textContent).toContain('3');
    // 50 + 30 + 12 = 92 runs
    expect(screen.getByTestId('kpi-total-runs-24h').textContent).toContain('92');
    // weighted average successRate: (50*0.98 + 30*0.85 + 12*0.62) / 92 = ~0.886 → 89%
    expect(screen.getByTestId('kpi-fleet-success').textContent).toContain('89%');
    // total cost cents: 412.5 + 224 + 80 = 716.5 → $7.17
    expect(screen.getByTestId('kpi-fleet-cost').textContent).toContain('$7.17');
  });

  it('shows the recent-runs section heading', () => {
    render(<AgentOpsView agents={agents} runs={runs} loading={false} onSelectAgent={() => {}} onSelectRun={() => {}} />);
    expect(screen.getByRole('heading', { name: /recent runs/i })).toBeTruthy();
  });

  it('shows zero-state when both agents + runs are empty', () => {
    render(<AgentOpsView agents={[]} runs={[]} loading={false} onSelectAgent={() => {}} onSelectRun={() => {}} />);
    expect(screen.getByText(/no registered agents/i)).toBeTruthy();
  });

  it('shows the loading state on KPI cards when loading=true', () => {
    render(<AgentOpsView agents={[]} runs={[]} loading={true} onSelectAgent={() => {}} onSelectRun={() => {}} />);
    // KPI placeholders show em-dashes when loading
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(3);
  });
});
