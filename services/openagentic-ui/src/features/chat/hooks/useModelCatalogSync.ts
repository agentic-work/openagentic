/**
 * useModelCatalogSync
 *
 * Self-contained model-catalog + prompt sync side-effects extracted verbatim
 * from ChatContainer. Owns three effects:
 *   1. Fetch available models + the user's assigned prompt template (+ multi-model
 *      config for admins) on mount / when admin status changes.
 *   2. Listen for the `multimodel-config-changed` window event from the Admin Portal.
 *   3. Re-fetch models on the `onModelsChanged` signal (CustomEvent + BroadcastChannel)
 *      plus a 30s polling fallback — keeps the chat model selector in sync with
 *      admin-console CRUD (SEV0 FIX 2026-04-08).
 *
 * All model state is written through the shared useModelStore (the same store the
 * container subscribes to for render), so this hook is purely additive — it does
 * not change the rendered model selection nor the first-message send path. The
 * `currentPrompt` local state is preserved here (it was set-only in the container).
 */
import { useEffect, useState } from 'react';
import { apiEndpoint } from '@/utils/api';
import { onModelsChanged } from '@/utils/modelSync';
import { useModelStore } from '@/stores/useModelStore';

interface UseModelCatalogSyncParams {
  getAccessToken: (scopes?: string[]) => Promise<string | null>;
  isAdminUser: boolean;
}

