import React from 'react';
import { clsx } from 'clsx';

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  padding?: string;
  onClick?: () => void;
  as?: keyof JSX.IntrinsicElements;
}

/**
 * GlassCard — TERMINAL GLASS (elevated) re-skin.
 *
 * Now a REAL frosted glass surface (the name finally matches): top-lit
 * gradient + backdrop blur + soft 1px glass border + top edge highlight + soft
 * radius + soft shadow, all via the token-driven .glass-surface classes in
 * theme.css. `hover` adds the glow-lift. Prop API is unchanged.
 */
const GlassCard: React.FC<GlassCardProps> = ({
  children,
  className = '',
  hover = false,
  padding = 'p-6',
  onClick,
  as = 'div',
  ...props
}) => {
  const Component = as as React.ElementType;

  const cardClasses = clsx(
    'glass-surface',
    hover && ['glass-surface-hover', onClick && 'cursor-pointer'],
    padding,
    className
  );

  return (
    <Component
      className={cardClasses}
      onClick={onClick}
      {...props}
    >
      <div className="relative z-10">
        {children}
      </div>
    </Component>
  );
};

export default GlassCard;
