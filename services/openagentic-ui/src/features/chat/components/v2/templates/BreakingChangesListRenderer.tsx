/**
 * BreakingChangesListRenderer — compose_app:breaking_changes_list template.
 *
 * Vertical list of breaking changes with severity badges and optional
 * migration hint per item. Sorted by severity (critical→major→minor).
 *
 * Mock anatomy: mocks/UX/AI/Chatmode/end-state-05-troubleshoot-fix-build-validate.html.
 */

import React, { useMemo } from 'react';

export type BreakingSeverity = 'critical' | 'major' | 'minor';

export interface BreakingChange {
  package: string;
  version: string;
  change_summary: string;
  migration_hint?: string;
  severity?: BreakingSeverity;
}

export interface BreakingChangesListRendererProps {
  title?: string;
  subtitle?: string;
  changes?: ReadonlyArray<BreakingChange>;
}

const SEV_ORDER: Record<BreakingSeverity, number> = { critical: 0, major: 1, minor: 2 };

function sevTone(s?: BreakingSeverity): string {
  switch (s) {
    case 'critical':
      return 'var(--cm-error, currentColor)';
    case 'major':
      return 'var(--cm-warn, currentColor)';
    case 'minor':
      return 'var(--cm-info, currentColor)';
    default:
      return 'var(--cm-fg-dim, currentColor)';
  }
}

export function BreakingChangesListRenderer(props: BreakingChangesListRendererProps) {
  const { title, subtitle, changes } = props;
  const safe = Array.isArray(changes) ? changes : [];

  const sorted = useMemo(() => {
    const copy = [...safe];
    copy.sort(
      (a, b) =>
        (SEV_ORDER[(a.severity ?? 'major') as BreakingSeverity] ?? 99) -
        (SEV_ORDER[(b.severity ?? 'major') as BreakingSeverity] ?? 99),
    );
    return copy;
  }, [safe]);

  if (safe.length === 0) {
    return (
      <div data-testid="breaking-changes-list-renderer" style={{ color: 'var(--cm-fg-dim)', fontSize: 12 }}>
        no breaking changes
      </div>
    );
  }

  return (
    <div
      data-testid="breaking-changes-list-renderer"
      className="cm-breaking-changes-list"
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
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
        {sorted.map((c, i) => {
          const sev = (c.severity ?? 'major') as BreakingSeverity;
          const tone = sevTone(sev);
          return (
            <li
              key={`${c.package}-${i}`}
              data-package={c.package}
              data-severity={sev}
              style={{
                padding: '10px 12px',
                background: 'var(--cm-bg-2)',
                border: '1px solid var(--cm-border)',
                borderLeft: `3px solid ${tone}`,
                borderRadius: 'var(--cm-radius, 6px)',
                display: 'grid',
                gap: 6,
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: 8,
                  alignItems: 'baseline',
                }}
              >
                <span style={{ color: 'var(--cm-fg)', fontWeight: 600, fontSize: 13 }}>
                  {c.package}{' '}
                  <span
                    style={{
                      fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
                      color: 'var(--cm-fg-dim)',
                      fontWeight: 400,
                    }}
                  >
                    {c.version}
                  </span>
                </span>
                <span
                  data-testid="breaking-severity-pill"
                  style={{
                    padding: '2px 8px',
                    borderRadius: 999,
                    fontSize: 10.5,
                    fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    color: tone,
                    border: `1px solid ${tone}`,
                  }}
                >
                  {sev}
                </span>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--cm-fg)' }}>{c.change_summary}</div>
              {c.migration_hint && (
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--cm-fg-dim)',
                    background: 'var(--cm-bg-3, var(--cm-bg-2))',
                    border: '1px solid var(--cm-border)',
                    borderRadius: 4,
                    padding: '6px 8px',
                  }}
                >
                  <strong style={{ color: 'var(--cm-fg)' }}>Migration:</strong> {c.migration_hint}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default BreakingChangesListRenderer;
