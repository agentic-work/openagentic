/**
 * Task #158 — `browser_exec_request` event renderer.
 *
 * Claude.ai-style "Python Sandbox" / "JS Sandbox" card. Shows the
 * requested source, a ▶ Run button (auto-fires on first render unless
 * the user paused), a stdout/stderr pane, and any captured matplotlib
 * figures rendered as <img> tags.
 *
 * States cycle:
 *   idle      →  user hasn't clicked Run (shouldn't normally happen —
 *                `useChatStream` auto-dispatches on arrival)
 *   running   →  sandboxManager.execute() in flight
 *   success   →  `ok: true` result frame received
 *   error     →  `ok: false` (timeout / runtime / syntax / load_failed)
 *
 * Visual: slate surface, violet accent on the header, JetBrains Mono
 * for code + output. Matches the existing Phase G event components
 * (`CorrectionBlock`, `RagStatusLine`) — we deliberately don't reach
 * for Tailwind because the events module bypasses the design-token
 * pipeline for now (see `useKeyframes.ts` note).
 */

import React, { memo, useEffect, useState, useCallback } from 'react';
import type {
  BrowserExecRequest,
  BrowserExecResult,
  SandboxLanguage,
} from '../../../../sandbox/types';

export type SandboxExecState =
  | 'idle'
  | 'running'
  | 'success'
  | 'error';

export interface SandboxExecCardProps {
  request: BrowserExecRequest;
  /**
   * If set, renders the finalized result instead of wiring up the
   * internal run flow. Used when useChatStream stores the final
   * result alongside the request and re-renders on history reload.
   */
  result?: BrowserExecResult | null;
  /**
   * When present, auto-runs on mount. The default is to auto-run so
   * the model's request doesn't sit idle; pass `false` to require
   * the user to press ▶ explicitly (admin / inspection mode).
   */
  autoRun?: boolean;
  /**
   * Hook for the consumer (useChatStream) to drive execution. If
   * omitted the card stays in the idle state and the Run button does
   * nothing — useful for storybook / tests.
   */
  onRun?: (req: BrowserExecRequest) => Promise<BrowserExecResult>;
  /** Hook for the kill-switch button. */
  onKill?: (requestId: string) => void;
}

const LANGUAGE_LABEL: Record<SandboxLanguage, string> = {
  python: 'Python Sandbox',
  javascript: 'JS Sandbox',
};

const PlayIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <polygon points="6 4 20 12 6 20 6 4" />
  </svg>
);

const StopIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <rect x="6" y="6" width="12" height="12" rx="1" />
  </svg>
);

