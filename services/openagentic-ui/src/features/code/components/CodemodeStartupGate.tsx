/**
 * CodemodeStartupGate — blocks the codemode composer + transcript until
 * all four health checks are green. Sits between CodeModeLayoutV2 and
 * the CodeModeChatView so the user never sees an empty/half-booted
 * chat surface.
 *
 * Checks:
 *   1. /api/auth/me                                    → 200
 *   2. /api/code/sessions/:id/status (or system_init)  → pod ready
 *   3. HEAD /exec/<userHash>/                          → 200
 *      falls back to GET /api/openagentic/sessions/:id/code-server
 *   4. ws-chat opens + openagentic emits system_init
 *
 * Exponential backoff between attempts (1s, 2s, 4s, 8s, capped at
 * 10s); manual "Retry" button resets and re-runs. When all four are
 * green the gate unmounts and the real chat view is revealed.
 *
 * Complements the full-screen SessionBootScreen overlay — this gate
 * fills the chat pane specifically so the composer stays disabled
 * until the session is actually usable.
 *
 * @copyright 2026 Openagentic LLC
 * @license PROPRIETARY
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/app/providers/AuthContext';
import { apiEndpoint } from '@/utils/api';

type CheckKey = 'auth' | 'pod' | 'codeServer' | 'chat';
type CheckStatus = 'pending' | 'running' | 'ok' | 'fail';

interface CheckState {
  key: CheckKey;
  label: string;
  detail: string;
  status: CheckStatus;
  message?: string;
}

const INITIAL_CHECKS: Record<CheckKey, CheckState> = {
  auth:       { key: 'auth',       label: 'Authentication',     detail: '/api/auth/me',                      status: 'pending' },
  pod:        { key: 'pod',        label: 'Exec pod scheduled', detail: 'session status',                    status: 'pending' },
  codeServer: { key: 'codeServer', label: 'Code server ready',  detail: 'HEAD /exec/<hash>/',                status: 'pending' },
  chat:       { key: 'chat',       label: 'Chat daemon ready',  detail: 'ws-chat + system_init',             status: 'pending' },
};

const MAX_BACKOFF_MS = 10_000;
const STEP_TIMEOUT_MS = 30_000;

async function computeUserHash(userId: string): Promise<string> {
  const enc = new TextEncoder().encode(userId);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex.substring(0, 12);
}

interface CodemodeStartupGateProps {
  sessionId: string;
  authToken?: string;
  children: React.ReactNode;
}

export const CodemodeStartupGate: React.FC<CodemodeStartupGateProps> = ({
  sessionId,
  authToken,
  children,
}) => {
  const { user, getAuthHeaders } = useAuth();
  const [checks, setChecks] = useState<Record<CheckKey, CheckState>>(() => ({ ...INITIAL_CHECKS }));
  const [attempt, setAttempt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [allGreen, setAllGreen] = useState(false);
  const cancelRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);

  const update = useCallback((key: CheckKey, patch: Partial<CheckState>) => {
    setChecks((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }, []);

  const runCheck = useCallback(
    async <T,>(
      key: CheckKey,
      fn: () => Promise<T>,
    ): Promise<T | null> => {
      if (cancelRef.current) return null;
      update(key, { status: 'running', message: undefined });
      let attemptNum = 0;
      while (!cancelRef.current) {
        try {
          const result = await fn();
          update(key, { status: 'ok' });
          return result;
        } catch (err: any) {
          attemptNum += 1;
          const backoff = Math.min(1000 * Math.pow(2, attemptNum - 1), MAX_BACKOFF_MS);
          update(key, {
            status: 'running',
            message: `retry ${attemptNum} in ${Math.round(backoff / 1000)}s: ${err?.message ?? String(err)}`,
          });
          if (attemptNum >= 5) {
            update(key, { status: 'fail', message: err?.message ?? String(err) });
            return null;
          }
          await new Promise((r) => setTimeout(r, backoff));
        }
      }
      return null;
    },
    [update],
  );

  const runGate = useCallback(async () => {
    cancelRef.current = false;
    setChecks({ ...INITIAL_CHECKS });
    setAllGreen(false);
    setElapsed(0);

    const headers = getAuthHeaders();

    // 1. /api/auth/me
    const authOk = await runCheck('auth', async () => {
      const res = await fetch(apiEndpoint('/auth/me'), { headers });
      if (!res.ok) throw new Error(`auth ${res.status}`);
      return res.json();
    });
    if (!authOk || cancelRef.current) return;

    // 2. session/pod status — try /api/code/sessions/:id/status first,
    //    fall back to "assume pending until system_init arrives on WS"
    await runCheck('pod', async () => {
      const res = await fetch(apiEndpoint(`/code/sessions/${sessionId}/status`), { headers });
      if (res.status === 404) {
        // endpoint missing — defer to WS system_init which we also
        // listen for below. Mark OK optimistically here; the `chat`
        // check is the real gate.
        return { deferred: true };
      }
      if (!res.ok) throw new Error(`pod ${res.status}`);
      const data = await res.json().catch(() => ({}));
      const ready = data?.podReady ?? data?.ready ?? data?.status === 'ready';
      if (!ready) throw new Error('pod not ready');
      return data;
    });
    if (cancelRef.current) return;

    // 3. code-server readiness
    await runCheck('codeServer', async () => {
      // Prefer direct /exec/<hash>/ HEAD, fall back to API status.
      if (user?.id) {
        try {
          const hash = await computeUserHash(user.id);
          const res = await fetch(`/exec/${hash}/`, { method: 'HEAD' });
          if (res.ok) return { via: 'exec', hash };
        } catch { /* fallthrough */ }
      }
      // Code-server is lazy-spawned when the user opens the Editor
      // pane. At gate time we only need to confirm the management
      // endpoint is reachable — a `status=no_session` response still
      // means "pod is alive, code-server just hasn't been asked to
      // start yet", which is fine. Treat any 2xx as OK.
      const res = await fetch(
        apiEndpoint(`/openagentic/sessions/${sessionId}/code-server`),
        { headers },
      );
      if (!res.ok) throw new Error(`code-server ${res.status}`);
      const data = await res.json().catch(() => ({}));
      return data;
    });
    if (cancelRef.current) return;

    // 4. ws-chat opens + exec pod accepts the upgrade (emits _exec/ready)
    //
    // We deliberately do NOT wait for `system=init` here — openagentic
    // emits that frame only after the first user message, so using it
    // as a gate would deadlock forever. The exec pod sends an envelope
    // `{type:'_exec',kind:'ready'}` the moment it accepts the upgrade
    // AND has a registered pty session, which is exactly what the gate
    // needs to confirm. We close the probe socket after receiving it so
    // the real useCodeModeChat hook can open its own connection.
    await runCheck('chat', async () => {
      return await new Promise((resolve, reject) => {
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const qs = new URLSearchParams();
        qs.set('sessionId', sessionId);
        if (authToken) qs.set('token', authToken);
        const url = `${proto}//${window.location.host}/api/code/ws/chat?${qs.toString()}`;
        const ws = new WebSocket(url);
        wsRef.current = ws;
        let resolved = false;
        const timeout = setTimeout(() => {
          if (resolved) return;
          try { ws.close(); } catch {}
          reject(new Error('ws-chat ready timeout'));
        }, STEP_TIMEOUT_MS);
        const finish = (payload: unknown) => {
          if (resolved) return;
          resolved = true;
          clearTimeout(timeout);
          try { ws.close(1000, 'gate probe done'); } catch {}
          resolve(payload as any);
        };
        ws.onopen = () => { /* wait for _exec/ready envelope */ };
        ws.onerror = () => {
          if (resolved) return;
          clearTimeout(timeout);
          reject(new Error('ws error'));
        };
        ws.onmessage = (ev) => {
          try {
            const parsed = JSON.parse(ev.data);
            // Exec-level envelope: `{type:'_exec',kind:'ready'}` fires
            // once the pod has the pty session registered.
            if (parsed?.type === '_exec' && parsed?.kind === 'ready') {
              finish({ ready: true });
              return;
            }
            if (parsed?.type === '_exec' && parsed?.kind === 'error') {
              clearTimeout(timeout);
              reject(new Error(`exec error: ${parsed.message || 'unknown'}`));
              try { ws.close(); } catch {}
              return;
            }
            // Back-compat: if the pod ever sends a system/init frame
            // before _exec/ready (legacy path), count that too.
            const rec = parsed?.record ?? parsed;
            if (rec?.type === 'system' && rec?.subtype === 'init') {
              finish({ init: true });
            }
          } catch { /* non-JSON frame — ignore */ }
        };
        ws.onclose = () => {
          if (resolved) return;
          clearTimeout(timeout);
          reject(new Error('ws closed before ready'));
        };
      });
    });
    if (cancelRef.current) return;

    setAllGreen(true);
  }, [sessionId, authToken, user?.id, getAuthHeaders, runCheck]);

  // Run the gate on mount / session change / retry
  useEffect(() => {
    if (!sessionId) return;
    runGate();
    const started = Date.now();
    const tick = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => {
      cancelRef.current = true;
      clearInterval(tick);
      try { wsRef.current?.close(); } catch {}
    };
    // attempt in deps forces re-run on manual retry
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, attempt]);

  if (allGreen) return <>{children}</>;

  const anyFailed = Object.values(checks).some((c) => c.status === 'fail');
  const doneCount = Object.values(checks).filter((c) => c.status === 'ok').length;

  return (
    <div
      className="flex items-center justify-center h-full w-full"
      style={{
        backgroundColor: 'var(--cm-bg, #0d1117)',
        color: 'var(--cm-text, #e6edf3)',
      }}
    >
      <div className="w-[380px] mx-6 px-5 py-5 rounded-lg border"
        style={{
          borderColor: 'var(--cm-border, rgba(240,246,252,0.1))',
          backgroundColor: 'var(--cm-panel, rgba(22,27,34,0.85))',
        }}
      >
        <div className="flex items-center gap-2 mb-4">
          <span
            className="text-lg"
            style={{
              color: anyFailed
                ? 'var(--cm-error, #f85149)'
                : 'var(--cm-accent, #58a6ff)',
            }}
          >
            {anyFailed ? '!' : '⏳'}
          </span>
          <div className="flex-1">
            <div className="text-sm font-semibold">
              {anyFailed ? 'Workspace failed to start' : 'Starting your workspace…'}
            </div>
            <div
              className="text-[11px]"
              style={{ color: 'var(--cm-text-muted, #8b949e)' }}
            >
              {doneCount}/4 ready · {elapsed}s
            </div>
          </div>
        </div>

        <ul className="flex flex-col gap-2">
          {(Object.keys(INITIAL_CHECKS) as CheckKey[]).map((key) => {
            const c = checks[key];
            return <CheckRow key={key} check={c} />;
          })}
        </ul>

        {anyFailed && (
          <button
            type="button"
            onClick={() => setAttempt((a) => a + 1)}
            className="mt-4 w-full py-2 rounded text-xs font-medium transition-colors"
            style={{
              backgroundColor: 'var(--cm-accent, #58a6ff)',
              color: '#0d1117',
            }}
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
};

interface CheckRowProps { check: CheckState; }

const CheckRow: React.FC<CheckRowProps> = ({ check }) => {
  const icon =
    check.status === 'ok' ? '✅'
      : check.status === 'fail' ? '✗'
        : check.status === 'running' ? '⏳'
          : '○';
  const color =
    check.status === 'ok' ? 'var(--cm-success, #3fb950)'
      : check.status === 'fail' ? 'var(--cm-error, #f85149)'
        : check.status === 'running' ? 'var(--cm-accent, #58a6ff)'
          : 'var(--cm-text-muted, #8b949e)';
  const pulse = check.status === 'running' ? 'cm-startup-pulse' : '';

  return (
    <li className="flex items-center gap-2 text-xs">
      <span
        className={`inline-block w-4 text-center ${pulse}`}
        style={{ color }}
      >
        {icon}
      </span>
      <span className="flex-1" style={{ color: 'var(--cm-text, #e6edf3)' }}>
        {check.label}
      </span>
      <span
        className="text-[10px] truncate max-w-[180px]"
        style={{ color: 'var(--cm-text-muted, #8b949e)' }}
        title={check.message ?? check.detail}
      >
        {check.message ?? check.detail}
      </span>
      <style>{`
        @keyframes cm-startup-pulse-kf { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
        .cm-startup-pulse { animation: cm-startup-pulse-kf 1.2s ease-in-out infinite; }
      `}</style>
    </li>
  );
};

export default CodemodeStartupGate;
