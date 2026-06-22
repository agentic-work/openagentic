import React, { useState, useEffect, useCallback } from 'react';
import { SaveIcon as Save, RefreshIcon as RotateCcw, WarningIcon as AlertCircle, SuccessIcon as CheckCircle } from './AdminIcons';

/**
 * Intelligence Slider tiers based on value
 */
export type SliderTier = 'economical' | 'balanced' | 'premium';

export const getSliderTier = (value: number): SliderTier => {
  if (value <= 40) return 'economical';
  if (value <= 60) return 'balanced';
  return 'premium';
};

export const getSliderTierInfo = (tier: SliderTier) => {
  switch (tier) {
    case 'economical':
      return {
        label: 'Economical',
        models: 'Haiku, GPT-4o-mini',
        thinking: 'No thinking budget',
        color: 'var(--color-success)',
      };
    case 'balanced':
      return {
        label: 'Balanced',
        models: 'Sonnet, GPT-4o',
        thinking: '4K-8K tokens',
        color: 'var(--color-warning)',
      };
    case 'premium':
      return {
        label: 'Premium',
        models: 'Opus, o1',
        thinking: '8K-32K tokens',
        color: 'var(--color-primary)',
      };
  }
};

export interface SliderControlProps {
  /** Current slider value (0-100) */
  value: number;
  /** Called when value changes (before save) */
  onChange?: (value: number) => void;
  /** Called when save is clicked */
  onSave?: (value: number) => Promise<void>;
  /** Called when reset is clicked */
  onReset?: () => Promise<void>;
  /** Whether editing is disabled */
  disabled?: boolean;
  /** Whether this is read-only display */
  readOnly?: boolean;
  /** Show save/reset buttons */
  showActions?: boolean;
  /** Label above the slider */
  label?: string;
  /** Source of current value */
  source?: string;
  /** Last modified info */
  lastModified?: { by?: string; at?: string };
  /** Compact mode for inline use */
  compact?: boolean;
}

