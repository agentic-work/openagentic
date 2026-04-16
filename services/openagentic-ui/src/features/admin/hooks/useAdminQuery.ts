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
    refetchInterval?: number;
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
 */
export function useAdminMutation<TData = any, TVariables = any>(
  endpoint: string,
  options?: {
    method?: 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    invalidateKeys?: string[][];
    onSuccess?: (data: TData) => void;
  }
) {
  const queryClient = useQueryClient();
  const method = options?.method || 'POST';

  return useMutation<TData, Error, TVariables>({
    mutationFn: async (variables: TVariables) => {
      const response = await apiRequest(endpoint, {
        method,
        body: variables ? JSON.stringify(variables) : undefined,
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${method} ${endpoint} failed: ${response.status} - ${text}`);
      }
      return response.status === 204 ? (undefined as TData) : response.json();
    },
    onSuccess: (data) => {
      // Invalidate related queries so they refetch
      if (options?.invalidateKeys) {
        for (const key of options.invalidateKeys) {
          queryClient.invalidateQueries({ queryKey: ['admin', ...key] });
        }
      }
      options?.onSuccess?.(data);
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
