/**
 * AgentHealthCard — single-agent health summary tile.
 *
 * Pillar 4 surface (#54). One per registered agent. Shows: agent name +
 * type, last 24h run count, success rate %, p50 duration, total cost
 * cents (in $), health badge derived from successRate.
 *
 * Health bands:
 *   - successRate >= 95%  → "healthy"  (green)
 *   - successRate >= 75%  → "degraded" (amber)
 *   - successRate <  75%  → "critical" (red)
 *   - runCount === 0      → "idle"     (grey)
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentHealthCard, type AgentHealthMetrics } from '../AgentHealthCard';

const healthy: AgentHealthMetrics = {
  agentId: 'a1',
  agentName: 'Researcher',
  agentType: 'research',
  runCount24h: 50,
  successRate: 0.98,
  p50DurationMs: 2400,
  totalCostCents: 412.5,
};

const degraded: AgentHealthMetrics = {
  ...healthy,
  agentName: 'Writer',
  successRate: 0.85,
};

const critical: AgentHealthMetrics = {
  ...healthy,
  agentName: 'Critic',
  successRate: 0.62,
};

const idle: AgentHealthMetrics = {
  ...healthy,
  agentName: 'Archiver',
  runCount24h: 0,
  successRate: 0,
  p50DurationMs: 0,
  totalCostCents: 0,
};

describe('AgentHealthCard', () => {
  it('renders the agent name + type', () => {
    render(<AgentHealthCard metrics={healthy} onClick={() => {}} />);
    expect(screen.getByText('Researcher')).toBeTruthy();
    expect(screen.getByText('research')).toBeTruthy();
  });

  it('shows healthy band when successRate >= 95%', () => {
    render(<AgentHealthCard metrics={healthy} onClick={() => {}} />);
    expect(screen.getByText(/healthy/i)).toBeTruthy();
  });

  it('shows degraded band when successRate is 75%-95%', () => {
    render(<AgentHealthCard metrics={degraded} onClick={() => {}} />);
    expect(screen.getByText(/degraded/i)).toBeTruthy();
  });

  it('shows critical band when successRate < 75%', () => {
    render(<AgentHealthCard metrics={critical} onClick={() => {}} />);
    expect(screen.getByText(/critical/i)).toBeTruthy();
  });

  it('shows idle band when no runs in 24h', () => {
    render(<AgentHealthCard metrics={idle} onClick={() => {}} />);
    expect(screen.getByText(/idle/i)).toBeTruthy();
  });

  it('formats successRate as percentage with no decimals', () => {
    render(<AgentHealthCard metrics={healthy} onClick={() => {}} />);
    expect(screen.getByText('98%')).toBeTruthy();
  });

  it('formats totalCostCents as $X.XX (cents → dollars)', () => {
    render(<AgentHealthCard metrics={healthy} onClick={() => {}} />);
    // 412.5 cents = $4.13
    expect(screen.getByText('$4.13')).toBeTruthy();
  });

  it('renders p50 duration in seconds with 1 decimal', () => {
    render(<AgentHealthCard metrics={healthy} onClick={() => {}} />);
    expect(screen.getByText(/2\.4s/)).toBeTruthy();
  });

  it('shows em-dash for p50 when there are no runs', () => {
    render(<AgentHealthCard metrics={idle} onClick={() => {}} />);
    // Both p50 and successRate read as em-dash for idle agents
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });

  it('calls onClick with agentId when the card is clicked', () => {
    const onClick = vi.fn();
    render(<AgentHealthCard metrics={healthy} onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledWith('a1');
  });
});
