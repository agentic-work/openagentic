import React from 'react';

export interface GlassContainerProps {
  children: React.ReactNode;
  variant?: 'subtle' | 'medium' | 'strong';
  padding?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  onClick?: () => void;
  as?: keyof JSX.IntrinsicElements;
}

export const GlassContainer: React.FC<GlassContainerProps> = ({
  children,
  variant = 'medium',
  padding = 'md',
  className = '',
  onClick,
  as: Component = 'div',
}) => {
  const variantClasses = {
    subtle: 'bg-bg-primary border border-border-primary/50',
    medium: 'bg-bg-secondary border border-border-primary',
    strong: 'bg-bg-tertiary border border-border-secondary'
  };

  const paddingClasses = {
    xs: 'p-xs',
    sm: 'p-sm',
    md: 'p-md',
    lg: 'p-lg',
    xl: 'p-xl'
  };

  const containerClasses = `${variantClasses[variant]} ${paddingClasses[padding]} ${className}`;

  return React.createElement(
    Component,
    {
      className: containerClasses,
      onClick,
    },
    children
  );
};

export default GlassContainer;