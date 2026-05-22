/**
 * Phase G (task #152) — `retry` event renderer.
 *
 * Yellow-tinted pill that appears on a tool card when the tool-execution
 * helper re-runs a call after a timeout. Wire contract:
 *
 *   {attempt:number, maxAttempts:number, reason:string, elapsedMs:number,
 *    toolCallId?:string, name?:string}
 *
 * Visual mirrors the `.pill.retry` + `.retry` classes from the v0.6.7 UX
 * mockup. Non-interactive — purely informational.
 */
import React, { memo } from 'react';

export interface RetryPillProps {
  attempt: number;
  maxAttempts: number;
  reason?: string | null;
  elapsedMs?: number | null;
  name?: string | null;
}

const RetryIcon = () => (
  <svg
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    aria-hidden="true"
  >
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);

const RetryPillComponent: React.FC<RetryPillProps> = ({
  attempt,
  maxAttempts,
  reason,
  elapsedMs,
  name,
}) => {
  const toolLabel = name ? name : 'tool';
  const elapsedSec =
    typeof elapsedMs === 'number' && Number.isFinite(elapsedMs) && elapsedMs > 0
      ? `${(elapsedMs / 1000).toFixed(1)}s`
      : null;

  return (
    <span
      data-testid="retry-pill"
      data-attempt={attempt}
      data-max-attempts={maxAttempts}
      role="status"
      aria-live="polite"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 9px',
        borderRadius: 99,
        background: 'rgba(245,158,11,0.08)',
        border: '1px solid rgba(245,158,11,0.28)',
        fontSize: 11,
        color: '#fcd34d',
        fontFamily: 'JetBrains Mono, monospace',
        lineHeight: 1,
      }}
    >
      <RetryIcon />
      <span style={{ fontWeight: 600 }}>
        Retry {attempt}/{maxAttempts}
      </span>
      <span style={{ color: '#a1a1aa' }}>
        · re-executing {toolLabel}
        {elapsedSec ? ` (${elapsedSec})` : null}
        ...
      </span>
      {reason && (
        <span
          style={{
            color: '#71717a',
            fontFamily: 'Inter, sans-serif',
            marginLeft: 4,
            maxWidth: 200,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={reason}
        >
          · {reason}
        </span>
      )}
    </span>
  );
};

export const RetryPill = memo(RetryPillComponent);
RetryPill.displayName = 'RetryPill';
