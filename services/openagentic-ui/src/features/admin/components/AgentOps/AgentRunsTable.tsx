/**
 * AgentRunsTable — recent agent runs across the fleet (Pillar 4).
 *
 * Renders one clickable row per run with: agent name, outcome badge,
 * duration, cost, started-at. Click → onSelect(runId) for trace
 * drill-down.
 *
 * Cost normalization: incoming `costCents` is in cents; the table
 * shows dollars with 2 decimals via `$<cents/100>`. So a 9.12-cent
 * run renders as "$0.09" — small numbers but real signal at fleet
 * scale, where averaging 100 runs/day at 9 cents tells you about
 * burn rate.
 *
 * Duration normalization: < 1s shown in ms (482ms), >= 1s shown in
 * seconds with one decimal (2.5s); 0 collapses to em-dash since
 * "in-flight" runs don't have a duration yet.
 */

import React from 'react';

export interface AgentRun {
  id: string;
  agentId: string;
  agentName: string;
  status: 'success' | 'error' | 'running' | 'queued';
  durationMs: number;
  costCents: number;
  startedAt: string;
  error?: string;
}

export interface AgentRunsTableProps {
  runs: AgentRun[];
  loading: boolean;
  onSelect: (runId: string) => void;
}

const statusColor = (s: AgentRun['status']): string => {
  switch (s) {
    case 'success': return 'var(--color-ok)';
    case 'error':   return 'var(--color-err)';
    case 'running': return 'var(--color-nfo)';
    case 'queued':  return 'var(--color-fg-subtle)';
  }
};

const formatCost = (cents: number): string => {
  if (cents === 0) return '$0.00';
  return `$${(cents / 100).toFixed(2)}`;
};

const formatDuration = (ms: number): string => {
  if (ms === 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

const formatRelative = (iso: string): string => {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const sec = Math.max(1, Math.floor((now - then) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
};

export const AgentRunsTable: React.FC<AgentRunsTableProps> = ({
  runs,
  loading,
  onSelect,
}) => {
  if (loading) {
    return (
      <div
        style={{
          padding: 24,
          textAlign: 'center',
          color: 'var(--color-text-tertiary)',
          fontSize: 13,
        }}
      >
        Loading runs…
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div
        style={{
          padding: 24,
          textAlign: 'center',
          color: 'var(--color-text-tertiary)',
          fontSize: 13,
        }}
      >
        No recent agent runs.
      </div>
    );
  }

  return (
    <div
      role="table"
      style={{
        width: '100%',
        background: 'var(--color-bg-secondary)',
        borderRadius: 8,
        border: '1px solid var(--color-border)',
        overflow: 'hidden',
      }}
    >
      <div
        role="row"
        style={{
          display: 'grid',
          gridTemplateColumns: '1.5fr 0.8fr 0.8fr 0.7fr 1fr',
          padding: '8px 12px',
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          color: 'var(--color-text-tertiary)',
          background: 'var(--color-bg-tertiary)',
        }}
      >
        <span>Agent</span>
        <span>Status</span>
        <span>Duration</span>
        <span>Cost</span>
        <span>Started</span>
      </div>

      {runs.map((run) => (
        <button
          key={run.id}
          type="button"
          role="row"
          data-testid="agent-run-row"
          onClick={() => onSelect(run.id)}
          style={{
            display: 'grid',
            gridTemplateColumns: '1.5fr 0.8fr 0.8fr 0.7fr 1fr',
            width: '100%',
            padding: '10px 12px',
            fontSize: 13,
            background: 'transparent',
            border: 'none',
            borderTop: '1px solid var(--color-border)',
            color: 'var(--color-text)',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontWeight: 500 }}>{run.agentName}</span>
            {run.error ? (
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--color-err)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={run.error}
              >
                {run.error}
              </span>
            ) : null}
          </span>
          <span>
            <span
              style={{
                display: 'inline-block',
                padding: '2px 8px',
                borderRadius: 10,
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--color-on-accent)',
                background: statusColor(run.status),
                textTransform: 'lowercase',
              }}
            >
              {run.status}
            </span>
          </span>
          <span style={{ fontFamily: 'var(--font-mono)' }}>
            {formatDuration(run.durationMs)}
          </span>
          <span style={{ fontFamily: 'var(--font-mono)' }}>
            {formatCost(run.costCents)}
          </span>
          <span style={{ color: 'var(--color-text-tertiary)' }}>
            {formatRelative(run.startedAt)}
          </span>
        </button>
      ))}
    </div>
  );
};
