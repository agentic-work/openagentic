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
    // Solid surface - NO glassmorphism
    'bg-[var(--color-surface)]',
    'border border-[var(--color-border)]',
    'rounded-xl',
    'shadow-[var(--color-shadow)]',

    // Transition - snappy, not sluggish
    'transition-all duration-150',

    // Hover effects (if enabled)
    hover && [
      'hover:bg-[var(--color-surfaceHover)]',
      'hover:border-[var(--color-borderHover)]',
      'hover:shadow-lg',
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
