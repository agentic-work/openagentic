/**
 * BuildProgressRenderer — compose_visual:build-progress template (mock 05).
 *
 * Vertical step list with status pill + duration + log fold-out per step.
 *
 * Mock anatomy: mocks/UX/AI/Chatmode/end-state-05-troubleshoot-fix-build-validate.html
 * Token-driven; no hex literals.
 *
 * the design notes
 *       §Phase 2.2.3 — A2 UI render pipeline (4 missing FrameRendererRegistry entries).
 */

import React from 'react';

export type BuildStepStatus = 'pending' | 'running' | 'ok' | 'warn' | 'err' | 'skip';

export interface BuildStep {
  /** Stable id used as a list key. */
  id: string;
  /** Step label (rendered as the row heading). */
  label: string;
  /** Outcome state — drives the status pill tone. */
  status: BuildStepStatus;
  /** Duration string (`"4.2s"`, `"–"`). Empty when unset. */
  duration?: string;
  /** Optional short message rendered under the label. */
  message?: string;
  /** Optional log excerpt — folds out when the step is expanded. */
  log?: string;
}

export interface BuildProgressRendererProps {
  title?: string;
  steps: ReadonlyArray<BuildStep>;
  /**
   * Optional duration of the entire pipeline rendered in the head.
   * Useful for end-of-run summary panels.
   */
  totalDuration?: string;
}

function statusTone(s: BuildStepStatus): string {
  switch (s) {
    case 'ok':
      return 'var(--cm-ok, currentColor)';
    case 'warn':
      return 'var(--cm-warn, currentColor)';
    case 'err':
      return 'var(--cm-err, currentColor)';
    case 'running':
      return 'var(--cm-accent, currentColor)';
    case 'skip':
      return 'var(--cm-fg-3, currentColor)';
    case 'pending':
    default:
      return 'var(--cm-fg-2, currentColor)';
  }
}

function statusLabel(s: BuildStepStatus): string {
  switch (s) {
    case 'ok':
      return 'pass';
    case 'warn':
      return 'warn';
    case 'err':
      return 'fail';
    case 'running':
      return 'running';
    case 'skip':
      return 'skipped';
    case 'pending':
    default:
      return 'pending';
  }
}

export function BuildProgressRenderer({
  title,
  steps,
  totalDuration,
}: BuildProgressRendererProps) {
  if (!steps || steps.length === 0) return null;

  return (
    <div
      className="cm-build-progress"
      data-testid="build-progress-renderer"
      style={{
        background: 'var(--cm-bg-1, transparent)',
        color: 'var(--cm-fg-1)',
        border: '1px solid var(--cm-stroke-1)',
        borderRadius: 6,
        padding: '12px 14px',
        fontFamily: 'inherit',
      }}
    >
      {(title || totalDuration) && (
        <div
          className="cm-build-progress-head"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: 8,
            borderBottom: '1px solid var(--cm-stroke-2)',
            paddingBottom: 6,
          }}
        >
          {title && (
            <span style={{ fontWeight: 600, color: 'var(--cm-fg-0)' }}>{title}</span>
          )}
          {totalDuration && (
            <span
              className="cm-build-progress-total"
              style={{
                fontSize: 11,
                color: 'var(--cm-fg-3)',
                fontFamily: 'JetBrains Mono, monospace',
              }}
            >
              {totalDuration}
            </span>
          )}
        </div>
      )}

      <ol
        className="cm-build-progress-steps"
        style={{ listStyle: 'none', margin: 0, padding: 0 }}
      >
        {steps.map((step) => (
          <li
            key={step.id}
            className={`cm-build-progress-step cm-build-progress-step-${step.status}`}
            data-step-id={step.id}
            data-status={step.status}
            style={{
              display: 'grid',
              gridTemplateColumns: '14px 1fr auto auto',
              gap: 10,
              padding: '6px 0',
              borderBottom: '1px dashed var(--cm-stroke-2)',
              alignItems: 'center',
            }}
          >
            <span
              className="cm-build-progress-dot"
              aria-hidden
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: statusTone(step.status),
                display: 'inline-block',
                marginLeft: 2,
              }}
            />
            <span className="cm-build-progress-label">
              <span style={{ fontWeight: 600 }}>{step.label}</span>
              {step.message && (
                <span
                  className="cm-build-progress-msg"
                  style={{
                    display: 'block',
                    fontSize: 11.5,
                    color: 'var(--cm-fg-2)',
                    marginTop: 2,
                  }}
                >
                  {step.message}
                </span>
              )}
            </span>
            <span
              className={`cm-build-progress-pill cm-build-progress-pill-${step.status}`}
              data-status-pill={step.status}
              style={{
                fontSize: 10.5,
                padding: '2px 8px',
                borderRadius: 999,
                color: statusTone(step.status),
                border: `1px solid ${statusTone(step.status)}`,
                fontFamily: 'JetBrains Mono, monospace',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              {statusLabel(step.status)}
            </span>
            <span
              className="cm-build-progress-duration"
              style={{
                fontSize: 11,
                color: 'var(--cm-fg-3)',
                fontFamily: 'JetBrains Mono, monospace',
                minWidth: 48,
                textAlign: 'right',
              }}
            >
              {step.duration ?? '–'}
            </span>
            {step.log && (
              <details
                className="cm-build-progress-log"
                style={{ gridColumn: '2 / -1', marginTop: 4 }}
              >
                <summary
                  style={{
                    cursor: 'pointer',
                    fontSize: 11,
                    color: 'var(--cm-fg-3)',
                  }}
                >
                  log ({step.log.split('\n').length} lines)
                </summary>
                <pre
                  style={{
                    margin: '6px 0 0 0',
                    padding: 8,
                    background: 'var(--cm-bg-2, transparent)',
                    border: '1px solid var(--cm-stroke-2)',
                    borderRadius: 4,
                    fontSize: 11,
                    fontFamily: 'JetBrains Mono, monospace',
                    color: 'var(--cm-fg-1)',
                    overflowX: 'auto',
                  }}
                >
                  {step.log}
                </pre>
              </details>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

export default BuildProgressRenderer;
