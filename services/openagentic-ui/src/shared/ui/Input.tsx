import React, { useId } from 'react';

/**
 * Shared Input — M3 Expressive (task #160).
 *
 *   - rounded-input-sm (16px), surface-1 background
 *   - no hard border in the resting state; a subtle 1px border-primary
 *     marks the field edge. Focus swaps in the shadow-focus-ring + a
 *     primary 50% border.
 *   - 200ms ease-emphasized transition on border + shadow.
 */
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  className = '',
  id,
  ...props
}) => {
  // Generate a stable id when the caller didn't supply one, so the
  // <label htmlFor> ↔ <input id> association exists. Screen readers,
  // get_by_label() in playwright, and "click the label to focus the
  // input" UX all depend on it.
  const auto = useId();
  const inputId = id ?? auto;
  const baseStyles = [
    'block w-full rounded-input-sm px-4 py-2.5 text-sm',
    'bg-surface-1 text-text-primary placeholder:text-text-muted',
    'border border-border-primary',
    'transition-[border-color,box-shadow] duration-200 ease-emphasized',
    'focus:outline-none focus:shadow-focus-ring focus:border-accent-primary',
  ].join(' ');

  const errorStyles = error
    ? 'border-error focus:border-error focus:shadow-[0_0_0_2px_rgba(255,69,58,0.5)]'
    : '';

  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={inputId} className="block text-sm font-medium text-text-primary">
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={`${baseStyles} ${errorStyles} ${className}`}
        {...props}
      />
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
};
