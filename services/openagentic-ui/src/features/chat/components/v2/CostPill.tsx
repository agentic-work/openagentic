import React from 'react';

/**
 * CostPill — running cost pill for tool / sub-agent headers.
 *
 * Reference: mocks/UX/01-cloud-ops.html line 811
 * <span class="cost-pill done" aria-label="Total cost $0.058">.
 *
 * `done=true` → muted fg/bg; default `done=false` → purple-accent
 * "running" pill. Cost rendered with 3-decimal monospace ($0.058).
 *
 * Inline styles to avoid stylesheet collisions during the parallel v2
 * chatmode rebuild.
 */

export interface CostPillProps {
  /** Cost in USD (e.g. 0.058). Formatted to 3 decimals with $ prefix. */
  costUsd: number;
  /** When true, pill renders in "done" muted style. When false, "running" accent. */
  done?: boolean;
  /** Optional ARIA label override. */
  ariaLabel?: string;
  className?: string;
}

const BASE_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '2px 8px',
  borderRadius: '999px',
  fontSize: '11px',
  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
  fontVariantNumeric: 'tabular-nums',
  fontWeight: 500,
};

const DONE_STYLE: React.CSSProperties = {
  ...BASE_STYLE,
  background: 'var(--cm-bg-tertiary)',
  color: 'var(--cm-text-secondary)',
  border: '1px solid var(--cm-border)',
};

const RUNNING_STYLE: React.CSSProperties = {
  ...BASE_STYLE,
  background: 'color-mix(in srgb, var(--cm-accent) 14%, transparent)',
  color: 'var(--cm-accent)',
  border: '1px solid color-mix(in srgb, var(--cm-accent) 32%, transparent)',
};

export function CostPill({
  costUsd,
  done = false,
  ariaLabel,
  className,
}: CostPillProps): JSX.Element {
  const formatted = `$${costUsd.toFixed(3)}`;
  const variant = done ? 'done' : 'running';
  const cls = ['cm-cost-pill', `cm-cost-pill-${variant}`, className]
    .filter(Boolean)
    .join(' ');
  return (
    <span
      className={cls}
      style={done ? DONE_STYLE : RUNNING_STYLE}
      aria-label={ariaLabel ?? `Total cost ${formatted}`}
    >
      {formatted}
    </span>
  );
}
