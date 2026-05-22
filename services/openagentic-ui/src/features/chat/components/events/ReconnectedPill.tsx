/**
 * Phase I (task #154) — `resume_exhausted` / durable-stream reconnect pill.
 *
 * Small "↻ Reconnected" chip that renders for 2s after `useChatStream`
 * successfully resumes a dropped stream via `GET /api/chat/stream/:s/tail`.
 * Visual language mirrors the other Phase G/H pills:
 *
 *   ↻  Reconnected  · 428 frames replayed
 *
 * Non-interactive. The hook auto-dismisses the pill after 2s by
 * clearing `reconnectedPill` state; this component renders purely
 * from its props.
 *
 * Contract: the `at` prop is the timestamp the pill was created so
 * MessageBubble can key on it (ensures a second reconnect within the
 * same turn re-runs the CSS animation instead of no-op'ing).
 */
import React, { memo } from 'react';

export interface ReconnectedPillProps {
  /** Timestamp (Date.now()) when the pill was triggered. Used as React key. */
  at: number;
  /** Optional count — how many frames /tail replayed. */
  framesReplayed?: number;
  /** Optional last _seq the client is now caught up to. */
  lastSeq?: number;
}

const ReconnectIcon = () => (
  <svg
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    aria-hidden="true"
  >
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <polyline points="3 4 3 10 9 10" />
  </svg>
);

const ReconnectedPillComponent: React.FC<ReconnectedPillProps> = ({
  at,
  framesReplayed,
  lastSeq,
}) => {
  const suffixParts: string[] = [];
  if (typeof framesReplayed === 'number' && framesReplayed > 0) {
    suffixParts.push(`${framesReplayed} frame${framesReplayed === 1 ? '' : 's'} replayed`);
  }
  if (typeof lastSeq === 'number' && lastSeq > 0) {
    suffixParts.push(`seq ${lastSeq}`);
  }
  const suffix = suffixParts.join(' · ');

  return (
    <span
      key={at}
      data-testid="reconnected-pill"
      data-at={at}
      role="status"
      aria-live="polite"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 9px',
        borderRadius: 99,
        background: 'rgba(34,197,94,0.10)',
        border: '1px solid rgba(34,197,94,0.28)',
        fontSize: 11,
        color: '#86efac',
        fontFamily: 'JetBrains Mono, monospace',
        lineHeight: 1,
        animation: 'reconnected-pill-pulse 0.35s ease-out',
      }}
    >
      <ReconnectIcon />
      <span style={{ fontWeight: 600 }}>Reconnected</span>
      {suffix && (
        <span
          style={{
            color: '#a1a1aa',
            fontFamily: 'Inter, sans-serif',
            marginLeft: 4,
          }}
        >
          · {suffix}
        </span>
      )}
    </span>
  );
};

export const ReconnectedPill = memo(ReconnectedPillComponent);
ReconnectedPill.displayName = 'ReconnectedPill';
