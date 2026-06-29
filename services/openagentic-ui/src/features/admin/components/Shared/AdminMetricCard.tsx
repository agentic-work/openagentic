import React from 'react';
import { AdminTooltip } from './AdminTooltip';
import { onKeyActivate } from '@/utils/a11y';

export interface AdminMetricCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  icon?: React.ReactNode;
  trend?: { value: number; direction: 'up' | 'down' | 'neutral' };
  tooltip?: string;
  sparklineData?: number[];
  onClick?: () => void;
  className?: string;
  loading?: boolean;
}

/**
 * GCP-style metric card with optional trend indicator and sparkline.
 * Uses CSS variables for theming - no hardcoded colors.
 */
export const AdminMetricCard: React.FC<AdminMetricCardProps> = ({
  label,
  value,
  subtext,
  icon,
  trend,
  tooltip,
  sparklineData,
  onClick,
  className = '',
  loading = false,
}) => {
  const trendColor =
    trend?.direction === 'up'
      ? 'var(--color-success)'
      : trend?.direction === 'down'
        ? 'var(--color-error)'
        : 'var(--text-tertiary)';

  const trendArrow =
    trend?.direction === 'up' ? '\u2191' : trend?.direction === 'down' ? '\u2193' : '\u2192';

  const cardClassName = `rounded-lg p-4 transition-all duration-150 ${className}`;
  const cardStyle: React.CSSProperties = {
    backgroundColor: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    cursor: onClick ? 'pointer' : undefined,
  };

  const cardBody = (
    <>
      {loading ? (
        <LoadingSkeleton />
      ) : (
        <>
          {/* Icon */}
          {icon && (
            <div
              className="mb-2"
              style={{ color: 'var(--color-primary)' }}
            >
              {icon}
            </div>
          )}

          {/* Label */}
          <div
            className="text-xs font-medium mb-1 flex items-center gap-1.5"
            style={{ color: 'var(--text-secondary)' }}
          >
            {label}
          </div>

          {/* Value + Trend row */}
          <div className="flex items-end gap-2">
            <span
              className="text-2xl font-semibold leading-none"
              style={{ color: 'var(--text-primary)' }}
            >
              {value}
            </span>

            {trend && (
              <span
                className="text-xs font-medium leading-none mb-0.5"
                style={{ color: trendColor }}
              >
                {trendArrow} {Math.abs(trend.value)}%
              </span>
            )}
          </div>

          {/* Sparkline */}
          {sparklineData && sparklineData.length > 1 && (
            <div className="mt-2">
              <Sparkline data={sparklineData} />
            </div>
          )}

          {/* Subtext */}
          {subtext && (
            <div
              className="text-xs mt-1.5"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {subtext}
            </div>
          )}
        </>
      )}
    </>
  );

  const card = onClick ? (
    <button
      type="button"
      className={`${cardClassName} text-left w-full`}
      style={cardStyle}
      onClick={onClick}
      onKeyDown={onKeyActivate(onClick)}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--color-primary)';
        e.currentTarget.style.boxShadow = '0 2px 8px color-mix(in srgb, var(--color-shadow) 10%, transparent)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--color-border)';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      {cardBody}
    </button>
  ) : (
    <div className={cardClassName} style={cardStyle}>
      {cardBody}
    </div>
  );

  if (tooltip) {
    return (
      <AdminTooltip content={tooltip} position="top">
        {card}
      </AdminTooltip>
    );
  }

  return card;
};

/**
 * Inline SVG sparkline - minimal, no library needed.
 */
const Sparkline: React.FC<{ data: number[] }> = ({ data }) => {
  const width = 120;
  const height = 24;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 2) - 1;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline
        points={points}
        fill="none"
        stroke="var(--color-primary)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

/**
 * Shimmer skeleton shown during loading state.
 */
const LoadingSkeleton: React.FC = () => (
  <div className="animate-pulse space-y-2">
    <div
      className="h-4 w-8 rounded"
      style={{ backgroundColor: 'var(--color-border)' }}
    />
    <div
      className="h-3 w-20 rounded"
      style={{ backgroundColor: 'var(--color-border)' }}
    />
    <div
      className="h-7 w-16 rounded"
      style={{ backgroundColor: 'var(--color-border)' }}
    />
    <div
      className="h-2.5 w-24 rounded"
      style={{ backgroundColor: 'var(--color-border)' }}
    />
  </div>
);
