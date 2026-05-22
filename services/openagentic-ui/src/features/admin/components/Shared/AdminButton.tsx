import React from 'react';
import { RefreshCw } from '@/shared/icons';

export interface AdminButtonProps {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
  icon?: React.ReactNode;
  loading?: boolean;
  disabled?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
  className?: string;
  type?: 'button' | 'submit';
  title?: string;
}

const variantStyles: Record<string, React.CSSProperties> = {
  primary: {
    backgroundColor: 'var(--color-primary)',
    color: 'var(--ap-fg-0)',
    border: 'none',
  },
  secondary: {
    backgroundColor: 'transparent',
    color: 'var(--text-primary)',
    border: '1px solid var(--color-border)',
  },
  danger: {
    backgroundColor: 'var(--color-error)',
    color: 'var(--ap-fg-0)',
    border: 'none',
  },
  ghost: {
    backgroundColor: 'transparent',
    color: 'var(--text-secondary)',
    border: 'none',
  },
};

export const AdminButton: React.FC<AdminButtonProps> = ({
  variant = 'secondary',
  size = 'md',
  icon,
  loading = false,
  disabled = false,
  onClick,
  children,
  className = '',
  type = 'button',
  title,
}) => {
  const isSm = size === 'sm';
  const isDisabled = disabled || loading;

  // M3 Expressive (task #160): primary/danger get rounded-pill, secondary/
  // ghost get rounded-btn (12px). All variants pick up the emphasized
  // transition + press-scale feedback.
  const shapeCls =
    variant === 'primary' || variant === 'danger' ? 'rounded-pill' : 'rounded-btn';

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      title={title}
      className={`inline-flex items-center gap-1.5 font-medium ${shapeCls}
        transition-[background,border,color,box-shadow,transform] duration-200 ease-emphasized active:scale-[0.98]
        focus-visible:outline-none focus-visible:shadow-focus-ring
        ${isSm ? 'px-3 py-1 text-xs' : 'px-4 py-1.5 text-xs'}
        ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        ${variant === 'secondary' ? 'hover:bg-[var(--color-surfaceHover)]' : ''}
        ${variant === 'ghost' ? 'hover:bg-[var(--color-surfaceHover)]' : ''}
        ${variant === 'primary' ? 'hover:brightness-110' : ''}
        ${variant === 'danger' ? 'hover:brightness-110' : ''}
        ${className}`}
      style={{
        ...variantStyles[variant],
        ...(isDisabled ? { pointerEvents: 'none' } : {}),
      }}
    >
      {loading ? (
        <RefreshCw size={isSm ? 11 : 13} className="animate-spin" />
      ) : icon ? (
        <span className="flex-shrink-0 flex items-center">{icon}</span>
      ) : null}
      {children}
    </button>
  );
};
