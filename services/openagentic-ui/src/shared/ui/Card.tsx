import React from 'react';

/**
 * Shared Card — M3 Expressive (task #160).
 * 20px radius (rounded-card), surface-1 background, no hard shadow —
 * tonal elevation only.
 */
export interface CardProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export const Card: React.FC<CardProps> = ({ children, className = '', style }) => {
  return (
    <div
      className={`rounded-card bg-surface-1 ${className}`}
      style={style}
    >
      {children}
    </div>
  );
};
