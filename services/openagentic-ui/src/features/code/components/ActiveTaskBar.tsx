/**
 * ActiveTaskBar - Openagentic CLI Style Sticky Todo Panel with deep viz
 *
 * Renders a hierarchical task panel with claude-code TUI parity:
 *   ⏳ In-progress todo (live timer + cumulative tokens)
 *      ⎿ Bash(npm install)         (2.1s ✓)
 *      ⎿ Write(/x/y.ts)            (0.4s ✓)
 *      ⎿ Bash(npm test)            (running 14s)…
 *   ☒ Completed todo                (final time + tokens)
 *   ☐ Pending todo
 *
 * Subtask attribution + token billing comes from enrichTodos.
 */

import React from 'react';
import type { TodoItem } from '@/stores/useCodeModeStore';
import {
  type EnrichedTodo,
  type SubtaskCard,
  formatDurationMs,
  formatTokens,
} from '../utils/enrichTodos';

interface ActiveTaskBarProps {
  todos: TodoItem[];
  /**
   * Optional enriched data for deep viz. When provided, the panel
   * renders per-todo timers + subtask attribution + token usage.
   * Falls back to the simple TodoItem-only render when omitted.
   */
  enriched?: EnrichedTodo[];
  className?: string;
}

/** Tick a re-render every second so live timers visibly count up. */
function useTickEverySecond() {
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
}

