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
 * InlineTodoList - Openagentic Style Todo Display
 *
 * Features:
 * - Orange bullet header "Update Todos"
 * - Tree structure with connectors
 * - Checkbox icons (☐) in monospace
 * - Animated strikethrough for completed items
 * - Current task highlighted (in_progress)
 * - Muted color for completed items
 *
 * The strikethrough animation sweeps from left to right
 * when a todo transitions to completed state.
 */

import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence, useAnimation } from 'framer-motion';
import { CheckSquare, Square, Loader2 } from '@/shared/icons';
import type { TodoItem } from '@/stores/useCodeModeStore';

// =============================================================================
// Types
// =============================================================================

interface InlineTodoListProps {
  todos: TodoItem[];
  showHeader?: boolean;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  animate?: boolean;
}

interface TodoItemProps {
  todo: TodoItem;
  isFirst: boolean;
  isLast: boolean;
  animate?: boolean;
}

// =============================================================================
// Animated Strikethrough Component
// =============================================================================

const AnimatedStrikethrough: React.FC<{
  isCompleted: boolean;
  children: React.ReactNode;
}> = ({ isCompleted, children }) => {
  const controls = useAnimation();
  const prevCompleted = useRef(isCompleted);

  useEffect(() => {
    // Only animate if transitioning TO completed state
    if (isCompleted && !prevCompleted.current) {
      controls.start({
        width: '100%',
        transition: { duration: 0.4, ease: 'easeOut' },
      });
    } else if (isCompleted) {
      // Already completed, no animation
      controls.set({ width: '100%' });
    } else {
      controls.set({ width: '0%' });
    }
    prevCompleted.current = isCompleted;
  }, [isCompleted, controls]);

  return (
    <span className="relative inline">
      {children}
      {/* Animated strikethrough line */}
      <motion.span
        initial={{ width: isCompleted ? '100%' : '0%' }}
        animate={controls}
        className="absolute left-0 top-1/2 h-[1.5px] bg-[var(--color-textMuted)]"
        style={{ transform: 'translateY(-50%)' }}
      />
    </span>
  );
};

// =============================================================================
// Todo Item Component
// =============================================================================

const TodoItemComponent: React.FC<TodoItemProps> = ({
  todo,
  isFirst,
  isLast,
  animate = true,
}) => {
  const isCompleted = todo.status === 'completed';
  const isInProgress = todo.status === 'in_progress';

  // Tree connector character
  const connector = isFirst ? '└' : ' ';

  // Icon based on status
  const Icon = isCompleted ? CheckSquare : Square;

  // Text color based on status
  const textColor = isCompleted
    ? 'text-[var(--color-textMuted)]'
    : isInProgress
    ? 'text-[var(--color-text)]'
    : 'text-[var(--color-textSecondary)]';

  // Icon color
  const iconColor = isCompleted
    ? 'text-[var(--cm-success)]'
    : isInProgress
    ? 'text-[var(--accent-warning)]'
    : 'text-[var(--color-textMuted)]';

  return (
    <motion.div
      initial={animate ? { opacity: 0, x: -10 } : false}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2 }}
      className="flex items-start gap-1 font-mono text-[12px] leading-relaxed"
    >
      {/* Tree connector */}
      <span className="text-[var(--color-textMuted)] w-4 flex-shrink-0 select-none">
        {connector}
      </span>

      {/* Checkbox icon */}
      <span className={`flex-shrink-0 mt-0.5 ${iconColor}`}>
        {isInProgress ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <Icon size={12} />
        )}
      </span>

      {/* Todo content with animated strikethrough */}
      <span className={`flex-1 ${textColor}`}>
        <AnimatedStrikethrough isCompleted={isCompleted}>
          {todo.content}
        </AnimatedStrikethrough>

        {/* Show active form for in-progress items */}
        {isInProgress && todo.activeForm && (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="ml-2 text-[var(--accent-warning)] text-[10px]"
          >
            ← {todo.activeForm}
          </motion.span>
        )}
      </span>
    </motion.div>
  );
};

