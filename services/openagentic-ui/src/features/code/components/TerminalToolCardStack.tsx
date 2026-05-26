/**
 * TerminalToolCardStack — floating React tool-call cards
 *
 * Phase 3 visual surface for the structured event side channel. Reads
 * inFlight + recent tool state from useProgressStore (populated by
 * useOpenagenticProgress) and renders one card per tool call.
 *
 * Layout:
 *   - Stack lives at bottom-right of the terminal pane (so it doesn't
 *     overlap the activity overlay at top-right)
 *   - Each card animates in on tool start, out on tool end + 4s
 *   - Click-through wrapper so the user can still interact with the
 *     terminal underneath
 *   - Stack max-height ~50% of the pane; older cards slide off the top
 *
 * Per-tool rendering:
 *   - Bash → command-style card (monospace tool name + spinner / check / x)
 *   - Edit / Write → file-edit card (file path glance, success/error)
 *   - Other tools → generic chip
 *
 * The cards are READ-ONLY previews of what's already in the terminal.
 * The terminal remains the source of truth; the cards are a polished
 * pulse so the user can glance at the panel from across the room and
 * see "openagentic is working" without parsing ANSI art.
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, X, Loader, Terminal as TerminalIcon, Edit as EditIcon, FilePlus, Wrench } from '@/shared/icons';
import {
  useInFlightTools,
  useRecentTools,
  type InFlightTool,
  type RecentTool,
} from '../hooks/useOpenagenticProgress';
import clsx from 'clsx';

interface TerminalToolCardStackProps {
  className?: string;
}

/** Pick an icon for a given tool name. Falls back to a generic wrench. */
function iconForTool(toolName: string): React.ReactNode {
  const lower = toolName.toLowerCase();
  if (lower.includes('bash') || lower.includes('shell') || lower === 'run') {
    return <TerminalIcon size={14} />;
  }
  if (lower === 'edit' || lower.includes('edit') || lower.includes('replace')) {
    return <EditIcon size={14} />;
  }
  if (lower === 'write' || lower.includes('write')) {
    return <FilePlus size={14} />;
  }
  return <Wrench size={14} />;
}

/** Format a duration in ms to a chip-friendly string. */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 1000)}s`;
}

interface InFlightCardProps {
  tool: InFlightTool;
  /** Forces a re-render every animation frame so the elapsed counter ticks live. */
  tickKey: number;
}

const InFlightCard: React.FC<InFlightCardProps> = ({ tool, tickKey: _tickKey }) => {
  // _tickKey is intentionally a no-op argument: it forces React to re-render
  // this card on every animation frame from the parent so the elapsed
  // counter below stays live without holding state inside the card.
  const elapsed = Date.now() - tool.startedAt;
  return (
    <motion.div
      key={tool.toolUseId}
      initial={{ opacity: 0, x: 16, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 16, scale: 0.95 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className={clsx(
        'flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-xs',
        'bg-[var(--cm-warning,#f59e0b)]/15 border-[var(--cm-warning,#f59e0b)]/40',
        'text-[var(--cm-warning,#f59e0b)] backdrop-blur-sm shadow-sm',
      )}
    >
      <Loader size={12} className="animate-spin opacity-80" />
      <span className="opacity-80">{iconForTool(tool.toolName)}</span>
      <span className="font-medium font-mono">{tool.toolName}</span>
      <span className="opacity-60 font-mono">· {formatDuration(elapsed)}</span>
    </motion.div>
  );
};

interface RecentCardProps {
  tool: RecentTool;
}

const RecentCard: React.FC<RecentCardProps> = ({ tool }) => {
  const tone = tool.ok
    ? 'bg-[var(--cm-success,#10b981)]/15 border-[var(--cm-success,#10b981)]/40 text-[var(--cm-success,#10b981)]'
    : 'bg-[var(--cm-error,#ef4444)]/15 border-[var(--cm-error,#ef4444)]/40 text-[var(--cm-error,#ef4444)]';
  return (
    <motion.div
      key={tool.toolUseId}
      initial={{ opacity: 0, x: 16, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 16, scale: 0.95 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className={clsx(
        'flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-xs',
        'backdrop-blur-sm shadow-sm',
        tone,
      )}
    >
      {tool.ok ? <Check size={12} /> : <X size={12} />}
      <span className="opacity-80">{iconForTool(tool.toolName)}</span>
      <span className="font-medium font-mono">{tool.toolName}</span>
      <span className="opacity-60 font-mono">· {formatDuration(tool.durationMs)}</span>
      {!tool.ok && tool.reason ? (
        <span className="opacity-70 truncate max-w-[180px]">· {tool.reason}</span>
      ) : null}
    </motion.div>
  );
};

export const TerminalToolCardStack: React.FC<TerminalToolCardStackProps> = ({ className }) => {
  const inFlight = useInFlightTools();
  const recent = useRecentTools();

  // Tick for live elapsed counters on in-flight cards. We only run
  // this when there's at least one in-flight tool to avoid constant
  // re-renders on idle sessions.
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    if (inFlight.size === 0) return;
    const id = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, [inFlight.size]);

  // Prune `recent` cards as time passes — done in the hook layer too,
  // but we also need to trigger React re-renders for cards aging out
  // even when no new events arrive. The hook's _ingest only runs on
  // new events, so without this local timer the cards would visually
  // linger past their retention window until the next event.
  const [_pruneTick, setPruneTick] = React.useState(0);
  React.useEffect(() => {
    if (recent.length === 0) return;
    const id = setInterval(() => setPruneTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [recent.length]);

  const now = Date.now();
  const visibleRecent = recent.filter((t) => now - t.endedAt < 4_000);
  const inFlightArr = Array.from(inFlight.values());

  return (
    <div
      className={clsx(
        'pointer-events-none absolute bottom-3 right-3 flex flex-col items-end gap-1.5',
        'max-h-[50%] overflow-hidden',
        className,
      )}
      style={{ zIndex: 'var(--cm-z-floating, 20)' }}
    >
      <AnimatePresence mode="popLayout">
        {visibleRecent.map((tool) => (
          <RecentCard key={tool.toolUseId} tool={tool} />
        ))}
        {inFlightArr.map((tool) => (
          <InFlightCard key={tool.toolUseId} tool={tool} tickKey={tick} />
        ))}
      </AnimatePresence>
    </div>
  );
};

export default TerminalToolCardStack;