export function useModelCatalogSync({ getAccessToken, isAdminUser }: UseModelCatalogSyncParams): void {
  // Model store — model selection, available models, multi-model mode.
  const {
    selectedModel,
    setSelectedModel,
    setAvailableModels,
    setMultiModelEnabled,
  } = useModelStore();

  const [, setCurrentPrompt] = useState<string>(''); // Current prompt being used

  // Fetch available models and current prompt on mount
  useEffect(() => {
    const fetchModelsAndPrompt = async () => {
      try {
        // Get auth token
        const token = await getAccessToken();
        const authHeaders = token ? { 'Authorization': `Bearer ${token}` } : {};

        // Fetch available models from API
        // Use /chat/models endpoint which returns ALL individual models (including all Claude variants)
        // The /models endpoint only returns one model per provider
        const modelsResponse = await fetch(apiEndpoint('/chat/models'), {
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders  // FIX: Pass auth token for authenticated endpoint
          }
        });

        if (modelsResponse.ok) {
          const data = await modelsResponse.json();
          if (data.models && data.models.length > 0) {
            // Chat dropdown only shows READY models (configured + available)
            // Unpulled/catalog models are managed in Admin Console Model Garden only
            const readyModels = data.models.filter((m: { id: string; isAvailable?: boolean }) => m.isAvailable !== false);
            setAvailableModels(readyModels);

            // Model selection is ADMIN ONLY
            // Non-admins always use empty string which defaults to auto-routing on backend
            if (isAdminUser) {
              // Validate stored model against available models
              const storedModel = localStorage.getItem('selectedModel');
              const modelIds = data.models.map((m: { id: string; isAvailable?: boolean }) => m.id);

              if (storedModel && modelIds.includes(storedModel)) {
                // Stored model is valid - use it
                console.log('[MODEL] Admin using stored model from localStorage:', storedModel);
                setSelectedModel(storedModel);
              } else {
                // No valid stored model - use Smart Router (empty string)
                // This lets the model router choose the best model based on query complexity
                console.log('[MODEL] Admin no stored model, using Smart Router');
                setSelectedModel('');
              }
            } else {
              // Non-admin - always use default auto-routing (empty string)
              console.log('[MODEL] Non-admin user, using default auto-routing');
              setSelectedModel('');
              localStorage.removeItem('selectedModel');
            }
          }
        }

        // Fetch current user's assigned prompt template
        try {
          const promptResponse = await fetch(apiEndpoint('/admin/prompts/my-template'), {
            headers: {
              'X-OpenAgentic-Frontend': 'true',
              ...authHeaders
            }
          });

          if (promptResponse.ok) {
            const promptData = await promptResponse.json();
            if (promptData.template?.name) {
              setCurrentPrompt(promptData.template.name);
            }
          } else {
            // Fall back to default if no specific template assigned
            setCurrentPrompt('Default Assistant');
          }
        } catch (promptError) {
          console.error('Could not fetch current prompt template:', promptError);
          // Fall back to default - this is normal if no template is assigned
          setCurrentPrompt('Default Assistant');
        }

        // Fetch multi-model config (admin only) to check if multi-model mode is enabled
        if (isAdminUser) {
          try {
            const multiModelResponse = await fetch(apiEndpoint('/admin/multi-model/config'), {
              headers: {
                'X-OpenAgentic-Frontend': 'true',
                ...authHeaders
              }
            });

            if (multiModelResponse.ok) {
              const multiModelData = await multiModelResponse.json();
              const isEnabled = multiModelData.config?.enabled ?? false;
              setMultiModelEnabled(isEnabled);
              console.log('[MULTI-MODEL] Mode enabled:', isEnabled);
            }
          } catch (multiModelError) {
            console.warn('Could not fetch multi-model config:', multiModelError);
            setMultiModelEnabled(false);
          }
        }
      } catch (error) {
        console.error('Failed to fetch models:', error);
      }
    };

    fetchModelsAndPrompt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdminUser]); // Re-run when admin status changes (e.g., after user loads)

  // Listen for multi-model config changes (dispatched from Admin Portal)
  useEffect(() => {
    const handleMultiModelChange = async (event: CustomEvent<{ enabled: boolean }>) => {
      console.log('[MULTI-MODEL] Config changed via event:', event.detail);
      setMultiModelEnabled(event.detail.enabled);
    };

    window.addEventListener('multimodel-config-changed', handleMultiModelChange as EventListener);
    return () => {
      window.removeEventListener('multimodel-config-changed', handleMultiModelChange as EventListener);
    };
  }, []);

  // SEV0 FIX (2026-04-08): Keep chat model selector in sync with admin console
  // CRUD operations. Previously /chat/models was fetched once on mount, so
  // any add/delete/toggle/edit in Model Registry stayed invisible to open
  // chat tabs until hard-refresh. onModelsChanged hooks a same-tab CustomEvent
  // plus a cross-tab BroadcastChannel so admin changes propagate immediately.
  useEffect(() => {
    const refetchModels = async () => {
      try {
        const token = await getAccessToken();
        const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};
        const res = await fetch(apiEndpoint('/chat/models'), {
          headers: { 'Content-Type': 'application/json', ...authHeaders },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.models && data.models.length > 0) {
          const readyModels = data.models.filter((m: { id: string; isAvailable?: boolean }) => m.isAvailable !== false);
          setAvailableModels(readyModels);
          // If the currently selected model was deleted, fall back to Smart Router
          const modelIds = readyModels.map((m: { id: string; isAvailable?: boolean }) => m.id);
          if (selectedModel && !modelIds.includes(selectedModel)) {
            console.log('[MODEL-SYNC] Selected model no longer available, reverting to Smart Router');
            setSelectedModel('');
          }
          console.log('[MODEL-SYNC] Chat model list refreshed from admin signal:', readyModels.length, 'models');
        }
      } catch (err) {
        console.warn('[MODEL-SYNC] Refetch failed:', err);
      }
    };
    const unsubscribe = onModelsChanged((reason) => {
      console.log('[MODEL-SYNC] Received models-changed signal, reason:', reason);
      refetchModels();
    });

    // Polling fallback: refresh every 30s so admin changes in other tabs/windows
    // are always picked up even if CustomEvent/BroadcastChannel fails.
    const pollInterval = setInterval(() => refetchModels(), 30000);

    return () => { unsubscribe(); clearInterval(pollInterval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModel]);
}
