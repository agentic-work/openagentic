/**
 * Phase G (task #152) — `warning` event renderer.
 *
 * Compact iconified pill for soft warnings that land at the top of a
 * message. Levels map to colour:
 *
 *   info  → sky/info blue
 *   warn  → amber (default)
 *   error → red
 *
 * Wire contract: `{level?, source?, code?, message, actionable?}`.
 * When actionable is present, a small "→ {actionable}" link hint is
 * rendered at the end of the pill.
 */
import React, { memo } from 'react';

export type WarningLevel = 'info' | 'warn' | 'error';

export interface WarningPillProps {
  level?: WarningLevel;
  source?: string | null;
  code?: string | null;
  message: string;
  actionable?: string | null;
}

const LEVEL_STYLES: Record<WarningLevel, {
  color: string;
  bg: string;
  border: string;
}> = {
  info: {
    color: 'var(--cm-info)',
    bg: 'color-mix(in srgb, var(--cm-info) 8%, transparent)',
    border: 'color-mix(in srgb, var(--cm-info) 28%, transparent)',
  },
  warn: {
    color: 'var(--cm-warning)',
    bg: 'color-mix(in srgb, var(--cm-warning) 8%, transparent)',
    border: 'color-mix(in srgb, var(--cm-warning) 28%, transparent)',
  },
  error: {
    color: 'var(--cm-error)',
    bg: 'color-mix(in srgb, var(--cm-error) 8%, transparent)',
    border: 'color-mix(in srgb, var(--cm-error) 28%, transparent)',
  },
};

const InfoIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

const WarnIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const ErrorIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <line x1="15" y1="9" x2="9" y2="15" />
    <line x1="9" y1="9" x2="15" y2="15" />
  </svg>
);

const WarningPillComponent: React.FC<WarningPillProps> = ({
  level = 'warn',
  source,
  code,
  message,
  actionable,
}) => {
  const styles = LEVEL_STYLES[level] ?? LEVEL_STYLES.warn;
  const Icon = level === 'info' ? InfoIcon : level === 'error' ? ErrorIcon : WarnIcon;

  return (
    <span
      data-testid="warning-pill"
      data-level={level}
      data-source={source || undefined}
      data-code={code || undefined}
      role={level === 'error' ? 'alert' : 'status'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 9px',
        borderRadius: 99,
        background: styles.bg,
        border: `1px solid ${styles.border}`,
        fontSize: 11,
        color: styles.color,
        fontFamily: 'Inter, sans-serif',
        lineHeight: 1.3,
        maxWidth: 520,
      }}
    >
      <Icon />
      {source && (
        <span
          style={{
            color: styles.color,
            opacity: 0.7,
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 10,
          }}
        >
          {source}
        </span>
      )}
      <span style={{ color: 'var(--cm-text-secondary)' }}>{message}</span>
      {actionable && (
        <span
          style={{
            color: styles.color,
            opacity: 0.8,
            marginLeft: 2,
            fontSize: 11,
          }}
        >
          → {actionable}
        </span>
      )}
    </span>
  );
};

export const WarningPill = memo(WarningPillComponent);
WarningPill.displayName = 'WarningPill';
