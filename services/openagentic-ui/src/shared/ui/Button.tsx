import React from 'react';

/**
 * Shared Button — M3 Expressive (task #160).
 *
 *   primary    pill-shaped, filled with accent, white label
 *   secondary  rounded-btn (12px), surface-1, raises to surface-2 on hover
 *   ghost      no background, same radius as secondary
 *   danger     pill, filled red
 *
 * All variants share:
 *   - font-weight 500, tracking -0.01em (from global button rule)
 *   - transition on bg/border/shadow/transform at 200ms ease-emphasized
 *   - active:scale-[0.98] press feedback (150ms)
 *   - focus-visible: soft focus ring at 50% primary
 */
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  children: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  children,
  className = '',
  disabled,
  ...props
}) => {
  const baseClasses = [
    'inline-flex items-center justify-center font-medium',
    'transition-[background,border,box-shadow,transform,color]',
    'duration-200 ease-emphasized',
    'active:scale-[0.98]',
    'focus-visible:outline-none focus-visible:shadow-focus-ring',
  ].join(' ');

  // primary + danger get pill (full-round), secondary/ghost get the softer
  // 12px "btn" radius — keeps them visually grouped with toolbars.
  const shapeClass =
    variant === 'primary' || variant === 'danger' ? 'rounded-pill' : 'rounded-btn';

  const variantClasses = {
    primary:
      'bg-accent-primary text-white hover:brightness-110 disabled:opacity-50',
    secondary:
      'bg-surface-1 text-text-primary border border-border-primary hover:bg-surface-2 disabled:opacity-50',
    ghost:
      'text-text-primary hover:bg-surface-1 disabled:opacity-50',
    danger:
      'bg-error text-white hover:brightness-110 disabled:opacity-50',
  };

  // Pill buttons get more horizontal padding for optical balance.
  const isPill = shapeClass === 'rounded-pill';
  const sizeClasses = {
    xs: isPill ? 'px-3 py-1 text-xs' : 'px-2 py-1 text-xs',
    sm: isPill ? 'px-4 py-1.5 text-sm' : 'px-3 py-1.5 text-sm',
    md: isPill ? 'px-6 py-2 text-sm' : 'px-4 py-2 text-sm',
    lg: isPill ? 'px-8 py-2.5 text-base' : 'px-6 py-2.5 text-base',
  };

  const buttonClasses = [
    baseClasses,
    shapeClass,
    variantClasses[variant],
    sizeClasses[size],
    disabled ? 'cursor-not-allowed' : '',
    className,
  ].join(' ');

  return (
    <button className={buttonClasses} disabled={disabled} {...props}>
      {children}
    </button>
  );
};
