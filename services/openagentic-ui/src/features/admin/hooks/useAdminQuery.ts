/**
 * React Query hooks for admin API calls.
 * Provides stale-while-revalidate caching so admin tab switches are instant.
 *
 * Usage:
 *   const { data, isLoading, error } = useAdminQuery(['agents'], '/api/admin/agents');
 *   const { data, isLoading } = useAdminQuery(['metrics', 'llm'], '/api/admin/llm-metrics', { staleTime: 60_000 });
 */

import { useQuery, useMutation, useQueryClient, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiRequestJson, apiRequest } from '@/utils/api';
import React from 'react';

// Shared query client for all admin views
const adminQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,        // 30s -- data considered fresh
      gcTime: 5 * 60_000,       // 5min -- cache garbage collection
      refetchOnWindowFocus: false, // Don't refetch on tab focus (admin data doesn't change that fast)
      retry: 1,                  // One retry on failure
    },
  },
});

/**
 * Provider wrapper -- add to AdminPortal root
 */
export function AdminQueryProvider({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client: adminQueryClient }, children);
}

/**
 * Fetch admin API data with caching.
 * Returns { data, isLoading, error, refetch, isFetching }
 */
export function useAdminQuery<T = any>(
  key: string[],
  endpoint: string,
  options?: {
    staleTime?: number;
    enabled?: boolean;
    // react-query accepts `false` to disable polling; callers pass
    // `cond ? ms : false`, so the type must allow it (the underlying
    // useQuery already does).
    refetchInterval?: number | false;
  }
) {
  return useQuery<T>({
    queryKey: ['admin', ...key],
    queryFn: () => apiRequestJson<T>(endpoint),
    staleTime: options?.staleTime,
    enabled: options?.enabled,
    refetchInterval: options?.refetchInterval,
  });
}

/**
 * Mutation hook for admin write operations (POST/PUT/DELETE).
 * Automatically invalidates related queries on success.
 *
 * `endpoint` may be a string (static path) OR a function (variables → path)
 * for cases like PUT/DELETE /api/admin/foo/:id where the id lives on the
 * variables payload.  When using the function form, the request body is
 * controlled by `bodyOf` (default: omit `path`/`id` from the body).
 */
export function useAdminMutation<TData = any, TVariables = any>(
  endpoint: string | ((vars: TVariables) => string),
  options?: {
    method?: 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    invalidateKeys?: string[][];
    onSuccess?: (data: TData, vars: TVariables) => void;
    onError?: (err: Error, vars: TVariables) => void;
    /**
     * Map variables → request body. Default: pass variables straight through
     * (or undefined for DELETE). Use this when the URL carries some ids and
     * the body should only contain the remaining fields.
     */
    bodyOf?: (vars: TVariables) => unknown | undefined;
  }
) {
  const queryClient = useQueryClient();
  const method = options?.method || 'POST';

  return useMutation<TData, Error, TVariables>({
    mutationFn: async (variables: TVariables) => {
      const path = typeof endpoint === 'function' ? endpoint(variables) : endpoint;
      const body = options?.bodyOf
        ? options.bodyOf(variables)
        : method === 'DELETE'
          ? undefined
          : variables;
      const response = await apiRequest(path, {
        method,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${method} ${path} failed: ${response.status} - ${text}`);
      }
      return response.status === 204 ? (undefined as TData) : response.json();
    },
    onSuccess: (data, vars) => {
      // Invalidate related queries so they refetch
      if (options?.invalidateKeys) {
        for (const key of options.invalidateKeys) {
          queryClient.invalidateQueries({ queryKey: ['admin', ...key] });
        }
      }
      options?.onSuccess?.(data, vars);
    },
    onError: (err, vars) => {
      options?.onError?.(err, vars);
    },
  });
}

/**
 * Invalidate specific admin query cache (force refetch on next access)
 */
export function useAdminInvalidate() {
  const queryClient = useQueryClient();
  return (keys: string[]) => {
    queryClient.invalidateQueries({ queryKey: ['admin', ...keys] });
  };
}

export { adminQueryClient };
