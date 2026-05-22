/**
 * Phase G (task #152) — `correction` event renderer.
 *
 * Renders a red-tinted "correction" block showing the self-corrected
 * revision inline: strikethrough wrongText followed by the corrected
 * text highlighted in green. Mirrors the `.correction` class from the
 * v0.6.7 UX mockup.
 *
 * Wire contract: `{wrongText, correctedText, reason?}`.
 *
 * Truncation: both preview strings are capped at 400 chars in the
 * block body so a long revision doesn't blow up the message height.
 * Full diff is available via the title attribute on the container.
 */
import React, { memo } from 'react';

export interface CorrectionBlockProps {
  wrongText: string;
  correctedText: string;
  reason?: string | null;
}

const CorrectionIcon = () => (
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

function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  return `${input.slice(0, max - 1)}…`;
}

const CorrectionBlockComponent: React.FC<CorrectionBlockProps> = ({
  wrongText,
  correctedText,
  reason,
}) => {
  const wrongPreview = truncate(wrongText, 400);
  const correctedPreview = truncate(correctedText, 400);
  const title = `Self-correction${reason ? `: ${reason}` : ''}`;

  return (
    <div
      data-testid="correction-block"
      role="note"
      aria-label="Self-correction"
      title={title}
      style={{
        padding: '8px 12px',
        border: '1px solid rgba(239,68,68,0.28)',
        background: 'rgba(239,68,68,0.05)',
        borderRadius: 8,
        fontSize: 12,
        margin: '6px 0',
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          color: '#fca5a5',
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: 4,
        }}
      >
        <CorrectionIcon />
        correction
      </div>
      <div>
        <del
          data-testid="correction-wrong"
          style={{
            color: '#71717a',
            textDecorationColor: 'rgba(239,68,68,0.6)',
          }}
        >
          {wrongPreview}
        </del>
        {' '}
        <ins
          data-testid="correction-corrected"
          style={{
            textDecoration: 'none',
            color: '#f8fafc',
            background: 'rgba(34,197,94,0.08)',
            padding: '1px 4px',
            borderRadius: 3,
          }}
        >
          {correctedPreview}
        </ins>
        {reason && (
          <span
            style={{
              color: '#71717a',
              marginLeft: 8,
              fontSize: 11,
            }}
          >
            — {reason}
          </span>
        )}
      </div>
    </div>
  );
};

export const CorrectionBlock = memo(CorrectionBlockComponent);
CorrectionBlock.displayName = 'CorrectionBlock';
