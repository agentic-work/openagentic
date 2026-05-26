import React, { useEffect, useRef, useState } from 'react';
import { parseNDJSONStream } from '@/utils/ndjsonStream';

interface BootEvent {
  ts: number;
  type: 'session_info' | 'kube_event' | 'check' | 'all_ready' | 'error';
  // session_info
  sessionId?: string;
  podName?: string;
  nodeName?: string | null;
  namespace?: string;
  startedAt?: number;
  // kube_event
  kind?: string;
  reason?: string;
  source?: string;
  message?: string;
  // check
  key?: string;
  status?: 'pending' | 'running' | 'ok' | 'warn' | 'fail';
  detail?: string;
  // Index signature satisfies NDJSONEvent constraint.
  [key: string]: unknown;
}

interface Props {
  sessionId: string | null | undefined;
  authToken?: string;
  /** Fired once when `{type:'all_ready'}` first arrives. Parent uses this
   * to unmount the gate and render the actual chat surface. */
  onAllReady?: () => void;
  /** When true, the gate renders a compressed "session ready" pill
   * instead of the full modal. Use after all_ready to show a slim
   * status without blocking chat. */
  compact?: boolean;
}

const CHECK_LABELS: Record<string, { label: string; sub: string }> = {
  pod_scheduled:     { label: 'Pod scheduled & Ready',   sub: 'kubelet' },
  workspace_mounted: { label: 'Workspace mounted',       sub: 'ephemeral PVC' },
  daemon_health:     { label: 'OpenAgentic daemon',       sub: 'remote-session · :3070/health' },
  model_ping:        { label: 'Default model ping',      sub: '/v1/messages · admin default' },
  relay_ws:          { label: 'Chat relay WebSocket',    sub: '/api/code/v2/ws/chat' },
};

const CHECK_ORDER = [
  'pod_scheduled',
  'workspace_mounted',
  'daemon_health',
  'model_ping',
  'relay_ws',
];

// ---- theme tokens -----------------------------------------------------------
// The boot modal is app chrome — not part of the terminal experience — so it
// uses the global `--color-*` / `--accent-*` variables that flip with the
// user's app-level light/dark theme. This keeps the modal readable on light
// mode even when the active codemode theme is "terminal green". Fallbacks
// track the app's dark defaults so the modal never renders unstyled.
const T = {
  // surfaces
  bg:         'var(--color-background, #161618)',
  panel:      'var(--color-surface, #1E1E21)',
  logBg:      'var(--color-surfaceTertiary, var(--color-surface, #2A2A2E))',
  border:     'var(--color-border, rgba(255,255,255,0.12))',
  borderSoft: 'var(--color-border, rgba(255,255,255,0.08))',
  // text
  text:       'var(--color-text, #E8E8ED)',
  textSoft:   'var(--color-textSecondary, #B8B8C0)',
  muted:      'var(--color-textMuted, #8E8E93)',
  mutedDim:   'var(--color-textMuted, #6E6E73)',
  // semantic — accent-* flips with the app theme (light/dark overrides)
  success:    'var(--accent-success, #30D158)',
  info:       'var(--accent-info, #0A84FF)',
  warning:    'var(--accent-warning, #FF9F0A)',
  error:      'var(--accent-error, #FF453A)',
  // tinted backgrounds for status dots — color-mix keeps the tint readable
  // on both light (white) and dark (near-black) backgrounds.
  tintSuccess: 'color-mix(in srgb, var(--accent-success, #30D158) 15%, transparent)',
  tintInfo:    'color-mix(in srgb, var(--accent-info, #0A84FF) 15%, transparent)',
  tintWarn:    'color-mix(in srgb, var(--accent-warning, #FF9F0A) 15%, transparent)',
  tintError:   'color-mix(in srgb, var(--accent-error, #FF453A) 15%, transparent)',
  tintMuted:   'color-mix(in srgb, var(--color-textMuted, #8E8E93) 12%, transparent)',
};

function elapsedLabel(startedAt: number | null, now: number): string {
  if (!startedAt) return '↑ 0s';
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  if (s < 60) return `↑ ${s}s`;
  const m = Math.floor(s / 60);
  return `↑ ${m}m ${s % 60}s`;
}

