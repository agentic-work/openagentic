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
 * useCodeModeCommands - Slash command handling for CodeMode
 *
 * CodeMode-specific commands like:
 * /help - Show CodeMode help
 * /clear - Clear conversation
 * /compact - Toggle compact mode
 * /model - Change model
 * /yolo - Toggle YOLO mode (auto-approve)
 * /diff - Show recent file changes
 * /undo - Undo last file change
 * /git - Git operations
 */

import { useState, useCallback, useMemo } from 'react';

// ============================================================================
// Types
// ============================================================================

export interface CodeModeCommand {
  command: string;
  description: string;
  shortcut?: string;
  category: 'general' | 'editing' | 'git' | 'settings';
}

export interface CodeModeCommandsReturn {
  commands: CodeModeCommand[];
  matchingCommands: CodeModeCommand[];
  isCommand: (input: string) => boolean;
  getMatchingCommands: (input: string) => CodeModeCommand[];
  executeCommand: (command: string, handlers: CodeModeCommandHandlers) => boolean;
}

export interface CodeModeCommandHandlers {
  clearMessages?: () => void;
  compactContext?: () => void;  // Calls backend to compact context/reduce tokens
  toggleYoloMode?: () => void;
  showHelp?: () => void;
  showDiff?: () => void;
  undoLastChange?: () => void;
  gitStatus?: () => void;
  gitCommit?: () => void;
  changeModel?: (model: string) => void;
  showKeyboardShortcuts?: () => void;
  sendSystemMessage?: (message: string) => void;
}

// ============================================================================
// CodeMode Help Content
// ============================================================================

export const CODEMODE_HELP = `# CodeMode Commands

## General
- \`/help\` - Show this help message
- \`/clear\` - Clear conversation history
- \`/shortcuts\` - Show keyboard shortcuts

## Editing
- \`/compact\` - Compact context to reduce token usage
- \`/yolo\` - Toggle YOLO mode (auto-approve all changes)
- \`/diff\` - Show recent file changes
- \`/undo\` - Undo last file change

## Git
- \`/git status\` - Show git status
- \`/git commit\` - Commit staged changes
- \`/git diff\` - Show unstaged changes

## Settings
- \`/model\` - Change the AI model

## Keyboard Shortcuts
- \`Ctrl+O\` - Expand/collapse all tool outputs
- \`Ctrl+C\` - Cancel current operation
- \`↑/↓\` - Navigate command history
- \`Enter\` - Send message
- \`Shift+Enter\` - New line

---
Type a command or describe what you want to build!`;

// ============================================================================
// Available Commands
// ============================================================================

const COMMANDS: CodeModeCommand[] = [
  // General
  {
    command: '/help',
    description: 'Show CodeMode help and commands',
    category: 'general',
  },
  {
    command: '/clear',
    description: 'Clear conversation history',
    category: 'general',
  },
  {
    command: '/shortcuts',
    description: 'Show keyboard shortcuts',
    shortcut: '?',
    category: 'general',
  },

  // Editing
  {
    command: '/compact',
    description: 'Compact context to reduce token usage',
    category: 'editing',
  },
  {
    command: '/yolo',
    description: 'Toggle YOLO mode (auto-approve changes)',
    shortcut: 'Ctrl+Y',
    category: 'editing',
  },
  {
    command: '/diff',
    description: 'Show recent file changes',
    category: 'editing',
  },
  {
    command: '/undo',
    description: 'Undo last file change',
    shortcut: 'Ctrl+Z',
    category: 'editing',
  },

  // Git
  {
    command: '/git status',
    description: 'Show git status',
    category: 'git',
  },
  {
    command: '/git commit',
    description: 'Commit staged changes with AI message',
    category: 'git',
  },
  {
    command: '/git diff',
    description: 'Show unstaged changes',
    category: 'git',
  },

  // Settings
  {
    command: '/model',
    description: 'Change the AI model',
    category: 'settings',
  },
];

// ============================================================================
// Keyboard Shortcuts Content
// ============================================================================

export const KEYBOARD_SHORTCUTS = `# Keyboard Shortcuts

## Navigation
| Shortcut | Action |
|----------|--------|
| \`↑\` / \`↓\` | Navigate command history |
| \`Tab\` | Autocomplete command |
| \`Esc\` | Close autocomplete / Cancel |

## Editing
| Shortcut | Action |
|----------|--------|
| \`Ctrl+O\` | Expand/collapse all outputs |
| \`Ctrl+Y\` | Toggle YOLO mode |
| \`Ctrl+C\` | Cancel current operation |
| \`Ctrl+Z\` | Undo last change |

## Input
| Shortcut | Action |
|----------|--------|
| \`Enter\` | Send message |
| \`Shift+Enter\` | New line |
| \`Ctrl+V\` | Paste (supports images) |

## Commands
Type \`/\` to see available commands`;

// ============================================================================
// Hook Implementation
// ============================================================================

export function useCodeModeCommands(): CodeModeCommandsReturn {
  const isCommand = useCallback((input: string): boolean => {
    const trimmed = input.trim();
    return trimmed.startsWith('/');
  }, []);

  const getMatchingCommands = useCallback((input: string): CodeModeCommand[] => {
    const trimmed = input.trim().toLowerCase();
    if (!trimmed.startsWith('/')) return [];

    // If just "/", show all commands
    if (trimmed === '/') {
      return COMMANDS;
    }

    return COMMANDS.filter(cmd =>
      cmd.command.toLowerCase().startsWith(trimmed) ||
      cmd.command.toLowerCase().includes(trimmed.slice(1))
    );
  }, []);

  const [inputValue, setInputValue] = useState('');

  const matchingCommands = useMemo(() => {
    return getMatchingCommands(inputValue);
  }, [inputValue, getMatchingCommands]);

  const executeCommand = useCallback((
    command: string,
    handlers: CodeModeCommandHandlers
  ): boolean => {
    const trimmed = command.trim().toLowerCase();
    const cmd = COMMANDS.find(c => c.command === trimmed);

    if (!cmd && !trimmed.startsWith('/git')) return false;

    switch (trimmed) {
      case '/help':
        handlers.sendSystemMessage?.(CODEMODE_HELP);
        return true;

      case '/clear':
        handlers.clearMessages?.();
        return true;

      case '/shortcuts':
        handlers.sendSystemMessage?.(KEYBOARD_SHORTCUTS);
        return true;

      case '/compact':
        handlers.compactContext?.();
        return true;

      case '/yolo':
        handlers.toggleYoloMode?.();
        return true;

      case '/diff':
        handlers.showDiff?.();
        return true;

      case '/undo':
        handlers.undoLastChange?.();
        return true;

      case '/git status':
        handlers.gitStatus?.();
        return true;

      case '/git commit':
        handlers.gitCommit?.();
        return true;

      case '/git diff':
        // Use showDiff for git diff as well
        handlers.showDiff?.();
        return true;

      case '/model':
        // This would open a model selector
        handlers.sendSystemMessage?.('Use the model selector in the toolbar to change models.');
        return true;

      default:
        // Handle partial git commands
        if (trimmed.startsWith('/git')) {
          handlers.gitStatus?.();
          return true;
        }
        return false;
    }
  }, []);

  return {
    commands: COMMANDS,
    matchingCommands,
    isCommand,
    getMatchingCommands,
    executeCommand,
  };
}

export default useCodeModeCommands;
