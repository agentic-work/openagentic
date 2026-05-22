/**
 * ClusterInventoryRenderer — compose_app:cluster_inventory template.
 *
 * Cluster table with totals and per-status counts. Sortable (basic).
 *
 * Mock anatomy: mocks/UX/AI/Chatmode/end-state-06-aws-k8s-aiops.html.
 */

import React, { useMemo, useState } from 'react';

export type ClusterStatus = 'healthy' | 'degraded' | 'critical' | 'unknown';

export interface ClusterRow {
  name: string;
  region: string;
  k8s_version: string;
  node_count: number;
  pods: number;
  status?: ClusterStatus;
  owner?: string;
}

export interface ClusterInventoryRendererProps {
  title?: string;
  subtitle?: string;
  clusters?: ReadonlyArray<ClusterRow>;
}

type SortKey = 'name' | 'region' | 'k8s_version' | 'node_count' | 'pods' | 'status' | 'owner';

function statusTone(s?: ClusterStatus): string {
  switch (s) {
    case 'healthy':
      return 'var(--cm-success, currentColor)';
    case 'degraded':
      return 'var(--cm-warn, currentColor)';
    case 'critical':
      return 'var(--cm-error, currentColor)';
    case 'unknown':
    default:
      return 'var(--cm-fg-dim, currentColor)';
  }
}

export function ClusterInventoryRenderer(props: ClusterInventoryRendererProps) {
  const { title, subtitle, clusters } = props;
  const safe = Array.isArray(clusters) ? clusters : [];

  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

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
      <div data-testid="cluster-inventory-renderer" style={{ color: 'var(--cm-fg-dim)', fontSize: 12 }}>
        no clusters
      </div>
    );
  }

  function setSort(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(k);
      setSortDir('asc');
    }
  }

  const totals = {
    nodes: safe.reduce((a, c) => a + (c.node_count || 0), 0),
    pods: safe.reduce((a, c) => a + (c.pods || 0), 0),
    healthy: safe.filter((c) => c.status === 'healthy').length,
    degraded: safe.filter((c) => c.status === 'degraded').length,
    critical: safe.filter((c) => c.status === 'critical').length,
  };

  const kpiStyle: React.CSSProperties = {
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
  };

  return (
    <div
      data-testid="cluster-inventory-renderer"
      className="cm-cluster-inventory"
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
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 10,
        }}
      >
        <div style={kpiStyle}>
          <div style={kpiLabel}>Clusters</div>
          <div style={kpiValue}>{safe.length}</div>
        </div>
        <div style={kpiStyle}>
          <div style={kpiLabel}>Nodes</div>
          <div style={kpiValue}>{totals.nodes}</div>
        </div>
        <div style={kpiStyle}>
          <div style={kpiLabel}>Pods</div>
          <div style={kpiValue}>{totals.pods}</div>
        </div>
        <div style={kpiStyle}>
          <div style={kpiLabel}>Healthy</div>
          <div style={{ ...kpiValue, color: 'var(--cm-success, currentColor)' }}>
            {totals.healthy}
          </div>
        </div>
        <div style={kpiStyle}>
          <div style={kpiLabel}>Degraded / Critical</div>
          <div
            style={{
              ...kpiValue,
              color:
                totals.critical > 0
                  ? 'var(--cm-error, currentColor)'
                  : totals.degraded > 0
                  ? 'var(--cm-warn, currentColor)'
                  : 'var(--cm-fg-dim)',
            }}
          >
            {totals.degraded + totals.critical}
          </div>
        </div>
      </div>
      <div
        style={{
          background: 'var(--cm-bg-2)',
          border: '1px solid var(--cm-border)',
          borderRadius: 'var(--cm-radius, 6px)',
          overflow: 'hidden',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={th} onClick={() => setSort('name')}>Cluster</th>
              <th style={th} onClick={() => setSort('region')}>Region</th>
              <th style={th} onClick={() => setSort('k8s_version')}>k8s</th>
              <th style={th} onClick={() => setSort('node_count')}>Nodes</th>
              <th style={th} onClick={() => setSort('pods')}>Pods</th>
              <th style={th} onClick={() => setSort('status')}>Status</th>
              <th style={th} onClick={() => setSort('owner')}>Owner</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => (
              <tr key={c.name} data-cluster={c.name} data-status={c.status ?? 'unknown'}>
                <td style={{ ...td, fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)' }}>
                  {c.name}
                </td>
                <td style={td}>{c.region}</td>
                <td style={{ ...td, fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)' }}>
                  {c.k8s_version}
                </td>
                <td style={{ ...td, fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)', textAlign: 'right' }}>
                  {c.node_count}
                </td>
                <td style={{ ...td, fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)', textAlign: 'right' }}>
                  {c.pods}
                </td>
                <td style={td}>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '3px 10px',
                      borderRadius: 999,
                      fontSize: 11,
                      fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
                      color: statusTone(c.status),
                      border: `1px solid ${statusTone(c.status)}`,
                    }}
                  >
                    {c.status ?? 'unknown'}
                  </span>
                </td>
                <td style={{ ...td, fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)', color: 'var(--cm-fg-dim)' }}>
                  {c.owner ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default ClusterInventoryRenderer;
