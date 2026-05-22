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
 * Shared card wrapper for admin console sections — M3 Expressive (task #160).
 * rounded-card (20px), surface-1 background, no visible border — tonal
 * elevation carries the separation.
 */
export const AdminCard: React.FC<AdminCardProps> = ({ children, className = '', padding = 'md' }) => (
  <div
    className={`rounded-card bg-surface-1 ${PADDING_MAP[padding]} ${className}`}
  >
    {children}
  </div>
);
