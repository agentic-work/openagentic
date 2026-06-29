/**
 * #781 Phase C5 — Runbook renderer.
 *
 * Numbered steps with body + optional code block + interactive checkbox.
 * Checked state persists to localStorage keyed by `runbook:{id}` so
 * progress survives page reloads (per plan acceptance criterion).
 */
import React, { useEffect, useState } from 'react';

export interface RunbookStep {
  title: string;
  body?: string;
  code?: string;
  lang?: string;
}

export interface RunbookProps {
  id: string;
  steps: RunbookStep[];
}

const COLORS = {
  ink: 'var(--ink, #0d0d0c)',
  graphite: 'var(--graphite, rgba(13,13,12,0.55))',
  accent: 'var(--accent, #c1440e)',
  rule: 'var(--ink-on-paper, rgba(13,13,12,0.12))',
  paper2: 'var(--paper-2, rgba(13,13,12,0.04))',
};

export const Runbook: React.FC<RunbookProps> = ({ id, steps }) => {
  const storageKey = `runbook:${id}`;
  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    if (typeof localStorage === 'undefined') return {};
    try {
      return JSON.parse(localStorage.getItem(storageKey) || '{}');
    } catch {
      return {};
    }
  });

  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(checked));
    } catch {
      /* quota / disabled — skip persist */
    }
  }, [storageKey, checked]);

  if (!steps || steps.length === 0) {
    return (
      <div
        data-testid="runbook-empty"
        style={{
          padding: '40px 20px',
          textAlign: 'center',
          color: COLORS.graphite,
          fontFamily: 'var(--font-mono, ui-monospace, monospace)',
          fontSize: 12,
          letterSpacing: 0.04,
        }}
      >
        No runbook steps.
      </div>
    );
  }

  const toggle = (i: number) =>
    setChecked((prev) => ({ ...prev, [String(i)]: !prev[String(i)] }));

  return (
    <ol
      data-testid="runbook-root"
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        display: 'grid',
        gap: 14,
      }}
    >
      {steps.map((step, i) => {
        const isChecked = !!checked[String(i)];
        return (
          <li
            key={i}
            data-testid={`runbook-step-${i}`}
            style={{
              display: 'grid',
              gridTemplateColumns: '32px 1fr',
              gap: 12,
              padding: '14px 16px',
              border: `1px solid ${COLORS.rule}`,
              borderLeft: `3px solid ${isChecked ? COLORS.accent : COLORS.graphite}`,
              background: isChecked ? COLORS.paper2 : 'transparent',
              opacity: isChecked ? 0.7 : 1,
              transition: 'opacity 200ms, background 200ms',
            }}
          >
            <input
              type="checkbox"
              checked={isChecked}
              onChange={() => toggle(i)}
              data-testid={`runbook-step-${i}-checkbox`}
              aria-label={`Mark step ${i + 1} complete`}
              style={{
                width: 18,
                height: 18,
                marginTop: 2,
                accentColor: 'var(--accent, #c1440e)',
                cursor: 'pointer',
              }}
            />
            <div>
              <div
                style={{
                  fontFamily: 'var(--font-serif, ui-serif, Georgia, serif)',
                  fontWeight: 600,
                  fontSize: 14.5,
                  color: COLORS.ink,
                  textDecoration: isChecked ? 'line-through' : 'none',
                  marginBottom: 4,
                  letterSpacing: '-0.01em',
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                    fontSize: 10.5,
                    letterSpacing: 0.16,
                    color: COLORS.accent,
                    marginRight: 8,
                    fontWeight: 600,
                  }}
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                {step.title}
              </div>
              {step.body && (
                <p
                  style={{
                    margin: '4px 0 8px',
                    fontFamily: 'var(--font-serif, ui-serif, Georgia, serif)',
                    fontSize: 13,
                    lineHeight: 1.5,
                    color: COLORS.ink,
                  }}
                >
                  {step.body}
                </p>
              )}
              {step.code && (
                <pre
                  style={{
                    margin: 0,
                    padding: '10px 12px',
                    background: COLORS.paper2,
                    border: `1px solid ${COLORS.rule}`,
                    overflow: 'auto',
                  }}
                >
                  <code
                    data-lang={step.lang || 'sh'}
                    style={{
                      fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                      fontSize: 11.5,
                      color: COLORS.ink,
                    }}
                  >
                    {step.code}
                  </code>
                </pre>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
};
