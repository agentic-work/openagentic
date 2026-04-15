/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * NativeTranscript — Slack/Linear-style React timeline for openagentic events
 *
 * Phase 4 of the CodeMode polish work. Users who prefer a polished
 * React UI over a terminal can toggle to "Transcript mode" in CodeMode
 * settings, which hides TerminalPanel and shows this component instead.
 *
 * Architecture choice: we DO NOT spawn openagentic in a different mode.
 * The exec pod still runs the standard Ink TUI under a PTY. The
 * structured tool events that flow through Phase 3's /ws/progress
 * channel are also the source for this transcript — same events,
 * different presentation. Switching modes is instant and stateful
 * (terminal mode preserves scrollback, transcript mode preserves
 * message order).
 *
 * What it renders:
 *   - In-flight tools (top of timeline, animated spinner)
 *   - Recent tool runs (one row each, ✓ / ✗, file path, duration)
 *   - The current activity status pill
 *   - A "switch to terminal mode" hint at the bottom
 *
 * What it does NOT render (yet):
 *   - The actual model assistant text — that flows through the PTY
 *     into xterm.js and is not on the progress channel today. The
 *     transcript shows tool execution; the terminal underneath shows
 *     the conversation. A future expansion could mirror assistant
 *     text into the side channel via an extra openagentic log event
 *     (`agw_assistant_text`) and render it here.
 *
 * The design intentionally keeps this as a *complementary* surface,
 * not a full replacement. Power users can toggle between views; the
 * data model is the same.
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, X, Loader, Terminal as TerminalIcon, Edit as EditIcon, FilePlus, Wrench, Info } from '@/shared/icons';
import {
  useInFlightTools,
  useRecentTools,
  useProgressConnectionState,
  type RecentTool,
  type InFlightTool,
} from '../hooks/useOpenagenticProgress';
import { useActivityState, useActivityMessage } from '@/stores/useCodeModeStore';
import clsx from 'clsx';

interface NativeTranscriptProps {
  className?: string;
  /** Callback to switch back to terminal mode (used by the footer hint). */
  onSwitchToTerminal?: () => void;
}

