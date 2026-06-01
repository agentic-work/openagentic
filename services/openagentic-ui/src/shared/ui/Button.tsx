import React from 'react';

/**
 * Shared Button — TERMINAL GLASS (elevated) re-skin.
 *
 * Reads ONLY theme tokens via the .glass-btn* classes in theme.css (no raw
 * color/font literals). Replaces the brutalist 2px-ink-border + hard offset
 * shadow + sharp corners + mono-uppercase label with the frosted Terminal
 * Glass language:
 *   - Inter label (sentence case), tight tracking — NOT uppercase mono
 *   - soft radius (--ctl-radius, 12px), 1px glass border + top edge highlight
 *   - primary = the signal-orange gradient + glow send button from the
 *     reference; secondary/ghost = frosted neutral fill; danger = error-hue
 *     gradient in the same glass language
 *   - glow-lift hover (translateY -1px + warm soft shadow), orange focus ring
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
  // Base frosted-control class carries the radius, glass border + edge
  // highlight, Inter label, transitions, focus ring, and disabled state.
  const baseClasses = 'glass-btn';

  const variantClasses = {
    primary: 'glass-btn-primary',
    secondary: 'glass-btn-secondary',
    ghost: 'glass-btn-ghost',
    danger: 'glass-btn-danger',
  };

  const sizeClasses = {
    xs: 'px-3 py-1 text-xs',
    sm: 'px-4 py-1.5 text-sm',
    md: 'px-6 py-2 text-sm',
    lg: 'px-8 py-2.5 text-base',
  };

  const buttonClasses = [
    baseClasses,
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
