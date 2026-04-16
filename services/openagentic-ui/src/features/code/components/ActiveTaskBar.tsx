/**
 * ActiveTaskBar - Openagentic CLI Style Sticky Todo Panel
 *
 * A fixed panel showing tasks in CLI terminal style:
 * - ☒ Completed items (strikethrough, muted)
 * - ☐ Pending items
 * - ⏳ In-progress item (highlighted)
 * - Compact, terminal aesthetic
 */

import React from 'react';
import type { TodoItem } from '@/stores/useCodeModeStore';

interface ActiveTaskBarProps {
  todos: TodoItem[];
  className?: string;
}

export const ActiveTaskBar: React.FC<ActiveTaskBarProps> = ({
  todos,
  className = '',
}) => {
  const [isExpanded, setIsExpanded] = React.useState(true);

  // Calculate stats
  const completedCount = todos.filter(t => t.status === 'completed').length;
  const totalCount = todos.length;
  const inProgressTask = todos.find(t => t.status === 'in_progress');
  const allComplete = completedCount === totalCount && totalCount > 0;

  // Don't render if no todos
  if (totalCount === 0) return null;

  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

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
        ) : inProgressTask ? (
          <>
            <span style={{ color: 'var(--cm-info, #39c5cf)' }}>{inProgressTask.activeForm || inProgressTask.content}</span>
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

      {/* Expanded task list - CLI checkbox style */}
      {isExpanded && (
        <div className="ml-3 space-y-0.5">
          {todos.map((todo) => (
            <CLITodoItem key={todo.id} todo={todo} />
          ))}
        </div>
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
