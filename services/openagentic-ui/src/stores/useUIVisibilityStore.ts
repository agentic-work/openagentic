/**
 * UI Visibility Store
 * Centralized state management for all UI panel visibility toggles
 * Reduces ChatContainer from 18+ useState calls to a single store import
 */

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';

// Keys that should be persisted to localStorage
const PERSISTED_KEYS = [
  'showMCPIndicators',
  'showThinkingInline',
  'showModelBadges',
  'isSidebarExpanded',
] as const;

interface UIVisibilityState {
  // Panel visibility (session-only, reset on reload)
  showChatSessions: boolean;
  showMetricsPanel: boolean;
  showSettings: boolean;
  showKeyboardHelp: boolean;
  showDocsViewer: boolean;
  showAdminPortal: boolean;
  showBackgroundJobs: boolean;
  showTokenUsage: boolean;
  showTokenGraph: boolean;
  showPersonalTokenUsage: boolean;
  showPromptTechniques: boolean;
  showMCPTools: boolean;
  showImageAnalysis: boolean;
  canvasOpen: boolean;

  // User preference toggles (persisted to localStorage)
  showMCPIndicators: boolean;
  showThinkingInline: boolean;
  showModelBadges: boolean;
  isSidebarExpanded: boolean;

  // Confirmation dialogs (special - holds ID)
  showDeleteConfirm: string | null;
}

interface UIVisibilityActions {
  // Toggle a boolean visibility state
  toggle: <K extends keyof UIVisibilityState>(
    key: K
  ) => void;

  // Set any visibility state to a specific value
  set: <K extends keyof UIVisibilityState>(
    key: K,
    value: UIVisibilityState[K]
  ) => void;

  // Open a panel (convenience method)
  open: <K extends keyof UIVisibilityState>(key: K) => void;

  // Close a panel (convenience method)
  close: <K extends keyof UIVisibilityState>(key: K) => void;

  // Close all panels (useful for escape key)
  closeAll: () => void;

  // Set delete confirmation dialog
  setDeleteConfirm: (sessionId: string | null) => void;
}

type UIVisibilityStore = UIVisibilityState & UIVisibilityActions;

// Initial state - all panels closed except user preferences
const initialState: UIVisibilityState = {
  // Session-only panels (default closed)
  showChatSessions: true, // Sidebar shown by default
  showMetricsPanel: false,
  showSettings: false,
  showKeyboardHelp: false,
  showDocsViewer: false,
  showAdminPortal: false,
  showBackgroundJobs: false,
  showTokenUsage: false,
  showTokenGraph: false,
  showPersonalTokenUsage: false,
  showPromptTechniques: false,
  showMCPTools: false,
  showImageAnalysis: false,
  canvasOpen: false,

  // User preferences (persisted, default true)
  showMCPIndicators: true,
  showThinkingInline: true,
  showModelBadges: true,
  isSidebarExpanded: true,

  // Dialogs
  showDeleteConfirm: null,
};

export const useUIVisibilityStore = create<UIVisibilityStore>()(
  devtools(
    persist(
      (set) => ({
        ...initialState,

        toggle: (key) =>
          set(
            (state) => ({
              [key]: typeof state[key] === 'boolean' ? !state[key] : state[key],
            }),
            false,
            `toggle/${String(key)}`
          ),

        set: (key, value) =>
          set(
            { [key]: value },
            false,
            `set/${String(key)}`
          ),

        open: (key) =>
          set(
            { [key]: true },
            false,
            `open/${String(key)}`
          ),

        close: (key) =>
          set(
            { [key]: false },
            false,
            `close/${String(key)}`
          ),

        closeAll: () =>
          set(
            {
              showSettings: false,
              showKeyboardHelp: false,
              showDocsViewer: false,
              showAdminPortal: false,
              showBackgroundJobs: false,
              showTokenUsage: false,
              showTokenGraph: false,
              showPersonalTokenUsage: false,
              showPromptTechniques: false,
              showMCPTools: false,
              showImageAnalysis: false,
              canvasOpen: false,
              showDeleteConfirm: null,
            },
            false,
            'closeAll'
          ),

        setDeleteConfirm: (sessionId) =>
          set(
            { showDeleteConfirm: sessionId },
            false,
            'setDeleteConfirm'
          ),
      }),
      {
        name: 'ui-visibility',
        // Only persist user preference keys
        partialize: (state) =>
          Object.fromEntries(
            PERSISTED_KEYS.map((key) => [key, state[key]])
          ) as Pick<UIVisibilityState, (typeof PERSISTED_KEYS)[number]>,
      }
    ),
    { name: 'UIVisibility' }
  )
);

// Selector hooks for common use cases
export const useShowMCPIndicators = () =>
  useUIVisibilityStore((state) => state.showMCPIndicators);

export const useShowThinkingInline = () =>
  useUIVisibilityStore((state) => state.showThinkingInline);

export const useShowModelBadges = () =>
  useUIVisibilityStore((state) => state.showModelBadges);

export const useIsSidebarExpanded = () =>
  useUIVisibilityStore((state) => state.isSidebarExpanded);

// Convenience hook for keyboard shortcuts - use shallow for object return
export const useUIActions = () =>
  useUIVisibilityStore(
    useShallow((state) => ({
      toggle: state.toggle,
      open: state.open,
      close: state.close,
      closeAll: state.closeAll,
    }))
  );
