/**
 * CollectionsSection — Milvus-backed collections panel for the ChatSidebar.
 *
 * Mounted under FileTreeSection in ChatSidebar (code-mode branch). Lists the
 * authenticated user's per-user Milvus collection (singleton today; the API
 * shape is a list to leave room for multi-collection growth) plus the files
 * indexed in it. Click a file to open it in the editor via the same
 * `openTab` flow FileTreeSection uses.
 *
 * Visual treatment per `mocks/codemode-mockup.html` lines 558-574:
 *   - Section header `Collections` + refresh ↻ button
 *   - Per-collection: 📚 <name> (N files) muted
 *   - Click row → expand + lazy-fetch files
 *   - Click file → openTab
 *   - Empty state: "No indexed files yet"
 *
 * Polling: refetch on mount + every 30s + on visibilitychange (matches the
 * pattern in FileTreeSection.tsx).
 *
 * Security model: the API endpoints are strictly per-user (see
 * services/openagentic-api/src/routes/code-mode/collections.route.ts). The UI
 * just renders whatever it gets back — there's no other-user code path here.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useFileStatusStore } from '../state/fileStatusStore';
import { ComposerGitHubPill } from '../../features/code/components/CodeModeChatView';

// =============================================================================
// API shapes (mirror routes/code-mode/collections.route.ts)
// =============================================================================

export interface CollectionListItem {
  name: string;
  userId: string;
  vectorCount: number;
  fileCount: number;
  status: 'active' | 'inactive' | 'error';
}

export interface CollectionFileItem {
  name: string;
  path: string;
  size: number;
  mtimeMs: number;
  mime: string;
}

// =============================================================================
// Component
// =============================================================================

const POLL_MS = 30_000;

const COLLECTION_PREFIX = 'codemode_user_';

function displayName(c: CollectionListItem): string {
  if (c.name.startsWith(COLLECTION_PREFIX)) {
    return c.name.slice(COLLECTION_PREFIX.length);
  }
  return c.name;
}

function authHeaders(): Record<string, string> {
  const token = (() => {
    try {
      return localStorage.getItem('auth_token');
    } catch {
      return null;
    }
  })();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function CollectionsSection(): JSX.Element {
  const { openTab } = useFileStatusStore.getState();

  const [collections, setCollections] = useState<CollectionListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filesByCollection, setFilesByCollection] = useState<Map<string, CollectionFileItem[]>>(
    new Map(),
  );
  const [loading, setLoading] = useState(false);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pausedRef = useRef(false);

  const fetchCollections = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/code-mode/collections', { headers: authHeaders() });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const body = (await res.json()) as { collections: CollectionListItem[] };
      setCollections(body.collections ?? []);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load collections';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchFiles = useCallback(async (collectionId: string) => {
    try {
      const res = await fetch(
        `/api/code-mode/collections/${encodeURIComponent(collectionId)}/files`,
        { headers: authHeaders() },
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const body = (await res.json()) as { files: CollectionFileItem[] };
      setFilesByCollection((prev) => {
        const next = new Map(prev);
        next.set(collectionId, body.files ?? []);
        return next;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load files';
      setError(msg);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchCollections();
  }, [fetchCollections]);

  // Poll every 30s + on visibilitychange (matches FileTreeSection's pattern)
  useEffect(() => {
    function tick() {
      if (pausedRef.current) return;
      fetchCollections();
      // Refresh files for currently-expanded collections
      expanded.forEach((id) => fetchFiles(id));
    }

    pollingRef.current = setInterval(tick, POLL_MS);

    function onVis() {
      pausedRef.current = document.visibilityState === 'hidden';
      if (!pausedRef.current) {
        // Refetch immediately when tab regains visibility
        tick();
      }
    }
    document.addEventListener('visibilitychange', onVis);

    return () => {
      if (pollingRef.current !== null) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [fetchCollections, fetchFiles, expanded]);

  function handleToggleExpand(c: CollectionListItem) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(c.name)) {
        next.delete(c.name);
      } else {
        next.add(c.name);
        // Lazy-load on first expand
        if (!filesByCollection.has(c.name)) {
          fetchFiles(c.name);
        }
      }
      return next;
    });
  }

  function handleOpenFile(path: string) {
    openTab(path);
  }

  return (
    <div
      className="fp-collections"
      data-testid="collections-section"
      style={{
        borderTop: '1px solid var(--cm-border, #30363d)',
        marginTop: 8,
        // User feedback 2026-05-02: collections were getting cut off
        // because the parent flex column didn't reserve space for them.
        // Pin to the bottom of the sidebar with `flex: 0 0 auto` so the
        // tree (flex: 1) takes the remaining space above and Collections
        // is always visible. Cap the list with maxHeight so it stays
        // scrollable when the user has many indexed collections.
        flex: '0 0 auto',
        maxHeight: '40vh',
        overflowY: 'auto',
      }}
    >
      <div className="fp-left-hdr">
        <span className="label">Collections</span>
        <span
          className="iconbtn"
          data-testid="collections-refresh"
          title="Refresh"
          onClick={() => fetchCollections()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') fetchCollections();
          }}
          role="button"
          tabIndex={0}
          aria-label="Refresh collections"
          aria-busy={loading || undefined}
        >
          ↻
        </span>
      </div>

      {error ? (
        <div
          className="fp-tree-error"
          data-testid="collections-error"
          style={{ padding: '8px 12px', fontSize: 11, color: 'var(--cm-danger, #f85149)' }}
        >
          Error: {error}
        </div>
      ) : collections.length === 0 ? (
        <div
          data-testid="collections-empty"
          style={{ padding: '8px 12px', fontSize: 11, color: '#484f58' }}
        >
          No indexed files yet
        </div>
      ) : (
        <div className="fp-collections-list" role="list">
          {collections.map((c) => {
            const isExpanded = expanded.has(c.name);
            const files = filesByCollection.get(c.name) ?? [];
            return (
              <div key={c.name} className="fp-collection" role="listitem">
                <div
                  className="fp-collection-row"
                  data-testid={`collection-row-${c.name}`}
                  onClick={() => handleToggleExpand(c)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleToggleExpand(c);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 12px',
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  <span className="glyph" aria-hidden>📚</span>
                  <span className="name" style={{ flex: 1 }}>{displayName(c)}</span>
                  <span
                    className="count"
                    style={{ color: '#484f58', fontSize: 10 }}
                  >
                    ({c.fileCount} {c.fileCount === 1 ? 'file' : 'files'})
                  </span>
                </div>

                {isExpanded && (
                  <div className="fp-collection-files" style={{ paddingLeft: 22 }}>
                    {files.length === 0 ? (
                      <div
                        style={{ padding: '4px 12px', fontSize: 11, color: '#484f58' }}
                        data-testid={`collection-files-empty-${c.name}`}
                      >
                        No files
                      </div>
                    ) : (
                      files.map((f) => (
                        <div
                          key={f.path}
                          className="fp-collection-file"
                          data-testid={`collection-file-${f.path}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => handleOpenFile(f.path)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              handleOpenFile(f.path);
                            }
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '2px 12px',
                            cursor: 'pointer',
                            fontSize: 12,
                          }}
                        >
                          <span aria-hidden>📄</span>
                          <span>{f.name}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* GitHub connect pill — moved here from the composer toolbar
          2026-05-06. It's a session-wide setting, not a per-prompt
          control, so it lives below the workspace + collections panels. */}
      <div
        data-testid="cm-sidebar-github-pill"
        style={{
          padding: '8px 12px 6px',
          borderTop: '1px solid var(--cm-border, #30363d)',
          marginTop: 4,
          display: 'flex',
          justifyContent: 'flex-start',
        }}
      >
        <ComposerGitHubPill />
      </div>
    </div>
  );
}

export default CollectionsSection;
