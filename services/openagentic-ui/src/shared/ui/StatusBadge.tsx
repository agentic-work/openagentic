import React from 'react';

/**
 * Shared StatusBadge — NEO-BRUTALIST field-guide restyle.
 *
 * Reads ONLY theme tokens. A tracked mono eyebrow label (.eyebrow) inside a
 * 2px-bordered chip with a soft tint of the status hue. Near-sharp corners
 * (rounded-chip). Prop API ({ status, children, className }) is unchanged so
 * the 12 consumers keep working.
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
  const baseClasses =
    'eyebrow inline-flex items-center px-2 py-1 rounded-chip border-2';

  const variantClasses = {
    success: 'bg-ok/15 text-ok border-ok/40',
    error: 'bg-err/15 text-err border-err/40',
    warning: 'bg-warn/15 text-warn border-warn/40',
    info: 'bg-nfo/15 text-nfo border-nfo/40',
    default: 'bg-surface text-fg-muted border-rule',
  };

  const badgeClasses = `${baseClasses} ${variantClasses[status]} ${className}`;

  return <span className={badgeClasses}>{children}</span>;
};

export default StatusBadge;
