import React from 'react';

/**
 * Shared Card — NEO-BRUTALIST field-guide restyle.
 *
 * Reads ONLY theme tokens. Sharp corners (rounded-none), 2px solid ink
 * border (border-rule-strong), surface background, and the hard zero-blur
 * offset shadow (shadow-hard) — the field-guide "card sitting on paper"
 * motif. Prop API ({ children, className, style }) is unchanged.
 */
export interface CardProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export const Card: React.FC<CardProps> = ({ children, className = '', style }) => {
  return (
    <div
      className={`rounded-none border-2 border-rule-strong bg-surface text-fg shadow-hard ${className}`}
      style={style}
    >
      {children}
    </div>
  );
};
