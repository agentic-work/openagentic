/**
 * TrainingRunsDashboardRenderer — compose_app:training_runs_dashboard template.
 *
 * ML training run grid with summary KPIs (running/completed/failed/queued)
 * + sortable table. Best-eval run highlighted.
 *
 * Anatomy: status pills, metric columns, sortable; no existing mock — minimal
 * anatomy chosen per task brief.
 */

import React, { useMemo, useState } from 'react';

export type RunStatus = 'running' | 'completed' | 'failed' | 'queued' | 'cancelled';

export interface TrainingRun {
  run_id: string;
  model: string;
  dataset: string;
  status: RunStatus;
  loss_final?: number;
  eval_metric_name?: string;
  eval_metric_value?: number;
  duration_min?: number;
  started_at?: string;
}

export interface TrainingRunsDashboardRendererProps {
  title?: string;
  subtitle?: string;
  runs?: ReadonlyArray<TrainingRun>;
}

type SortKey =
  | 'run_id'
  | 'model'
  | 'dataset'
  | 'status'
  | 'loss_final'
  | 'eval_metric_value'
  | 'duration_min'
  | 'started_at';

function statusTone(s: RunStatus): string {
  switch (s) {
    case 'running':
      return 'var(--cm-accent, currentColor)';
    case 'completed':
      return 'var(--cm-success, currentColor)';
    case 'failed':
      return 'var(--cm-error, currentColor)';
    case 'queued':
      return 'var(--cm-fg-dim, currentColor)';
    case 'cancelled':
      return 'var(--cm-fg-muted, var(--cm-fg-dim))';
    default:
      return 'var(--cm-fg-dim, currentColor)';
  }
}

