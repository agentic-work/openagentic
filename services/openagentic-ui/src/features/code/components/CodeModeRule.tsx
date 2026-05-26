import React, { useEffect, useState } from 'react';

export interface CodeModeRuleProps {
  /** Live model name (claude-sonnet-4-6, gpt-oss:20b, …). */
  model?: string | null;
  /** Current working directory the daemon is running in. */
  cwd?: string | null;
  /** Live input_tokens reported by the most recent result event. */
  contextTokens?: number;
  /** Accumulated session cost in USD. */
  totalCostUsd?: number;
  /** Wall-clock ms when the session was created — for the elapsed timer. */
  sessionStartedAt?: number;
  /** True while the assistant is producing output. */
  isStreaming?: boolean;
  /** Most recent error string. Null when healthy. */
  error?: string | null;
  /** Hide the rule entirely when nothing is interesting (no model, no cwd). */
  hideWhenEmpty?: boolean;
}

function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0s elapsed';
  const totalSec = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remMin = minutes % 60;
    return `${hours}h ${remMin}m elapsed`;
  }
  if (minutes >= 1) {
    return `${minutes}m ${seconds.toString().padStart(2, '0')}s elapsed`;
  }
  return `${seconds}s elapsed`;
}

function formatCost(usd: number): string {
  if (!Number.isFinite(usd)) return '$0.00';
  return `$${usd.toFixed(usd >= 0.1 ? 3 : 4)}`;
}

function formatTokens(t: number): string {
  if (t < 1000) return `${t} tok`;
  return `${t.toLocaleString()} tok`;
}

const pillVariant = (props: {
  isStreaming?: boolean;
  error?: string | null;
}): { label: string; klass: 'ready' | 'thinking' | 'error' } => {
  if (props.error) return { label: 'ERROR', klass: 'error' };
  if (props.isStreaming) return { label: '⠋ THINKING', klass: 'thinking' };
  return { label: 'READY', klass: 'ready' };
};

export const CodeModeRule: React.FC<CodeModeRuleProps> = ({
  model,
  cwd,
  contextTokens,
  totalCostUsd,
  sessionStartedAt,
  isStreaming,
  error,
  hideWhenEmpty = false,
}) => {
  // 1Hz tick for the elapsed timer so the row updates while streaming.
  const [, setTick] = useState(0);
  useEffect(() => {
    const handle = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(handle);
  }, []);

  const hasAny =
    !!model || !!cwd || (contextTokens ?? 0) > 0 || (totalCostUsd ?? 0) > 0 || isStreaming;
  if (hideWhenEmpty && !hasAny) return null;

  const variant = pillVariant({ isStreaming, error });
  const elapsedMs = sessionStartedAt ? Date.now() - sessionStartedAt : 0;
  const tokens = typeof contextTokens === 'number' ? contextTokens : 0;
  const cost = typeof totalCostUsd === 'number' ? totalCostUsd : 0;

  return (
    <div
      data-testid="cm-rule"
      data-pill={variant.klass}
      className="cm-rule"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 14,
        padding: '10px 16px',
        fontFamily:
          'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace)',
        fontSize: 11,
        color: 'var(--cm-text-muted, #6c7086)',
        borderBottom: '1px solid var(--cm-border, #45475a)',
        background: 'var(--cm-bg-secondary, #181825)',
      }}
    >
      <span
        data-testid="cm-rule-pill"
        className={`pill ${variant.klass}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '2px 8px',
          borderRadius: 999,
          fontWeight: 600,
          fontSize: 10,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          background:
            variant.klass === 'thinking'
              ? 'rgba(203,166,247,0.18)'
              : variant.klass === 'ready'
                ? 'rgba(166,227,161,0.15)'
                : 'rgba(243,139,168,0.18)',
          color:
            variant.klass === 'thinking'
              ? 'var(--cm-prompt, #cba6f7)'
              : variant.klass === 'ready'
                ? 'var(--cm-success, #a6e3a1)'
                : 'var(--cm-error, #f38ba8)',
        }}
      >
        {variant.label}
      </span>
      <span data-testid="cm-rule-tok" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {formatTokens(tokens)}
      </span>
      <span className="sep" style={{ opacity: 0.4 }}>·</span>
      <span data-testid="cm-rule-cost" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {formatCost(cost)}
      </span>
      <span className="sep" style={{ opacity: 0.4 }}>·</span>
      <span data-testid="cm-rule-elapsed" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {formatElapsed(elapsedMs)}
      </span>
      {model && (
        <>
          <span className="sep" style={{ opacity: 0.4 }}>·</span>
          <span
            data-testid="cm-rule-model"
            className="cm-accent"
            style={{ color: 'var(--cm-accent, #89b4fa)' }}
          >
            {model}
          </span>
        </>
      )}
      {cwd && (
        <>
          <span className="sep" style={{ opacity: 0.4 }}>·</span>
          <span data-testid="cm-rule-cwd">
            workspace:{' '}
            <span className="cm-accent" style={{ color: 'var(--cm-accent, #89b4fa)' }}>
              {cwd}
            </span>
          </span>
        </>
      )}
    </div>
  );
};

export default CodeModeRule;
