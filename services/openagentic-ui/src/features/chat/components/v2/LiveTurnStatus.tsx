/**
 * LiveTurnStatus — chatmode live status strip (mirrors codemode footer).
 *
 * One inline line under the streaming assistant avatar that shows:
 *   [elapsed] · ↑ in · ↓ out · {ttft} · {activity summary}
 *
 * Mirrors openagentic/src/components/Spinner/SpinnerAnimationRow.tsx.
 * Ticks every 1s while isStreaming. Freezes when streaming ends so the
 * final summary persists on the message.
 */

import { useEffect, useState } from 'react';

interface Props {
  /** ms timestamp when the user submitted the turn. null = no active turn. */
  turnStartedAt: number | null;
  /** ms timestamp of the first text/thinking delta. null = no first token yet. */
  firstTokenAt: number | null;
  /** input tokens (from message_received / usage frame). */
  tokensIn: number;
  /** output tokens (running approximation; final from usage frame). */
  tokensOut: number;
  /** human-readable summary of what the model is doing right now. */
  activitySummary: string;
  /** when false the elapsed counter freezes at the last tick. */
  isStreaming: boolean;
}

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) return `${sec}s`;
  return `${min}m ${sec}s`;
}

function formatTtft(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTokens(n: number): string {
  return n.toLocaleString('en-US');
}

export function LiveTurnStatus(props: Props) {
  const { turnStartedAt, firstTokenAt, tokensIn, tokensOut, activitySummary, isStreaming } = props;
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!isStreaming) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [isStreaming]);

  if (turnStartedAt == null) return null;

  // When streaming stops, freeze elapsed at the moment of stop.
  // We capture the freeze-time once via a closure on the first render
  // after isStreaming flips false.
  const elapsedReference = isStreaming ? now : Math.max(now, turnStartedAt);
  const elapsedMs = elapsedReference - turnStartedAt;
  const elapsedText = formatElapsed(elapsedMs);

  const ttftMs = firstTokenAt != null ? firstTokenAt - turnStartedAt : null;

  return (
    <div
      className="cm-v2 cm-live-turn-status"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '6px',
        fontSize: '11px',
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        color: 'var(--mw-fg-3, #71717a)',
        margin: '4px 0 6px 0',
      }}
    >
      <span data-testid="live-turn-elapsed" title="Elapsed time on this turn">
        {elapsedText}
      </span>
      <span style={{ opacity: 0.5 }}>·</span>
      {/* Sev-0 2026-05-08 UX clarity:
       *
       * Pre-TTFT (firstTokenAt == null) → DON'T show "↑ 0 ↓ 0" because the
       * 0/0 looks like a frozen counter and gives no signal whether the
       * model is doing work. Show "waiting for first token · reasoning"
       * instead so the user knows the model is server-side reasoning and
       * tokens haven't started streaming yet.
       *
       * Post-TTFT → show ↑ in / ↓ out + the persistent "TTFT N.Ns" badge
       * so the user can see exactly when generation kicked in.
       */}
      {ttftMs == null && isStreaming ? (
        <span
          data-testid="live-turn-pretoken"
          title="Model is reasoning server-side; no tokens have streamed yet"
          style={{
            color: 'var(--mw-fg-2, #a1a1aa)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              display: 'inline-block',
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: 'var(--mw-info, #38bdf8)',
              animation: 'openagentic-tts-pulse 1.4s ease-in-out infinite',
            }}
          />
          waiting for first token
        </span>
      ) : (
        <>
          <span data-testid="live-turn-tokens" title="Tokens used (input ↑ / output ↓)">
            <span style={{ color: 'var(--mw-info, #38bdf8)', fontWeight: 600 }}>↑</span>{' '}
            {formatTokens(tokensIn)}{' '}
            <span style={{ color: 'var(--mw-success, #22c55e)', fontWeight: 600, marginLeft: '6px' }}>
              ↓
            </span>{' '}
            {formatTokens(tokensOut)}
          </span>
          {ttftMs != null && (
            <>
              <span style={{ opacity: 0.5 }}>·</span>
              <span
                data-testid="live-turn-ttft"
                title="Time to first token — generation start"
                style={{
                  color: 'var(--mw-success, #22c55e)',
                  fontWeight: 600,
                }}
              >
                TTFT {formatTtft(ttftMs)}
              </span>
            </>
          )}
        </>
      )}
      {activitySummary && (
        <>
          <span style={{ opacity: 0.5 }}>·</span>
          <span
            data-testid="live-turn-activity"
            style={{
              color: 'var(--mw-fg-2, #a1a1aa)',
              fontStyle: 'italic',
              maxWidth: '420px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {activitySummary}
          </span>
        </>
      )}
    </div>
  );
}

export default LiveTurnStatus;