function iconForTool(toolName: string): React.ReactNode {
  const lower = toolName.toLowerCase();
  if (lower.includes('bash') || lower.includes('shell') || lower === 'run') {
    return <TerminalIcon size={16} />;
  }
  if (lower === 'edit' || lower.includes('edit') || lower.includes('replace')) {
    return <EditIcon size={16} />;
  }
  if (lower === 'write' || lower.includes('write')) {
    return <FilePlus size={16} />;
  }
  return <Wrench size={16} />;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 1000)}s`;
}

interface TimelineRowProps {
  children: React.ReactNode;
  tone?: 'default' | 'success' | 'error' | 'pending';
}

const TimelineRow: React.FC<TimelineRowProps> = ({ children, tone = 'default' }) => {
  return (
    <div
      className={clsx(
        'flex items-start gap-3 px-4 py-3 border-b transition-colors',
        'border-[var(--color-border)]/40',
        tone === 'success' && 'hover:bg-[var(--cm-success,#10b981)]/5',
        tone === 'error' && 'hover:bg-[var(--cm-error,#ef4444)]/5',
        tone === 'pending' && 'bg-[var(--cm-warning,#f59e0b)]/5',
        tone === 'default' && 'hover:bg-[var(--color-surfaceHover)]/50',
      )}
    >
      {children}
    </div>
  );
};

const InFlightRow: React.FC<{ tool: InFlightTool; tickKey: number }> = ({ tool, tickKey: _tickKey }) => {
  const elapsed = Date.now() - tool.startedAt;
  return (
    <TimelineRow tone="pending">
      <div className="flex-shrink-0 mt-0.5 text-[var(--cm-warning,#f59e0b)]">
        <Loader size={16} className="animate-spin" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[var(--cm-warning,#f59e0b)]">{iconForTool(tool.toolName)}</span>
          <span className="font-mono font-medium text-[var(--color-text)]">{tool.toolName}</span>
          <span className="text-xs text-[var(--color-textMuted)] font-mono">
            running · {formatDuration(elapsed)}
          </span>
        </div>
      </div>
    </TimelineRow>
  );
};

const RecentRow: React.FC<{ tool: RecentTool }> = ({ tool }) => {
  const tone = tool.ok ? 'success' : 'error';
  const icon = tool.ok ? (
    <Check size={16} className="text-[var(--cm-success,#10b981)]" />
  ) : (
    <X size={16} className="text-[var(--cm-error,#ef4444)]" />
  );
  return (
    <TimelineRow tone={tone}>
      <div className="flex-shrink-0 mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="opacity-70">{iconForTool(tool.toolName)}</span>
          <span className="font-mono font-medium text-[var(--color-text)]">{tool.toolName}</span>
          <span className="text-xs text-[var(--color-textMuted)] font-mono">
            {tool.ok ? 'completed' : 'failed'} · {formatDuration(tool.durationMs)}
          </span>
        </div>
        {!tool.ok && tool.reason ? (
          <div className="mt-1 text-xs text-[var(--cm-error,#ef4444)] font-mono break-words">
            {tool.reason}
          </div>
        ) : null}
      </div>
      <div className="flex-shrink-0 text-xs text-[var(--color-textMuted)] font-mono whitespace-nowrap">
        {new Date(tool.endedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </div>
    </TimelineRow>
  );
};

export const NativeTranscript: React.FC<NativeTranscriptProps> = ({
  className,
  onSwitchToTerminal,
}) => {
  const inFlight = useInFlightTools();
  const recent = useRecentTools();
  const connectionState = useProgressConnectionState();
  const activityState = useActivityState();
  const activityMessage = useActivityMessage();

  // Live tick for elapsed counters on in-flight rows.
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    if (inFlight.size === 0) return;
    const id = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, [inFlight.size]);

  const inFlightArr = Array.from(inFlight.values()).sort((a, b) => a.startedAt - b.startedAt);

  // Show recent tools newest at the top (vs. card stack which is newest at bottom)
  // because a transcript reads top-down chronologically.
  const recentReversed = [...recent].reverse();

  // Auto-scroll to top when new in-flight tools appear so the running
  // ones are always visible.
  const scrollRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (inFlightArr.length === 0) return;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [inFlightArr.length]);

  const empty = inFlight.size === 0 && recent.length === 0;

  return (
    <div
      className={clsx(
        'flex flex-col h-full bg-[var(--color-background)]',
        className,
      )}
    >
      {/* Header */}
      <div
        className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[var(--color-text)]">Transcript</span>
          <span
            className={clsx(
              'text-xs px-1.5 py-0.5 rounded font-mono',
              connectionState === 'open'
                ? 'bg-[var(--cm-success,#10b981)]/10 text-[var(--cm-success,#10b981)]'
                : connectionState === 'connecting'
                  ? 'bg-[var(--cm-info,#3b82f6)]/10 text-[var(--cm-info,#3b82f6)]'
                  : 'bg-[var(--color-textMuted)]/10 text-[var(--color-textMuted)]',
            )}
          >
            {connectionState}
          </span>
        </div>
        {activityState !== 'idle' && activityMessage ? (
          <div className="text-xs text-[var(--color-textMuted)] italic animate-pulse">
            {activityMessage}
          </div>
        ) : null}
      </div>

      {/* Timeline */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {empty ? (
          <div className="flex flex-col items-center justify-center h-full px-8 text-center">
            <Info size={32} className="text-[var(--color-textMuted)]/40 mb-3" />
            <p className="text-sm text-[var(--color-textMuted)]">
              No tool activity yet.
            </p>
            <p className="text-xs text-[var(--color-textMuted)]/70 mt-1">
              Tool runs will appear here as openagentic executes them.
            </p>
            {onSwitchToTerminal ? (
              <button
                onClick={onSwitchToTerminal}
                className={clsx(
                  'mt-4 text-xs px-3 py-1.5 rounded-md',
                  'border border-[var(--color-border)]',
                  'text-[var(--color-textSecondary)]',
                  'hover:bg-[var(--color-surfaceHover)]',
                  'transition-colors',
                )}
              >
                Switch to Terminal mode
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <AnimatePresence mode="popLayout">
              {inFlightArr.map((tool) => (
                <motion.div
                  key={tool.toolUseId}
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                >
                  <InFlightRow tool={tool} tickKey={tick} />
                </motion.div>
              ))}
            </AnimatePresence>
            {recentReversed.map((tool) => (
              <RecentRow key={tool.toolUseId} tool={tool} />
            ))}
          </>
        )}
      </div>

      {/* Footer hint */}
      {!empty && onSwitchToTerminal ? (
        <div
          className="flex-shrink-0 px-4 py-2 border-t text-xs text-[var(--color-textMuted)] flex items-center justify-between"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <span>Tool execution timeline</span>
          <button
            onClick={onSwitchToTerminal}
            className="hover:text-[var(--color-text)] underline-offset-2 hover:underline"
          >
            Switch to Terminal mode
          </button>
        </div>
      ) : null}
    </div>
  );
};

export default NativeTranscript;
