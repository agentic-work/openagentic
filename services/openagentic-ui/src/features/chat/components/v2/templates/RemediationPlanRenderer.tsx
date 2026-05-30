/**
 * RemediationPlanRenderer — compose_app:remediation_plan template.
 *
 * Phased checklist with overall progress bar. Each phase has actions
 * { action, owner, eta, status, notes? } where status ∈
 * todo|in_progress|done|blocked.
 *
 * Mock anatomy: mocks/UX/AI/Chatmode/end-state-09-hipaa-storage-audit.html,
 * mocks/UX/AI/Chatmode/end-state-02-enterprise-multi-tenant-audit.html.
 */

import React from 'react';

export type RemediationStatus = 'todo' | 'in_progress' | 'done' | 'blocked';

export interface RemediationAction {
  action: string;
  owner?: string;
  eta?: string;
  status?: RemediationStatus;
  notes?: string;
}

export interface RemediationPhase {
  phase: string;
  actions?: ReadonlyArray<RemediationAction>;
}

export interface RemediationPlanRendererProps {
  title?: string;
  subtitle?: string;
  phases?: ReadonlyArray<RemediationPhase>;
}

function statusTone(s?: RemediationStatus): string {
  switch (s) {
    case 'done':
      return 'var(--cm-success, currentColor)';
    case 'in_progress':
      return 'var(--cm-accent, currentColor)';
    case 'blocked':
      return 'var(--cm-error, currentColor)';
    case 'todo':
    default:
      return 'var(--cm-fg-dim, currentColor)';
  }
}

function statusLabel(s?: RemediationStatus): string {
  switch (s) {
    case 'done':
      return 'done';
    case 'in_progress':
      return 'in progress';
    case 'blocked':
      return 'blocked';
    case 'todo':
    default:
      return 'todo';
  }
}

export function RemediationPlanRenderer({
  title,
  subtitle,
  phases,
}: RemediationPlanRendererProps) {
  const safe = Array.isArray(phases) ? phases : [];

  if (safe.length === 0) {
    return (
      <div data-testid="remediation-plan-renderer" style={{ color: 'var(--cm-fg-dim)', fontSize: 12 }}>
        no remediation plan
      </div>
    );
  }

  const allActions = safe.flatMap((p) => p.actions ?? []);
  const done = allActions.filter((a) => a.status === 'done').length;
  const progressPct = allActions.length === 0 ? 0 : Math.round((done / allActions.length) * 100);

  return (
    <div
      data-testid="remediation-plan-renderer"
      className="cm-remediation-plan"
      style={{ display: 'grid', gap: 12, color: 'var(--cm-fg)' }}
    >
      {(title || subtitle) && (
        <div>
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
      <div
        data-testid="remediation-progress"
        style={{
          background: 'var(--cm-bg-2)',
          border: '1px solid var(--cm-border)',
          borderRadius: 'var(--cm-radius, 6px)',
          padding: '12px 16px',
          display: 'grid',
          gap: 6,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            fontSize: 12,
            color: 'var(--cm-fg-dim)',
          }}
        >
          <span>{done} of {allActions.length} actions complete</span>
          <span
            style={{
              fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
              color: 'var(--cm-fg)',
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            {progressPct}%
          </span>
        </div>
        <div
          style={{
            height: 8,
            background: 'var(--cm-bg-3, var(--cm-bg-2))',
            borderRadius: 4,
            overflow: 'hidden',
            border: '1px solid var(--cm-border)',
          }}
        >
          <div
            data-testid="remediation-progress-bar"
            style={{
              height: '100%',
              width: `${progressPct}%`,
              background: 'var(--cm-success, var(--cm-accent, currentColor))',
              transition: 'width 200ms ease',
            }}
          />
        </div>
      </div>
      {safe.map((p, idx) => (
        <div
          key={`${p.phase}-${idx}`}
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
            {p.phase}
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {(p.actions ?? []).map((a, i) => (
              <li
                key={`${p.phase}-${i}`}
                data-status={a.status ?? 'todo'}
                style={{
                  padding: '8px 14px',
                  borderBottom: '1px solid var(--cm-border)',
                  display: 'grid',
                  gridTemplateColumns: '14px 1fr auto auto',
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
                    borderRadius: '50%',
                    background: statusTone(a.status),
                  }}
                />
                <span>
                  {a.action}
                  {a.notes && (
                    <span
                      style={{
                        display: 'block',
                        fontSize: 11.5,
                        color: 'var(--cm-fg-dim)',
                        marginTop: 2,
                      }}
                    >
                      {a.notes}
                    </span>
                  )}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
                    fontSize: 11,
                    padding: '2px 8px',
                    borderRadius: 999,
                    border: `1px solid ${statusTone(a.status)}`,
                    color: statusTone(a.status),
                  }}
                >
                  {statusLabel(a.status)}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
                    fontSize: 11,
                    color: 'var(--cm-fg-dim)',
                    minWidth: 88,
                    textAlign: 'right',
                  }}
                >
                  {a.owner ?? '—'}
                  {a.eta && (
                    <>
                      {' · '}
                      {a.eta}
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export default RemediationPlanRenderer;
