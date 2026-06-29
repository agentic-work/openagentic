import React from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { useCallback, useEffect } from 'react';
import { onKeyActivate } from '@/utils/a11y';

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

// Normalize a single key combo ("cmd+M") to a stable lookup key ("cmd+m").
function normalizeCombo(combo: string): string {
  return combo
    .trim()
    .toLowerCase()
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .join('+');
}

// Flattened, render-stable maps built once from the static `shortcuts` table.
// One key combo → its action. Used to dispatch from a single useHotkeys call.
const COMBO_TO_ACTION: Record<string, keyof KeyboardActions> = {};
const ALL_COMBOS: string[] = [];
for (const { keys, action } of shortcuts) {
  for (const combo of keys.split(',').map((k) => k.trim()).filter(Boolean)) {
    ALL_COMBOS.push(combo);
    COMBO_TO_ACTION[normalizeCombo(combo)] = action;
  }
}

export function useKeyboardShortcuts(actions: KeyboardActions, enabled: boolean = true) {
  // Register every shortcut in ONE top-level useHotkeys call (hooks must not be
  // called inside a loop/callback — rules-of-hooks). The fired hotkey is
  // resolved back to its action via the COMBO_TO_ACTION lookup.
  useHotkeys(
    ALL_COMBOS,
    (e, handler) => {
      if (!enabled) return; // Don't execute if disabled
      e.preventDefault();
      // react-hotkeys-hook v4: `handler.keys` is the matched non-modifier
      // keys; rebuild the combo using the live modifier flags so it matches
      // the normalized lookup regardless of cmd/ctrl variant.
      const parts: string[] = [];
      if (e.ctrlKey) parts.push('ctrl');
      if (e.metaKey) parts.push('cmd');
      if (e.altKey) parts.push('alt');
      if (e.shiftKey) parts.push('shift');
      for (const k of handler.keys ?? []) parts.push(k);
      const action = COMBO_TO_ACTION[normalizeCombo(parts.join('+'))];
      if (!action) return;
      const actionFn = actions[action];
      if (actionFn && typeof actionFn === 'function') {
        actionFn();
      }
    },
    {
      enableOnFormTags: false,
      preventDefault: true,
      enabled // Use the enabled parameter
    },
    [actions, enabled]
  );

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
        className="absolute inset-0 bg-[var(--color-shadow)]/80"
        role="button"
        tabIndex={0}
        aria-label="Close"
        onClick={onClose}
        onKeyDown={onKeyActivate(onClose)}
      />

      {/* Modal — neo-brutalist: sharp corners, 2px ink border, hard shadow */}
      <div className="relative max-w-3xl w-full max-h-[80vh] overflow-hidden shadow-hard-lg bg-surface border-ink">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--color-border)]">
          <h2 className="text-xl font-semibold text-[var(--color-text)]">
            Keyboard Shortcuts
          </h2>
        </div>

        {/* Content */}
        <div className="px-6 py-4 overflow-y-auto max-h-[60vh]">
          {categories.map(category => (
            <div key={category} className="mb-6 last:mb-0">
              <h3 className="text-sm font-semibold mb-3 text-fg-subtle">
                {category}
              </h3>
              <div className="space-y-2">
                {shortcutsByCategory[category].map(({ keys, description }) => (
                  <div
                    key={keys}
                    className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-surface-hover"
                  >
                    <span className="text-sm text-fg-muted">
                      {description}
                    </span>
                    <div className="flex gap-1">
                      {keys.split(', ').map((key, idx) => (
                        <kbd
                          key={idx}
                          className="px-2 py-1 text-xs font-mono rounded bg-[var(--color-surface-2)] text-fg-muted border border-rule"
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
        <div className="px-6 py-3 border-t border-[var(--color-border)]">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-150 bg-[var(--color-surface-2)] hover:bg-surface-hover text-fg-muted"
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
    .replace(/ctrl/gi, 'Ctrl')
    .replace(/shift/gi, '⇧')
    .replace(/\+/g, ' ')
    .replace(/enter/gi, '↵')
    .replace(/,/g, '<')
    .trim();
}