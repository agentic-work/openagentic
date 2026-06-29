/**
 * RunInputsModal — collects required trigger inputs before submitting Run.
 *
 * Templates declare required parameters on `trigger.data.inputs`. When the
 * user clicks Run on a flow that has any required input still empty, we
 * pop this modal so they can fill them in. Submitting calls onSubmit with
 * the collected values; onCancel closes without running.
 *
 * Uniform shape with the rest of the right-rail design language —
 * dark theme, focused field labels, clear required-field indicator,
 * primary "Run flow" + secondary "Cancel" buttons.
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export interface RunInputDef {
  name: string;
  label: string;
  type?: 'string' | 'number' | 'boolean';
  required?: boolean;
  placeholder?: string;
  description?: string;
  default?: any;
}

export interface RunInputsModalProps {
  isOpen: boolean;
  inputs: RunInputDef[];
  defaultValues?: Record<string, any>;
  onSubmit: (values: Record<string, any>) => void;
  onCancel: () => void;
}

export const RunInputsModal: React.FC<RunInputsModalProps> = ({
  isOpen,
  inputs,
  defaultValues,
  onSubmit,
  onCancel,
}) => {
  const [values, setValues] = useState<Record<string, any>>({});
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const seed: Record<string, any> = {};
    for (const i of inputs) {
      if (defaultValues && i.name in defaultValues) seed[i.name] = defaultValues[i.name];
      else if (i.default !== undefined) seed[i.name] = i.default;
    }
    setValues(seed);
    setShowErrors(false);
  }, [isOpen, inputs, defaultValues]);

  if (!isOpen) return null;

  const isEmpty = (v: any) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
  const missingRequired = inputs.filter((i) => i.required && isEmpty(values[i.name]));

  const handleSubmit = () => {
    if (missingRequired.length > 0) {
      setShowErrors(true);
      return;
    }
    const out: Record<string, any> = {};
    for (const i of inputs) {
      if (!isEmpty(values[i.name])) out[i.name] = values[i.name];
    }
    onSubmit(out);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
        onClick={onCancel}
      >
        <motion.div
          // Terminal Glass: frosted modal CARD (.glass) over the dim scrim;
          // was an opaque #1a1a1a card. Layout + text set inline.
          className="glass"
          data-testid="run-inputs-modal"
          initial={{ scale: 0.95, y: 16 }}
          animate={{ scale: 1, y: 0 }}
          onClick={(e) => e.stopPropagation()}
          style={{
            width: 'min(560px, 92vw)',
            maxHeight: '85vh', overflow: 'auto',
            color: 'var(--color-text)',
            padding: 24,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Run with parameters</h2>
          <p style={{ marginTop: 8, marginBottom: 20, fontSize: 13, color: 'var(--color-text-secondary)' }}>
            This flow needs a few inputs before it can run. Fill them in below.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {inputs.map((input) => {
              const fieldId = `run-input-${input.name}`;
              const value = values[input.name] ?? '';
              const missing = input.required && isEmpty(value);
              return (
                <div key={input.name}>
                  <label htmlFor={fieldId} style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
                    {input.label}
                    {input.required ? <span style={{ color: 'var(--color-error)', marginLeft: 4 }}>*</span> : null}
                  </label>
                  {input.description ? (
                    <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginBottom: 6 }}>
                      {input.description}
                    </div>
                  ) : null}
                  <input
                    id={fieldId}
                    aria-label={input.label}
                    type={input.type === 'number' ? 'number' : 'text'}
                    placeholder={input.placeholder || ''}
                    value={value}
                    onChange={(e) => setValues((s) => ({ ...s, [input.name]: e.target.value }))}
                    style={{
                      width: '100%', padding: '10px 12px', fontSize: 13,
                      background: 'var(--ctl-surf)',
                      color: 'var(--color-text)',
                      border: `1px solid ${showErrors && missing ? 'var(--color-error)' : 'var(--glass-border)'}`,
                      borderRadius: 8, outline: 'none',
                    }}
                  />
                  {showErrors && missing ? (
                    <div style={{ fontSize: 11, color: 'var(--color-error)', marginTop: 4 }}>This is required.</div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
            <button
              type="button"
              onClick={onCancel}
              className="glass-btn glass-btn-secondary"
              style={{ padding: '8px 14px', fontSize: 13, cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              className="glass-btn glass-btn-primary"
              style={{ padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              Run flow
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
