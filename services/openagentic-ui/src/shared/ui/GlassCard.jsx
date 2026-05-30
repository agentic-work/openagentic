import React from 'react';
import classNames from 'classnames';

const GlassCard = ({ 
  children, 
  className = '', 
  hover = false,
  padding = 'p-6',
  onClick,
  as = 'div',
  ...props 
}) => {
  const Component = as;
  
  const cardClasses = classNames(
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
