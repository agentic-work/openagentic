/**
 * TaskProgress - Interactive Todo List
 *
 * Displays tasks with real-time status updates:
 * - Checkbox indicators (pending/in-progress/complete/failed)
 * - Strikethrough animation on completion
 * - Progress bar for overall completion
 * - Collapsible with Ctrl+T shortcut
 */

import React, { useMemo, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckSquare,
  Square,
  Loader2,
  XCircle,
  ChevronDown,
  ChevronRight,
  ListTodo,
} from '@/shared/icons';

import type { TaskProgressProps, AgenticTask, TaskStatus } from '../types/activity.types';

// Status icon component
const StatusIcon: React.FC<{ status: TaskStatus; animate?: boolean }> = ({
  status,
  animate = true,
}) => {
  switch (status) {
    case 'completed':
      return (
        <motion.div
          initial={animate ? { scale: 0 } : undefined}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        >
          <CheckSquare className="w-4 h-4 text-[var(--color-success)] flex-shrink-0" />
        </motion.div>
      );
    case 'in_progress':
      return (
        <Loader2
          className="w-4 h-4 text-[var(--color-primary)] flex-shrink-0 animate-spin"
        />
      );
    case 'failed':
      return (
        <XCircle className="w-4 h-4 text-[var(--color-error)] flex-shrink-0" />
      );
    case 'pending':
    default:
      return (
        <Square className="w-4 h-4 text-[var(--color-textMuted)] flex-shrink-0" />
      );
  }
};

// Single task item component
const TaskItem: React.FC<{
  task: AgenticTask;
  animate?: boolean;
  showTimestamp?: boolean;
  isLast?: boolean;
}> = ({ task, animate = true, showTimestamp = false, isLast = false }) => {
  const isInProgress = task.status === 'in_progress';
  const isCompleted = task.status === 'completed';
  const isFailed = task.status === 'failed';

  // Display active form for in_progress, otherwise show title
  const displayText = isInProgress && task.activeForm ? task.activeForm : task.title;

  return (
    <motion.div
      initial={animate ? { opacity: 0, x: -10 } : undefined}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 10 }}
      className={`
        flex items-start gap-2 py-1.5 px-2
        ${!isLast ? 'border-b border-[var(--color-border)]/20' : ''}
        ${isInProgress ? 'bg-[var(--color-primary)]/5' : ''}
        ${isFailed ? 'bg-[var(--color-error)]/5' : ''}
      `}
    >
      <StatusIcon status={task.status} animate={animate} />

      <div className="flex-1 min-w-0">
        <span
          className={`
            text-sm leading-snug block
            ${isCompleted ? 'text-[var(--color-textMuted)] line-through' : 'text-[var(--color-text)]'}
            ${isInProgress ? 'text-[var(--color-primary)]' : ''}
            ${isFailed ? 'text-[var(--color-error)]' : ''}
          `}
        >
          {displayText}
        </span>

        {/* Progress bar for partial progress */}
        {typeof task.progress === 'number' && task.progress > 0 && task.progress < 100 && (
          <div className="mt-1 h-1 bg-[var(--color-surfaceSecondary)] rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-[var(--color-primary)] rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${task.progress}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
        )}

        {/* Timestamp */}
        {showTimestamp && task.completedAt && (
          <span className="text-xs text-[var(--color-textMuted)] mt-0.5 block">
            {new Date(task.completedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Duration badge for completed tasks */}
      {isCompleted && task.startedAt && task.completedAt && (
        <span className="text-xs text-[var(--color-textMuted)] tabular-nums flex-shrink-0">
          {Math.round((task.completedAt - task.startedAt) / 1000)}s
        </span>
      )}
    </motion.div>
  );
};

// Progress bar component
const ProgressBar: React.FC<{ tasks: AgenticTask[] }> = ({ tasks }) => {
  const completed = tasks.filter(t => t.status === 'completed').length;
  const total = tasks.length;
  const percentage = total > 0 ? (completed / total) * 100 : 0;

  return (
    <div className="flex items-center gap-2 px-2 pb-2">
      <div className="flex-1 h-1.5 bg-[var(--color-surfaceSecondary)] rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-gradient-to-r from-[var(--color-success)] to-[var(--color-success)]/80 rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        />
      </div>
      <span className="text-xs text-[var(--color-textMuted)] tabular-nums min-w-[3rem] text-right">
        {completed}/{total}
      </span>
    </div>
  );
};

export const TaskProgress: React.FC<TaskProgressProps> = ({
  tasks,
  animate = true,
  showTimestamps = false,
  collapsible = true,
  isExpanded = true,
  onToggle,
  className = '',
}) => {
  // Ctrl+T keyboard shortcut for toggle
  useEffect(() => {
    if (!collapsible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 't') {
        e.preventDefault();
        onToggle?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [collapsible, onToggle]);

  // Task statistics
  const stats = useMemo(() => {
    const completed = tasks.filter(t => t.status === 'completed').length;
    const inProgress = tasks.find(t => t.status === 'in_progress');
    const failed = tasks.filter(t => t.status === 'failed').length;
    const pending = tasks.filter(t => t.status === 'pending').length;

    return { completed, inProgress, failed, pending, total: tasks.length };
  }, [tasks]);

  const handleToggle = useCallback(() => {
    onToggle?.();
  }, [onToggle]);

  if (tasks.length === 0) {
    return null;
  }

  return (
    <div
      className={`
        task-progress
        bg-[var(--color-surfaceSecondary)]/50
        backdrop-blur-sm
        border border-[var(--color-border)]/30
        rounded-lg
        overflow-hidden
        ${className}
      `}
    >
      {/* Header */}
      <button
        onClick={handleToggle}
        disabled={!collapsible}
        className={`
          w-full flex items-center justify-between gap-2 px-3 py-2
          ${collapsible ? 'hover:bg-[var(--color-surfaceHover)]/50 cursor-pointer' : 'cursor-default'}
          transition-colors text-left
        `}
      >
        <div className="flex items-center gap-2">
          <ListTodo className="w-4 h-4 text-[var(--color-textMuted)]" />
          <span className="text-sm font-medium text-[var(--color-text)]">
            Tasks
          </span>
          <span className="text-xs text-[var(--color-textMuted)]">
            ({stats.completed}/{stats.total})
          </span>
          {stats.inProgress && (
            <span className="text-xs text-[var(--color-primary)] truncate max-w-[200px]">
              • {stats.inProgress.activeForm || stats.inProgress.title}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {collapsible && (
            <span className="text-xs text-[var(--color-textMuted)]">Ctrl+T</span>
          )}
          {collapsible && (
            isExpanded ? (
              <ChevronDown className="w-4 h-4 text-[var(--color-textMuted)]" />
            ) : (
              <ChevronRight className="w-4 h-4 text-[var(--color-textMuted)]" />
            )
          )}
        </div>
      </button>

      {/* Expandable content */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="border-t border-[var(--color-border)]/20">
              {/* Progress bar */}
              <div className="pt-2">
                <ProgressBar tasks={tasks} />
              </div>

              {/* Task items */}
              <div className="max-h-[300px] overflow-y-auto">
                {tasks.map((task, index) => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    animate={animate}
                    showTimestamp={showTimestamps}
                    isLast={index === tasks.length - 1}
                  />
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default TaskProgress;
