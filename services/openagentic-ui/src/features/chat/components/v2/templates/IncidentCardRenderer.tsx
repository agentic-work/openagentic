/**
 * IncidentCardRenderer — compose_app:incident_card template.
 *
 * Single-incident summary card with severity pill, status, owner, impact,
 * related alerts list.
 *
 * Mock anatomy: mocks/UX/AI/Chatmode/end-state-08-incident-triage.html.
 */

import React from 'react';

export type IncidentCardSeverity = 'critical' | 'high' | 'medium' | 'low';
export type IncidentCardStatus = 'open' | 'investigating' | 'mitigated' | 'resolved';

export interface IncidentRelatedAlert {
  id: string;
  name: string;
  fired_at?: string;
}

export interface IncidentCardRendererProps {
  id?: string;
  title?: string;
  severity?: IncidentCardSeverity;
  opened_at?: string;
  owner?: string;
  status?: IncidentCardStatus;
  impact?: string;
  related_alerts?: ReadonlyArray<IncidentRelatedAlert>;
  summary?: string;
}

function sevTone(s?: IncidentCardSeverity): string {
  switch (s) {
    case 'critical':
      return 'var(--cm-error, currentColor)';
    case 'high':
      return 'var(--cm-warn, currentColor)';
    case 'medium':
      return 'var(--cm-info, currentColor)';
    case 'low':
      return 'var(--cm-success, currentColor)';
    default:
      return 'var(--cm-fg-dim, currentColor)';
  }
}

function statusTone(s?: IncidentCardStatus): string {
  switch (s) {
    case 'open':
      return 'var(--cm-error, currentColor)';
    case 'investigating':
      return 'var(--cm-warn, currentColor)';
    case 'mitigated':
      return 'var(--cm-info, currentColor)';
    case 'resolved':
      return 'var(--cm-success, currentColor)';
    default:
      return 'var(--cm-fg-dim, currentColor)';
  }
}

export function IncidentCardRenderer(props: IncidentCardRendererProps) {
  const { id, title, severity, opened_at, owner, status, impact, related_alerts, summary } = props;

  if (!title && !id && !summary) {
    return (
      <div data-testid="incident-card-renderer" style={{ color: 'var(--cm-fg-dim)', fontSize: 12 }}>
        no incident data
      </div>
    );
  }

  const card: React.CSSProperties = {
    background: 'var(--cm-bg-2)',
    border: '1px solid var(--cm-border)',
    borderRadius: 'var(--cm-radius, 6px)',
    overflow: 'hidden',
  };
  const head: React.CSSProperties = {
    padding: '14px 16px',
    borderBottom: '1px solid var(--cm-border)',
    display: 'grid',
    gridTemplateColumns: 'auto 1fr auto',
    gap: 12,
    alignItems: 'center',
  };
  const idCss: React.CSSProperties = {
    fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
    fontSize: 12,
    color: 'var(--cm-fg-dim)',
  };
  const titleCss: React.CSSProperties = {
    color: 'var(--cm-fg)',
    fontSize: 16,
    fontWeight: 600,
  };
  const sevPill = (s?: IncidentCardSeverity): React.CSSProperties => ({
    padding: '4px 10px',
    borderRadius: 999,
    fontSize: 11,
    fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: sevTone(s),
    border: `1px solid ${sevTone(s)}`,
  });
  const body: React.CSSProperties = {
    padding: 16,
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 14,
  };
  const dt: React.CSSProperties = {
    fontSize: 11,
    color: 'var(--cm-fg-dim)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    marginBottom: 2,
  };
  const dd: React.CSSProperties = {
    fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
    fontSize: 13,
    color: 'var(--cm-fg)',
    margin: 0,
  };
  const alertItem: React.CSSProperties = {
    padding: '6px 8px',
    background: 'var(--cm-bg-3, var(--cm-bg-2))',
    border: '1px solid var(--cm-border)',
    borderRadius: 4,
    display: 'grid',
    gridTemplateColumns: 'auto 1fr auto',
    gap: 8,
    alignItems: 'center',
    fontSize: 12,
  };

  return (
    <div data-testid="incident-card-renderer" className="cm-incident-card" style={card}>
      <div style={head}>
        {id && <span style={idCss}>{id}</span>}
        <span style={titleCss}>{title ?? '(untitled incident)'}</span>
        {severity && (
          <span data-testid="incident-severity-pill" style={sevPill(severity)}>
            {severity}
          </span>
        )}
      </div>
      <div style={body}>
        <div>
          <div style={dt}>Status</div>
          <p
            style={{
              ...dd,
              color: statusTone(status),
            }}
          >
            {status ?? '—'}
          </p>
        </div>
        <div>
          <div style={dt}>Owner</div>
          <p style={dd}>{owner ?? '—'}</p>
        </div>
        <div>
          <div style={dt}>Opened</div>
          <p style={dd}>{opened_at ?? '—'}</p>
        </div>
        <div>
          <div style={dt}>Impact</div>
          <p style={{ ...dd, fontFamily: 'inherit', fontSize: 13 }}>{impact ?? '—'}</p>
        </div>
        {summary && (
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={dt}>Summary</div>
            <p style={{ ...dd, fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5 }}>{summary}</p>
          </div>
        )}
        {related_alerts && related_alerts.length > 0 && (
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={dt}>Related alerts ({related_alerts.length})</div>
            <div style={{ display: 'grid', gap: 6 }}>
              {related_alerts.map((a) => (
                <div key={a.id} style={alertItem}>
                  <span
                    style={{
                      fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
                      color: 'var(--cm-fg-dim)',
                    }}
                  >
                    {a.id}
                  </span>
                  <span style={{ color: 'var(--cm-fg)' }}>{a.name}</span>
                  {a.fired_at && (
                    <span
                      style={{
                        fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
                        color: 'var(--cm-fg-muted, var(--cm-fg-dim))',
                      }}
                    >
                      {a.fired_at}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default IncidentCardRenderer;
