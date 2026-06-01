import React from 'react';

/**
 * Shared Input — NEO-BRUTALIST field-guide restyle.
 *
 * Reads ONLY theme tokens. 2px solid ink border (border-rule-strong),
 * near-sharp corners (rounded-input → --radius-input, 2px), surface
 * background, signal-orange focus (border-accent + shadow-hard-xs). The
 * field label uses the mono eyebrow marker. Error state swaps the border +
 * focus shadow to the error token (no raw rgba literal). Prop API
 * ({ label, error, ...inputAttrs }) is unchanged.
 */
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  className = '',
  ...props
}) => {
  const baseStyles = [
    'block w-full rounded-input px-4 py-2.5 text-sm',
    'bg-surface text-fg placeholder:text-fg-subtle',
    'border-2 border-rule-strong',
    'transition-[border-color,box-shadow] duration-100',
    'focus:outline-none focus:border-accent focus:shadow-hard-xs',
  ].join(' ');

  const errorStyles = error
    ? 'border-err focus:border-err'
    : '';

  return (
    <div className="space-y-1">
      {label && (
        <label className="eyebrow block text-fg">
          {label}
        </label>
      )}
      <input
        className={`${baseStyles} ${errorStyles} ${className}`}
        {...props}
      />
      {error && <p className="text-sm text-err">{error}</p>}
    </div>
  );
};
