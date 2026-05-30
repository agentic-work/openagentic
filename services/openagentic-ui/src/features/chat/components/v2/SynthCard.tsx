/**
 * AC-C — SynthCard. Renders one synth lifecycle entry inline.
 *
 * Anatomy mirrors ToolCard: header (intent + risk badge + caps chips
 * + stage indicator), body sections (Plan / Code / Approval / Stdout /
 * Result). The synthsByMessageId reducer in useChatStream owns the
 * state; this component is a pure render of that state plus an
 * optional approve/deny callback for the awaiting_approval stage.
 *
 * Visual treatment uses the same cm-* token system as the other v2
 * primitives (chatmode-v2.css). The card surfaces:
 *
 *   - intent (single-line, semibold)
 *   - risk badge (low|medium|high|critical, color-coded)
 *   - caps chips (filesystem, github, postgres, …)
 *   - stage indicator (planned · awaiting · executing · ✓ · ✗ · denied)
 *   - code preview (Python source streaming in)
 *   - approval CTA (only when stage=awaiting_approval)
 *   - stdout buffer (with stderr tagged when present)
 *   - duration / error / denial-reason in the footer per terminal stage
 *
 * The component never POSTs by itself — the `onApprove`/`onDeny`
 * callbacks bubble to the consumer (ChatContainer wires them to
 * /api/synth/approvals/:id/[approve|reject]).
 */

import { useState, type CSSProperties } from 'react';
import type { Synth } from '../../hooks/useChatStream';

export interface SynthCardProps {
  synth: Synth;
  /** Fired when the user clicks Approve. Consumer POSTs to api. */
  onApprove?: (artifactId: string) => void;
  /** Fired when the user clicks Deny. Consumer POSTs to api. */
  onDeny?: (artifactId: string) => void;
}

// Risk-level color tokens resolve from the active theme — `var(--cm-*)`
// honors light/dark/accent overrides at paint time. Hex fallbacks are
// safety defaults for the rare case the iframe hasn't loaded the
// chatmode token preamble yet.
const RISK_COLORS: Record<Synth['riskLevel'], string> = {
  low: 'var(--cm-success, #10b981)',
  medium: 'var(--cm-warn, #f59e0b)',
  high: 'var(--cm-error, #ef4444)',
  critical: 'var(--cm-error, #7f1d1d)',
};

const STAGE_GLYPH: Record<Synth['stage'], string> = {
  planned: '·',
  awaiting_approval: '?',
  approved: '→',
  denied: '✗',
  executing: '◴',
  completed: '✓',
  failed: '✗',
};

const STAGE_LABEL: Record<Synth['stage'], string> = {
  planned: 'planned',
  awaiting_approval: 'awaiting approval',
  approved: 'approved',
  denied: 'denied',
  executing: 'executing',
  completed: 'completed',
  failed: 'failed',
};

