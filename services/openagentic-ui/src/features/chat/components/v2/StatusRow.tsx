import React from 'react';

/**
 * StatusRow — horizontal flex row of label / value status items.
 * Mock 01 reference: `mocks/UX/01-cloud-ops.html` lines 818-895
 * (`<div class="status-row">` blocks). Each item may carry an optional
 * leading icon, a monospace value, and a severity tone (ok/warn/err/info).
 *
 * v2 chatmode primitive (#502). Inline styles to dodge stylesheet
 * collisions during the parallel rebuild.
 */

export type StatusRowSeverity = 'ok' | 'warn' | 'err' | 'info';

export interface StatusRowItem {
  /** Optional leading icon as ReactNode (typically a small SVG or emoji). */
  icon?: React.ReactNode;
  /** Main label. */
  label: string;
  /** Optional value rendered after label in monospace. */
  value?: string;
  /** Optional severity tone applied via inline style. */
  severity?: StatusRowSeverity;
}

export interface StatusRowProps {
  items: StatusRowItem[];
  className?: string;
}

const ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '12px',
  padding: '8px 0',
  fontSize: '12px',
  color: 'var(--fg-2, #a1a1aa)',
};

const ITEM_BASE_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
};

const ICON_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
};

const LABEL_BASE_STYLE: React.CSSProperties = {
  color: 'var(--fg-2, #a1a1aa)',
};

const VALUE_BASE_STYLE: React.CSSProperties = {
  color: 'var(--fg-1, #d4d4d8)',
  fontFamily: 'JetBrains Mono, monospace',
  fontVariantNumeric: 'tabular-nums',
  fontWeight: 500,
};

// #873 (2026-05-15) — Rule 8(b): theme tokens via var(--cm-*).
// No hardcoded hex/rgb in renderers; the canonical status tokens
// resolve to the user's selected accent + theme variant at runtime.
const SEVERITY_COLOR: Record<StatusRowSeverity, string> = {
  ok: 'var(--cm-ok)',
  warn: 'var(--cm-warn)',
  err: 'var(--cm-err)',
  info: 'var(--cm-info)',
};

export function StatusRow({ items, className }: StatusRowProps): JSX.Element {
  const cls = ['cm-status-row', className].filter(Boolean).join(' ');
  return (
    <div className={cls} style={ROW_STYLE}>
      {items.map((item, idx) => {
        const sev = item.severity;
        const sevColor = sev ? SEVERITY_COLOR[sev] : undefined;
        const itemCls = ['cm-sr-item', sev ? `cm-sr-sev-${sev}` : '']
          .filter(Boolean)
          .join(' ');
        const itemStyle: React.CSSProperties = {
          ...ITEM_BASE_STYLE,
          ...(sevColor ? { color: sevColor } : {}),
        };
        const labelStyle: React.CSSProperties = sevColor
          ? { ...LABEL_BASE_STYLE, color: sevColor }
          : LABEL_BASE_STYLE;
        const valueStyle: React.CSSProperties = sevColor
          ? { ...VALUE_BASE_STYLE, color: sevColor }
          : VALUE_BASE_STYLE;
        return (
          <span key={idx} className={itemCls} style={itemStyle}>
            {item.icon !== undefined && item.icon !== null && (
              <span className="cm-sr-icon" style={ICON_STYLE}>
                {item.icon}
              </span>
            )}
            <span className="cm-sr-label" style={labelStyle}>
              {item.label}
            </span>
            {item.value !== undefined && (
              <span className="cm-sr-value" style={valueStyle}>
                {item.value}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
