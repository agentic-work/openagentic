import React from 'react';

export interface GlassContainerProps {
  children: React.ReactNode;
  variant?: 'subtle' | 'medium' | 'strong';
  padding?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  onClick?: () => void;
  as?: keyof JSX.IntrinsicElements;
}

/**
 * GlassContainer — TERMINAL GLASS (elevated) re-skin.
 *
 * Token-driven frosted panel via the .glass-surface* classes in theme.css.
 * Variants map to elevation tiers in the glass language:
 *   - subtle  → faint frosted fill, no blur (inline chrome)
 *   - medium  → the standard frosted glass card (blur + soft shadow)
 *   - strong  → frosted glass with the deep panel shadow
 * Reads ONLY theme tokens. Prop API unchanged.
 */
export const GlassContainer: React.FC<GlassContainerProps> = ({
  children,
  variant = 'medium',
  padding = 'md',
  className = '',
  onClick,
  as: Component = 'div',
}) => {
  const variantClasses = {
    subtle: 'glass-surface glass-surface-subtle',
    medium: 'glass-surface',
    strong: 'glass-surface glass-surface-strong',
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
