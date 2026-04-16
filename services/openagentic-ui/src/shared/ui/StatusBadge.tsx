import React from 'react';

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
  const baseClasses = 'inline-flex items-center px-2 py-1 rounded-md text-xs font-medium';

  const variantClasses = {
    success: 'bg-success/10 text-success border border-success/20',
    error: 'bg-error/10 text-error border border-error/20',
    warning: 'bg-warning/10 text-warning border border-warning/20',
    info: 'bg-info/10 text-info border border-info/20',
    default: 'bg-bg-secondary text-text-secondary border border-border-primary'
  };

  const badgeClasses = `${baseClasses} ${variantClasses[status]} ${className}`;

  return <span className={badgeClasses}>{children}</span>;
};

export default StatusBadge;