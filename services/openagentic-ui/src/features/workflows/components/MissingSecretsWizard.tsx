/**
 * MissingSecretsWizard — collects values for secrets the workflow
 * references via {{secret:NAME}} that don't exist yet.
 *
 * Surfaces one masked-input field per missing name. On submit returns
 * the full {NAME → value} map so the caller can POST each to
 * /api/admin/workflow-secrets, then re-fire Run.
 *
 * Used by WorkflowsContainer between the pre-flight validation gate
 * (which detects SECRET_NOT_FOUND issues) and the actual Execute call.
 */

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export interface MissingSecretEntry {
  name: string;
  nodeIds: string[];
}

export interface MissingSecretsWizardProps {
  isOpen: boolean;
  missing: MissingSecretEntry[];
  onSubmit: (values: Record<string, string>) => void;
  onCancel: () => void;
}

const inputStyle = (border: string): React.CSSProperties => ({
  width: '100%',
  padding: '10px 12px',
  fontSize: 13,
  fontFamily: 'var(--font-mono)',
  background: 'var(--color-bg-tertiary, #0d1117)',
  color: 'var(--color-text, #e6edf3)',
  border: `1px solid ${border}`,
  borderRadius: 6,
  outline: 'none',
});

export const MissingSecretsWizard: React.FC<MissingSecretsWizardProps> = ({
  isOpen,
  missing,
  onSubmit,
  onCancel,
}) => {
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen) return;
    setValues({});
  }, [isOpen, missing]);

  if (!isOpen) return null;

  const isEmpty = (v: string | undefined) => !v || v.trim() === '';
  const allFilled = missing.every((m) => !isEmpty(values[m.name]));

  const handleSubmit = () => {
    if (!allFilled) return;
    onSubmit({ ...values });
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
          data-testid="missing-secrets-wizard"
          initial={{ scale: 0.95, y: 16 }}
          animate={{ scale: 1, y: 0 }}
          onClick={(e) => e.stopPropagation()}
          style={{
            width: 'min(640px, 92vw)',
            maxHeight: '85vh', overflow: 'auto',
            background: 'var(--color-bg-secondary, #1a1a1a)',
            color: 'var(--color-text, #e6edf3)',
            border: '1px solid var(--color-border, #2a2a2a)',
            borderRadius: 12, padding: 24,
            boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
            Provide credentials before running
          </h2>
          <p style={{ marginTop: 8, marginBottom: 20, fontSize: 13, color: 'var(--color-text-secondary, #8b949e)' }}>
            This flow references credentials that haven't been saved yet. Enter
            the values below — they'll be encrypted and stored as workflow
            secrets, then reused on every run.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {missing.map((m) => {
              const id = `missing-secret-${m.name}`;
              const val = values[m.name] ?? '';
              return (
                <div key={m.name}>
                  <label
                    htmlFor={id}
                    style={{
                      display: 'block',
                      fontSize: 13,
                      fontWeight: 600,
                      fontFamily: 'var(--font-mono)',
                      marginBottom: 4,
                    }}
                  >
                    {m.name}
                  </label>
                  <div style={{ fontSize: 11, color: 'var(--color-text-tertiary, #6e7681)', marginBottom: 6 }}>
                    Used by {m.nodeIds.length} node{m.nodeIds.length === 1 ? '' : 's'}: {m.nodeIds.join(', ')}
                  </div>
                  <input
                    id={id}
                    aria-label={m.name}
                    type="password"
                    autoComplete="off"
                    value={val}
                    onChange={(e) =>
                      setValues((prev) => ({ ...prev, [m.name]: e.target.value }))
                    }
                    style={inputStyle('var(--color-border, #2a2a2a)')}
                  />
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
            <button
              type="button"
              onClick={onCancel}
              style={{
                padding: '8px 14px', fontSize: 13,
                background: 'transparent', color: 'var(--color-text, #e6edf3)',
                border: '1px solid var(--color-border, #2a2a2a)', borderRadius: 6, cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!allFilled}
              style={{
                padding: '8px 14px', fontSize: 13, fontWeight: 600,
                background: allFilled ? 'var(--color-info)' : '#444',
                color: 'white',
                border: '1px solid ' + (allFilled ? 'var(--color-info)' : '#444'),
                borderRadius: 6,
                cursor: allFilled ? 'pointer' : 'not-allowed',
                opacity: allFilled ? 1 : 0.6,
              }}
            >
              Save & Run
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
