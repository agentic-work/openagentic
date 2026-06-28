/**
 * AgentHealthCard — single-agent health summary tile (Pillar 4).
 *
 * Compact card for a fleet view: agent identity + 24h-window metrics
 * (run count, success rate, p50 duration, total cost) + a color-coded
 * health band derived from successRate.
 */

import React from 'react';

export interface AgentHealthMetrics {
  agentId: string;
  agentName: string;
  agentType: string;
  /** Total runs in the last 24h. 0 → "idle" band regardless of successRate. */
  runCount24h: number;
  /** Float in [0,1]. Banding: >= 0.95 healthy, >= 0.75 degraded, < 0.75 critical. */
  successRate: number;
  p50DurationMs: number;
  /** In cents. Rendered as `$<cents/100>.XX` to match AgentRunsTable. */
  totalCostCents: number;
}

export interface AgentHealthCardProps {
  metrics: AgentHealthMetrics;
  onClick: (agentId: string) => void;
}

type Band = 'healthy' | 'degraded' | 'critical' | 'idle';

function bandFor(m: AgentHealthMetrics): Band {
  if (m.runCount24h === 0) return 'idle';
  if (m.successRate >= 0.95) return 'healthy';
  if (m.successRate >= 0.75) return 'degraded';
  return 'critical';
}

const bandColor: Record<Band, string> = {
  healthy: 'var(--color-ok)',
  degraded: 'var(--color-warn)',
  critical: 'var(--color-err)',
  idle: 'var(--color-fg-subtle)',
};

const formatCost = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const formatDuration = (ms: number) => {
  if (ms === 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

const formatRate = (m: AgentHealthMetrics) => {
  if (m.runCount24h === 0) return '—';
  return `${Math.round(m.successRate * 100)}%`;
};

export const AgentHealthCard: React.FC<AgentHealthCardProps> = ({ metrics, onClick }) => {
  const band = bandFor(metrics);

  return (
    <button
      type="button"
      onClick={() => onClick(metrics.agentId)}
      style={{
        textAlign: 'left',
        width: '100%',
        padding: 14,
        borderRadius: 10,
        background: 'var(--color-bg-secondary)',
        border: `1px solid ${bandColor[band]}33`,
        color: 'var(--color-text)',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{metrics.agentName}</span>
          <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{metrics.agentType}</span>
        </div>
        <span
          style={{
            padding: '3px 10px',
            borderRadius: 12,
            fontSize: 10,
            fontWeight: 700,
            color: 'var(--color-on-accent)',
            background: bandColor[band],
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            flexShrink: 0,
          }}
        >
          {band}
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 8,
          fontSize: 12,
        }}
      >
        <Metric label="Runs 24h" value={String(metrics.runCount24h)} />
        <Metric label="Success" value={formatRate(metrics)} />
        <Metric label="p50" value={formatDuration(metrics.p50DurationMs)} />
        <Metric label="Cost" value={formatCost(metrics.totalCostCents)} />
      </div>
    </button>
  );
};

const Metric: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
    <span
      style={{
        fontSize: 10,
        color: 'var(--color-text-tertiary)',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
      }}
    >
      {label}
    </span>
    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{value}</span>
  </div>
);
