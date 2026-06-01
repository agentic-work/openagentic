import React from 'react';

/**
 * Shared Button — NEO-BRUTALIST field-guide restyle.
 *
 * Reads ONLY theme tokens (no raw color/font literals). The brutalist
 * signatures, all token-driven:
 *   - 2px solid ink border (border-rule-strong)
 *   - hard offset shadow, ZERO blur (shadow-hard-sm), tightening to
 *     shadow-hard-xs on press with a 2px translate
 *   - SHARP corners (rounded-none) on primary/danger; small radius on
 *     secondary/ghost so they read as chrome
 *   - IBM Plex Mono (font-mono) UPPERCASE label, tracked via .btn-label
 *   - signal-orange primary (bg-accent / text-on-accent)
 *
 * Prop API is unchanged (variant / size / standard button attrs) so no
 * consumer breaks.
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
    'inline-flex items-center justify-center',
    // IBM Plex Mono uppercase tracked label (token-baked in .btn-label)
    'btn-label',
    // 2px ink border on every variant — the #2 brutalist signature
    'border-2 border-rule-strong',
    'transition-[background,border,box-shadow,transform,color]',
    'duration-100',
    // hard zero-blur offset shadow → tighter shadow + 2px nudge on press
    'shadow-hard-sm active:shadow-hard-xs active:translate-x-[2px] active:translate-y-[2px]',
    'focus-visible:outline-none focus-visible:shadow-signal',
    'disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-hard-xs',
  ].join(' ');

  // SHARP corners on primary/danger (the loud, brutalist CTAs); a hair of
  // radius on secondary/ghost so dense toolbars stay legible.
  const shapeClass =
    variant === 'primary' || variant === 'danger' ? 'rounded-none' : 'rounded-sm';

  const variantClasses = {
    primary: 'bg-accent text-on-accent hover:brightness-105',
    secondary: 'bg-surface text-fg hover:bg-surface-2',
    ghost: 'bg-transparent text-fg hover:bg-surface',
    danger: 'bg-err text-on-accent hover:brightness-105',
  };

  const sizeClasses = {
    xs: 'px-3 py-1 text-xs',
    sm: 'px-4 py-1.5 text-sm',
    md: 'px-6 py-2 text-sm',
    lg: 'px-8 py-2.5 text-base',
  };

  const buttonClasses = [
    baseClasses,
    shapeClass,
    variantClasses[variant],
    sizeClasses[size],
    className,
  ].join(' ');

  return (
    <button className={buttonClasses} disabled={disabled} {...props}>
      {children}
    </button>
  );
};
