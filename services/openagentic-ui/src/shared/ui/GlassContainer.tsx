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
  // NEO-BRUTALIST panel/surface — token-driven. Variants map to elevation
  // tiers via the surface ramp + hard offset shadow; all carry the 2px ink
  // border + sharp corners. Reads ONLY theme tokens.
  const variantClasses = {
    subtle: 'rounded-none border-2 border-rule bg-bg text-fg',
    medium: 'rounded-none border-2 border-rule-strong bg-surface text-fg shadow-hard-sm',
    strong: 'rounded-none border-2 border-rule-strong bg-surface-2 text-fg shadow-hard',
  };

  const paddingClasses = {
    xs: 'p-2',
    sm: 'p-3',
    md: 'p-6',
    lg: 'p-8',
    xl: 'p-12',
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