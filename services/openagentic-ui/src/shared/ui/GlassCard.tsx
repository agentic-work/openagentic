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
    // Solid brutalist surface — token-driven (no glassmorphism; the name is
    // retained for API stability)
    'bg-surface text-fg',
    'border-2 border-rule-strong',
    'rounded-none',
    'shadow-hard',

    // Transition - snappy, not sluggish
    'transition-all duration-150',

    // Hover lifts the hard offset shadow
    hover && [
      'hover:bg-surface-2',
      'hover:shadow-hard-lg',
      onClick && 'cursor-pointer',
    ],

    // Padding
    padding,

    // Custom classes
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
