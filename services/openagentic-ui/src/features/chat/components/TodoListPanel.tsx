/**
 * TODO List Panel Component
 * Shows active todos from AI's work
 * Displays persistent list of tasks being worked on
 */

import React from 'react';
import { CheckCircle, Circle, Loader2 } from '@/shared/icons';
import { motion, AnimatePresence } from 'framer-motion';

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string; // The "ing" form shown when in progress
}

interface TodoListPanelProps {
  todos: TodoItem[];
  theme?: 'light' | 'dark';
}

export const TodoListPanel: React.FC<TodoListPanelProps> = ({
  todos,
  theme = 'dark'
}) => {
  if (!todos || todos.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        padding: '16px 20px',
        borderBottom: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-surface)',
        fontFamily: 'system-ui, -apple-system, sans-serif'
      }}
    >
      <div
        style={{
          fontSize: '12px',
          fontWeight: 600,
          color: 'var(--color-textSecondary)',
          marginBottom: '12px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px'
        }}
      >
        Tasks
      </div>

      <AnimatePresence mode="popLayout">
        {todos.map((todo, index) => (
          <motion.div
            key={todo.id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ duration: 0.2, delay: index * 0.05 }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '8px 0',
              fontSize: '13px',
              lineHeight: '1.4'
            }}
          >
            {/* Status icon */}
            {todo.status === 'completed' ? (
              <CheckCircle
                size={16}
                style={{
                  color: 'var(--color-success)',
                  flexShrink: 0
                }}
              />
            ) : todo.status === 'in_progress' ? (
              <Loader2
                size={16}
                style={{
                  color: 'var(--color-primary)',
                  flexShrink: 0,
                  animation: 'spin 1s linear infinite'
                }}
              />
            ) : (
              <Circle
                size={16}
                style={{
                  color: 'var(--color-textTertiary)',
                  flexShrink: 0
                }}
              />
            )}

            {/* Todo content */}
            <div
              style={{
                flex: 1,
                color:
                  todo.status === 'completed'
                    ? 'var(--color-textTertiary)'
                    : todo.status === 'in_progress'
                    ? 'var(--color-text)'
                    : 'var(--color-textSecondary)',
                textDecoration:
                  todo.status === 'completed' ? 'line-through' : 'none',
                fontWeight: todo.status === 'in_progress' ? 500 : 400
              }}
            >
              {todo.status === 'in_progress' && todo.activeForm
                ? todo.activeForm
                : todo.content}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      <style>{`
        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
};

export default TodoListPanel;
