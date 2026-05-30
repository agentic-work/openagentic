/**
 * IncidentTimelineRenderer — compose_app:incident_timeline template.
 *
 * Vertical event timeline with severity-colored dots and a connecting
 * spine. Each event: { ts, severity, source?, message }.
 *
 * Mock anatomy: mocks/UX/AI/Chatmode/end-state-08-incident-triage.html.
 */

import React from 'react';

export type IncidentSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface IncidentEvent {
  ts: string;
  severity?: IncidentSeverity;
  source?: string;
  message: string;
}

export interface IncidentTimelineRendererProps {
  title?: string;
  subtitle?: string;
  events?: ReadonlyArray<IncidentEvent>;
}

function sevTone(s: IncidentSeverity): string {
  switch (s) {
    case 'critical':
      return 'var(--cm-error, currentColor)';
    case 'high':
      return 'var(--cm-warn, currentColor)';
    case 'medium':
      return 'var(--cm-info, currentColor)';
    case 'low':
      return 'var(--cm-success, currentColor)';
    case 'info':
    default:
      return 'var(--cm-fg-dim, currentColor)';
  }
}

export function IncidentTimelineRenderer({
  title,
  subtitle,
  events,
}: IncidentTimelineRendererProps) {
  const safe = Array.isArray(events) ? events : [];

  if (safe.length === 0) {
    return (
      <div
        data-testid="incident-timeline-renderer"
        style={{ color: 'var(--cm-fg-dim)', fontSize: 12 }}
      >
        no timeline events
      </div>
    );
  }

  return (
    <div
      data-testid="incident-timeline-renderer"
      className="cm-incident-timeline"
      style={{
        background: 'transparent',
        color: 'var(--cm-fg)',
        fontFamily: 'inherit',
        display: 'grid',
        gap: 8,
      }}
    >
      {(title || subtitle) && (
        <div style={{ marginBottom: 4 }}>
          {title && (
            <div style={{ fontWeight: 600, color: 'var(--cm-fg)', fontSize: 14 }}>{title}</div>
          )}
          {subtitle && (
            <div
              style={{
                fontSize: 11,
                color: 'var(--cm-fg-dim)',
                fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
                marginTop: 2,
              }}
            >
              {subtitle}
            </div>
          )}
        </div>
      )}
      <ol
        data-testid="incident-timeline-list"
        style={{
          position: 'relative',
          paddingLeft: 24,
          margin: 0,
          listStyle: 'none',
        }}
      >
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: 8,
            top: 4,
            bottom: 4,
            width: 2,
            background: 'var(--cm-border)',
          }}
        />
        {safe.map((e, i) => {
          const sev = (e.severity ?? 'info') as IncidentSeverity;
          const tone = sevTone(sev);
          return (
            <li
              key={`${e.ts}-${i}`}
              data-severity={sev}
              style={{
                position: 'relative',
                padding: '10px 12px 10px 18px',
                marginBottom: 8,
                background: 'var(--cm-bg-2)',
                border: '1px solid var(--cm-border)',
                borderRadius: 'var(--cm-radius, 6px)',
              }}
            >
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  left: -20,
                  top: 14,
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  background: tone,
                  border: `2px solid ${tone}`,
                  boxShadow: sev === 'critical' ? `0 0 0 4px color-mix(in srgb, ${tone} 20%, transparent)` : undefined,
                }}
              />
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr auto',
                  gap: 10,
                  alignItems: 'start',
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
                    fontSize: 12,
                    color: 'var(--cm-fg-dim)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {e.ts}
                </span>
                <span style={{ color: 'var(--cm-fg)', fontSize: 13 }}>{e.message}</span>
                {e.source && (
                  <span
                    style={{
                      fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
                      fontSize: 11,
                      color: 'var(--cm-fg-muted, var(--cm-fg-dim))',
                    }}
                  >
                    {e.source}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default IncidentTimelineRenderer;
