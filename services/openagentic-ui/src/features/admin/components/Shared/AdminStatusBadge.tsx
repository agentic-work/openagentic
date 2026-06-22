import React from 'react';

export interface AdminStatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
  showDot?: boolean;
  className?: string;
}

type ColorVar = 'success' | 'warning' | 'error' | 'neutral';

const STATUS_MAP: Record<string, ColorVar> = {
  healthy: 'success',
  active: 'success',
  running: 'success',
  completed: 'success',
  success: 'success',
  ready: 'success',
  enabled: 'success',
  connected: 'success',

  warning: 'warning',
  pending: 'warning',
  suspended: 'warning',
  degraded: 'warning',
  starting: 'warning',
  queued: 'warning',

  error: 'error',
  failed: 'error',
  critical: 'error',
  unhealthy: 'error',
  disconnected: 'error',
  down: 'error',

  unknown: 'neutral',
  deleted: 'neutral',
  cancelled: 'neutral',
  disabled: 'neutral',
  stopped: 'neutral',
  inactive: 'neutral',
};

const COLOR_VARS: Record<ColorVar, string> = {
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  error: 'var(--color-error)',
  neutral: 'var(--text-tertiary)',
};

/**
 * Standardized status badge with colored dot + label.
 * Maps common status strings to semantic colors automatically.
 */
export const AdminStatusBadge: React.FC<AdminStatusBadgeProps> = ({
  status,
  size = 'md',
  showDot = true,
  className = '',
}) => {
  const colorKey = STATUS_MAP[status.toLowerCase()] || 'neutral';
  const color = COLOR_VARS[colorKey];

  const isSm = size === 'sm';

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-medium rounded-full ${className}`}
      style={{
        padding: isSm ? '1px 8px' : '2px 10px',
        fontSize: isSm ? 'var(--text-xs, 11px)' : 'var(--text-sm, 12px)',
        backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
        color,
      }}
    >
      {showDot && (
        <span
          className="rounded-full flex-shrink-0"
          style={{
            width: isSm ? 5 : 6,
            height: isSm ? 5 : 6,
            backgroundColor: color,
          }}
        />
      )}
      {status}
    </span>
  );
};
