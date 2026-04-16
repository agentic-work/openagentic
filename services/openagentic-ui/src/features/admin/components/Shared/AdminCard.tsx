import React from 'react';

export interface AdminCardProps {
  children: React.ReactNode;
  className?: string;
  padding?: 'sm' | 'md' | 'lg';
}

const PADDING_MAP = {
  sm: 'p-3',
  md: 'p-5',
  lg: 'p-6',
} as const;

/**
 * Shared card wrapper for admin console sections.
 * Consistent rounded-lg, surface bg, border. Use everywhere instead of inline Card components.
 */
export const AdminCard: React.FC<AdminCardProps> = ({ children, className = '', padding = 'md' }) => (
  <div
    className={`rounded-lg ${PADDING_MAP[padding]} ${className}`}
    style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
  >
    {children}
  </div>
);
