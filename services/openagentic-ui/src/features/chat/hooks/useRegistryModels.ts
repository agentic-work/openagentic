/**
 * useRegistryModels — task #4 (registry SoT)
 *
 * The chat toolbar's model selector used to fetch from /chat/models which
 * read providerManager.discoveredCapabilities (leaking 86 auto-discovered
 * models per session). That's wrong: the user-facing picker must reflect
 * ONLY the curated Registry (admin.model_role_assignments), not every
 * model the provider catalog happens to list.
 *
 * This hook fetches /api/admin/llm-providers/registry?enabledOnly=true
 * and maps each row into the ModelInfo shape the toolbar already consumes.
 * The mapping preserves the 'type: chat' filter the dropdown uses + honors
 * the Registry's enabled flag so toggling a row off in the admin Models
 * page removes it from the toolbar on next reload.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiEndpoint } from '@/utils/api';

export interface RegistryModelRow {
  id: string;
  model: string;
  provider: string;
  role: string;
  priority: number;
  enabled: boolean;
  temperature: number | null;
  max_tokens: number | null;
  capabilities: Record<string, boolean | undefined>;
  description: string | null;
  options: Record<string, any>;
  provider_display_name: string;
  provider_enabled: boolean;
}

export interface ToolbarModelInfo {
  id: string;
  name: string;
  description?: string;
  provider?: string;
  capabilities?: string[];
  thinking?: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
  type?: 'chat' | 'embedding' | 'image' | 'vision';
}

/**
 * Transforms one Registry row into the shape the toolbar dropdown consumes.
 * Pure function so the mapping logic is unit-testable without React.
 */
export function mapRegistryRowToToolbarModel(row: RegistryModelRow): ToolbarModelInfo {
  const caps: string[] = [];
  if (row.capabilities?.vision) caps.push('vision');
  if (row.capabilities?.tools) caps.push('function-calling');
  if (row.capabilities?.streaming) caps.push('streaming');
  if (row.capabilities?.embeddings) caps.push('embeddings');

  // Role → type: embeddings role maps to embedding type; everything else
  // (chat/reasoning/tool_execution/synthesis/fallback) is 'chat' from the
  // toolbar's perspective. The dropdown filters by type==='chat' before
  // rendering.
  const type: ToolbarModelInfo['type'] =
    row.role === 'embeddings' ? 'embedding' : 'chat';

  return {
    id: row.model,
    name: row.description ?? row.model,
    description: row.description ?? undefined,
    provider: row.provider,
    capabilities: caps,
    thinking: !!row.capabilities?.thinking,
    maxOutputTokens: row.max_tokens ?? undefined,
    type,
  };
}

export interface UseRegistryModelsResult {
  models: ToolbarModelInfo[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export interface UseRegistryModelsOptions {
  /** Optional auth headers factory (so callers can plumb bearer tokens) */
  getAuthHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
}

export function useRegistryModels(opts: UseRegistryModelsOptions = {}): UseRegistryModelsResult {
  const [models, setModels] = useState<ToolbarModelInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Keep a ref to the auth-headers factory so caller identity (which may be
  // recreated on every render) doesn't re-trigger the effect.
  const getAuthHeadersRef = useRef(opts.getAuthHeaders);
  getAuthHeadersRef.current = opts.getAuthHeaders;

  const fetchRegistry = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const getAuthHeaders = getAuthHeadersRef.current;
      const authHeaders = getAuthHeaders ? await getAuthHeaders() : {};
      const res = await fetch(apiEndpoint('/admin/llm-providers/registry?enabledOnly=true'), {
        headers: { 'Content-Type': 'application/json', ...authHeaders },
      });
      if (!res.ok) {
        throw new Error(`Registry fetch failed: ${res.status}`);
      }
      const rows: RegistryModelRow[] = await res.json();
      setModels(rows.map(mapRegistryRowToToolbarModel));
    } catch (e: any) {
      setError(e?.message ?? 'Unknown error');
      setModels([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRegistry();
  }, [fetchRegistry]);

  return { models, loading, error, refetch: fetchRegistry };
}