export function TrainingRunsDashboardRenderer(props: TrainingRunsDashboardRendererProps) {
  const { title, subtitle, runs } = props;
  const safe = Array.isArray(runs) ? runs : [];

  const [sortKey, setSortKey] = useState<SortKey>('started_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const sorted = useMemo(() => {
    const copy = [...safe];
    copy.sort((a, b) => {
      const av = (a[sortKey] ?? '') as number | string;
      const bv = (b[sortKey] ?? '') as number | string;
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      return sortDir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return copy;
  }, [safe, sortKey, sortDir]);

  if (safe.length === 0) {
    return (
      <div data-testid="training-runs-dashboard-renderer" style={{ color: 'var(--cm-fg-dim)', fontSize: 12 }}>
        no training runs
      </div>
    );
  }

  function setSort(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(k);
      setSortDir('desc');
    }
  }

  const totals = {
    running: safe.filter((r) => r.status === 'running').length,
    completed: safe.filter((r) => r.status === 'completed').length,
    failed: safe.filter((r) => r.status === 'failed').length,
    queued: safe.filter((r) => r.status === 'queued').length,
  };

  const completedRuns = safe.filter(
    (r) => r.status === 'completed' && typeof r.eval_metric_value === 'number',
  );
  const bestEval =
    completedRuns.length === 0
      ? null
      : Math.max(...completedRuns.map((r) => r.eval_metric_value!));

  const kpi: React.CSSProperties = {
    padding: '10px 12px',
    background: 'var(--cm-bg-2)',
    border: '1px solid var(--cm-border)',
    borderRadius: 'var(--cm-radius, 6px)',
  };
  const kpiLabel: React.CSSProperties = {
    fontSize: 10,
    color: 'var(--cm-fg-dim)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  };
  const kpiValue: React.CSSProperties = {
    fontSize: 20,
    fontWeight: 600,
    fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
    marginTop: 4,
    color: 'var(--cm-fg)',
  };
  const th: React.CSSProperties = {
    padding: '8px 12px',
    textAlign: 'left',
    background: 'var(--cm-bg-3, var(--cm-bg-2))',
    color: 'var(--cm-fg-dim)',
    fontWeight: 600,
    borderBottom: '1px solid var(--cm-border)',
    cursor: 'pointer',
    userSelect: 'none',
  };
  const td: React.CSSProperties = {
    padding: '8px 12px',
    borderBottom: '1px solid var(--cm-border)',
    color: 'var(--cm-fg)',
    fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
    fontSize: 12,
  };

  return (
    <div
      data-testid="training-runs-dashboard-renderer"
      className="cm-training-runs-dashboard"
      style={{ display: 'grid', gap: 12, color: 'var(--cm-fg)' }}
    >
      {(title || subtitle) && (
        <div>
          {title && (
            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--cm-fg)' }}>{title}</div>
          )}
          {subtitle && (
            <div style={{ fontSize: 11, color: 'var(--cm-fg-dim)', marginTop: 2 }}>{subtitle}</div>
          )}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
        <div style={kpi}>
          <div style={kpiLabel}>Runs</div>
          <div style={kpiValue}>{safe.length}</div>
        </div>
        <div style={kpi}>
          <div style={kpiLabel}>Running</div>
          <div style={{ ...kpiValue, color: 'var(--cm-accent)' }}>{totals.running}</div>
        </div>
        <div style={kpi}>
          <div style={kpiLabel}>Completed</div>
          <div style={{ ...kpiValue, color: 'var(--cm-success)' }}>{totals.completed}</div>
        </div>
        <div style={kpi}>
          <div style={kpiLabel}>Failed</div>
          <div style={{ ...kpiValue, color: 'var(--cm-error)' }}>{totals.failed}</div>
        </div>
        <div style={kpi}>
          <div style={kpiLabel}>Queued</div>
          <div style={{ ...kpiValue, color: 'var(--cm-fg-dim)' }}>{totals.queued}</div>
        </div>
      </div>
      <div
        style={{
          background: 'var(--cm-bg-2)',
          border: '1px solid var(--cm-border)',
          borderRadius: 'var(--cm-radius, 6px)',
          overflow: 'auto',
        }}
      >
        <table style={{ borderCollapse: 'collapse', minWidth: '100%', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={th} onClick={() => setSort('run_id')}>Run</th>
              <th style={th} onClick={() => setSort('model')}>Model</th>
              <th style={th} onClick={() => setSort('dataset')}>Dataset</th>
              <th style={th} onClick={() => setSort('status')}>Status</th>
              <th style={th} onClick={() => setSort('loss_final')}>Loss</th>
              <th style={th} onClick={() => setSort('eval_metric_value')}>Eval</th>
              <th style={th} onClick={() => setSort('duration_min')}>Dur (m)</th>
              <th style={th} onClick={() => setSort('started_at')}>Started</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const isBest =
                bestEval !== null &&
                r.status === 'completed' &&
                typeof r.eval_metric_value === 'number' &&
                r.eval_metric_value === bestEval;
              return (
                <tr
                  key={r.run_id}
                  data-run-id={r.run_id}
                  data-status={r.status}
                  data-best={isBest ? '1' : '0'}
                  style={
                    isBest
                      ? {
                          background:
                            'linear-gradient(90deg, color-mix(in srgb, var(--cm-success) 12%, transparent), transparent 60%)',
                        }
                      : undefined
                  }
                >
                  <td style={td}>{r.run_id}</td>
                  <td style={td}>{r.model}</td>
                  <td style={td}>{r.dataset}</td>
                  <td style={td}>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: 999,
                        fontSize: 11,
                        color: statusTone(r.status),
                        border: `1px solid ${statusTone(r.status)}`,
                      }}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {typeof r.loss_final === 'number' ? r.loss_final.toFixed(3) : '—'}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {typeof r.eval_metric_value === 'number'
                      ? `${r.eval_metric_value.toFixed(3)}${r.eval_metric_name ? ` ${r.eval_metric_name}` : ''}`
                      : '—'}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {typeof r.duration_min === 'number' ? r.duration_min : '—'}
                  </td>
                  <td style={{ ...td, color: 'var(--cm-fg-dim)' }}>{r.started_at ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default TrainingRunsDashboardRenderer;
