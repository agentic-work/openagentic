/**
 * RootCauseCardRenderer — compose_app:root_cause_card template.
 *
 * RCA card with hypothesis, evidence list, confidence dial, and
 * next-steps checklist.
 *
 * Mock anatomy: mocks/UX/AI/Chatmode/end-state-05-troubleshoot-fix-build-validate.html,
 * mocks/UX/AI/Chatmode/end-state-08-incident-triage.html.
 */

import React from 'react';

export interface RootCauseEvidence {
  source: string;
  detail: string;
  link?: string;
}

export interface RootCauseStep {
  action: string;
  owner?: string;
}

export interface RootCauseCardRendererProps {
  title?: string;
  scope?: string;
  hypothesis?: string;
  evidence?: ReadonlyArray<RootCauseEvidence>;
  confidence?: number;
  next_steps?: ReadonlyArray<RootCauseStep>;
}

function confTone(c: number): string {
  if (c >= 80) return 'var(--cm-success, currentColor)';
  if (c >= 60) return 'var(--cm-warn, currentColor)';
  return 'var(--cm-error, currentColor)';
}

export function RootCauseCardRenderer(props: RootCauseCardRendererProps) {
  const { title, scope, hypothesis, evidence, confidence, next_steps } = props;
  const safeEvidence = Array.isArray(evidence) ? evidence : [];
  const safeSteps = Array.isArray(next_steps) ? next_steps : [];
  const conf = typeof confidence === 'number' ? Math.max(0, Math.min(100, confidence)) : null;

  if (!hypothesis && safeEvidence.length === 0) {
    return (
      <div data-testid="root-cause-card-renderer" style={{ color: 'var(--cm-fg-dim)', fontSize: 12 }}>
        no root cause data
      </div>
    );
  }

  const card: React.CSSProperties = {
    padding: '14px 16px',
    background: 'var(--cm-bg-2)',
    border: '1px solid var(--cm-border)',
    borderRadius: 'var(--cm-radius, 6px)',
    color: 'var(--cm-fg)',
  };

  return (
    <div
      data-testid="root-cause-card-renderer"
      className="cm-root-cause-card"
      style={{ display: 'grid', gap: 12 }}
    >
      <div
        style={{
          ...card,
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          gap: 12,
          alignItems: 'center',
        }}
      >
        <div>
          {title && (
            <div style={{ fontWeight: 600, fontSize: 16, color: 'var(--cm-fg)' }}>{title}</div>
          )}
          {scope && (
            <div
              style={{
                fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
                fontSize: 11,
                color: 'var(--cm-fg-dim)',
                marginTop: 2,
              }}
            >
              {scope}
            </div>
          )}
        </div>
        {conf !== null && (
          <div data-testid="root-cause-confidence" style={{ textAlign: 'right', minWidth: 110 }}>
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
                color: confTone(conf),
              }}
            >
              {conf}%
            </div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--cm-fg-dim)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              Confidence
            </div>
          </div>
        )}
      </div>
      {hypothesis && (
        <div style={card}>
          <div
            style={{
              fontSize: 11,
              color: 'var(--cm-fg-dim)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              marginBottom: 6,
            }}
          >
            Hypothesis
          </div>
          <div style={{ fontSize: 14, color: 'var(--cm-fg)', lineHeight: 1.5 }}>{hypothesis}</div>
        </div>
      )}
      {safeEvidence.length > 0 && (
        <div
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
              color: 'var(--cm-fg)',
              fontWeight: 600,
              fontSize: 13,
              borderBottom: '1px solid var(--cm-border)',
            }}
          >
            Evidence ({safeEvidence.length})
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {safeEvidence.map((e, i) => (
              <li
                key={`ev-${i}`}
                style={{
                  padding: '8px 14px',
                  borderBottom: '1px solid var(--cm-border)',
                  display: 'grid',
                  gridTemplateColumns: '140px 1fr',
                  gap: 10,
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
                  {e.source}
                </span>
                <span style={{ color: 'var(--cm-fg)' }}>
                  {e.detail}
                  {e.link && (
                    <a
                      href={e.link}
                      style={{ marginLeft: 8, color: 'var(--cm-accent, currentColor)' }}
                      target="_blank"
                      rel="noreferrer"
                    >
                      ↗
                    </a>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {safeSteps.length > 0 && (
        <div
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
              color: 'var(--cm-fg)',
              fontWeight: 600,
              fontSize: 13,
              borderBottom: '1px solid var(--cm-border)',
            }}
          >
            Next steps ({safeSteps.length})
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {safeSteps.map((s, i) => (
              <li
                key={`s-${i}`}
                style={{
                  padding: '8px 14px',
                  borderBottom: '1px solid var(--cm-border)',
                  display: 'grid',
                  gridTemplateColumns: '14px 1fr auto',
                  gap: 10,
                  alignItems: 'center',
                  fontSize: 13,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    border: '1.5px solid var(--cm-fg-dim)',
                  }}
                />
                <span style={{ color: 'var(--cm-fg)' }}>{s.action}</span>
                {s.owner && (
                  <span
                    style={{
                      fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
                      fontSize: 11,
                      color: 'var(--cm-fg-dim)',
                    }}
                  >
                    {s.owner}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default RootCauseCardRenderer;
