/**
 * NeedsInputForm — flows "human_input" HITL typed form.
 *
 * The flows engine pauses a workflow on a `human_input` node and emits a
 * `needs_input` NDJSON frame:
 *
 *   { type: 'needs_input', requestId, nodeId, title, description, fields,
 *     channel, expiresAt, timeoutAction? }
 *
 * where `fields` is an array of typed field descriptors. This component
 * renders a typed form — text/number/dropdown/secret/checkbox/date/textarea
 * per field type — honors `required` / `default` / `placeholder` /
 * `validation`, and on a valid submit calls `onSubmit({ ...values })`. The
 * parent (WorkflowsContainer) wires `onSubmit` to
 * `WorkflowApiService.submitDataRequest`, which POSTs `{ values }` to the
 * data-request route so the engine resumes.
 *
 * THEME: every color resolves via a CSS variable (`var(--cm-*)` /
 * `var(--color-*)` / `var(--accent)`) — no hardcoded hex/rgb/named colors —
 * so the form themes correctly in light + dark + the user's accent
 * (CLAUDE.md Rule 8b). Risk/error tints use `color-mix(... transparent)`
 * over a theme token, mirroring ToolApprovalPopup.
 *
 * The component is render-surface agnostic: it draws only its own card body,
 * so the caller can mount it inline (next to approval prompts), in a modal
 * shell, or in the execution panel.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Send, Loader2, AlertCircle, Check, Eye, EyeOff } from '@/shared/icons';

// ── Types ──────────────────────────────────────────────────────────────────

export type NeedsInputFieldType =
  | 'string'
  | 'number'
  | 'enum'
  | 'secret'
  | 'boolean'
  | 'file'
  | 'date'
  | 'json';

export interface NeedsInputFieldValidation {
  /** Minimum length / value (string length or numeric minimum). */
  min?: number;
  /** Maximum length / value (string length or numeric maximum). */
  max?: number;
  /** RegExp source string the value must match (string fields). */
  pattern?: string;
  /** Human-readable message shown when `pattern` / bounds fail. */
  message?: string;
}

export interface NeedsInputField {
  name: string;
  label: string;
  type: NeedsInputFieldType;
  required?: boolean;
  /** Choices for `enum` fields (the dropdown options). */
  options?: string[];
  default?: unknown;
  placeholder?: string;
  /** Optional inline help text under the label. */
  description?: string;
  validation?: NeedsInputFieldValidation;
}

export interface NeedsInputRequest {
  requestId: string;
  nodeId: string;
  title: string;
  description?: string;
  fields: NeedsInputField[];
  channel?: string;
  expiresAt?: string;
  /**
   * When the node's timeout action falls back to defaults, the user may
   * submit the declared defaults without filling required fields. Surfaces
   * a "Use defaults" affordance.
   */
  allowDefaults?: boolean;
}

