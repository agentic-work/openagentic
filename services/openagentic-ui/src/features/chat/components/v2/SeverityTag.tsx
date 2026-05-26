import React from 'react';

/**
 * SeverityTag — small inline severity pill (ok / warn / err / info).
 *
 * Used inside table cells, prose, and status rows. Reference:
 * mocks/UX/01-cloud-ops.html lines 1015-1071 (e.g.
 * <span class="sev sev-warn">D4s_v5</span>).
 *
 * Inline styles to avoid stylesheet collisions during the parallel v2
 * chatmode rebuild — keep the contract self-contained.
 */

export type Severity = 'ok' | 'warn' | 'err' | 'info';

export interface SeverityTagProps {
  severity: Severity;
  children: React.ReactNode;
  className?: string;
}

const BASE_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '2px 8px',
  borderRadius: '4px',
  fontSize: '11px',
  fontWeight: 500,
  fontVariantNumeric: 'tabular-nums',
  lineHeight: 1.4,
};

export const SEVERITY_TAG_STYLES: Record<Severity, React.CSSProperties> = {
  ok: {
    ...BASE_STYLE,
    background: 'color-mix(in srgb, var(--cm-success) 14%, transparent)',
    color: 'var(--cm-success)',
    border: '1px solid color-mix(in srgb, var(--cm-success) 32%, transparent)',
  },
  warn: {
    ...BASE_STYLE,
    background: 'color-mix(in srgb, var(--cm-warning) 14%, transparent)',
    color: 'var(--cm-warning)',
    border: '1px solid color-mix(in srgb, var(--cm-warning) 32%, transparent)',
  },
  err: {
    ...BASE_STYLE,
    background: 'color-mix(in srgb, var(--cm-error) 14%, transparent)',
    color: 'var(--cm-error)',
    border: '1px solid color-mix(in srgb, var(--cm-error) 32%, transparent)',
  },
  info: {
    ...BASE_STYLE,
    background: 'color-mix(in srgb, var(--cm-info) 14%, transparent)',
    color: 'var(--cm-info)',
    border: '1px solid color-mix(in srgb, var(--cm-info) 32%, transparent)',
  },
};

export function SeverityTag({
  severity,
  children,
  className,
}: SeverityTagProps): JSX.Element {
  const cls = ['cm-sev', `cm-sev-${severity}`, className].filter(Boolean).join(' ');
  return (
    <span className={cls} style={SEVERITY_TAG_STYLES[severity]}>
      {children}
    </span>
  );
}
