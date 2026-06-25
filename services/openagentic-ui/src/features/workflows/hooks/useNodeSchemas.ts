/**
 * useNodeSchemas — React hook that fetches and caches the /node-schemas
 * registry endpoint.
 *
 * Exposes:
 *   schemas       — all migrated RegistryNodeSchema objects
 *   byType        — schemas keyed by `type` for O(1) lookup
 *   aiPromptFragment — server-generated AI Flow Builder fragment
 *   loading       — true on first fetch
 *   error         — non-null if fetch failed hard (currently unused since the
 *                   api returns empty-and-warns on failures, but kept for
 *                   callers that want to surface an error state)
 */

import { useState, useEffect, useRef } from 'react';
import { nodeSchemasApi } from '../services/nodeSchemasApi';
import type { RegistryNodeSchema } from '../services/nodeSchemasApi';

export interface UseNodeSchemasResult {
  schemas: RegistryNodeSchema[];
  byType: Record<string, RegistryNodeSchema>;
  aiPromptFragment: string;
  loading: boolean;
  error: string | null;
}

// Module-level cache so multiple hook instances share a single fetch.
let _cache: {
  schemas: RegistryNodeSchema[];
  byType: Record<string, RegistryNodeSchema>;
  aiPromptFragment: string;
} | null = null;
let _fetchPromise: Promise<void> | null = null;

/**
 * Build the byType index from schemas array.
 */
function buildByType(schemas: RegistryNodeSchema[]): Record<string, RegistryNodeSchema> {
  const map: Record<string, RegistryNodeSchema> = {};
  for (const s of schemas) {
    map[s.type] = s;
  }
  return map;
}

export function useNodeSchemas(): UseNodeSchemasResult {
  const [schemas, setSchemas] = useState<RegistryNodeSchema[]>(_cache?.schemas ?? []);
  const [byType, setByType] = useState<Record<string, RegistryNodeSchema>>(_cache?.byType ?? {});
  const [aiPromptFragment, setAiPromptFragment] = useState<string>(_cache?.aiPromptFragment ?? '');
  const [loading, setLoading] = useState<boolean>(_cache === null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    // Already cached — no fetch needed.
    if (_cache !== null) {
      setSchemas(_cache.schemas);
      setByType(_cache.byType);
      setAiPromptFragment(_cache.aiPromptFragment);
      setLoading(false);
      return;
    }

    // De-duplicate concurrent fetches
    if (!_fetchPromise) {
      _fetchPromise = nodeSchemasApi.fetchSchemas().then(result => {
        const bt = buildByType(result.schemas);
        _cache = {
          schemas: result.schemas,
          byType: bt,
          aiPromptFragment: result.aiPromptFragment,
        };
        _fetchPromise = null;
      });
    }

    _fetchPromise.then(() => {
      if (!mountedRef.current) return;
      if (_cache) {
        setSchemas(_cache.schemas);
        setByType(_cache.byType);
        setAiPromptFragment(_cache.aiPromptFragment);
      }
      setLoading(false);
      setError(null);
    }).catch((err: unknown) => {
      if (!mountedRef.current) return;
      setLoading(false);
      setError(err instanceof Error ? err.message : String(err));
    });
  }, []);

  // Auto-refetch on window focus (like react-query staleTime=0 pattern)
  useEffect(() => {
    const handleFocus = () => {
      // Invalidate cache and refetch
      _cache = null;
      _fetchPromise = null;
      setLoading(true);
      nodeSchemasApi.fetchSchemas().then(result => {
        if (!mountedRef.current) return;
        const bt = buildByType(result.schemas);
        _cache = {
          schemas: result.schemas,
          byType: bt,
          aiPromptFragment: result.aiPromptFragment,
        };
        setSchemas(result.schemas);
        setByType(bt);
        setAiPromptFragment(result.aiPromptFragment);
        setLoading(false);
      }).catch(() => {
        if (mountedRef.current) setLoading(false);
      });
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  return { schemas, byType, aiPromptFragment, loading, error };
}

/**
 * Invalidate the module-level cache — useful in tests and when the user
 * explicitly triggers a refresh.
 */
export function invalidateNodeSchemasCache(): void {
  _cache = null;
  _fetchPromise = null;
}
