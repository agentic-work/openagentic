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
    background: 'rgba(34,197,94,0.14)',
    color: '#22c55e',
    border: '1px solid rgba(34,197,94,0.32)',
  },
  warn: {
    ...BASE_STYLE,
    background: 'rgba(245,158,11,0.14)',
    color: '#f59e0b',
    border: '1px solid rgba(245,158,11,0.32)',
  },
  err: {
    ...BASE_STYLE,
    background: 'rgba(239,68,68,0.14)',
    color: '#ef4444',
    border: '1px solid rgba(239,68,68,0.32)',
  },
  info: {
    ...BASE_STYLE,
    background: 'rgba(56,189,248,0.14)',
    color: '#38bdf8',
    border: '1px solid rgba(56,189,248,0.32)',
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
