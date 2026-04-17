import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2,
  Loader2,
  XCircle,
  HardDrive,
  Code2,
  Sparkles,
  Monitor,
} from '@/shared/icons';
import type { InitStep } from '@/stores/useCodeModeStore';

type GateStepKey = 'workspace' | 'vscode' | 'openagentic' | 'chat';
type GateStatus = 'pending' | 'running' | 'complete' | 'failed';

interface GateStep {
  key: GateStepKey;
  label: string;
  detail: string;
  status: GateStatus;
  icon: React.ReactNode;
}

interface SessionBootScreenProps {
  sessionId?: string | null;
  connectionState: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';
  initSteps: InitStep[];
  reconnectAttempts: number;
  onSkip: () => void;
  timeoutMs?: number;
}

const STEP_ORDER: GateStepKey[] = ['workspace', 'vscode', 'openagentic', 'chat'];

const STEP_META: Record<
  GateStepKey,
  { label: string; detail: string; icon: React.ReactNode }
> = {
  workspace: {
    label: 'Workspace',
    detail: 'Sandbox + MinIO storage mount',
    icon: <HardDrive size={18} />,
  },
  vscode: {
    label: 'VS Code',
    detail: 'code-server HTTP endpoint',
    icon: <Code2 size={18} />,
  },
  openagentic: {
    label: 'OpenAgentic CLI',
    detail: 'Ink REPL mount + readiness marker',
    icon: <Sparkles size={18} />,
  },
  chat: {
    label: 'Chat ready',
    detail: 'Streaming channel connected',
    icon: <Monitor size={18} />,
  },
};

function pickStatus(
  key: GateStepKey,
  initSteps: InitStep[],
  connected: boolean,
): GateStatus {
  if (key === 'chat') {
    // Chat step is "ready" as soon as the CLI is up AND the WS is
    // connected — the native chat view sends over HTTP SSE on-demand,
    // so there's no separate "first frame" signal to wait for.
    const cliStep = initSteps.find((s) => s.step === 'openagentic');
    const cliReady = cliStep?.status === 'complete';
    if (cliReady && connected) return 'complete';
    if (cliReady) return 'running';
    return 'pending';
  }

  // The backend's InitStep machine uses slightly different keys than
  // the gate's intentional 4-step grouping — the ready/llm steps feed
  // into openagentic for gate display purposes so we have a single
  // "CLI ready" signal the user can read.
  const backendKey =
    key === 'openagentic' ? ['openagentic', 'llm', 'ready'] : [key];
  const relevant = initSteps.filter((s) => backendKey.includes(s.step));
  if (relevant.length === 0) return connected ? 'running' : 'pending';

  if (relevant.some((s) => s.status === 'failed')) return 'failed';
  if (relevant.every((s) => s.status === 'complete')) return 'complete';
  if (relevant.some((s) => s.status === 'running')) return 'running';
  return 'pending';
}