export const ActiveTaskBar: React.FC<ActiveTaskBarProps> = ({
  todos,
  enriched,
  className = '',
}) => {
  const [isExpanded, setIsExpanded] = React.useState(true);
  // Tick every second so live timers under in_progress todos and
  // running subtasks visibly count up without needing new messages.
  useTickEverySecond();

  // Prefer enriched data when present (deep viz). Fall back to flat
  // todos for backwards compat / unit tests that don't pass enriched.
  const useEnriched = Array.isArray(enriched) && enriched.length > 0;
  const completedCount = useEnriched
    ? enriched!.filter((t) => t.status === 'completed').length
    : todos.filter((t) => t.status === 'completed').length;
  const totalCount = useEnriched ? enriched!.length : todos.length;
  const inProgressEnriched = useEnriched
    ? enriched!.find((t) => t.status === 'in_progress')
    : undefined;
  const inProgressTask = useEnriched
    ? undefined
    : todos.find((t) => t.status === 'in_progress');
  const allComplete = completedCount === totalCount && totalCount > 0;

  if (totalCount === 0) return null;

  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const headerLabel = inProgressEnriched
    ? inProgressEnriched.activeForm || inProgressEnriched.content
    : inProgressTask
      ? inProgressTask.activeForm || inProgressTask.content
      : null;

  return (
    <div className={`font-mono text-[11px] ${className}`}>
      {/* Header - CLI style with progress percentage */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 cursor-pointer hover:opacity-80 mb-1"
      >
        <span style={{ color: 'var(--cm-info, #39c5cf)' }} className="select-none">◇</span>
        {allComplete ? (
          <span style={{ color: 'var(--cm-success, #22C55E)' }}>All tasks completed</span>
        ) : headerLabel ? (
          <>
            <span style={{ color: 'var(--cm-info, #39c5cf)' }}>{headerLabel}</span>
            <span style={{ color: 'var(--cm-text-muted, #8b949e)' }} className="ml-2">({completedCount}/{totalCount} · {progressPct}%)</span>
          </>
        ) : (
          <span style={{ color: 'var(--cm-text-muted, #8b949e)' }}>{totalCount - completedCount} tasks pending</span>
        )}
      </div>

      {/* Thin progress bar */}
      {!allComplete && totalCount > 0 && (
        <div
          style={{
            height: '2px',
            background: 'var(--cm-border, rgba(255,255,255,0.08))',
            borderRadius: '1px',
            marginBottom: '4px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${progressPct}%`,
              background: 'var(--cm-accent, #7c3aed)',
              borderRadius: '1px',
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      )}

      {/* Expanded task list */}
      {isExpanded && (
        <div className="ml-3 space-y-0.5">
          {useEnriched
            ? enriched!.map((t) => <EnrichedTodoRow key={t.id} todo={t} />)
            : todos.map((todo) => <CLITodoItem key={todo.id} todo={todo} />)}
        </div>
      )}
    </div>
  );
};

/**
 * EnrichedTodoRow — parent todo with live timer + cumulative tokens,
 * plus nested subtask cards (Bash/Write/etc.) with their own timer.
 */
const EnrichedTodoRow: React.FC<{ todo: EnrichedTodo }> = ({ todo }) => {
  const isCompleted = todo.status === 'completed';
  const isInProgress = todo.status === 'in_progress';

  const dur = formatDurationMs(todo.durationMs);
  const tIn = formatTokens(todo.tokensIn);
  const tOut = formatTokens(todo.tokensOut);
  const meta: string[] = [];
  if (dur) meta.push(dur);
  if (tIn || tOut) meta.push(`${tIn || '0'} in / ${tOut || '0'} out`);
  const metaLine = meta.join(' · ');

  return (
    <div>
      {/* Parent todo line */}
      <div className="flex items-start gap-2 text-[12px]">
        <span className="select-none flex-shrink-0">
          {isCompleted ? (
            <span style={{ color: 'var(--cm-success, #22C55E)' }}>☒</span>
          ) : isInProgress ? (
            <span style={{ color: 'var(--cm-warning, #d29922)' }} className="animate-pulse">⏳</span>
          ) : (
            <span style={{ color: 'var(--cm-text-muted, #8b949e)' }}>☐</span>
          )}
        </span>
        <span
          style={{
            color: isCompleted
              ? 'var(--cm-text-muted, #8b949e)'
              : isInProgress
                ? 'var(--cm-text, #e6edf3)'
                : 'var(--cm-text-muted, #8b949e)',
          }}
          className={isCompleted ? 'line-through' : ''}
        >
          {isInProgress && todo.activeForm ? todo.activeForm : todo.content}
        </span>
        {metaLine && (
          <span style={{ color: 'var(--cm-text-muted, #8b949e)' }} className="ml-1 text-[11px]">
            ({metaLine})
          </span>
        )}
      </div>

      {/* Subtasks under in_progress / completed parents */}
      {todo.subtasks.length > 0 && (
        <div className="ml-6 mt-0.5 space-y-0.5">
          {todo.subtasks.map((s) => (
            <SubtaskRow key={s.toolUseId} sub={s} parentInProgress={isInProgress} />
          ))}
        </div>
      )}
    </div>
  );
};

/** Per-subtask card: ⎿ Tool(args) (timer ✓ / running) */
const SubtaskRow: React.FC<{ sub: SubtaskCard; parentInProgress: boolean }> = ({
  sub,
  parentInProgress,
}) => {
  const isRunning = sub.status === 'running';
  const isFailed = sub.status === 'failed';

  // Live timer for running subtasks: now - startedAtMs.
  let timerLabel = '';
  if (typeof sub.elapsedSec === 'number' && sub.elapsedSec > 0) {
    timerLabel = formatDurationMs(Math.round(sub.elapsedSec * 1000));
  } else if (isRunning && sub.startedAtMs && parentInProgress) {
    timerLabel = formatDurationMs(Date.now() - sub.startedAtMs);
  }

  const statusIcon = isRunning ? '…' : isFailed ? '✗' : '✓';
  const statusColor = isRunning
    ? 'var(--cm-warning, #d29922)'
    : isFailed
      ? 'var(--cm-error, #f85149)'
      : 'var(--cm-success, #22C55E)';

  return (
    <div className="flex items-start gap-1.5 text-[11px]" style={{ lineHeight: 1.4 }}>
      <span style={{ color: 'var(--cm-text-muted, #8b949e)' }} className="select-none">⎿</span>
      <span style={{ color: 'var(--cm-info, #39c5cf)' }} className="flex-shrink-0">
        {sub.toolName}
      </span>
      <span style={{ color: 'var(--cm-text-muted, #8b949e)' }} className="truncate" title={sub.summary}>
        {sub.summary}
      </span>
      {timerLabel && (
        <span style={{ color: 'var(--cm-text-muted, #8b949e)' }} className="flex-shrink-0">
          ({timerLabel}
          {isRunning ? ' running' : ''}
          )
        </span>
      )}
      <span style={{ color: statusColor }} className="flex-shrink-0 select-none">
        {statusIcon}
      </span>
      {sub.resultPreview && !isRunning && (
        <span
          style={{ color: 'var(--cm-text-muted-2, #6e7681)' }}
          className="truncate text-[10.5px]"
          title={sub.resultPreview}
        >
          → {sub.resultPreview}
        </span>
      )}
    </div>
  );
};

/**
 * Individual todo row - CLI checkbox style
 */
const CLITodoItem: React.FC<{ todo: TodoItem }> = ({ todo }) => {
  const isCompleted = todo.status === 'completed';
  const isInProgress = todo.status === 'in_progress';

  return (
    <div className="flex items-start gap-2 text-[12px]">
      {/* Checkbox character */}
      <span className="select-none flex-shrink-0">
        {isCompleted ? (
          <span style={{ color: 'var(--cm-success, #22C55E)' }}>☒</span>
        ) : isInProgress ? (
          <span style={{ color: 'var(--cm-warning, #d29922)' }} className="animate-pulse">⏳</span>
        ) : (
          <span style={{ color: 'var(--cm-text-muted, #8b949e)' }}>☐</span>
        )}
      </span>

      {/* Task text */}
      <span
        style={{
          color: isCompleted
            ? 'var(--cm-text-muted, #8b949e)'
            : isInProgress
              ? 'var(--cm-text, #e6edf3)'
              : 'var(--cm-text-muted, #8b949e)',
        }}
        className={isCompleted ? 'line-through' : ''}
      >
        {isInProgress && todo.activeForm ? todo.activeForm : todo.content}
      </span>
    </div>
  );
};

/**
 * Compact badge variant for inline use
 */
export const ActiveTaskBadge: React.FC<ActiveTaskBarProps & { onClick?: () => void }> = ({
  todos,
  className = '',
  onClick,
}) => {
  const completedCount = todos.filter(t => t.status === 'completed').length;
  const totalCount = todos.length;
  const inProgressTask = todos.find(t => t.status === 'in_progress');
  const allComplete = completedCount === totalCount && totalCount > 0;

  if (totalCount === 0) return null;

  return (
    <button
      onClick={onClick}
      className={`
        flex items-center gap-2 text-[12px] font-mono
        ${onClick ? 'cursor-pointer hover:opacity-80' : ''}
        ${className}
      `}
    >
      {/* Icon */}
      {allComplete ? (
        <span style={{ color: 'var(--cm-success, #22C55E)' }}>☒</span>
      ) : inProgressTask ? (
        <span style={{ color: 'var(--cm-warning, #d29922)' }} className="animate-pulse">⏳</span>
      ) : (
        <span style={{ color: 'var(--cm-text-muted, #8b949e)' }}>☐</span>
      )}

      {/* Text */}
      {inProgressTask && (
        <span style={{ color: 'var(--cm-text, #e6edf3)' }} className="truncate max-w-[150px]">
          {inProgressTask.activeForm || inProgressTask.content}
        </span>
      )}

      {/* Progress */}
      <span style={{ color: 'var(--cm-text-muted, #8b949e)' }}>{completedCount}/{totalCount}</span>
    </button>
  );
};

export default ActiveTaskBar;