export const SliderControl: React.FC<SliderControlProps> = ({
  value: initialValue,
  onChange,
  onSave,
  onReset,
  disabled = false,
  readOnly = false,
  showActions = true,
  label,
  source,
  lastModified,
  compact = false,
}) => {
  const [value, setValue] = useState(initialValue);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Update internal value when prop changes
  useEffect(() => {
    setValue(initialValue);
    setIsDirty(false);
  }, [initialValue]);

  const tier = getSliderTier(value);
  const tierInfo = getSliderTierInfo(tier);

  const handleChange = useCallback(
    (newValue: number) => {
      setValue(newValue);
      setIsDirty(newValue !== initialValue);
      setError(null);
      setSuccess(false);
      onChange?.(newValue);
    },
    [initialValue, onChange]
  );

  const handleSave = async () => {
    if (!onSave || !isDirty) return;

    setIsSaving(true);
    setError(null);

    try {
      await onSave(value);
      setIsDirty(false);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    if (!onReset) return;

    setIsSaving(true);
    setError(null);

    try {
      await onReset();
      setIsDirty(false);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className={`${compact ? 'space-y-2' : 'space-y-4'}`}
      style={{
        padding: compact ? '12px' : '16px',
        backgroundColor: 'var(--color-surfaceSecondary)',
        borderRadius: '8px',
        border: '1px solid var(--color-border)',
      }}
    >
      {/* Header */}
      {(label || source) && (
        <div className="flex items-center justify-between">
          {label && (
            <span
              className="font-medium"
              style={{ color: 'var(--text-primary)', fontSize: 'var(--text-sm)' }}
            >
              {label}
            </span>
          )}
          {source && (
            <span
              className="text-xs px-2 py-0.5 rounded"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--color-primary) 15%, transparent)',
                color: 'var(--color-primary)',
              }}
            >
              Source: {source}
            </span>
          )}
        </div>
      )}

      {/* Slider */}
      <div className="space-y-2">
        <div className="flex items-center gap-4">
          {/* Slider input */}
          <div className="flex-1 relative">
            <input
              type="range"
              min="0"
              max="100"
              value={value}
              onChange={(e) => handleChange(Number(e.target.value))}
              disabled={disabled || readOnly}
              className="w-full h-2 rounded-lg appearance-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                background: `linear-gradient(to right,
                  var(--color-success) 0%,
                  var(--color-success) 40%,
                  var(--color-warning) 40%,
                  var(--color-warning) 60%,
                  var(--color-primary) 60%,
                  var(--color-primary) 100%)`,
              }}
            />
            {/* Tick marks */}
            <div className="flex justify-between mt-1 px-0.5">
              {[0, 20, 40, 60, 80, 100].map((tick) => (
                <span
                  key={tick}
                  className="text-xs"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {tick}
                </span>
              ))}
            </div>
          </div>

          {/* Value display */}
          <div
            className="w-16 text-center py-1 px-2 rounded font-mono font-bold"
            style={{
              backgroundColor: `color-mix(in srgb, ${tierInfo.color} 15%, transparent)`,
              color: tierInfo.color,
              fontSize: 'var(--text-base)',
            }}
          >
            {value}%
          </div>
        </div>

        {/* Tier info */}
        <div
          className="flex items-center gap-4 text-sm"
          style={{ color: 'var(--text-secondary)' }}
        >
          <span
            className="font-medium"
            style={{ color: tierInfo.color }}
          >
            {tierInfo.label}
          </span>
          <span>|</span>
          <span>Models: {tierInfo.models}</span>
          <span>|</span>
          <span>Thinking: {tierInfo.thinking}</span>
        </div>
      </div>

      {/* Actions */}
      {showActions && !readOnly && (
        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-2">
            {error && (
              <div
                className="flex items-center gap-1 text-sm"
                style={{ color: 'var(--color-error)' }}
              >
                <AlertCircle size={14} />
                {error}
              </div>
            )}
            {success && (
              <div
                className="flex items-center gap-1 text-sm"
                style={{ color: 'var(--color-success)' }}
              >
                <CheckCircle size={14} />
                Saved!
              </div>
            )}
            {lastModified && !error && !success && (
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Last modified{lastModified.by ? ` by ${lastModified.by}` : ''}
                {lastModified.at ? ` at ${lastModified.at}` : ''}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {onReset && (
              <button
                onClick={handleReset}
                disabled={disabled || isSaving}
                className="flex items-center gap-1 px-3 py-1.5 rounded text-sm transition-colors disabled:opacity-50"
                style={{
                  color: 'var(--text-secondary)',
                  backgroundColor: 'transparent',
                  border: '1px solid var(--color-border)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--color-surfaceHover)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                <RotateCcw size={14} />
                Reset
              </button>
            )}
            {onSave && (
              <button
                onClick={handleSave}
                disabled={disabled || !isDirty || isSaving}
                className="flex items-center gap-1 px-3 py-1.5 rounded text-sm font-medium transition-colors disabled:opacity-50"
                style={{
                  backgroundColor: isDirty ? 'var(--color-primary)' : 'var(--color-surfaceTertiary)',
                  color: isDirty ? 'var(--color-on-accent)' : 'var(--text-muted)',
                }}
                onMouseEnter={(e) => {
                  if (isDirty && !disabled && !isSaving) {
                    e.currentTarget.style.filter = 'brightness(1.1)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.filter = 'none';
                }}
              >
                <Save size={14} />
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Compact inline slider display (read-only) with edit button
 */
export const SliderDisplay: React.FC<{
  value: number;
  source?: string;
  onEdit?: () => void;
}> = ({ value, source, onEdit }) => {
  const tier = getSliderTier(value);
  const tierInfo = getSliderTierInfo(tier);

  return (
    <div className="flex items-center gap-3">
      <span
        className="font-mono font-bold px-2 py-0.5 rounded"
        style={{
          backgroundColor: `color-mix(in srgb, ${tierInfo.color} 15%, transparent)`,
          color: tierInfo.color,
          fontSize: 'var(--text-sm)',
        }}
      >
        {value}%
      </span>
      <span
        className="text-sm"
        style={{ color: tierInfo.color }}
      >
        {tierInfo.label}
      </span>
      {source && (
        <span
          className="text-xs"
          style={{ color: 'var(--text-muted)' }}
        >
          ({source})
        </span>
      )}
      {onEdit && (
        <button
          onClick={onEdit}
          className="text-xs px-2 py-0.5 rounded transition-colors"
          style={{
            color: 'var(--color-primary)',
            backgroundColor: 'transparent',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor =
              'color-mix(in srgb, var(--color-primary) 15%, transparent)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
        >
          Edit
        </button>
      )}
    </div>
  );
};

export default SliderControl;
