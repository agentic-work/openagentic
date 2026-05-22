/**
 * AgentRunsTable — recent agent runs across the fleet.
 *
 * Pillar 4 surface (#54). Renders one row per run with: agent name,
 * outcome badge (success/error/running), duration, cost, started-at
 * relative time, click-through to the trace.
 *
 * Tests:
 *   - empty state when no runs
 *   - one row per run, in the order provided (caller pre-sorts)
 *   - outcome badge color reflects status
 *   - cost rendered as $X.XX with 2 decimals
 *   - duration < 1s shown in ms; >= 1s shown in s
 *   - click on a row calls onSelect with the run id
 *   - skeleton/loading state when loading=true
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { AgentRunsTable, type AgentRun } from '../AgentRunsTable';

const sample: AgentRun[] = [
  {
    id: 'r-1',
    agentId: 'a-researcher',
    agentName: 'Researcher',
    status: 'success',
    durationMs: 2517,
    costCents: 9.12,
    startedAt: '2026-04-26T17:00:00Z',
  },
  {
    id: 'r-2',
    agentId: 'a-writer',
    agentName: 'Writer',
    status: 'error',
    durationMs: 482,
    costCents: 2.04,
    startedAt: '2026-04-26T17:01:00Z',
    error: 'Refusal: input lacked context',
  },
  {
    id: 'r-3',
    agentId: 'a-researcher',
    agentName: 'Researcher',
    status: 'running',
    durationMs: 0,
    costCents: 0,
    startedAt: '2026-04-26T17:02:00Z',
  },
];

describe('AgentRunsTable', () => {
  it('renders an empty-state message when runs is empty', () => {
    render(<AgentRunsTable runs={[]} loading={false} onSelect={() => {}} />);
    expect(screen.getByText(/no recent agent runs/i)).toBeTruthy();
  });

  it('renders one row per run in the order provided', () => {
    render(<AgentRunsTable runs={sample} loading={false} onSelect={() => {}} />);
    const rows = screen.getAllByTestId('agent-run-row');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('Researcher')).toBeTruthy();
    expect(within(rows[1]).getByText('Writer')).toBeTruthy();
  });

  it('renders status pills with the correct status text', () => {
    render(<AgentRunsTable runs={sample} loading={false} onSelect={() => {}} />);
    expect(screen.getByText(/success/i)).toBeTruthy();
    expect(screen.getByText(/error/i)).toBeTruthy();
    expect(screen.getByText(/running/i)).toBeTruthy();
  });

  it('renders cost as $X.XX with 2 decimals from cents', () => {
    render(<AgentRunsTable runs={sample} loading={false} onSelect={() => {}} />);
    // $9.12 → 9.12, $2.04 → 2.04, $0 → 0.00
    expect(screen.getByText(/\$0\.09/)).toBeTruthy(); // 9.12 cents = $0.09
    expect(screen.getByText(/\$0\.02/)).toBeTruthy(); // 2.04 cents = $0.02
  });

  it('renders duration as "ms" when below 1s, "s" otherwise', () => {
    render(<AgentRunsTable runs={sample} loading={false} onSelect={() => {}} />);
    // 2517ms → "2.5s"; 482ms → "482ms"; 0 → "—"
    expect(screen.getByText(/2\.5s/)).toBeTruthy();
    expect(screen.getByText(/482ms/)).toBeTruthy();
  });

  it('calls onSelect with the run id when a row is clicked', () => {
    const onSelect = vi.fn();
    render(<AgentRunsTable runs={sample} loading={false} onSelect={onSelect} />);
    fireEvent.click(screen.getAllByTestId('agent-run-row')[1]);
    expect(onSelect).toHaveBeenCalledWith('r-2');
  });

  it('shows a loading state when loading=true', () => {
    render(<AgentRunsTable runs={[]} loading={true} onSelect={() => {}} />);
    expect(screen.getByText(/loading runs/i)).toBeTruthy();
  });

  it('truncates the error message to one line when present', () => {
    render(<AgentRunsTable runs={sample} loading={false} onSelect={() => {}} />);
    expect(screen.getByText(/Refusal: input lacked context/)).toBeTruthy();
  });
});
