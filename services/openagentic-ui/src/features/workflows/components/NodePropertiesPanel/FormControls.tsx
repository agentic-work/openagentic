/**
 * Form input primitives for the Node Properties Panel — consistent, CSS
 * variable-based controls so they follow the app theme. Extracted verbatim
 * from the original inline definitions.
 */

import React from 'react';
import { AlertCircle } from '@/shared/icons';

// Form input components for consistent styling - CSS variable based for theme adherence
export const FormInput: React.FC<{
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  isDark?: boolean;
  helpText?: string;
  min?: number;
  max?: number;
  required?: boolean;
  error?: boolean;
}> = ({ label, value, onChange, type = 'text', placeholder, helpText, min, max, required, error }) => (
  <div>
    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
      {label}
      {required && <span style={{ color: 'var(--color-warning)', marginLeft: 4, fontWeight: 800 }}>*</span>}
    </label>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      min={min}
      max={max}
      data-required-field={required ? 'true' : undefined}
      data-field-error={error ? 'true' : undefined}
      className={`glass-field px-3 py-2.5 text-sm transition-all focus:outline-none${error ? ' glass-field-error' : ''}`}
    />
    {error && !value && (
      <p className="text-xs mt-1 flex items-center gap-1" data-testid="required-field-error" style={{ color: 'var(--color-error)' }}>
        <AlertCircle style={{ width: 10, height: 10 }} /> Required
      </p>
    )}
    {helpText && !error && (
      <p className="text-xs mt-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
        {helpText}
      </p>
    )}
  </div>
);

export const FormTextarea: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  isDark?: boolean;
  helpText?: string;
  monospace?: boolean;
  required?: boolean;
  error?: boolean;
}> = ({ label, value, onChange, rows = 3, placeholder, helpText, monospace = false, required, error }) => (
  <div>
    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
      {label}
      {required && <span style={{ color: 'var(--color-warning)', marginLeft: 4, fontWeight: 800 }}>*</span>}
    </label>
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      data-required-field={required ? 'true' : undefined}
      data-field-error={error ? 'true' : undefined}
      className={`glass-field px-3 py-2.5 text-sm transition-all resize-none focus:outline-none${monospace ? ' font-mono' : ''}${error ? ' glass-field-error' : ''}`}
    />
    {helpText && (
      <p className="text-xs mt-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
        {helpText}
      </p>
    )}
  </div>
);

export const FormSelect: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  isDark?: boolean;
  helpText?: string;
}> = ({ label, value, onChange, options, helpText }) => (
  <div>
    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
      {label}
    </label>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="glass-field px-3 py-2.5 text-sm transition-all appearance-none cursor-pointer focus:outline-none"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
        backgroundPosition: 'right 0.5rem center',
        backgroundRepeat: 'no-repeat',
        backgroundSize: '1.5em 1.5em',
        paddingRight: '2.5rem'
      }}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
    {helpText && (
      <p className="text-xs mt-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
        {helpText}
      </p>
    )}
  </div>
);

export const SectionLabel: React.FC<{ label: string }> = ({ label }) => (
  <div className="text-xs font-semibold uppercase tracking-wider pt-2" style={{ color: 'var(--color-text-tertiary)' }}>
    {label}
  </div>
);
