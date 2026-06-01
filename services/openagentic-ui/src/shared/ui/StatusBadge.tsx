import React from 'react';

/**
 * Shared StatusBadge — TERMINAL GLASS (elevated) re-skin.
 *
 * Reads ONLY theme tokens via the .glass-status* classes in theme.css. Replaces
 * the brutalist 2px-bordered + tracked-uppercase-mono eyebrow chip with the
 * frosted glass status chip from the reference: a soft 1px glass border + top
 * edge highlight, soft radius, a faint tint of the status hue, and an
 * IBM Plex Mono technical label (mono is correct here — it reads as a metric /
 * status tag, not a heading). Prop API ({ status, children, className }) is
 * unchanged so the 12 consumers keep working.
 */
export type StatusType = 'success' | 'error' | 'warning' | 'info' | 'default';

export interface StatusBadgeProps {
  status: StatusType;
  children: React.ReactNode;
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  children,
  className = '',
}) => {
  const baseClasses = 'glass-status px-2.5 py-1';

  const variantClasses = {
    success: 'glass-status-success',
    error: 'glass-status-error',
    warning: 'glass-status-warning',
    info: 'glass-status-info',
    default: 'glass-status-default',
  };

  const badgeClasses = `${baseClasses} ${variantClasses[status]} ${className}`;

  return <span className={badgeClasses}>{children}</span>;
};

export default StatusBadge;
