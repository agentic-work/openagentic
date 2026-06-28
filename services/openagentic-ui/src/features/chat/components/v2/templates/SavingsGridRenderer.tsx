/**
 * SavingsGridRenderer — compose_app:savings_grid template.
 *
 * Sortable grid of cost-savings opportunities. Each row:
 * { resource, current_cost, recommended_action, monthly_savings, risk }.
 * Top-N rows highlighted as biggest wins. Default sort is monthly_savings desc.
 *
 * Mock anatomy: mocks/UX/AI/Chatmode/end-state-07-tri-cloud-cost-spikes.html,
 * mocks/UX/AI/Chatmode/end-state-01-azure-subs-rgs.html (savings section).
 */

import React, { useMemo, useState } from 'react';

export type RiskTone = 'low' | 'medium' | 'high';

export interface SavingsRow {
  resource: string;
  current_cost: number;
  recommended_action: string;
  monthly_savings: number;
  risk?: RiskTone;
}

export interface SavingsGridRendererProps {
  title?: string;
  currency?: string;
  rows?: ReadonlyArray<SavingsRow>;
  highlight_top_n?: number;
}

type SortKey = 'resource' | 'current_cost' | 'recommended_action' | 'monthly_savings' | 'risk';
type SortDir = 'asc' | 'desc';

const RISK_ORDER: Record<RiskTone, number> = { low: 0, medium: 1, high: 2 };

function riskTone(r: RiskTone | undefined): string {
  switch (r) {
    case 'high':
      return 'var(--cm-error, currentColor)';
    case 'medium':
      return 'var(--cm-warn, currentColor)';
    case 'low':
    default:
      return 'var(--cm-success, currentColor)';
  }
}

function fmtCurrency(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return String(n);
  }
}