export interface NeedsInputFormProps {
  request: NeedsInputRequest;
  /**
   * Submit the collected values. Should resolve on a 200 (engine resumes)
   * and reject with an Error whose message is shown inline on failure.
   */
  onSubmit: (values: Record<string, any>) => Promise<void> | void;
  /** Optional cancel/dismiss affordance (rarely used — pausing is blocking). */
  onCancel?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

// ── Helpers ──────────────────────────────────────────────────────────────

const isEmpty = (v: any): boolean =>
  v === undefined ||
  v === null ||
  (typeof v === 'string' && v.trim() === '');

/** Seed initial form state from each field's declared default. */
function seedDefaults(fields: NeedsInputField[]): Record<string, any> {
  const seed: Record<string, any> = {};
  for (const f of fields) {
    if (f.type === 'boolean') {
      seed[f.name] = f.default === true;
    } else if (f.default !== undefined && f.default !== null) {
      seed[f.name] = f.default;
    } else {
      seed[f.name] = '';
    }
  }
  return seed;
}

/**
 * Validate a single field's value. Returns an error string or null.
 * Pure — used by the submit gate and inline error rendering.
 */
function validateField(field: NeedsInputField, value: any): string | null {
  if (field.required && field.type !== 'boolean' && isEmpty(value)) {
    return 'This field is required.';
  }
  if (isEmpty(value)) return null; // optional + empty → ok

  const v = field.validation;
  if (field.type === 'number') {
    const num = Number(value);
    if (Number.isNaN(num)) return 'Must be a number.';
    if (v?.min != null && num < v.min) return v.message || `Must be ≥ ${v.min}.`;
    if (v?.max != null && num > v.max) return v.message || `Must be ≤ ${v.max}.`;
  } else if (field.type === 'json') {
    try {
      JSON.parse(typeof value === 'string' ? value : JSON.stringify(value));
    } catch {
      return 'Must be valid JSON.';
    }
  } else if (typeof value === 'string') {
    if (v?.min != null && value.length < v.min) return v.message || `Must be at least ${v.min} characters.`;
    if (v?.max != null && value.length > v.max) return v.message || `Must be at most ${v.max} characters.`;
    if (v?.pattern) {
      try {
        if (!new RegExp(v.pattern).test(value)) return v.message || 'Invalid format.';
      } catch {
        /* malformed pattern from server — skip rather than block */
      }
    }
  }
  return null;
}

/** Coerce field values to their declared types for the submit payload. */
function coerceValues(
  fields: NeedsInputField[],
  values: Record<string, any>,
): Record<string, any> {
  const out: Record<string, any> = {};
  for (const f of fields) {
    const raw = values[f.name];
    if (f.type === 'boolean') {
      out[f.name] = !!raw;
      continue;
    }
    if (isEmpty(raw)) continue; // omit empty optionals
    if (f.type === 'number') {
      out[f.name] = Number(raw);
    } else if (f.type === 'json') {
      try {
        out[f.name] = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch {
        out[f.name] = raw; // leave as string; server can re-validate
      }
    } else {
      out[f.name] = raw;
    }
  }
  return out;
}

// ── Shared field-control styles (theme tokens only) ─────────────────────────

const controlStyle = (hasError: boolean): React.CSSProperties => ({
  width: '100%',
  padding: '8px 10px',
  fontSize: 13,
  borderRadius: 6,
  outline: 'none',
  background: 'var(--cm-bg, var(--color-bg-tertiary))',
  color: 'var(--cm-text, var(--color-text))',
  border: `1px solid ${
    hasError
      ? 'var(--cm-error, var(--color-error))'
      : 'var(--cm-border, var(--color-border))'
  }`,
});

// ── Component ──────────────────────────────────────────────────────────────

export const NeedsInputForm: React.FC<NeedsInputFormProps> = ({
  request,
  onSubmit,
  onCancel,
  className,
  style,
}) => {
  const { fields } = request;
  const [values, setValues] = useState<Record<string, any>>(() => seedDefaults(fields));
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [revealSecret, setRevealSecret] = useState<Record<string, boolean>>({});

  // Re-seed when a NEW request arrives (different requestId).
  useEffect(() => {
    setValues(seedDefaults(fields));
    setTouched(false);
    setSubmitting(false);
    setSubmitted(false);
    setServerError(null);
    setRevealSecret({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.requestId]);

  const errors = useMemo(() => {
    const e: Record<string, string | null> = {};
    for (const f of fields) e[f.name] = validateField(f, values[f.name]);
    return e;
  }, [fields, values]);

  const hasErrors = useMemo(
    () => Object.values(errors).some((e) => e != null),
    [errors],
  );

  const setField = useCallback((name: string, value: any) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setServerError(null);
  }, []);

  const doSubmit = useCallback(
    async (payload: Record<string, any>) => {
      setSubmitting(true);
      setServerError(null);
      try {
        await onSubmit(payload);
        setSubmitted(true);
      } catch (err: any) {
        setServerError(err?.message || 'Failed to submit input.');
      } finally {
        setSubmitting(false);
      }
    },
    [onSubmit],
  );

  const handleSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      setTouched(true);
      if (hasErrors) return; // block — inline errors are now visible
      void doSubmit(coerceValues(fields, values));
    },
    [hasErrors, doSubmit, fields, values],
  );

  const handleUseDefaults = useCallback(() => {
    void doSubmit(coerceValues(fields, seedDefaults(fields)));
  }, [doSubmit, fields]);

  // ── Per-field control renderer ──────────────────────────────────────────
  const renderControl = (field: NeedsInputField) => {
    const id = `needs-input-${request.requestId}-${field.name}`;
    const err = touched ? errors[field.name] : null;
    const value = values[field.name];
    const common = { id, 'aria-label': field.label, style: controlStyle(!!err) };

    switch (field.type) {
      case 'enum':
        return (
          <select
            {...common}
            value={value ?? ''}
            onChange={(e) => setField(field.name, e.target.value)}
          >
            <option value="" disabled>
              {field.placeholder || 'Select…'}
            </option>
            {(field.options || []).map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        );

      case 'number':
        return (
          <input
            {...common}
            type="number"
            value={value ?? ''}
            placeholder={field.placeholder}
            onChange={(e) => setField(field.name, e.target.value)}
          />
        );

      case 'secret':
        return (
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input
              {...common}
              style={{ ...controlStyle(!!err), paddingRight: 36 }}
              type={revealSecret[field.name] ? 'text' : 'password'}
              value={value ?? ''}
              placeholder={field.placeholder}
              autoComplete="off"
              onChange={(e) => setField(field.name, e.target.value)}
            />
            <button
              type="button"
              aria-label={revealSecret[field.name] ? 'Hide value' : 'Reveal value'}
              onClick={() =>
                setRevealSecret((p) => ({ ...p, [field.name]: !p[field.name] }))
              }
              style={{
                position: 'absolute',
                right: 6,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--cm-text-muted, var(--color-text-tertiary))',
                display: 'flex',
                padding: 4,
              }}
            >
              {revealSecret[field.name] ? <EyeOff /> : <Eye />}
            </button>
          </div>
        );

      case 'boolean':
        return (
          <label
            htmlFor={id}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
          >
            <input
              id={id}
              aria-label={field.label}
              type="checkbox"
              checked={!!value}
              onChange={(e) => setField(field.name, e.target.checked)}
              style={{ accentColor: 'var(--accent, var(--cm-accent))', width: 16, height: 16 }}
            />
            <span style={{ fontSize: 13, color: 'var(--cm-text, var(--color-text))' }}>
              {value ? 'Yes' : 'No'}
            </span>
          </label>
        );

      case 'date':
        return (
          <input
            {...common}
            type="date"
            value={value ?? ''}
            onChange={(e) => setField(field.name, e.target.value)}
          />
        );

      case 'json':
        return (
          <textarea
            {...common}
            rows={5}
            spellCheck={false}
            value={typeof value === 'string' ? value : value ? JSON.stringify(value, null, 2) : ''}
            placeholder={field.placeholder || '{ }'}
            onChange={(e) => setField(field.name, e.target.value)}
            style={{ ...controlStyle(!!err), fontFamily: 'var(--font-mono, monospace)', resize: 'vertical' }}
          />
        );

      case 'file':
        return (
          <input
            {...common}
            type="file"
            onChange={(e) => setField(field.name, e.target.files?.[0]?.name || '')}
          />
        );

      case 'string':
      default: {
        // Multi-line for prose-like fields; single-line otherwise.
        const multiline = /message|notes?|prompt|description|comment|reason/i.test(field.name);
        if (multiline) {
          return (
            <textarea
              {...common}
              rows={3}
              value={value ?? ''}
              placeholder={field.placeholder}
              onChange={(e) => setField(field.name, e.target.value)}
              style={{ ...controlStyle(!!err), resize: 'vertical' }}
            />
          );
        }
        return (
          <input
            {...common}
            type="text"
            value={value ?? ''}
            placeholder={field.placeholder}
            onChange={(e) => setField(field.name, e.target.value)}
          />
        );
      }
    }
  };

  // ── Resolved (post-submit) state ─────────────────────────────────────────
  if (submitted) {
    return (
      <div
        data-testid="needs-input-submitted"
        className={className}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '14px 16px',
          borderRadius: 10,
          background: 'color-mix(in srgb, var(--cm-success, var(--color-success)) 10%, transparent)',
          border: '1px solid color-mix(in srgb, var(--cm-success, var(--color-success)) 35%, transparent)',
          color: 'var(--cm-success, var(--color-success))',
          ...style,
        }}
      >
        <Check />
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          Input submitted — resuming workflow…
        </span>
      </div>
    );
  }

  return (
    <form
      data-testid="needs-input-form"
      data-request-id={request.requestId}
      data-node-id={request.nodeId}
      className={className}
      onSubmit={handleSubmit}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        padding: 18,
        borderRadius: 12,
        background: 'color-mix(in srgb, var(--cm-surface, var(--color-surface)) 94%, transparent)',
        border: '1px solid var(--cm-border, var(--color-border))',
        boxShadow: '0 8px 28px color-mix(in srgb, var(--cm-text, var(--color-text)) 14%, transparent)',
        ...style,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              padding: '2px 8px',
              borderRadius: 999,
              background: 'color-mix(in srgb, var(--accent, var(--cm-accent)) 14%, transparent)',
              color: 'var(--accent, var(--cm-accent))',
              border: '1px solid color-mix(in srgb, var(--accent, var(--cm-accent)) 32%, transparent)',
            }}
          >
            Input needed
          </span>
        </div>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--cm-text, var(--color-text))' }}>
          {request.title}
        </h3>
        {request.description && (
          <p
            style={{
              margin: 0,
              fontSize: 12.5,
              lineHeight: 1.5,
              color: 'var(--cm-text-secondary, var(--color-text-secondary))',
            }}
          >
            {request.description}
          </p>
        )}
      </div>

      {/* Fields */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {fields.map((field) => {
          const err = touched ? errors[field.name] : null;
          return (
            <div key={field.name} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label
                htmlFor={`needs-input-${request.requestId}-${field.name}`}
                style={{
                  fontSize: 12.5,
                  fontWeight: 500,
                  color: 'var(--cm-text, var(--color-text))',
                }}
              >
                {field.label}
                {field.required && (
                  <span
                    aria-hidden
                    style={{ color: 'var(--cm-error, var(--color-error))', marginLeft: 4 }}
                  >
                    *
                  </span>
                )}
              </label>
              {field.description && (
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--cm-text-muted, var(--color-text-tertiary))',
                  }}
                >
                  {field.description}
                </span>
              )}
              {renderControl(field)}
              {err && (
                <span
                  role="alert"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 11,
                    color: 'var(--cm-error, var(--color-error))',
                  }}
                >
                  <AlertCircle />
                  {err}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Server-side error */}
      {serverError && (
        <div
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 10px',
            borderRadius: 8,
            fontSize: 12,
            background: 'color-mix(in srgb, var(--cm-error, var(--color-error)) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--cm-error, var(--color-error)) 35%, transparent)',
            color: 'var(--cm-error, var(--color-error))',
          }}
        >
          <AlertCircle />
          {serverError}
        </div>
      )}

      {/* Actions */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginTop: 2,
        }}
      >
        <div style={{ display: 'flex', gap: 8 }}>
          {request.allowDefaults && (
            <button
              type="button"
              onClick={handleUseDefaults}
              disabled={submitting}
              style={{
                padding: '8px 14px',
                fontSize: 12.5,
                fontWeight: 500,
                borderRadius: 8,
                cursor: submitting ? 'not-allowed' : 'pointer',
                opacity: submitting ? 0.6 : 1,
                background: 'transparent',
                color: 'var(--cm-text-secondary, var(--color-text-secondary))',
                border: '1px solid var(--cm-border, var(--color-border))',
              }}
            >
              Use defaults
            </button>
          )}
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              style={{
                padding: '8px 14px',
                fontSize: 12.5,
                fontWeight: 500,
                borderRadius: 8,
                cursor: submitting ? 'not-allowed' : 'pointer',
                opacity: submitting ? 0.6 : 1,
                background: 'transparent',
                color: 'var(--cm-text-secondary, var(--color-text-secondary))',
                border: '1px solid var(--cm-border, var(--color-border))',
              }}
            >
              Cancel
            </button>
          )}
        </div>

        <button
          type="submit"
          disabled={submitting}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 18px',
            fontSize: 13,
            fontWeight: 600,
            borderRadius: 8,
            cursor: submitting ? 'not-allowed' : 'pointer',
            opacity: submitting ? 0.75 : 1,
            color: 'var(--cm-bg, var(--color-bg-primary))',
            background: 'var(--accent, var(--cm-accent))',
            border: '1px solid color-mix(in srgb, var(--accent, var(--cm-accent)) 70%, var(--cm-text, transparent))',
          }}
        >
          {submitting ? <Loader2 /> : <Send />}
          {submitting ? 'Submitting…' : 'Submit'}
        </button>
      </div>
    </form>
  );
};

export default NeedsInputForm;
