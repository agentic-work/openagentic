/**
 * @copyright 2025 Openagentic LLC
 * @license PROPRIETARY
 */

import React from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { useCallback, useEffect } from 'react';

interface KeyboardActions {
  createNewSession?: () => void;
  toggleMetrics?: () => void;
  toggleZenMode?: () => void;
  openChatSettings?: () => void;
  regenerateMessage?: () => void;
  toggleLeftPanel?: () => void;
  toggleRightPanel?: () => void;
  addUserMessage?: () => void;
  clearCurrentMessages?: () => void;
  saveTopic?: () => void;
  focusInput?: () => void;
  searchMessages?: () => void;
  exportChat?: () => void;
  toggleTools?: () => void;
  setLightTheme?: () => void;
  setDarkTheme?: () => void;
  openAdminPortal?: () => void;
  openDocs?: () => void;
}

interface ShortcutDefinition {
  keys: string;
  description: string;
  category: 'Session' | 'View' | 'Message' | 'Navigation' | 'Tools' | 'Theme';
  action: keyof KeyboardActions;
}

const shortcuts: ShortcutDefinition[] = [
  // Session shortcuts
  { keys: 'cmd+n, ctrl+n', description: 'New chat session', category: 'Session', action: 'createNewSession' },
  { keys: 'cmd+c, ctrl+c', description: 'New chat session (alt)', category: 'Session', action: 'createNewSession' },
  { keys: 'cmd+s, ctrl+s', description: 'Save topic', category: 'Session', action: 'saveTopic' },
  { keys: 'cmd+shift+d, ctrl+shift+d', description: 'Clear current messages', category: 'Session', action: 'clearCurrentMessages' },

  // View shortcuts
  { keys: 'cmd+m, ctrl+m', description: 'Toggle metrics panel', category: 'View', action: 'toggleMetrics' },
  { keys: 'cmd+shift+z, ctrl+shift+z', description: 'Toggle zen mode', category: 'View', action: 'toggleZenMode' },
  { keys: 'cmd+[, ctrl+[', description: 'Toggle left panel', category: 'View', action: 'toggleLeftPanel' },
  { keys: 'cmd+], ctrl+]', description: 'Toggle right panel', category: 'View', action: 'toggleRightPanel' },

  // Message shortcuts
  { keys: 'cmd+r, ctrl+r', description: 'Regenerate last message', category: 'Message', action: 'regenerateMessage' },
  { keys: 'cmd+enter, ctrl+enter', description: 'Add user message', category: 'Message', action: 'addUserMessage' },
  { keys: 'cmd+i, ctrl+i', description: 'Focus input', category: 'Message', action: 'focusInput' },

  // Navigation shortcuts
  { keys: 'cmd+f, ctrl+f', description: 'Search messages', category: 'Navigation', action: 'searchMessages' },
  { keys: 'cmd+e, ctrl+e', description: 'Export chat', category: 'Navigation', action: 'exportChat' },
  { keys: 'cmd+a, ctrl+a', description: 'Open admin portal', category: 'Navigation', action: 'openAdminPortal' },
  { keys: 'cmd+?, ctrl+?', description: 'Open documentation', category: 'Navigation', action: 'openDocs' },

  // Tools shortcuts
  { keys: 'cmd+k, ctrl+k', description: 'Toggle tools panel', category: 'Tools', action: 'toggleTools' },
  { keys: 'cmd+,, ctrl+,', description: 'Open settings', category: 'Tools', action: 'openChatSettings' },

  // Theme shortcuts
  { keys: 'cmd+l, ctrl+l', description: 'Switch to light theme', category: 'Theme', action: 'setLightTheme' },
  { keys: 'cmd+d, ctrl+d', description: 'Switch to dark theme', category: 'Theme', action: 'setDarkTheme' }
];

export function useKeyboardShortcuts(actions: KeyboardActions, enabled: boolean = true) {
  // Register all shortcuts only if enabled
  shortcuts.forEach(({ keys, action }) => {
    useHotkeys(
      keys,
      (e) => {
        if (!enabled) return; // Don't execute if disabled
        e.preventDefault();
        const actionFn = actions[action];
        if (actionFn && typeof actionFn === 'function') {
          actionFn();
        }
      },
      {
        enableOnFormTags: false,
        preventDefault: true,
        enabled // Use the enabled parameter
      }
    );
  });

  // Return shortcut definitions for UI display
  return shortcuts.map(({ keys, description, category }) => ({
    keys,
    description,
    category
  }));
}

// Keyboard shortcuts help component
export interface KeyboardShortcutsHelpProps {
  isOpen: boolean;
  onClose: () => void;
}

export const KeyboardShortcutsHelp: React.FC<KeyboardShortcutsHelpProps> = ({ isOpen, onClose }) => {
  // Close on Escape
  useHotkeys('escape', () => {
    if (isOpen) onClose();
  });

  if (!isOpen) return null;

  const categories = ['Session', 'View', 'Message', 'Navigation', 'Tools', 'Theme'] as const;
  const shortcutsByCategory = categories.reduce((acc, category) => {
    acc[category] = shortcuts.filter(s => s.category === category);
    return acc;
  }, {} as Record<string, ShortcutDefinition[]>);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative max-w-3xl w-full max-h-[80vh] overflow-hidden rounded-2xl shadow-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Keyboard Shortcuts
          </h2>
        </div>

        {/* Content */}
        <div className="px-6 py-4 overflow-y-auto max-h-[60vh]">
          {categories.map(category => (
            <div key={category} className="mb-6 last:mb-0">
              <h3 className="text-sm font-semibold mb-3 text-gray-600 dark:text-gray-400">
                {category}
              </h3>
              <div className="space-y-2">
                {shortcutsByCategory[category].map(({ keys, description }) => (
                  <div
                    key={keys}
                    className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50"
                  >
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      {description}
                    </span>
                    <div className="flex gap-1">
                      {keys.split(', ').map((key, idx) => (
                        <kbd
                          key={idx}
                          className="px-2 py-1 text-xs font-mono rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700"
                        >
                          {formatShortcutKey(key)}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-800">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-150 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200"
          >
            Close (Esc)
          </button>
        </div>
      </div>
    </div>
  );
};

// Helper function to format shortcut keys for display
function formatShortcutKey(key: string): string {
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  
  return key
    .replace(/cmd/gi, isMac ? '⌘' : 'Ctrl')
    .replace(/ctrl/gi, isMac ? 'Ctrl' : 'Ctrl')
    .replace(/shift/gi, '⇧')
    .replace(/\+/g, ' ')
    .replace(/enter/gi, '↵')
    .replace(/,/g, '<')
    .trim();
}