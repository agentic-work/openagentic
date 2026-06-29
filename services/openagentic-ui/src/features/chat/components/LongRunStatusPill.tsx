/**
 * LongRunStatusPill — Sev-1 #923
 *
 * Long-running prompts (4-5 min capstone drives of enterprise prompts on
 * Sonnet 4.6) push the assistant message header — and the ThinkingSphere
 * indicator inside it — out of the viewport. With the composer area pinned
 * to the bottom and the activity stream scrolled, the user has no way to
 * tell whether the agent is still working or has stalled.
 *
 * This pill lives INSIDE the composer container (NOT a floating bottom-
 * center element — that pattern was ripped in #667 because it competed
 * with short-response UX). It only surfaces after the stream has been
 * active for 30+ seconds, so sub-30s responses stay clean.
 *
 * Theme-token compliant: var(--cm-*) and var(--cm-accent) only. No hex,
 * rgb(), or named colors. CLAUDE.md rule 8(b).
 */

import React, { useEffect, useState } from 'react';

interface LongRunStatusPillProps {
  isStreaming: boolean;
  streamStartedAt: number | null;
  modelLabel?: string;
  outputTokens?: number;
  status?: string;
}

const VISIBILITY_THRESHOLD_MS = 30_000;

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export const LongRunStatusPill: React.FC<LongRunStatusPillProps> = ({
  isStreaming,
  streamStartedAt,
  modelLabel,
  outputTokens,
  status = 'running',
}) => {
  // Tick once per second to refresh the elapsed display. We use a state
  // counter (not a useRef) so React re-renders even when other props are
  // stable across ticks.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isStreaming || streamStartedAt == null) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [isStreaming, streamStartedAt]);

  if (!isStreaming || streamStartedAt == null) return null;

  const elapsedMs = Date.now() - streamStartedAt;
  if (elapsedMs < VISIBILITY_THRESHOLD_MS) return null;

  const elapsedLabel = formatElapsed(elapsedMs);
  const modelText = modelLabel?.trim() ? modelLabel : 'model';
  const tokensText =
    typeof outputTokens === 'number' && outputTokens > 0
      ? `${outputTokens.toLocaleString()} tok`
      : null;

  return (
    <>
      <style>{`
        @keyframes long-run-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.35; transform: scale(0.85); }
        }
      `}</style>
      <div
        data-testid="long-run-status-pill"
        role="status"
        aria-live="polite"
        aria-label={`${modelText} still running, elapsed ${elapsedLabel}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          height: '24px',
          padding: '0 12px',
          borderRadius: '9999px',
          border: '1px solid var(--cm-line-2)',
          background: 'var(--cm-bg-1)',
          color: 'var(--cm-fg-1)',
          fontSize: '12px',
          lineHeight: '1',
          whiteSpace: 'nowrap',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: 'inline-block',
            width: '8px',
            height: '8px',
            borderRadius: '9999px',
            background: 'var(--cm-accent)',
            animation: 'long-run-pulse 1.4s ease-in-out infinite',
          }}
        />
        <span data-testid="long-run-status-pill-model">{modelText}</span>
        <span aria-hidden="true" style={{ opacity: 0.5 }}>·</span>
        <span data-testid="long-run-status-pill-elapsed">{elapsedLabel}</span>
        {tokensText && (
          <>
            <span aria-hidden="true" style={{ opacity: 0.5 }}>·</span>
            <span data-testid="long-run-status-pill-tokens">{tokensText} ↓</span>
          </>
        )}
        <span aria-hidden="true" style={{ opacity: 0.5 }}>·</span>
        <span data-testid="long-run-status-pill-status">{status}</span>
      </div>
    </>
  );
};

export default LongRunStatusPill;