export const InlineBootStream: React.FC<Props> = ({ sessionId, authToken, onAllReady, compact }) => {
  const [events, setEvents] = useState<BootEvent[]>([]);
  const [checks, setChecks] = useState<Record<string, BootEvent>>({});
  const [allReady, setAllReady] = useState(false);
  const [sessionInfo, setSessionInfo] = useState<{ sessionId?: string; podName?: string; nodeName?: string | null; namespace?: string; startedAt?: number }>({});
  const [now, setNow] = useState(Date.now());
  const [streamError, setStreamError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLPreElement>(null);
  const readyFiredRef = useRef(false);

  // Elapsed-timer tick every second.
  useEffect(() => {
    if (allReady) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [allReady]);

  // Stream connection.
  useEffect(() => {
    if (!sessionId || !authToken) return;
    let cancelled = false;
    (async () => {
      if (abortRef.current) abortRef.current.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const qs = new URLSearchParams();
        qs.set('sessionId', sessionId);
        qs.set('token', authToken);
        const resp = await fetch(`/api/code/v2/boot-events?${qs.toString()}`, {
          headers: { Accept: 'application/x-ndjson' },
          signal: ac.signal,
        });
        if (!resp.ok) {
          setStreamError(`boot-events endpoint returned HTTP ${resp.status}`);
          return;
        }
        for await (const e of parseNDJSONStream<BootEvent>(resp)) {
          if (cancelled) break;
          if (e.type === 'session_info') {
            setSessionInfo(prev => ({
              sessionId: e.sessionId || prev.sessionId,
              podName: e.podName || prev.podName,
              nodeName: e.nodeName ?? prev.nodeName,
              namespace: e.namespace || prev.namespace,
              startedAt: e.startedAt || prev.startedAt,
            }));
          } else if (e.type === 'kube_event') {
            setEvents(prev => [...prev.slice(-200), e]);
          } else if (e.type === 'check') {
            setChecks(prev => ({ ...prev, [e.key!]: e }));
          } else if (e.type === 'all_ready') {
            setAllReady(true);
            if (!readyFiredRef.current) {
              readyFiredRef.current = true;
              onAllReady?.();
            }
          } else if (e.type === 'error') {
            setStreamError(e.message || 'unknown stream error');
          }
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          setStreamError(err?.message || 'stream connection failed');
        }
      }
    })();
    return () => { cancelled = true; if (abortRef.current) abortRef.current.abort(); };
  }, [sessionId, authToken, onAllReady]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [events]);

  // Pre-session spinner (auto-create hasn't returned a sessionId yet).
  // Backdrop is fully opaque so the half-booted chat/editor behind can't
  // leak error toasts through the glass.
  if (!sessionId) {
    return (
      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 1200,
          background: T.bg,
          color: T.text,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: "'Inter', 'IBM Plex Sans', system-ui, sans-serif",
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 28, color: T.info, animation: 'cm-pulse 2.4s ease-in-out infinite' }}>◆</div>
          <div style={{ marginTop: 12, fontSize: 13, color: T.muted, fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
            requesting codemode session…
          </div>
        </div>
        <style>{`@keyframes cm-pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.08); } }`}</style>
      </div>
    );
  }

  // Post-ready compressed pill — parent only uses this when it wants
  // to show a sliver status under the chat after gate clears.
  if (compact && allReady) {
    return (
      <div
        style={{
          position: 'absolute', top: 8, right: 12, zIndex: 30,
          fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 11,
          background: T.panel, color: T.success,
          border: `1px solid ${T.success}`, borderRadius: 999,
          padding: '4px 10px', backdropFilter: 'blur(6px)',
        }}
      >
        <span style={{ marginRight: 6 }}>◆</span>
        session ready
      </div>
    );
  }

  const completedCount = CHECK_ORDER.filter(k => checks[k]?.status === 'ok').length;
  const totalCount = CHECK_ORDER.length;
  const pct = Math.round((completedCount / totalCount) * 100);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1200,
        // Solid opaque base so nothing bleeds through (editor panel's
        // "Failed to start VS Code" banner, daemon connect-refused
        // flashes). The subtle tint lives as a non-transparent
        // backgroundImage layer on top, not as a fill, so it can
        // never reveal UI behind.
        background: T.bg,
        backgroundImage: `radial-gradient(circle at 50% 30%, color-mix(in srgb, ${T.info} 5%, transparent), transparent 70%)`,
        color: T.text,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 32,
        fontFamily: "'Inter', 'IBM Plex Sans', system-ui, sans-serif",
        fontSize: 14, lineHeight: 1.55,
        WebkitFontSmoothing: 'antialiased' as any,
      }}
    >
      <style>{`
        @keyframes cm-pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.08); } }
        @keyframes cm-spin { to { transform: rotate(360deg); } }
      `}</style>

      <div
        style={{
          width: '100%', maxWidth: 820,
          background: T.panel,
          border: `1px solid ${T.border}`,
          borderRadius: 14,
          overflow: 'hidden',
          boxShadow: `0 24px 64px color-mix(in srgb, ${T.bg} 45%, transparent)`,
          backdropFilter: 'blur(14px)',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '22px 28px 18px',
            borderBottom: `1px solid ${T.borderSoft}`,
            display: 'flex', alignItems: 'center', gap: 16,
          }}
        >
          <span
            style={{
              fontSize: 28,
              color: allReady ? T.success : T.info,
              animation: 'cm-pulse 2.4s ease-in-out infinite',
            }}
          >
            ◆
          </span>
          <div>
            <h1 style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em', margin: 0, color: T.text }}>
              {allReady ? 'Codemode session ready' : 'Codemode session starting'}
            </h1>
            <div
              style={{
                marginTop: 2,
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                fontSize: 11.5, fontWeight: 400, lineHeight: 1.4,
                color: T.muted,
              }}
            >
              session&nbsp;<span style={{ color: T.info }}>{(sessionInfo.sessionId || sessionId).slice(0, 8)}</span>
              &nbsp;·&nbsp; pod&nbsp;<span style={{ color: T.info }}>{sessionInfo.podName || '—'}</span>
              &nbsp;·&nbsp; node&nbsp;<span style={{ color: T.info }}>{sessionInfo.nodeName || '—'}</span>
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <div
            style={{
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              fontSize: 11, fontWeight: 500, lineHeight: 1,
              color: T.muted,
              padding: '6px 10px', border: `1px solid ${T.borderSoft}`, borderRadius: 6,
            }}
          >
            {elapsedLabel(sessionInfo.startedAt || null, now)}
          </div>
        </div>

        {/* Checks */}
        <div style={{ padding: '16px 28px 10px' }}>
          {CHECK_ORDER.map((key, idx) => {
            const c = checks[key];
            const meta = CHECK_LABELS[key];
            const status = c?.status || 'pending';
            const detail = c?.detail || '—';
            const stateClass = status === 'ok' ? 'ok' : status === 'running' ? 'run' : status === 'warn' ? 'warn' : status === 'fail' ? 'fail' : 'wait';
            const dotBg =
              stateClass === 'ok' ? T.tintSuccess :
              stateClass === 'run' ? T.tintInfo :
              stateClass === 'warn' ? T.tintWarn :
              stateClass === 'fail' ? T.tintError :
              T.tintMuted;
            const dotColor =
              stateClass === 'ok' ? T.success :
              stateClass === 'run' ? T.info :
              stateClass === 'warn' ? T.warning :
              stateClass === 'fail' ? T.error :
              T.mutedDim;
            const detailColor = dotColor;
            const icon =
              stateClass === 'ok' ? '✓' :
              stateClass === 'run' ? <span style={{
                display: 'inline-block', width: 11, height: 11,
                border: `1.5px solid ${T.info}`, borderTopColor: 'transparent',
                borderRadius: '50%', animation: 'cm-spin 0.9s linear infinite',
              }} /> :
              stateClass === 'warn' ? '⚠' :
              stateClass === 'fail' ? '✗' :
              '○';
            return (
              <div
                key={key}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '9px 0',
                  borderTop: idx === 0 ? 'none' : `1px solid ${T.borderSoft}`,
                }}
              >
                <div
                  style={{
                    width: 22, height: 22, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, flexShrink: 0,
                    background: dotBg, color: dotColor,
                  }}
                >
                  {icon}
                </div>
                <span style={{ fontWeight: 500, flex: 1, color: T.text }}>
                  {meta.label}
                  <small style={{ color: T.muted, fontWeight: 400, marginLeft: 6, fontSize: 12 }}>— {meta.sub}</small>
                </span>
                <span
                  style={{
                    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                    fontSize: 11.5, fontWeight: 500, lineHeight: 1,
                    color: detailColor, whiteSpace: 'nowrap',
                  }}
                >
                  {detail}
                </span>
              </div>
            );
          })}
        </div>

        {/* Live kube-api log */}
        <div style={{ borderTop: `1px solid ${T.borderSoft}`, background: T.logBg }}>
          <div
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 22px', fontSize: 11.5, color: T.muted,
              borderBottom: `1px solid ${T.borderSoft}`,
            }}
          >
            <span>
              <span style={{
                display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
                background: T.success, boxShadow: `0 0 6px ${T.success}`,
                animation: 'cm-pulse 1.6s ease-in-out infinite',
                marginRight: 6, verticalAlign: -1,
              }} />
              kube-api events · <span style={{ color: T.mutedDim }}>read-only</span>
            </span>
            <span>
              {sessionInfo.nodeName || '—'} · {sessionInfo.namespace || 'agentic-dev'} · tail -f
            </span>
          </div>
          <pre
            ref={logRef}
            style={{
              margin: 0,
              padding: '12px 22px 18px',
              maxHeight: 220,
              overflow: 'auto',
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              fontSize: 12, fontWeight: 500, lineHeight: 1.65,
              color: T.textSoft,
              whiteSpace: 'pre',
            }}
          >
            {events.length === 0 && !streamError
              ? <span style={{ color: T.mutedDim }}>waiting for kube events…</span>
              : events.slice(-80).map((e, i) => {
                  const t = new Date(e.ts).toLocaleTimeString('en-US', { hour12: false });
                  const reasonColor =
                    e.kind === 'Warning' ? T.warning :
                    e.reason === 'Started' || e.reason === 'Ready' || e.reason === 'Pulled' || e.reason === 'Created' ? T.success :
                    T.info;
                  return (
                    <div key={i}>
                      <span style={{ color: T.mutedDim }}>{t}</span>
                      {'  '}
                      <span style={{ color: T.muted }}>{(e.source || '').padEnd(10).slice(0, 10)}</span>
                      {'  '}
                      <span style={{ color: reasonColor }}>{(e.reason || '').padEnd(12).slice(0, 12)}</span>
                      {'  '}
                      <span>{e.message}</span>
                    </div>
                  );
                })}
            {streamError && (
              <div style={{ color: T.error }}>
                {new Date().toLocaleTimeString('en-US', { hour12: false })}  ERROR        {streamError}
              </div>
            )}
          </pre>
        </div>

        {/* Footer: progress + primary CTA */}
        <div
          style={{
            padding: '14px 28px 18px',
            display: 'flex', alignItems: 'center', gap: 12,
            borderTop: `1px solid ${T.borderSoft}`,
            background: T.panel,
          }}
        >
          <div
            style={{
              flex: 1, height: 6, background: T.borderSoft, borderRadius: 3, overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%', width: `${pct}%`,
                background: `linear-gradient(90deg, ${T.success}, ${T.info})`,
                transition: 'width 0.4s ease',
              }}
            />
          </div>
          <span
            style={{
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              fontSize: 11.5, fontWeight: 500, lineHeight: 1,
              color: T.muted, minWidth: 42, textAlign: 'right',
            }}
          >
            {completedCount}/{totalCount}
          </span>
          <button
            disabled={!allReady}
            onClick={() => { readyFiredRef.current = true; onAllReady?.(); }}
            style={{
              background: allReady ? T.success : T.logBg,
              color: allReady ? T.bg : T.mutedDim,
              border: `1px solid ${allReady ? T.success : T.borderSoft}`,
              padding: '8px 16px', borderRadius: 6,
              fontWeight: 600, fontSize: 13,
              cursor: allReady ? 'pointer' : 'not-allowed',
              transition: 'background 0.15s',
            }}
          >
            {allReady ? 'Start chatting →' : 'Waiting for checks…'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default InlineBootStream;
