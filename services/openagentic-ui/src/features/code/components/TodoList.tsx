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
 * TodoList Component - Openagentic CLI Style
 *
 * Displays a collapsible todo list with checkbox indicators like Openagentic CLI.
 * Supports Ctrl+T keyboard shortcut to toggle expansion.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckSquare,
  Square,
  ChevronDown,
  ChevronRight,
  Loader2,
  ListTodo
} from '@/shared/icons';
import type { TodoItem, TodoStatus } from '../types/protocol';

interface TodoListProps {
  todos: TodoItem[];
  defaultExpanded?: boolean;
  className?: string;
  onToggle?: (expanded: boolean) => void;
}

// Status icon component
const StatusIcon: React.FC<{ status: TodoStatus }> = ({ status }) => {
  switch (status) {
    case 'completed':
      return (
        <CheckSquare
          className="w-4 h-4 text-[var(--color-success)] flex-shrink-0"
          strokeWidth={2}
        />
      );
    case 'in_progress':
      return (
        <Loader2
          className="w-4 h-4 text-[var(--color-primary)] flex-shrink-0 animate-spin"
          strokeWidth={2}
        />
      );
    case 'pending':
    default:
      return (
        <Square
          className="w-4 h-4 text-[var(--color-textMuted)] flex-shrink-0"
          strokeWidth={2}
        />
      );
  }
};

// Single todo item component
const TodoItemRow: React.FC<{ item: TodoItem; isLast: boolean }> = ({ item, isLast }) => {
  const isInProgress = item.status === 'in_progress';
  const isCompleted = item.status === 'completed';

  // Display activeForm for in_progress, otherwise show content
  const displayText = isInProgress && item.activeForm ? item.activeForm : item.content;

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 10 }}
      className={`
        flex items-start gap-2 py-1.5 px-2
        ${!isLast ? 'border-b border-[var(--color-border)]/20' : ''}
        ${isInProgress ? 'bg-[var(--color-primary)]/5' : ''}
        ${isCompleted ? 'opacity-60' : ''}
      `}
    >
      <StatusIcon status={item.status} />
      <span
        className={`
          text-sm leading-snug flex-1
          ${isCompleted ? 'text-[var(--color-textMuted)] line-through' : 'text-[var(--color-text)]'}
          ${isInProgress ? 'text-[var(--color-primary)]' : ''}
        `}
      >
        {displayText}
      </span>
    </motion.div>
  );
};

// Progress bar component
const ProgressBar: React.FC<{ todos: TodoItem[] }> = ({ todos }) => {
  const completed = todos.filter(t => t.status === 'completed').length;
  const total = todos.length;
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

export const TodoList: React.FC<TodoListProps> = ({
  todos,
  defaultExpanded = true,
  className = '',
  onToggle
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  // Handle toggle
  const handleToggle = useCallback(() => {
    setIsExpanded(prev => {
      const newValue = !prev;
      onToggle?.(newValue);
      return newValue;
    });
  }, [onToggle]);

  // Ctrl+T keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 't') {
        e.preventDefault();
        handleToggle();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleToggle]);

  // Don't render if no todos
  if (todos.length === 0) {
    return null;
  }

  // Count stats
  const inProgress = todos.find(t => t.status === 'in_progress');
  const completedCount = todos.filter(t => t.status === 'completed').length;
  const pendingCount = todos.filter(t => t.status === 'pending').length;

  return (
    <div
      className={`
        bg-[var(--color-surfaceSecondary)]/50 backdrop-blur-sm border border-[var(--color-border)]/30 rounded-lg
        overflow-hidden
        ${className}
      `}
    >
      {/* Header - Always visible */}
      <button
        onClick={handleToggle}
        className="
          w-full flex items-center justify-between gap-2 px-3 py-2
          hover:bg-[var(--color-surfaceHover)]/50 transition-colors
          text-left
        "
      >
        <div className="flex items-center gap-2">
          <ListTodo className="w-4 h-4 text-[var(--color-textMuted)]" />
          <span className="text-sm font-medium text-[var(--color-text)]">
            Tasks
          </span>
          <span className="text-xs text-[var(--color-textMuted)]">
            ({completedCount}/{todos.length})
          </span>
          {inProgress && (
            <span className="text-xs text-[var(--color-primary)] truncate max-w-[200px]">
              • {inProgress.activeForm || inProgress.content}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--color-textMuted)]">Ctrl+T</span>
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-[var(--color-textMuted)]" />
          ) : (
            <ChevronRight className="w-4 h-4 text-[var(--color-textMuted)]" />
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
                <ProgressBar todos={todos} />
              </div>

              {/* Todo items */}
              <div className="max-h-[300px] overflow-y-auto">
                {todos.map((item, index) => (
                  <TodoItemRow
                    key={item.id}
                    item={item}
                    isLast={index === todos.length - 1}
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

// Compact inline version for status bar
export const TodoStatusBadge: React.FC<{ todos: TodoItem[] }> = ({ todos }) => {
  if (todos.length === 0) return null;

  const completed = todos.filter(t => t.status === 'completed').length;
  const inProgress = todos.find(t => t.status === 'in_progress');
  const percentage = Math.round((completed / todos.length) * 100);

  return (
    <div className="flex items-center gap-1.5 text-xs">
      <ListTodo className="w-3.5 h-3.5 text-[var(--color-textMuted)]" />
      <span className="text-[var(--color-textSecondary)]">
        {completed}/{todos.length}
      </span>
      {inProgress && (
        <>
          <Loader2 className="w-3 h-3 text-[var(--color-primary)] animate-spin" />
          <span className="text-[var(--color-primary)] truncate max-w-[150px]">
            {inProgress.activeForm || inProgress.content}
          </span>
        </>
      )}
      {!inProgress && percentage === 100 && (
        <CheckSquare className="w-3.5 h-3.5 text-[var(--color-success)]" />
      )}
    </div>
  );
};

export default TodoList;