export function SavingsGridRenderer({
  title,
  currency = 'USD',
  rows,
  highlight_top_n = 1,
}: SavingsGridRendererProps) {
  const [sortKey, setSortKey] = useState<SortKey>('monthly_savings');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const safeRows = Array.isArray(rows) ? rows : [];

  const sorted = useMemo(() => {
    const copy = [...safeRows];
    copy.sort((a, b) => {
      let av: number | string = a[sortKey] as number | string;
      let bv: number | string = b[sortKey] as number | string;
      if (sortKey === 'risk') {
        av = RISK_ORDER[(a.risk ?? 'low') as RiskTone];
        bv = RISK_ORDER[(b.risk ?? 'low') as RiskTone];
      }
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'desc' ? bv.localeCompare(av) : av.localeCompare(bv);
      }
      const an = Number(av);
      const bn = Number(bv);
      return sortDir === 'desc' ? bn - an : an - bn;
    });
    return copy;
  }, [safeRows, sortKey, sortDir]);

  if (safeRows.length === 0) {
    return (
      <div data-testid="savings-grid-renderer" style={{ color: 'var(--cm-fg-dim)', fontSize: 12 }}>
        no savings data
      </div>
    );
  }

  const totalSavings = sorted.reduce((s, r) => s + (r.monthly_savings || 0), 0);
  const totalCurrent = sorted.reduce((s, r) => s + (r.current_cost || 0), 0);

  function setSort(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else {
      setSortKey(k);
      setSortDir('desc');
    }
  }

  function ariaSort(k: SortKey): 'ascending' | 'descending' | 'none' {
    if (k !== sortKey) return 'none';
    return sortDir === 'desc' ? 'descending' : 'ascending';
  }

  const wrap: React.CSSProperties = {
    background: 'var(--cm-bg, transparent)',
    color: 'var(--cm-fg)',
    fontFamily: 'inherit',
    display: 'grid',
    gap: 12,
  };
  const kpiRow: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 10,
  };
  const kpi: React.CSSProperties = {
    background: 'var(--cm-bg-2)',
    border: '1px solid var(--cm-border)',
    borderRadius: 'var(--cm-radius, 6px)',
    padding: '10px 12px',
  };
  const kpiLabel: React.CSSProperties = {
    fontSize: 11,
    color: 'var(--cm-fg-dim)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  };
  const kpiValue: React.CSSProperties = {
    fontSize: 20,
    fontWeight: 600,
    fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
    color: 'var(--cm-fg)',
    marginTop: 4,
  };
  const tableHost: React.CSSProperties = {
    background: 'var(--cm-bg-2)',
    border: '1px solid var(--cm-border)',
    borderRadius: 'var(--cm-radius, 6px)',
    overflow: 'hidden',
  };
  const table: React.CSSProperties = {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 13,
  };
  const th: React.CSSProperties = {
    padding: '8px 12px',
    textAlign: 'left',
    background: 'var(--cm-bg-3, var(--cm-bg-2))',
    color: 'var(--cm-fg-dim)',
    fontWeight: 600,
    cursor: 'pointer',
    userSelect: 'none',
    borderBottom: '1px solid var(--cm-border)',
  };
  const td: React.CSSProperties = {
    padding: '8px 12px',
    borderBottom: '1px solid var(--cm-border)',
    color: 'var(--cm-fg)',
  };
  const tdNum: React.CSSProperties = {
    ...td,
    fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
    textAlign: 'right',
  };
  const tdSavings: React.CSSProperties = {
    ...tdNum,
    color: 'var(--cm-success, currentColor)',
    fontWeight: 600,
  };
  const riskPill = (r: RiskTone): React.CSSProperties => ({
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 11,
    fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
    color: riskTone(r),
    border: `1px solid ${riskTone(r)}`,
  });

  return (
    <div data-testid="savings-grid-renderer" className="cm-savings-grid" style={wrap}>
      {title && (
        <div style={{ fontWeight: 600, color: 'var(--cm-fg)', fontSize: 14 }}>{title}</div>
      )}
      <div style={kpiRow}>
        <div style={kpi}>
          <div style={kpiLabel}>Resources</div>
          <div style={kpiValue}>{sorted.length}</div>
        </div>
        <div style={kpi}>
          <div style={kpiLabel}>Current monthly</div>
          <div style={kpiValue}>{fmtCurrency(totalCurrent, currency)}</div>
        </div>
        <div style={kpi}>
          <div style={kpiLabel}>Potential savings</div>
          <div style={{ ...kpiValue, color: 'var(--cm-success, currentColor)' }}>
            −{fmtCurrency(totalSavings, currency)}
          </div>
        </div>
      </div>
      <div style={tableHost}>
        <table style={table}>
          <thead>
            <tr>
              <th style={th} aria-sort={ariaSort('resource')} onClick={() => setSort('resource')}>
                Resource
              </th>
              <th
                style={th}
                aria-sort={ariaSort('current_cost')}
                onClick={() => setSort('current_cost')}
              >
                Current
              </th>
              <th
                style={th}
                aria-sort={ariaSort('recommended_action')}
                onClick={() => setSort('recommended_action')}
              >
                Recommended action
              </th>
              <th
                style={th}
                aria-sort={ariaSort('monthly_savings')}
                onClick={() => setSort('monthly_savings')}
              >
                Monthly savings
              </th>
              <th style={th} aria-sort={ariaSort('risk')} onClick={() => setSort('risk')}>
                Risk
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => {
              const isTop =
                sortKey === 'monthly_savings' && sortDir === 'desc' && i < (highlight_top_n ?? 1);
              return (
                <tr
                  key={`${r.resource}-${i}`}
                  data-resource={r.resource}
                  data-top={isTop ? '1' : '0'}
                  style={
                    isTop
                      ? {
                          background:
                            'linear-gradient(90deg, color-mix(in srgb, var(--cm-success) 12%, transparent), transparent 60%)',
                        }
                      : undefined
                  }
                >
                  <td style={td}>{r.resource}</td>
                  <td style={tdNum}>{fmtCurrency(r.current_cost, currency)}</td>
                  <td style={td}>{r.recommended_action}</td>
                  <td style={tdSavings}>−{fmtCurrency(r.monthly_savings, currency)}</td>
                  <td style={td}>
                    <span style={riskPill((r.risk ?? 'low') as RiskTone)}>
                      {r.risk ?? 'low'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default SavingsGridRenderer;
