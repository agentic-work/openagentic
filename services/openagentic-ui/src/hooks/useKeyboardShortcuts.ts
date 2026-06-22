/**
 * Keyboard Shortcuts Hook
 * Global keyboard shortcuts for the application
 *
 * Shortcuts:
 * - Ctrl+C: New chat session
 * - Ctrl+L: Light theme
 * - Ctrl+D: Dark theme
 * - Ctrl+A: Admin portal
 * - Ctrl+?: Docs page
 */

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export interface KeyboardShortcuts {
  'ctrl+c': { description: 'New chat session'; action: () => void };
  'ctrl+l': { description: 'Switch to light theme'; action: () => void };
  'ctrl+d': { description: 'Switch to dark theme'; action: () => void };
  'ctrl+a': { description: 'Open admin portal'; action: () => void };
  'ctrl+?': { description: 'Open documentation'; action: () => void };
}

export const KEYBOARD_SHORTCUTS_CONFIG: Record<keyof KeyboardShortcuts, { key: string; ctrl: boolean; description: string }> = {
  'ctrl+c': { key: 'c', ctrl: true, description: 'New chat session' },
  'ctrl+l': { key: 'l', ctrl: true, description: 'Switch to light theme' },
  'ctrl+d': { key: 'd', ctrl: true, description: 'Switch to dark theme' },
  'ctrl+a': { key: 'a', ctrl: true, description: 'Open admin portal' },
  'ctrl+?': { key: '?', ctrl: true, description: 'Open documentation' }
};

interface UseKeyboardShortcutsOptions {
  onNewChat?: () => void;
  onLightTheme?: () => void;
  onDarkTheme?: () => void;
  onAdminPortal?: () => void;
  onDocs?: () => void;
  enabled?: boolean;
}

export const useKeyboardShortcuts = (options: UseKeyboardShortcutsOptions) => {
  const {
    onNewChat,
    onLightTheme,
    onDarkTheme,
    onAdminPortal,
    onDocs,
    enabled = true
  } = options;

  const navigate = useNavigate();

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore if user is typing in an input/textarea
      const target = event.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      // Check for Ctrl/Cmd key combinations
      const isCtrlOrCmd = event.ctrlKey || event.metaKey;

      if (!isCtrlOrCmd) return;

      const key = event.key.toLowerCase();

      switch (key) {
        case 'c':
          event.preventDefault();
          if (onNewChat) {
            onNewChat();
          }
          break;

        case 'l':
          event.preventDefault();
          if (onLightTheme) {
            onLightTheme();
          }
          break;

        case 'd':
          event.preventDefault();
          if (onDarkTheme) {
            onDarkTheme();
          }
          break;

        case 'a':
          event.preventDefault();
          if (onAdminPortal) {
            onAdminPortal();
          } else {
            navigate('/admin');
          }
          break;

        case '?':
        case '/': // Also accept '/' since '?' requires shift
          if (event.shiftKey || key === '?') {
            event.preventDefault();
            if (onDocs) {
              onDocs();
            } else {
              navigate('/docs');
            }
          }
          break;

        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, onNewChat, onLightTheme, onDarkTheme, onAdminPortal, onDocs, navigate]);

  return {
    shortcuts: KEYBOARD_SHORTCUTS_CONFIG
  };
};

export default useKeyboardShortcuts;
