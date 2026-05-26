/**
 * CollectionsSection — sidebar section listing the authenticated user's
 * Milvus collections + the indexed files in them.
 *
 * Mounts under FileTreeSection inside ChatSidebar. Hits:
 *   GET /api/code-mode/collections
 *   GET /api/code-mode/collections/:collectionId/files
 *
 * The endpoints are strictly per-user — security is enforced by the API
 * (see services/openagentic-api/src/routes/code-mode/collections.route.ts);
 * the UI just renders whatever the endpoint returns. Empty arrays render
 * the "No indexed files yet" empty state from the mock (line 572).
 *
 * TDD plan (red-first, 6 cases):
 *   1. mounts, shows empty state when no collections
 *   2. renders per-collection name + file count
 *   3. expands to show files on click
 *   4. file click triggers openTab via the existing fileStatusStore
 *   5. error state when fetch fails (shows "Error: ..." inline)
 *   6. refresh button refetches
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

// fileStatusStore — replace with a fresh per-test instance so openTab spy
// state doesn't bleed across tests. Mirrors FileTreeSection.test.tsx pattern.
// ComposerGitHubPill — uses AuthProvider context which isn't wrapped in
// the test render. Stub it; the composer's own tests pin GitHub-pill
// behavior. Here we just need CollectionsSection to render cleanly with
// the new sidebar mount.
vi.mock('../../../features/code/components/CodeModeChatView', () => ({
  ComposerGitHubPill: () => null,
}));

vi.mock('../../state/fileStatusStore', async () => {
  const { createFileStatusStore } = await import('../../state/fileStatusStore');
  const store = createFileStatusStore();
  return {
    useFileStatusStore: store,
    useOpenTabs: () => store((s: any) => s.tabs),
    useActivePath: () => store((s: any) => s.activePath),
    useExpandedPaths: () => store((s: any) => s.expandedPaths),
    useIsDirty: (p: string) => store((s: any) => s.dirtyPaths.has(p)),
    useIsEditing: (p: string) => store((s: any) => s.editingPath === p),
    useIsRecentlyModified: (p: string) => store((s: any) => s.recentlyModifiedPaths.has(p)),
    createFileStatusStore,
  };
});

import { CollectionsSection } from '../CollectionsSection';
import { useFileStatusStore } from '../../state/fileStatusStore';

const COLLECTIONS_URL = '/api/code-mode/collections';

function mockFetchOnce(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  (global as any).fetch = vi.fn(impl);
  return (global as any).fetch as ReturnType<typeof vi.fn>;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  // Reset window auth-token slot so component can compose Authorization
  try {
    localStorage.setItem('auth_token', 'test-token-abc');
  } catch { /* no-op in non-DOM envs */ }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CollectionsSection', () => {
  it('mounts, shows empty state when no collections', async () => {
    mockFetchOnce(async () => jsonResponse({ collections: [] }));

    await act(async () => {
      render(<CollectionsSection />);
      // flush microtask + initial fetch
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId('collections-section')).toBeInTheDocument();
    expect(screen.getByText('Collections')).toBeInTheDocument();
    // Empty state copy from mock line 572
    expect(screen.getByText(/No indexed files yet/i)).toBeInTheDocument();
  });

  it('renders per-collection name + file count', async () => {
    mockFetchOnce(async () =>
      jsonResponse({
        collections: [
          {
            name: 'codemode_user_user-a',
            userId: 'user-a',
            vectorCount: 17,
            fileCount: 4,
            status: 'active',
          },
        ],
      }),
    );

    await act(async () => {
      render(<CollectionsSection />);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Friendly display name (post-prefix)
    expect(screen.getByText(/user-a/)).toBeInTheDocument();
    expect(screen.getByText(/4 files/i)).toBeInTheDocument();
  });

  it('expands to show files on click', async () => {
    const fetchSpy = mockFetchOnce(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith(COLLECTIONS_URL)) {
        return jsonResponse({
          collections: [
            { name: 'codemode_user_user-a', userId: 'user-a', vectorCount: 2, fileCount: 2, status: 'active' },
          ],
        });
      }
      if (url.includes('/files')) {
        return jsonResponse({
          files: [
            { name: 'main.py', path: '/workspaces/user-a/main.py', size: 100, mtimeMs: 0, mime: 'text/x-python' },
            { name: 'README.md', path: '/workspaces/user-a/README.md', size: 50, mtimeMs: 0, mime: 'text/markdown' },
          ],
        });
      }
      return jsonResponse({ error: 'unexpected_url' }, 500);
    });

    await act(async () => {
      render(<CollectionsSection />);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Click the collection row to expand
    const row = screen.getByTestId('collection-row-codemode_user_user-a');
    await act(async () => {
      fireEvent.click(row);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Files endpoint was called with the user's collection id
    const calls = fetchSpy.mock.calls.map((c: any[]) => String(c[0]));
    expect(calls.some((u: string) => u.includes('/codemode_user_user-a/files'))).toBe(true);

    // File names visible
    expect(screen.getByText('main.py')).toBeInTheDocument();
    expect(screen.getByText('README.md')).toBeInTheDocument();
  });

  it('file click triggers openTab via the existing fileStatusStore', async () => {
    mockFetchOnce(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith(COLLECTIONS_URL)) {
        return jsonResponse({
          collections: [
            { name: 'codemode_user_user-a', userId: 'user-a', vectorCount: 1, fileCount: 1, status: 'active' },
          ],
        });
      }
      if (url.includes('/files')) {
        return jsonResponse({
          files: [
            { name: 'main.py', path: '/workspaces/user-a/main.py', size: 100, mtimeMs: 0, mime: 'text/x-python' },
          ],
        });
      }
      return jsonResponse({ error: 'unexpected_url' }, 500);
    });

    const openTabSpy = vi.spyOn(useFileStatusStore.getState(), 'openTab');

    await act(async () => {
      render(<CollectionsSection />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('collection-row-codemode_user_user-a'));
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('main.py'));
    });

    expect(openTabSpy).toHaveBeenCalledWith('/workspaces/user-a/main.py');
  });

  it('error state when fetch fails (shows "Error: ..." inline)', async () => {
    mockFetchOnce(async () => {
      throw new Error('network down');
    });

    await act(async () => {
      render(<CollectionsSection />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId('collections-error')).toBeInTheDocument();
    expect(screen.getByTestId('collections-error').textContent).toMatch(/Error:/i);
  });

  it('refresh button refetches', async () => {
    const fetchSpy = mockFetchOnce(async () => jsonResponse({ collections: [] }));

    await act(async () => {
      render(<CollectionsSection />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const refreshBtn = screen.getByTestId('collections-refresh');
    await act(async () => {
      fireEvent.click(refreshBtn);
      await Promise.resolve();
    });

    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