function formatDuration(ms: number | undefined): string {
  if (typeof ms !== 'number') return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const cardStyle: CSSProperties = {
  border: '1px solid var(--cm-border, #2a2a35)',
  borderRadius: 8,
  padding: 12,
  margin: '8px 0',
  background: 'var(--cm-surface, #14141c)',
  fontFamily: 'var(--cm-font-body, system-ui, sans-serif)',
  fontSize: 13,
  color: 'var(--cm-text, #e7e7ee)',
};

const codeStyle: CSSProperties = {
  margin: '8px 0',
  padding: '8px 10px',
  background: 'var(--cm-code-bg, #0a0a14)',
  border: '1px solid var(--cm-border, #2a2a35)',
  borderRadius: 6,
  fontFamily: 'var(--cm-font-mono, "JetBrains Mono", monospace)',
  fontSize: 12,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  maxHeight: 240,
  overflowY: 'auto',
  color: 'var(--cm-text-strong, #f4f4f9)',
};

const stdoutStyle: CSSProperties = {
  ...codeStyle,
  background: 'var(--cm-stdout-bg, #08081a)',
  color: 'var(--cm-text-soft, #c5c5d2)',
};

const stderrStyle: CSSProperties = {
  ...codeStyle,
  background: 'var(--cm-stderr-bg, #1a0808)',
  color: 'var(--cm-error, #ffb3b3)',
};

const chipStyle: CSSProperties = {
  display: 'inline-block',
  padding: '2px 8px',
  marginRight: 4,
  borderRadius: 999,
  background: 'var(--cm-chip-bg, #1a1a26)',
  border: '1px solid var(--cm-border-soft, #2a2a3a)',
  fontSize: 11,
  color: 'var(--cm-text-soft, #c5c5d2)',
};

const buttonStyle: CSSProperties = {
  border: 'none',
  borderRadius: 6,
  padding: '6px 14px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  marginRight: 8,
};

export function SynthCard({ synth, onApprove, onDeny }: SynthCardProps) {
  const [expanded, setExpanded] = useState(true);
  const showCode = synth.code.length > 0;
  const showStdout = synth.stdout.length > 0;
  const showStderr = synth.stderr.length > 0;
  const showApproval = synth.stage === 'awaiting_approval';
  const showDuration = synth.stage === 'completed' || synth.stage === 'failed';
  const showError = synth.stage === 'failed' && (synth.error || showStderr);
  const showDenial = synth.stage === 'denied';

  return (
    <div
      data-testid="synth-card"
      data-risk={synth.riskLevel}
      data-stage={synth.stage}
      style={cardStyle}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? 'collapse' : 'expand'}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--cm-text-soft, #c5c5d2)',
            cursor: 'pointer',
            fontSize: 12,
            padding: 0,
          }}
        >
          {expanded ? '▾' : '▸'}
        </button>
        <strong style={{ flex: 1 }}>{synth.intent}</strong>
        <span
          aria-label={`risk ${synth.riskLevel}`}
          style={{
            ...chipStyle,
            background: RISK_COLORS[synth.riskLevel],
            color: 'var(--cm-fg, #fff)',
            border: 'none',
            textTransform: 'uppercase',
            letterSpacing: 0.4,
          }}
        >
          {synth.riskLevel}
        </span>
        <span
          aria-label={`stage ${synth.stage}`}
          style={{ ...chipStyle, fontVariant: 'small-caps' }}
        >
          {STAGE_GLYPH[synth.stage]} {STAGE_LABEL[synth.stage]}
        </span>
      </div>

      {expanded && (
        <>
          <div style={{ marginTop: 6 }}>
            {synth.capabilities.map((c) => (
              <span key={c} style={chipStyle}>
                {c}
              </span>
            ))}
          </div>
          {synth.riskReason ? (
            <div
              style={{
                marginTop: 4,
                fontSize: 11,
                color: 'var(--cm-text-soft, #c5c5d2)',
              }}
            >
              {synth.riskReason}
            </div>
          ) : null}
          {showCode ? (
            <pre data-testid="synth-card-code" style={codeStyle}>
              {synth.code}
            </pre>
          ) : null}
          {showApproval ? (
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                style={{ ...buttonStyle, background: 'var(--cm-success, #10b981)', color: 'var(--cm-fg, #fff)' }}
                onClick={() => onApprove?.(synth.artifactId)}
              >
                Approve
              </button>
              <button
                type="button"
                style={{ ...buttonStyle, background: 'var(--cm-error, #ef4444)', color: 'var(--cm-fg, #fff)' }}
                onClick={() => onDeny?.(synth.artifactId)}
              >
                Deny
              </button>
            </div>
          ) : null}
          {showStdout ? (
            <pre data-testid="synth-card-stdout" style={stdoutStyle}>
              {synth.stdout}
            </pre>
          ) : null}
          {showStderr ? (
            <pre data-testid="synth-card-stderr" style={stderrStyle}>
              {synth.stderr}
            </pre>
          ) : null}
          {showError && synth.error ? (
            <div
              data-testid="synth-card-error"
              style={{ marginTop: 4, color: 'var(--cm-error, #ffb3b3)', fontSize: 12 }}
            >
              {synth.error}
            </div>
          ) : null}
          {showDuration ? (
            <div
              style={{
                marginTop: 4,
                fontSize: 11,
                color: 'var(--cm-text-soft, #c5c5d2)',
              }}
            >
              {formatDuration(synth.durationMs)}
            </div>
          ) : null}
          {showDenial && synth.denialReason ? (
            <div
              data-testid="synth-card-denial"
              style={{ marginTop: 4, color: 'var(--cm-error, #ffb3b3)', fontSize: 12 }}
            >
              Denied: {synth.denialReason}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
