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
 * Model Store
 * Centralized state management for LLM model selection
 * Handles model selection, available models list, and multi-model mode
 */

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  provider?: string;
  capabilities?: string[];
}

interface ModelState {
  // Selected model (empty string = let router decide)
  selectedModel: string;

  // List of available models
  availableModels: ModelInfo[];

  // Multi-model orchestration mode
  isMultiModelEnabled: boolean;

  // Loading state
  isLoadingModels: boolean;
}

interface ModelActions {
  // Set selected model
  setSelectedModel: (modelId: string) => void;

  // Set available models
  setAvailableModels: (models: ModelInfo[]) => void;

  // Toggle multi-model mode
  toggleMultiModel: () => void;
  setMultiModelEnabled: (enabled: boolean) => void;

  // Set loading state
  setLoadingModels: (loading: boolean) => void;

  // Reset to default (router selection)
  resetToDefault: () => void;

  // Initialize model from localStorage (for admin users)
  initializeModel: (isAdmin: boolean, availableModelIds: string[]) => void;
}

type ModelStore = ModelState & ModelActions;

const initialState: ModelState = {
  selectedModel: '', // Empty = router decides
  availableModels: [],
  isMultiModelEnabled: false, // Default OFF — let user select model or use Smart Router
  isLoadingModels: false,
};

export const useModelStore = create<ModelStore>()(
  devtools(
    persist(
      (set, get) => ({
        ...initialState,

        setSelectedModel: (modelId) => {
          set(
            { selectedModel: modelId },
            false,
            'setSelectedModel'
          );
        },

        setAvailableModels: (models) => {
          set(
            { availableModels: models },
            false,
            'setAvailableModels'
          );
        },

        toggleMultiModel: () => {
          set(
            (state) => ({ isMultiModelEnabled: !state.isMultiModelEnabled }),
            false,
            'toggleMultiModel'
          );
        },

        setMultiModelEnabled: (enabled) => {
          set(
            { isMultiModelEnabled: enabled },
            false,
            'setMultiModelEnabled'
          );
        },

        setLoadingModels: (loading) => {
          set(
            { isLoadingModels: loading },
            false,
            'setLoadingModels'
          );
        },

        resetToDefault: () => {
          set(
            { selectedModel: '' },
            false,
            'resetToDefault'
          );
        },

        initializeModel: (isAdmin, availableModelIds) => {
          const { selectedModel } = get();

          if (isAdmin) {
            // For admins, validate stored model against available models
            if (selectedModel && availableModelIds.includes(selectedModel)) {
              // Stored model is valid - keep it
              console.log('[ModelStore] Admin using stored model:', selectedModel);
            } else {
              // No valid stored model - use default (router selection)
              console.log('[ModelStore] Admin no valid stored model, using default');
              set({ selectedModel: '' }, false, 'initializeModel/resetToDefault');
            }
          } else {
            // Non-admin - always use default
            console.log('[ModelStore] Non-admin, using default auto-routing');
            set({ selectedModel: '' }, false, 'initializeModel/nonAdmin');
          }
        },
      }),
      {
        name: 'model-selection',
        // Persist selectedModel and multiModel preference
        partialize: (state) => ({
          selectedModel: state.selectedModel,
          isMultiModelEnabled: state.isMultiModelEnabled,
        }),
      }
    ),
    { name: 'ModelStore' }
  )
);

// Selector hooks
export const useSelectedModel = (): string =>
  useModelStore((state) => state.selectedModel);

export const useAvailableModels = (): ModelInfo[] =>
  useModelStore((state) => state.availableModels);

export const useIsMultiModelEnabled = (): boolean =>
  useModelStore((state) => state.isMultiModelEnabled);

export const useIsLoadingModels = (): boolean =>
  useModelStore((state) => state.isLoadingModels);

// Action hooks
export const useModelActions = () => {
  const setSelectedModel = useModelStore((state) => state.setSelectedModel);
  const setAvailableModels = useModelStore((state) => state.setAvailableModels);
  const toggleMultiModel = useModelStore((state) => state.toggleMultiModel);
  const setMultiModelEnabled = useModelStore((state) => state.setMultiModelEnabled);
  const resetToDefault = useModelStore((state) => state.resetToDefault);
  const initializeModel = useModelStore((state) => state.initializeModel);

  return {
    setSelectedModel,
    setAvailableModels,
    toggleMultiModel,
    setMultiModelEnabled,
    resetToDefault,
    initializeModel,
  };
};
