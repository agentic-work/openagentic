/**
 * useAdminRegistry — task #5 (registry SoT for admin Models page)
 *
 * The admin Models page used to load from /discover-models (per-provider
 * live SDK hit) + provider_config.models[]. That produced the "0 models
 * across 0 providers" headline when discovery failed or was slow, and
 * mixed cache + curation in a way the toolbar picker couldn't agree with.
 *
 * This hook reads the curated Registry directly via the task #3 endpoint
 * and exposes toggleEnabled + editPriority mutation helpers that PATCH back.
 * The rendered rows are always in sync with what the chat toolbar sees.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { apiEndpoint } from '@/utils/api';

export interface RegistryEndpointRow {
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

export interface AdminModelInfo {
  /** Registry row primary key (used for PATCH /registry/:id) */
  id: string;
  /** The actual model ID (e.g., us.anthropic.claude-sonnet-4-6) */
  name: string;
  providerName: string;
  providerDisplayName: string;
  providerEnabled: boolean;
  role: string;
  priority: number;
  enabled: boolean;
  temperature: number | null;
  maxTokens: number | null;
  capabilities: string[];
  description: string | null;
}

export function mapRegistryRowToAdminModelInfo(row: RegistryEndpointRow): AdminModelInfo {
  const caps: string[] = [];
  for (const [k, v] of Object.entries(row.capabilities ?? {})) {
    if (v) caps.push(k);
  }
  return {
    id: row.id,
    name: row.model,
    providerName: row.provider,
    providerDisplayName: row.provider_display_name,
    providerEnabled: row.provider_enabled,
    role: row.role,
    priority: row.priority,
    enabled: row.enabled,
    temperature: row.temperature,
    maxTokens: row.max_tokens,
    capabilities: caps,
    description: row.description,
  };
}

export interface RegistryStats {
  total: number;
  enabled: number;
  providerCount: number;
}

export interface UseAdminRegistryResult {
  models: AdminModelInfo[];
  stats: RegistryStats;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  toggleEnabled: (id: string, enabled: boolean) => Promise<void>;
  editPriority: (id: string, priority: number) => Promise<void>;
}

export function useAdminRegistry(): UseAdminRegistryResult {
  const [models, setModels] = useState<AdminModelInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRegistry = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiEndpoint('/admin/llm-providers/registry?enabledOnly=false'), {
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        throw new Error(`Registry fetch failed: ${res.status}`);
      }
      const rows: RegistryEndpointRow[] = await res.json();
      setModels(rows.map(mapRegistryRowToAdminModelInfo));
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

  const stats: RegistryStats = useMemo(() => {
    const providerSet = new Set(models.map(m => m.providerName));
    return {
      total: models.length,
      enabled: models.filter(m => m.enabled).length,
      providerCount: providerSet.size,
    };
  }, [models]);

  const toggleEnabled = useCallback(async (id: string, enabled: boolean): Promise<void> => {
    // Optimistic update
    setModels(prev => prev.map(m => (m.id === id ? { ...m, enabled } : m)));
    try {
      const res = await fetch(apiEndpoint(`/admin/llm-providers/registry/${encodeURIComponent(id)}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) {
        // Revert on failure
        setModels(prev => prev.map(m => (m.id === id ? { ...m, enabled: !enabled } : m)));
        throw new Error(`PATCH failed: ${res.status}`);
      }
    } catch (e: any) {
      // Revert already handled above when !res.ok; also revert on throw
      setModels(prev => prev.map(m => (m.id === id && m.enabled === enabled ? { ...m, enabled: !enabled } : m)));
      throw e;
    }
  }, []);

  const editPriority = useCallback(async (id: string, priority: number): Promise<void> => {
    const prevPriority = models.find(m => m.id === id)?.priority ?? null;
    setModels(prev => prev.map(m => (m.id === id ? { ...m, priority } : m)));
    try {
      const res = await fetch(apiEndpoint(`/admin/llm-providers/registry/${encodeURIComponent(id)}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority }),
      });
      if (!res.ok) {
        if (prevPriority !== null) {
          setModels(prev => prev.map(m => (m.id === id ? { ...m, priority: prevPriority } : m)));
        }
        throw new Error(`PATCH failed: ${res.status}`);
      }
    } catch (e: any) {
      if (prevPriority !== null) {
        setModels(prev => prev.map(m => (m.id === id ? { ...m, priority: prevPriority } : m)));
      }
      throw e;
    }
  }, [models]);

  return { models, stats, loading, error, refetch: fetchRegistry, toggleEnabled, editPriority };
}