const SandboxExecCardComponent: React.FC<SandboxExecCardProps> = ({
  request,
  result: externalResult,
  autoRun = true,
  onRun,
  onKill,
}) => {
  const [state, setState] = useState<SandboxExecState>(
    externalResult ? (externalResult.ok ? 'success' : 'error') : 'idle',
  );
  const [result, setResult] = useState<BrowserExecResult | null>(
    externalResult ?? null,
  );

  // Keep in sync if the parent hands us a fresh result after the fact.
  useEffect(() => {
    if (externalResult) {
      setResult(externalResult);
      setState(externalResult.ok ? 'success' : 'error');
    }
  }, [externalResult]);

  const runNow = useCallback(async () => {
    if (!onRun) return;
    setState('running');
    try {
      const r = await onRun(request);
      setResult(r);
      setState(r.ok ? 'success' : 'error');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setResult({
        requestId: request.requestId,
        ok: false,
        stdout: '',
        stderr: message,
        durationMs: 0,
        errorCode: 'UNKNOWN',
      });
      setState('error');
    }
  }, [onRun, request]);

  // Auto-run on mount if we have a runner and no pre-loaded result.
  useEffect(() => {
    if (autoRun && !externalResult && state === 'idle' && onRun) {
      void runNow();
    }
    // only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const kill = useCallback(() => {
    if (!onKill) return;
    onKill(request.requestId);
    setState('error');
    setResult((prev) => ({
      requestId: request.requestId,
      ok: false,
      stdout: prev?.stdout ?? '',
      stderr: 'aborted by user',
      durationMs: prev?.durationMs ?? 0,
      errorCode: 'ABORTED',
    }));
  }, [onKill, request.requestId]);

  const title = request.title || LANGUAGE_LABEL[request.language] || 'Sandbox';
  const accent = state === 'error' ? 'var(--cm-error)' : 'var(--cm-accent)';

  return (
    <div
      data-testid="sandbox-exec-card"
      data-state={state}
      data-language={request.language}
      style={{
        margin: '8px 0',
        border: '1px solid color-mix(in srgb, var(--cm-accent) 22%, transparent)',
        borderRadius: 10,
        background: 'var(--cm-bg)',
        fontFamily: 'JetBrains Mono, monospace',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          background: 'color-mix(in srgb, var(--cm-accent) 6%, transparent)',
          borderBottom: '1px solid var(--cm-border)',
          fontSize: 11,
        }}
      >
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span
            aria-hidden="true"
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: accent,
              boxShadow: state === 'running' ? `0 0 0 3px color-mix(in srgb, ${accent} 20%, transparent)` : undefined,
            }}
          />
          <span style={{ color: 'var(--cm-text)', fontWeight: 600 }}>{title}</span>
          <span style={{ color: 'var(--cm-text-muted)' }}>
            · {request.language}
            {result?.durationMs != null && (
              <> · {(result.durationMs / 1000).toFixed(2)}s</>
            )}
          </span>
        </div>
        <div style={{ display: 'inline-flex', gap: 8 }}>
          {state === 'running' && onKill ? (
            <button
              type="button"
              onClick={kill}
              data-testid="sandbox-kill"
              style={buttonStyle('var(--cm-error)')}
            >
              <StopIcon /> stop
            </button>
          ) : (
            <button
              type="button"
              onClick={runNow}
              disabled={state === 'running' || !onRun}
              data-testid="sandbox-run"
              style={buttonStyle(accent, state === 'running')}
            >
              <PlayIcon /> {state === 'success' ? 'rerun' : 'run'}
            </button>
          )}
        </div>
      </div>

      <pre
        data-testid="sandbox-code"
        style={{
          margin: 0,
          padding: '10px 12px',
          fontSize: 12,
          color: 'var(--cm-text)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          borderBottom: '1px solid var(--cm-border)',
        }}
      >
        {request.code}
      </pre>

      {(result || state === 'running') && (
        <div
          data-testid="sandbox-output"
          style={{
            padding: '8px 12px',
            fontSize: 11,
            color: 'var(--cm-text-muted)',
            background: 'color-mix(in srgb, var(--cm-text) 2%, transparent)',
          }}
        >
          {state === 'running' && !result && (
            <span style={{ color: 'var(--cm-text-muted)' }}>running…</span>
          )}
          {result?.stdout && (
            <pre
              data-testid="sandbox-stdout"
              style={{
                margin: 0,
                color: 'var(--cm-success)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {result.stdout}
            </pre>
          )}
          {result?.stderr && (
            <pre
              data-testid="sandbox-stderr"
              style={{
                margin: '4px 0 0',
                color: 'var(--cm-error)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {result.stderr}
            </pre>
          )}
          {result?.returnValue && (
            <pre
              data-testid="sandbox-return"
              style={{
                margin: '4px 0 0',
                color: 'var(--cm-text)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              → {result.returnValue}
            </pre>
          )}
          {result?.images && result.images.length > 0 && (
            <div
              data-testid="sandbox-images"
              style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}
            >
              {result.images.map((img, i) => (
                <img
                  key={i}
                  src={`data:${img.mime};base64,${img.base64}`}
                  alt={`figure ${i + 1}`}
                  style={{
                    maxWidth: '100%',
                    maxHeight: 360,
                    borderRadius: 4,
                    background: 'var(--cm-bg)',
                  }}
                />
              ))}
            </div>
          )}
          {result?.errorCode && (
            <div style={{ marginTop: 4, color: 'var(--cm-error)', fontSize: 10 }}>
              [{result.errorCode}
              {result.timedOut ? ' · timed out' : ''}]
            </div>
          )}
        </div>
      )}
    </div>
  );
};

function buttonStyle(color: string, disabled = false): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '3px 9px',
    borderRadius: 99,
    background: 'color-mix(in srgb, var(--cm-text) 4%, transparent)',
    border: `1px solid color-mix(in srgb, ${color} 33%, transparent)`,
    color,
    fontSize: 11,
    fontFamily: 'JetBrains Mono, monospace',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.55 : 1,
  };
}

export const SandboxExecCard = memo(SandboxExecCardComponent);
SandboxExecCard.displayName = 'SandboxExecCard';
