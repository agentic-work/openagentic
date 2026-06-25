/**
 * Optimized Chat State Management Hook
 * Groups related UI state together to reduce re-renders and improve performance
 */

import { useState, useCallback } from 'react';

export interface ChatUIState {
  showChatSessions: boolean;
  showMetricsPanel: boolean;
  showSettings: boolean;
  isSidebarExpanded: boolean;
  showDeleteConfirm: string | null;
  showDocsViewer: boolean;
  showImageAnalysis: boolean;
  showKeyboardHelp: boolean;
  canvasOpen: boolean;
}

const defaultUIState: ChatUIState = {
  showChatSessions: true,
  showMetricsPanel: false,
  showSettings: false,
  isSidebarExpanded: true,
  showDeleteConfirm: null,
  showDocsViewer: false,
  showImageAnalysis: false,
  showKeyboardHelp: false,
  canvasOpen: false
};

export const useOptimizedChatState = (initialState?: Partial<ChatUIState>) => {
  // Group related state together to reduce re-renders
  const [uiState, setUiState] = useState<ChatUIState>({
    ...defaultUIState,
    ...initialState
  });

  const updateUIState = useCallback((updates: Partial<ChatUIState>) => {
    setUiState(prev => ({ ...prev, ...updates }));
  }, []);

  // Helper functions for common state updates
  const toggleState = useCallback((key: keyof ChatUIState) => {
    setUiState(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  }, []);

  const resetUIState = useCallback(() => {
    setUiState(defaultUIState);
  }, []);

  return {
    uiState,
    updateUIState,
    toggleState,
    resetUIState
  };
};