// =============================================================================
// Main Component
// =============================================================================

export const InlineTodoList: React.FC<InlineTodoListProps> = ({
  todos,
  showHeader = true,
  collapsible = false,
  defaultCollapsed = false,
  animate = true,
}) => {
  const [isCollapsed, setIsCollapsed] = React.useState(defaultCollapsed);

  // Count completed todos
  const completedCount = todos.filter((t) => t.status === 'completed').length;
  const totalCount = todos.length;
  const allComplete = completedCount === totalCount;

  if (todos.length === 0) return null;

  return (
    <motion.div
      initial={animate ? { opacity: 0, y: 10 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="my-3"
    >
      {/* Header */}
      {showHeader && (
        <div
          className={`flex items-center gap-2 ${collapsible ? 'cursor-pointer' : ''}`}
          onClick={() => collapsible && setIsCollapsed(!isCollapsed)}
        >
          {/* Orange bullet */}
          <span className="text-lg font-bold text-[var(--accent-warning)]">●</span>

          {/* Title */}
          <span className="font-mono text-[11px] font-medium text-[var(--accent-warning)]">
            Update Todos
          </span>

          {/* Progress badge */}
          <span
            className={`
              px-2 py-0.5 rounded-full text-[10px] font-medium
              ${allComplete
                ? 'bg-[var(--cm-success)]/20 text-[var(--cm-success)]'
                : 'bg-[var(--accent-warning)]/20 text-[var(--accent-warning)]'
              }
            `}
          >
            {completedCount}/{totalCount}
          </span>

          {/* Collapse indicator */}
          {collapsible && (
            <motion.span
              animate={{ rotate: isCollapsed ? -90 : 0 }}
              className="text-[var(--color-textMuted)]"
            >
              ▼
            </motion.span>
          )}
        </div>
      )}

      {/* Todo items */}
      <AnimatePresence>
        {!isCollapsed && (
          <motion.div
            initial={collapsible ? { height: 0, opacity: 0 } : false}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="ml-2 mt-1 space-y-0.5">
              {todos.map((todo, index) => (
                <TodoItemComponent
                  key={todo.id}
                  todo={todo}
                  isFirst={index === 0}
                  isLast={index === todos.length - 1}
                  animate={animate}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

// =============================================================================
// Compact Badge Version (for headers/status bars)
// =============================================================================

export const TodoStatusBadge: React.FC<{
  todos: TodoItem[];
  onClick?: () => void;
}> = ({ todos, onClick }) => {
  const completedCount = todos.filter((t) => t.status === 'completed').length;
  const inProgressCount = todos.filter((t) => t.status === 'in_progress').length;
  const totalCount = todos.length;
  const allComplete = completedCount === totalCount;

  if (totalCount === 0) return null;

  return (
    <motion.button
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      onClick={onClick}
      className={`
        flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium
        transition-all duration-200 font-mono
        ${allComplete
          ? 'bg-[var(--cm-success)]/20 text-[var(--cm-success)] ring-1 ring-[var(--cm-success)]/30'
          : inProgressCount > 0
          ? 'bg-[var(--accent-warning)]/20 text-[var(--accent-warning)] ring-1 ring-[var(--accent-warning)]/30'
          : 'bg-[var(--color-surfaceSecondary)] text-[var(--color-textSecondary)]'
        }
        ${onClick ? 'cursor-pointer hover:brightness-110' : ''}
      `}
    >
      {allComplete ? (
        <CheckSquare size={12} />
      ) : inProgressCount > 0 ? (
        <Loader2 size={12} className="animate-spin" />
      ) : (
        <Square size={12} />
      )}
      <span>Tasks</span>
      <span className="opacity-60">:</span>
      <span className="font-bold">{completedCount}/{totalCount}</span>
    </motion.button>
  );
};

export default InlineTodoList;
