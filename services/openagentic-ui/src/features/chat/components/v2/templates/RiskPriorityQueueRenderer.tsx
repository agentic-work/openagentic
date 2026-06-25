/**
 * RiskPriorityQueueRenderer — compose_app:risk_priority_queue template.
 *
 * Ranked risk list sorted by priority_score (or impact × probability)
 * descending. Top item highlighted.
 *
 * Mock anatomy: mocks/UX/AI/Chatmode/end-state-02-enterprise-multi-tenant-audit.html,
 * mocks/UX/AI/Chatmode/end-state-09-hipaa-storage-audit.html.
 */

import React, { useMemo } from 'react';

export type RiskStatus = 'new' | 'accepted' | 'mitigated' | 'closed';

export interface RiskRow {
  id: string;
  title: string;
  impact: number;
  probability: number;
  priority_score?: number;
  owner?: string;
  eta?: string;
  status?: RiskStatus;
}

export interface RiskPriorityQueueRendererProps {
  title?: string;
  subtitle?: string;
  risks?: ReadonlyArray<RiskRow>;
}

function scoreTone(score: number): string {
  if (score >= 60) return 'var(--cm-error, currentColor)';
  if (score >= 30) return 'var(--cm-warn, currentColor)';
  return 'var(--cm-success, currentColor)';
}

function statusTone(s?: RiskStatus): string {
  switch (s) {
    case 'new':
      return 'var(--cm-fg-dim, currentColor)';
    case 'accepted':
      return 'var(--cm-warn, currentColor)';
    case 'mitigated':
      return 'var(--cm-info, currentColor)';
    case 'closed':
      return 'var(--cm-success, currentColor)';
    default:
      return 'var(--cm-fg-dim, currentColor)';
  }
}

export function RiskPriorityQueueRenderer(props: RiskPriorityQueueRendererProps) {
  const { title, subtitle, risks } = props;
  const safe = Array.isArray(risks) ? risks : [];

  const ranked = useMemo(() => {
    return safe
      .map((r) => ({
        ...r,
        _score:
          typeof r.priority_score === 'number'
            ? r.priority_score
            : Math.round((r.impact ?? 0) * (r.probability ?? 0)),
      }))
      .sort((a, b) => b._score - a._score);
  }, [safe]);

  if (ranked.length === 0) {
    return (
      <div data-testid="risk-priority-queue-renderer" style={{ color: 'var(--cm-fg-dim)', fontSize: 12 }}>
        no risks
      </div>
    );
  }

  return (
    <div
      data-testid="risk-priority-queue-renderer"
      className="cm-risk-priority-queue"
      style={{ display: 'grid', gap: 8, color: 'var(--cm-fg)' }}
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
      <div style={{ display: 'grid', gap: 6 }}>
        {ranked.map((r, i) => {
          const tone = scoreTone(r._score);
          return (
            <div
              key={r.id}
              data-risk-id={r.id}
              data-rank={i + 1}
              data-top={i === 0 ? '1' : '0'}
              style={{
                display: 'grid',
                gridTemplateColumns: '40px 1fr 56px 56px 60px 110px 110px 90px',
                gap: 10,
                padding: '10px 12px',
                background: 'var(--cm-bg-2)',
                border:
                  i === 0
                    ? '1px solid var(--cm-error, currentColor)'
                    : '1px solid var(--cm-border)',
                borderRadius: 'var(--cm-radius, 6px)',
                alignItems: 'center',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
                  fontSize: 16,
                  textAlign: 'center',
                  color: i === 0 ? 'var(--cm-error, currentColor)' : 'var(--cm-accent, currentColor)',
                  fontWeight: 700,
                }}
              >
                #{i + 1}
              </div>
              <div>
                <div style={{ fontSize: 13, color: 'var(--cm-fg)' }}>{r.title}</div>
                <div
                  style={{
                    fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
                    fontSize: 11,
                    color: 'var(--cm-fg-dim)',
                    marginTop: 2,
                  }}
                >
                  {r.id}
                </div>
              </div>
              <div
                style={{
                  fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
                  fontSize: 13,
                  textAlign: 'center',
                  color: 'var(--cm-fg)',
                }}
                title="impact"
              >
                I{r.impact}
              </div>
              <div
                style={{
                  fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
                  fontSize: 13,
                  textAlign: 'center',
                  color: 'var(--cm-fg)',
                }}
                title="probability"
              >
                P{r.probability}
              </div>
              <div
                data-testid="risk-priority-score"
                style={{
                  fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
                  fontSize: 14,
                  fontWeight: 600,
                  textAlign: 'center',
                  padding: '4px 6px',
                  borderRadius: 6,
                  color: tone,
                  background: `color-mix(in srgb, ${tone} 18%, transparent)`,
                }}
              >
                {r._score}
              </div>
              <div
                style={{
                  fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
                  fontSize: 12,
                  color: 'var(--cm-fg-dim)',
                }}
              >
                {r.owner ?? '—'}
              </div>
              <div
                style={{
                  fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
                  fontSize: 12,
                  color: 'var(--cm-fg-dim)',
                }}
              >
                {r.eta ?? '—'}
              </div>
              <div
                style={{
                  padding: '3px 10px',
                  borderRadius: 999,
                  fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
                  fontSize: 11,
                  textAlign: 'center',
                  color: statusTone(r.status),
                  border: `1px solid ${statusTone(r.status)}`,
                }}
              >
                {r.status ?? 'new'}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default RiskPriorityQueueRenderer;
