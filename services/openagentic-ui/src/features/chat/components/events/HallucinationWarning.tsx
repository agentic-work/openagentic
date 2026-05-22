/**
 * Phase G (task #152) — `hallucination_warning` event renderer.
 *
 * Red warning pill shown when the response completeness / hallucination
 * checker flags the assistant's output. Wire contract may include
 * `{confidence?, warnings?, toolCount?, revised?, message?}`.
 *
 * When `revised` is true the response has already been auto-corrected
 * (self_critique completed), so the pill is informational. When false
 * the pill is a user-facing "may contain inaccuracies" flag.
 */
import React, { memo } from 'react';

export interface HallucinationWarningProps {
  confidence?: number | null;
  message?: string | null;
  warningCount?: number | null;
  revised?: boolean;
  toolCount?: number | null;
}

const AlertIcon = () => (
  <svg
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const HallucinationWarningComponent: React.FC<HallucinationWarningProps> = ({
  confidence,
  message,
  warningCount,
  revised,
  toolCount,
}) => {
  const confidenceLabel =
    typeof confidence === 'number' && Number.isFinite(confidence)
      ? `${(confidence * 100).toFixed(0)}% confidence`
      : null;
  const defaultMsg = revised
    ? 'Initial response had flagged inaccuracies — auto-revised against tool output.'
    : 'The response may contain inaccuracies. Verify against the tool output.';

  return (
    <div
      data-testid="hallucination-warning"
      data-confidence={confidence ?? undefined}
      data-revised={revised ? 'true' : undefined}
      role="alert"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        borderRadius: 8,
        border: '1px solid rgba(239,68,68,0.28)',
        background: 'rgba(239,68,68,0.06)',
        fontSize: 12,
        color: '#fca5a5',
        margin: '6px 0',
        maxWidth: 620,
      }}
    >
      <AlertIcon />
      <span style={{ fontWeight: 600, color: '#f8fafc' }}>
        {revised ? 'Auto-corrected' : 'Possible inaccuracy'}
      </span>
      <span style={{ color: '#a1a1aa' }}>· {message || defaultMsg}</span>
      {(confidenceLabel || typeof warningCount === 'number' || typeof toolCount === 'number') && (
        <span
          style={{
            color: '#71717a',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 11,
            marginLeft: 4,
          }}
        >
          {[
            confidenceLabel,
            typeof warningCount === 'number' ? `${warningCount} flag(s)` : null,
            typeof toolCount === 'number' ? `${toolCount} tool(s)` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      )}
    </div>
  );
};

export const HallucinationWarning = memo(HallucinationWarningComponent);
HallucinationWarning.displayName = 'HallucinationWarning';
