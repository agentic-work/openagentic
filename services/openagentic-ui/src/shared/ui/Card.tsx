import React from 'react';

/**
 * Shared Card — TERMINAL GLASS (elevated) re-skin.
 *
 * Reads ONLY theme tokens via the .glass-surface class in theme.css. Replaces
 * the brutalist sharp-corner + 2px-ink-border + hard offset shadow with the
 * frosted glass result-card: top-lit gradient, backdrop blur, soft 1px glass
 * border + edge highlight, soft radius, soft shadow. Prop API
 * ({ children, className, style }) is unchanged.
 */
export interface CardProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export const Card: React.FC<CardProps> = ({ children, className = '', style }) => {
  return (
    <div className={`glass-surface ${className}`} style={style}>
      {children}
    </div>
  );
};
