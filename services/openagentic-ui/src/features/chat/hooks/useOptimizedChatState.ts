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