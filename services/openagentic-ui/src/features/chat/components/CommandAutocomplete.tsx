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
 * CommandAutocomplete - Dropdown menu for slash command autocomplete
 * Shows when user types "/" in the chat input
 */

import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { SlashCommand } from '../hooks/useSlashCommands';

interface CommandAutocompleteProps {
  commands: SlashCommand[];
  selectedIndex: number;
  onSelect: (command: SlashCommand) => void;
  onClose: () => void;
  position?: 'above' | 'below';
}

export const CommandAutocomplete: React.FC<CommandAutocompleteProps> = ({
  commands,
  selectedIndex,
  onSelect,
  onClose,
  position = 'above',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Close on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (commands.length === 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        ref={containerRef}
        initial={{ opacity: 0, y: position === 'above' ? 10 : -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: position === 'above' ? 10 : -10 }}
        transition={{ duration: 0.15 }}
        className="absolute left-0 right-0 z-50 overflow-hidden rounded-lg"
        style={{
          [position === 'above' ? 'bottom' : 'top']: 'calc(100% + 8px)',
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.25)',
          maxHeight: '250px',
          overflowY: 'auto',
        }}
      >
        <div className="py-1">
          {commands.map((command, index) => (
            <button
              key={command.command}
              onClick={() => onSelect(command)}
              className="w-full px-3 py-2 text-left flex items-center gap-3 transition-colors"
              style={{
                backgroundColor: index === selectedIndex
                  ? 'var(--color-surfaceSecondary)'
                  : 'transparent',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--color-surfaceSecondary)';
              }}
              onMouseLeave={(e) => {
                if (index !== selectedIndex) {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }
              }}
            >
              {/* Command */}
              <span
                className="font-mono text-sm font-medium"
                style={{ color: 'var(--color-primary)' }}
              >
                {command.command}
              </span>

              {/* Description */}
              <span
                className="text-sm flex-1"
                style={{ color: 'var(--color-textSecondary)' }}
              >
                {command.description}
              </span>

              {/* Keyboard hint on selected */}
              {index === selectedIndex && (
                <span
                  className="text-xs px-1.5 py-0.5 rounded"
                  style={{
                    backgroundColor: 'var(--color-surfaceTertiary)',
                    color: 'var(--color-textMuted)',
                  }}
                >
                  Enter
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Footer hint */}
        <div
          className="px-3 py-2 text-xs flex items-center gap-2"
          style={{
            borderTop: '1px solid var(--color-border)',
            backgroundColor: 'var(--color-surfaceSecondary)',
            color: 'var(--color-textMuted)',
          }}
        >
          <span className="px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--color-surfaceTertiary)' }}>
            ↑↓
          </span>
          <span>navigate</span>
          <span className="px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--color-surfaceTertiary)' }}>
            ↵
          </span>
          <span>select</span>
          <span className="px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--color-surfaceTertiary)' }}>
            esc
          </span>
          <span>close</span>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default CommandAutocomplete;
