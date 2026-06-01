import React from 'react';

/**
 * Shared Input — TERMINAL GLASS (elevated) re-skin.
 *
 * Reads ONLY theme tokens via the .glass-field* classes in theme.css. Replaces
 * the brutalist 2px-ink-border + near-sharp corners + hard focus shadow with a
 * frosted field: faint glass fill, 1px glass border + top edge highlight, soft
 * radius (--ctl-radius), and a signal-orange focus GLOW ring. The label is a
 * quiet Inter label (NOT the mono eyebrow). Error state swaps the border + glow
 * to the error token. Prop API ({ label, error, ...inputAttrs }) is unchanged.
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
  const baseStyles = 'glass-field block px-4 py-2.5 text-sm';
  const errorStyles = error ? 'glass-field-error' : '';

  return (
    <div className="space-y-1.5">
      {label && (
        <label className="glass-field-label block">
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
