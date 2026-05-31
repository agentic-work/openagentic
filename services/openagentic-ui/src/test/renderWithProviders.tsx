/**
 * renderWithProviders — Testing Library render wrapped in the providers that
 * data-driven components require (React Query + Router). Use this instead of
 * the bare `render` for any component that calls useQuery/useAdminQuery,
 * useNavigate, or otherwise needs app context — it eliminates the
 * "No QueryClient set" / "useNavigate() may be used only in the context of a
 * <Router>" render crashes.
 *
 * A fresh QueryClient is created per render (retries disabled for determinism).
 * Re-exports everything from @testing-library/react, so a test can do:
 *
 *   import { renderWithProviders, screen, waitFor } from '@/test/renderWithProviders';
 */
import React from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

export function makeTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  /** Provide a shared client to assert cache state across renders. */
  queryClient?: QueryClient;
  /** Initial router entries (default: ['/']). */
  routerEntries?: string[];
}

export function renderWithProviders(
  ui: React.ReactElement,
  { queryClient, routerEntries = ['/'], ...options }: RenderWithProvidersOptions = {},
) {
  const client = queryClient ?? makeTestQueryClient();
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={routerEntries}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }
  return { queryClient: client, ...render(ui, { wrapper: Wrapper, ...options }) };
}

// Convenience re-export so tests need only one import line.
export * from '@testing-library/react';
