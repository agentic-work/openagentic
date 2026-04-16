import React from 'react';

export interface CardProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export const Card: React.FC<CardProps> = ({ children, className = '', style }) => {
  return (
    <div className={`rounded-lg border-primary bg-primary shadow-sm ${className}`} style={style}>
      {children}
    </div>
  );
};