export const SessionBootScreen: React.FC<SessionBootScreenProps> = ({
  sessionId,
  connectionState,
  initSteps,
  reconnectAttempts,
  onSkip,
  timeoutMs = 45_000,
}) => {
  const connected = connectionState === 'connected';
  const isReconnect = connectionState === 'reconnecting';
  const isError = connectionState === 'error';

  const steps: GateStep[] = useMemo(
    () =>
      STEP_ORDER.map((key) => {
        const meta = STEP_META[key];
        return {
          key,
          label: meta.label,
          detail: meta.detail,
          icon: meta.icon,
          status: pickStatus(key, initSteps, connected),
        };
      }),
    [initSteps, connected],
  );

  const allComplete = steps.every((s) => s.status === 'complete');
  const anyFailed = steps.some((s) => s.status === 'failed');
  const doneCount = steps.filter((s) => s.status === 'complete').length;
  const progressPct = Math.round((doneCount / steps.length) * 100);

  // Skip timeout — resets whenever the connection drops (reconnect
  // path) so every fresh boot attempt gets a fresh window.
  const [timedOut, setTimedOut] = useState(false);
  const startedAtRef = useRef(Date.now());
  useEffect(() => {
    startedAtRef.current = Date.now();
    setTimedOut(false);
    const timer = setTimeout(() => setTimedOut(true), timeoutMs);
    return () => clearTimeout(timer);
  }, [connectionState, timeoutMs]);

  // Mount flag — the gate renders AnimatePresence-controlled children,
  // but the parent controls the visible prop based on allComplete. We
  // still want exit animations to feel smooth.
  const shouldShow = !allComplete;

  return (
    <AnimatePresence>
      {shouldShow && (
        <motion.div
          key="session-boot-screen"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.25 } }}
          transition={{ duration: 0.2 }}
          className="absolute inset-0 z-50 flex items-center justify-center"
          style={{
            background:
              'radial-gradient(circle at 50% 30%, rgba(88,166,255,0.08), rgba(13,17,23,0.98) 70%)',
            backdropFilter: 'blur(10px)',
          }}
        >
          <motion.div
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="w-full max-w-md mx-6"
          >
            {/* Title */}
            <div className="text-center mb-6">
              <motion.div
                animate={
                  anyFailed
                    ? { rotate: 0 }
                    : { rotate: [0, -6, 6, -6, 0], scale: [1, 1.05, 1] }
                }
                transition={{
                  duration: 2.5,
                  repeat: anyFailed ? 0 : Infinity,
                  ease: 'easeInOut',
                }}
                className="inline-block text-4xl mb-3"
              >
                <span style={{ color: anyFailed ? '#f85149' : '#3fb950' }}>◆</span>
              </motion.div>
              <h1 className="text-xl font-semibold text-[#e6edf3] mb-1">
                {isError
                  ? 'Connection error'
                  : isReconnect
                    ? `Reconnecting${reconnectAttempts ? ` (attempt ${reconnectAttempts})` : ''}`
                    : anyFailed
                      ? 'Startup failed'
                      : 'Starting OpenAgentic'}
              </h1>
              <p className="text-xs text-[#8b949e] font-mono">
                {sessionId ? (
                  <>session <span className="text-[#58a6ff]">{sessionId.slice(0, 8)}</span></>
                ) : (
                  'waiting for session id'
                )}
              </p>
            </div>

            {/* Steps */}
            <div className="rounded-xl border border-[#30363d] bg-[#0d1117]/80 overflow-hidden">
              <ul className="divide-y divide-[#21262d]">
                {steps.map((step) => (
                  <li key={step.key} className="flex items-center gap-3 px-4 py-3">
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors"
                      style={{
                        background:
                          step.status === 'complete'
                            ? 'rgba(63,185,80,0.12)'
                            : step.status === 'running'
                              ? 'rgba(88,166,255,0.12)'
                              : step.status === 'failed'
                                ? 'rgba(248,81,73,0.12)'
                                : 'rgba(110,118,129,0.08)',
                        color:
                          step.status === 'complete'
                            ? '#3fb950'
                            : step.status === 'running'
                              ? '#58a6ff'
                              : step.status === 'failed'
                                ? '#f85149'
                                : '#6e7681',
                      }}
                    >
                      {step.status === 'running' ? (
                        <Loader2 size={18} className="animate-spin" />
                      ) : step.status === 'complete' ? (
                        <CheckCircle2 size={18} />
                      ) : step.status === 'failed' ? (
                        <XCircle size={18} />
                      ) : (
                        step.icon
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div
                        className="text-sm font-medium transition-colors"
                        style={{
                          color:
                            step.status === 'complete'
                              ? '#3fb950'
                              : step.status === 'running'
                                ? '#e6edf3'
                                : step.status === 'failed'
                                  ? '#f85149'
                                  : '#6e7681',
                        }}
                      >
                        {step.label}
                      </div>
                      <div className="text-xs text-[#6e7681] truncate">
                        {step.status === 'failed'
                          ? 'Failed — check pod logs'
                          : step.detail}
                      </div>
                    </div>
                    {step.status === 'complete' && (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="text-[#3fb950] shrink-0"
                      >
                        <CheckCircle2 size={14} />
                      </motion.div>
                    )}
                  </li>
                ))}
              </ul>

              {/* Progress bar */}
              <div className="h-1 bg-[#21262d] overflow-hidden">
                <motion.div
                  className="h-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${progressPct}%` }}
                  transition={{ duration: 0.4, ease: 'easeOut' }}
                  style={{
                    background: anyFailed
                      ? '#f85149'
                      : 'linear-gradient(90deg,#3fb950,#58a6ff)',
                  }}
                />
              </div>
            </div>

            {/* Footer status line */}
            <div className="mt-5 flex items-center justify-between gap-4 text-xs">
              <div className="font-mono text-[#6e7681]">
                {isError && <span className="text-[#f85149]">Connection error — reload</span>}
                {isReconnect && <span className="text-[#d29922]">Reconnecting…</span>}
                {!isError && !isReconnect && !anyFailed && (
                  <span>{doneCount}/{steps.length} ready</span>
                )}
                {anyFailed && <span className="text-[#f85149]">Startup failed</span>}
              </div>
              {(timedOut || anyFailed) && (
                <button
                  onClick={onSkip}
                  className="px-3 py-1 rounded-md text-xs font-medium text-[#e6edf3] border border-[#30363d] hover:border-[#484f58] hover:bg-[#21262d] transition-colors"
                >
                  {anyFailed ? 'Show terminal anyway' : 'Skip wait'}
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default SessionBootScreen;
