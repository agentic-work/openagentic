import React from 'react';

/**
 * ToolParallelHeader — collapsed header that wraps multiple parallel
 * tool calls into a single "fan-out" group.
 *
 * Reference: mocks/UX/01-cloud-ops.html lines 900-905 (`.tool-parallel-hdr`).
 *
 * Renders a clickable bar with a fan/chevron icon, a label, and a
 * right-aligned stats cluster (total · ok · failed · wall). Click
 * toggles the group's expanded state via `onToggle`.
 */

export interface ToolParallelHeaderProps {
  /** Heading like "running 4 tools in parallel" or "4 tools · 2 failed". */
  label: string;
  /** Total count. */
  total: number;
  /** How many succeeded. */
  succeeded?: number;
  /** How many failed. */
  failed?: number;
  /** Wall-clock duration ms. */
  wallMs?: number;
  /** Click handler to expand/collapse the group. */
  onToggle?: () => void;
  /** Whether the group below is currently expanded. Drives chevron rotation. */
  expanded?: boolean;
  className?: string;
}

export const TOOL_PARALLEL_HEADER_STYLES = {
  root: {
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    gap: '10px',
    padding: '8px 12px',
    background: 'var(--cm-bg-secondary)',
    border: '1px solid var(--cm-border)',
    borderRadius: '8px',
    cursor: 'pointer',
    textAlign: 'left' as const,
  } as React.CSSProperties,
  label: {
    flex: 1,
    color: 'var(--cm-text)',
    fontSize: '13px',
    fontWeight: 500,
  } as React.CSSProperties,
  stats: {
    display: 'flex',
    gap: '12px',
    fontSize: '11px',
    color: 'var(--cm-text-muted)',
    fontFamily: 'JetBrains Mono, monospace',
    fontVariantNumeric: 'tabular-nums' as const,
  } as React.CSSProperties,
  failedStat: {
    color: 'var(--cm-error)',
  } as React.CSSProperties,
};

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function chevronStyle(expanded: boolean): React.CSSProperties {
  return {
    width: '12px',
    height: '12px',
    transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
    transition: 'transform 0.15s ease',
    flexShrink: 0,
    color: 'var(--cm-text-muted)',
  };
}

export function ToolParallelHeader({
  label,
  total,
  succeeded,
  failed,
  wallMs,
  onToggle,
  expanded,
  className,
}: ToolParallelHeaderProps): JSX.Element {
  const isExpanded = !!expanded;

  return (
    <button
      type="button"
      className={`cm-tool-parallel-hdr${className ? ` ${className}` : ''}`}
      style={{ ...TOOL_PARALLEL_HEADER_STYLES.root, background: TOOL_PARALLEL_HEADER_STYLES.root.background }}
      aria-expanded={isExpanded}
      onClick={onToggle}
    >
      {/* Chevron — same shape as ToolCard / SubAgentCard */}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        style={chevronStyle(isExpanded)}
        aria-hidden="true"
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>

      <span className="cm-tool-parallel-hdr-label" style={TOOL_PARALLEL_HEADER_STYLES.label}>
        {label}
      </span>

      <span className="cm-tool-parallel-hdr-stats" style={TOOL_PARALLEL_HEADER_STYLES.stats}>
        <span>
          {total} {total === 1 ? 'tool' : 'tools'}
        </span>
        {succeeded !== undefined && <span>{succeeded} ok</span>}
        {failed !== undefined && failed > 0 && (
          <span style={TOOL_PARALLEL_HEADER_STYLES.failedStat}>{failed} failed</span>
        )}
        {wallMs !== undefined && <span>{fmtMs(wallMs)}</span>}
      </span>
    </button>
  );
}
