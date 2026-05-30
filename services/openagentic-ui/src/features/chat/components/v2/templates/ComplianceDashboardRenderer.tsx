/**
 * ComplianceDashboardRenderer — compose_app:compliance_dashboard template.
 *
 * Controls grid grouped by family. Per-family bar (MET/PARTIAL/GAP) and
 * an overall readiness % across all controls.
 *
 * Mock anatomy: mocks/UX/AI/Chatmode/end-state-09-hipaa-storage-audit.html.
 */

import React from 'react';

export type ControlStatus = 'met' | 'partial' | 'gap';

export interface ComplianceControl {
  id: string;
  name: string;
  status?: ControlStatus;
  evidence?: string;
}

export interface ComplianceFamily {
  family: string;
  controls?: ReadonlyArray<ComplianceControl>;
}

export interface ComplianceDashboardRendererProps {
  title?: string;
  framework?: string;
  subtitle?: string;
  families?: ReadonlyArray<ComplianceFamily>;
}

function statusTone(s?: ControlStatus): string {
  switch (s) {
    case 'met':
      return 'var(--cm-success, currentColor)';
    case 'partial':
      return 'var(--cm-warn, currentColor)';
    case 'gap':
      return 'var(--cm-error, currentColor)';
    default:
      return 'var(--cm-fg-dim, currentColor)';
  }
}

function statusLabel(s?: ControlStatus): string {
  switch (s) {
    case 'met':
      return 'MET';
    case 'partial':
      return 'PARTIAL';
    case 'gap':
      return 'GAP';
    default:
      return '—';
  }
}

interface FamilyCounts {
  met: number;
  partial: number;
  gap: number;
  total: number;
}

function tally(controls: ReadonlyArray<ComplianceControl>): FamilyCounts {
  let met = 0;
  let partial = 0;
  let gap = 0;
  for (const c of controls) {
    if (c.status === 'met') met++;
    else if (c.status === 'partial') partial++;
    else if (c.status === 'gap') gap++;
  }
  return { met, partial, gap, total: controls.length };
}

export function ComplianceDashboardRenderer(props: ComplianceDashboardRendererProps) {
  const { title, framework, subtitle, families } = props;
  const safe = Array.isArray(families) ? families : [];

  if (safe.length === 0) {
    return (
      <div data-testid="compliance-dashboard-renderer" style={{ color: 'var(--cm-fg-dim)', fontSize: 12 }}>
        no compliance data
      </div>
    );
  }

  const allControls = safe.flatMap((f) => f.controls ?? []);
  const overall = tally(allControls);
  const overallPct =
    overall.total === 0
      ? 0
      : Math.round(((overall.met + overall.partial * 0.5) / overall.total) * 100);

  return (
    <div
      data-testid="compliance-dashboard-renderer"
      className="cm-compliance-dashboard"
      style={{ display: 'grid', gap: 12, color: 'var(--cm-fg)' }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          gap: 12,
          alignItems: 'center',
          padding: '12px 16px',
          background: 'var(--cm-bg-2)',
          border: '1px solid var(--cm-border)',
          borderRadius: 'var(--cm-radius, 6px)',
        }}
      >
        <div>
          {title && (
            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--cm-fg)' }}>{title}</div>
          )}
          {framework && (
            <div
              style={{
                fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
                fontSize: 11,
                color: 'var(--cm-fg-dim)',
                marginTop: 2,
              }}
            >
              {framework}
            </div>
          )}
          {subtitle && (
            <div style={{ fontSize: 11, color: 'var(--cm-fg-dim)', marginTop: 2 }}>{subtitle}</div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div
            data-testid="compliance-overall-pct"
            style={{
              fontSize: 32,
              fontWeight: 700,
              fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
              color:
                overallPct >= 80
                  ? 'var(--cm-success, currentColor)'
                  : overallPct >= 50
                  ? 'var(--cm-warn, currentColor)'
                  : 'var(--cm-error, currentColor)',
            }}
          >
            {overallPct}%
          </div>
          <div
            style={{
              fontSize: 10,
              color: 'var(--cm-fg-dim)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            Overall readiness
          </div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--cm-fg-dim)',
              fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
              marginTop: 4,
            }}
          >
            met {overall.met} · partial {overall.partial} · gap {overall.gap}
          </div>
        </div>
      </div>
      {safe.map((fam, idx) => {
        const controls = fam.controls ?? [];
        const counts = tally(controls);
        return (
          <div
            key={`${fam.family}-${idx}`}
            data-family={fam.family}
            style={{
              background: 'var(--cm-bg-2)',
              border: '1px solid var(--cm-border)',
              borderRadius: 'var(--cm-radius, 6px)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '10px 14px',
                background: 'var(--cm-bg-3, var(--cm-bg-2))',
                borderBottom: '1px solid var(--cm-border)',
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: 8,
                alignItems: 'center',
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--cm-fg)' }}>
                {fam.family}
              </span>
              <span
                style={{
                  fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
                  fontSize: 11,
                  color: 'var(--cm-fg-dim)',
                }}
              >
                {counts.met} met · {counts.partial} partial · {counts.gap} gap
              </span>
            </div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {controls.map((c, i) => (
                <li
                  key={`${c.id}-${i}`}
                  data-control-id={c.id}
                  data-status={c.status ?? 'unknown'}
                  style={{
                    padding: '8px 14px',
                    borderBottom: '1px solid var(--cm-border)',
                    display: 'grid',
                    gridTemplateColumns: '70px 1fr auto',
                    gap: 10,
                    alignItems: 'center',
                    fontSize: 13,
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
                      fontSize: 12,
                      color: 'var(--cm-fg-dim)',
                    }}
                  >
                    {c.id}
                  </span>
                  <span>
                    {c.name}
                    {c.evidence && (
                      <span
                        style={{
                          display: 'block',
                          fontSize: 11.5,
                          color: 'var(--cm-fg-dim)',
                          marginTop: 2,
                        }}
                      >
                        {c.evidence}
                      </span>
                    )}
                  </span>
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: 999,
                      fontSize: 10.5,
                      fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
                      color: statusTone(c.status),
                      border: `1px solid ${statusTone(c.status)}`,
                      letterSpacing: 0.5,
                    }}
                  >
                    {statusLabel(c.status)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export default ComplianceDashboardRenderer;
