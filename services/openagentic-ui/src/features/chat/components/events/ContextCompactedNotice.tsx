/**
 * Phase H (task #153) — `context_compacted` event renderer.
 *
 * The backend already emits `context_compacted` when
 * ContextManagementService silently trims a session near the model's
 * context window. This component gives it a dedicated inline render
 * instead of the generic notification the pre-Phase-H code used. Shape
 * matches the v0.6.7 UX mockup: a tiny violet "↯" lightning glyph plus
 * "Trimmed 12,847 tokens (14 messages summarized)".
 *
 * Wire contract: `{freedPercent:number, tokensFreed:number,
 * messagesRemoved:number, messagesSummarized?:number,
 * compactionLevel:string, reason?:string}`.
 */
import React, { memo } from 'react';

export interface ContextCompactedNoticeProps {
  tokensBefore?: number | null;
  tokensAfter?: number | null;
  tokensFreed: number;
  messagesRemoved: number;
  messagesSummarized?: number | null;
  reason?: string | null;
  compactionLevel?: string | null;
}

const LightningIcon = () => (
  <svg
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    aria-hidden="true"
  >
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const InfoIcon = () => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12" y2="8" />
  </svg>
);

function formatTokens(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (n < 1000) return `${Math.round(n)}`;
  return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`.replace('.0k', 'k');
}

const ContextCompactedNoticeComponent: React.FC<ContextCompactedNoticeProps> = ({
  tokensBefore,
  tokensAfter,
  tokensFreed,
  messagesRemoved,
  messagesSummarized,
  reason,
  compactionLevel,
}) => {
  const summarized = messagesSummarized ?? 0;
  const tokensLabel = formatTokens(tokensFreed);
  const messagesLabel = summarized > 0
    ? `${summarized} messages summarized`
    : `${messagesRemoved} messages trimmed`;
  const tooltip = [
    reason ? `Reason: ${reason}` : null,
    compactionLevel ? `Level: ${compactionLevel}` : null,
    typeof tokensBefore === 'number'
      ? `Before: ${formatTokens(tokensBefore)} tokens`
      : null,
    typeof tokensAfter === 'number'
      ? `After: ${formatTokens(tokensAfter)} tokens`
      : null,
  ].filter(Boolean).join(' · ');

  return (
    <span
      data-testid="context-compacted-notice"
      data-tokens-freed={tokensFreed}
      data-messages-removed={messagesRemoved}
      role="status"
      aria-live="polite"
      title={tooltip || undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 10px',
        borderRadius: 99,
        background: 'rgba(139,92,246,0.08)',
        border: '1px solid rgba(139,92,246,0.28)',
        fontSize: 11,
        color: '#d4d4d8',
        fontFamily: 'JetBrains Mono, monospace',
        lineHeight: 1,
      }}
    >
      <span style={{ color: '#a78bfa' }}>
        <LightningIcon />
      </span>
      <span style={{ fontWeight: 600, color: '#a78bfa' }}>
        Trimmed {tokensLabel} tokens
      </span>
      <span style={{ color: '#71717a', fontFamily: 'Inter, sans-serif' }}>
        ({messagesLabel})
      </span>
      {tooltip && (
        <span
          style={{ color: '#71717a', display: 'inline-flex', alignItems: 'center' }}
          aria-label="more info"
        >
          <InfoIcon />
        </span>
      )}
    </span>
  );
};

export const ContextCompactedNotice = memo(ContextCompactedNoticeComponent);
ContextCompactedNotice.displayName = 'ContextCompactedNotice';
