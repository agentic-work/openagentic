import React from 'react';

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
  const baseClasses = 'inline-flex items-center justify-center font-medium rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 transition-colors duration-fast';

  const variantClasses = {
    primary: 'bg-accent-primary text-white hover:bg-accent-primary-hover focus-visible:outline-accent-primary disabled:bg-interactive-disabled',
    secondary: 'bg-bg-secondary text-text-primary border border-border-primary hover:bg-bg-tertiary focus-visible:outline-accent-primary disabled:bg-interactive-disabled',
    ghost: 'text-text-primary hover:bg-interactive-hover focus-visible:outline-accent-primary disabled:text-text-muted',
    danger: 'bg-error text-white hover:bg-error-hover focus-visible:outline-error disabled:bg-interactive-disabled'
  };

  const sizeClasses = {
    xs: 'px-xs py-xs text-xs',
    sm: 'px-sm py-sm text-sm',
    md: 'px-md py-sm text-base',
    lg: 'px-lg py-md text-lg'
  };

  const buttonClasses = `${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${disabled ? 'cursor-not-allowed' : ''} ${className}`;

  return (
    <button
      className={buttonClasses}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
};