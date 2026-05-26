import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// =============================================================================
// Types
// =============================================================================

export type FilePath = string;

export interface OpenTab {
  path: FilePath;
  /** ms since epoch when this tab was last activated — used for MRU sort. */
  lastActivatedMs: number;
}

export interface FileStatusState {
  /** Open tabs in MRU order — most-recently-active first. */
  tabs: OpenTab[];
  /** Active tab path, or null when no tabs open. */
  activePath: FilePath | null;
  /** Tree expansion state — paths that are currently expanded (showing children). */
  expandedPaths: Set<FilePath>;
  /** Forward-compat for Phase B — paths with unsaved buffer changes. */
  dirtyPaths: Set<FilePath>;
  /** Forward-compat for Phase C — path openagentic is currently editing. */
  editingPath: FilePath | null;
  /** Forward-compat for Phase C — paths recently modified by openagentic. */
  recentlyModifiedPaths: Set<FilePath>;
}

export interface FileStatusActions {
  openTab: (path: FilePath) => void;
  closeTab: (path: FilePath) => void;
  setActiveTab: (path: FilePath | null) => void;
  toggleExpand: (path: FilePath) => void;
  setExpanded: (path: FilePath, expanded: boolean) => void;
  markDirty: (path: FilePath) => void;
  clearDirty: (path: FilePath) => void;
  setEditingPath: (path: FilePath | null) => void;
  markRecentlyModified: (path: FilePath) => void;
  reset: () => void;
}

export type FileStatusStore = FileStatusState & FileStatusActions;

// =============================================================================
// Constants
// =============================================================================

const STORAGE_KEY = 'codemode-file-panel-state-v1';
const MAX_TABS = 50;

// Monotonic counter to ensure MRU ordering even when Date.now() collides
let _mruCounter = 0;
function nowMru(): number {
  return Date.now() * 1000 + (_mruCounter++ & 0xfff);
}

// =============================================================================
// Helpers
// =============================================================================

function sortByMruDesc(tabs: OpenTab[]): OpenTab[] {
  return [...tabs].sort((a, b) => b.lastActivatedMs - a.lastActivatedMs);
}

// =============================================================================
// Persisted state shape (serialized form — Sets become arrays)
// =============================================================================

interface PersistedShape {
  tabs: OpenTab[];
  activePath: FilePath | null;
  expandedPaths: FilePath[];
}

// =============================================================================
// Initial state
// =============================================================================

const initialState: FileStatusState = {
  tabs: [],
  activePath: null,
  expandedPaths: new Set(),
  dirtyPaths: new Set(),
  editingPath: null,
  recentlyModifiedPaths: new Set(),
};

// =============================================================================
// Timer tracking (outside store to avoid serialization issues)
// =============================================================================

const recentlyModifiedTimers = new Map<FilePath, ReturnType<typeof setTimeout>>();

// =============================================================================
// Factory function (exported for tests)
// =============================================================================

export function createFileStatusStore() {
  return create<FileStatusStore>()(
    persist(
      (set, get) => ({
        ...initialState,
        // Clone Sets so each store instance has independent state
        expandedPaths: new Set(),
        dirtyPaths: new Set(),
        recentlyModifiedPaths: new Set(),

        openTab(path) {
          set(state => {
            const existing = state.tabs.find(t => t.path === path);
            let newTabs: OpenTab[];
            const ts = nowMru();

            if (existing) {
              // Bump MRU timestamp
              newTabs = state.tabs.map(t =>
                t.path === path ? { ...t, lastActivatedMs: ts } : t
              );
            } else {
              const added = [...state.tabs, { path, lastActivatedMs: ts }];
              // Cap at MAX_TABS — after sorting, drop the oldest (tail)
              const sorted = sortByMruDesc(added);
              newTabs = sorted.length > MAX_TABS ? sorted.slice(0, MAX_TABS) : sorted;
              return {
                tabs: newTabs,
                activePath: path,
              };
            }

            return {
              tabs: sortByMruDesc(newTabs),
              activePath: path,
            };
          });
        },

        closeTab(path) {
          set(state => {
            const newTabs = state.tabs.filter(t => t.path !== path);
            const newDirty = new Set(state.dirtyPaths);
            newDirty.delete(path);

            let newActive = state.activePath;
            if (state.activePath === path) {
              newActive = newTabs.length > 0 ? newTabs[0].path : null;
            }

            return {
              tabs: newTabs,
              activePath: newActive,
              dirtyPaths: newDirty,
            };
          });
        },

        setActiveTab(path) {
          if (path === null) {
            set({ activePath: null });
            return;
          }
          const state = get();
          const tab = state.tabs.find(t => t.path === path);
          if (!tab) {
            throw new Error(
              `setActiveTab: path "${path}" is not in open tabs. Call openTab() first.`
            );
          }
          const ts = nowMru();
          set(s => ({
            tabs: sortByMruDesc(
              s.tabs.map(t =>
                t.path === path ? { ...t, lastActivatedMs: ts } : t
              )
            ),
            activePath: path,
          }));
        },

        toggleExpand(path) {
          set(state => {
            const next = new Set(state.expandedPaths);
            if (next.has(path)) {
              next.delete(path);
            } else {
              next.add(path);
            }
            return { expandedPaths: next };
          });
        },

        setExpanded(path, expanded) {
          set(state => {
            const next = new Set(state.expandedPaths);
            if (expanded) {
              next.add(path);
            } else {
              next.delete(path);
            }
            return { expandedPaths: next };
          });
        },

        markDirty(path) {
          set(state => ({
            dirtyPaths: new Set([...state.dirtyPaths, path]),
          }));
        },

        clearDirty(path) {
          set(state => {
            const next = new Set(state.dirtyPaths);
            next.delete(path);
            return { dirtyPaths: next };
          });
        },

        setEditingPath(path) {
          set({ editingPath: path });
        },

        markRecentlyModified(path) {
          // Cancel existing timer for this path
          const existing = recentlyModifiedTimers.get(path);
          if (existing !== undefined) {
            clearTimeout(existing);
          }

          set(state => ({
            recentlyModifiedPaths: new Set([...state.recentlyModifiedPaths, path]),
          }));

          const timer = setTimeout(() => {
            recentlyModifiedTimers.delete(path);
            const currentStore = get();
            const next = new Set(currentStore.recentlyModifiedPaths);
            next.delete(path);
            // Need to call set — get the set function from closure
            set({ recentlyModifiedPaths: next });
          }, 5000);

          recentlyModifiedTimers.set(path, timer);
        },

        reset() {
          // Clear all pending timers
          recentlyModifiedTimers.forEach(timer => clearTimeout(timer));
          recentlyModifiedTimers.clear();

          set({
            tabs: [],
            activePath: null,
            expandedPaths: new Set(),
            dirtyPaths: new Set(),
            editingPath: null,
            recentlyModifiedPaths: new Set(),
          });

          // Persist middleware writes synchronously in its subscriber after set().
          // We remove the key right after — the persist middleware only re-writes
          // on subsequent set() calls, not on removeItem, so this is stable.
          localStorage.removeItem(STORAGE_KEY);
        },
      }),
      {
        name: STORAGE_KEY,
        // Only persist stable UI state — not volatile session state
        partialize: (state): PersistedShape => ({
          tabs: state.tabs,
          activePath: state.activePath,
          expandedPaths: Array.from(state.expandedPaths),
        }),
        // Custom serialize/deserialize to handle Set<string> ↔ string[]
        storage: {
          getItem(name) {
            const raw = localStorage.getItem(name);
            if (!raw) return null;
            try {
              const parsed = JSON.parse(raw) as { state: PersistedShape; version: number };
              const s = parsed.state;

              // Rehydrate expandedPaths array → Set
              const expandedPaths = new Set<FilePath>(
                Array.isArray(s.expandedPaths) ? s.expandedPaths : []
              );

              // Validate activePath is in tabs
              const tabs: OpenTab[] = Array.isArray(s.tabs) ? s.tabs : [];
              let activePath = s.activePath ?? null;
              if (activePath !== null && !tabs.find(t => t.path === activePath)) {
                activePath = tabs.length > 0 ? tabs[0].path : null;
              }

              return {
                state: {
                  tabs,
                  activePath,
                  expandedPaths,
                },
                version: parsed.version ?? 0,
              };
            } catch {
              return null;
            }
          },
          setItem(name, value) {
            // value.state is already the partialized shape (expandedPaths is an array)
            localStorage.setItem(name, JSON.stringify(value));
          },
          removeItem(name) {
            localStorage.removeItem(name);
          },
        },
      }
    )
  );
}

// =============================================================================
// Singleton store (for app usage)
// =============================================================================

export const useFileStatusStore = createFileStatusStore();

// =============================================================================
// Selectors (named hooks for minimal re-renders)
// =============================================================================

export const useOpenTabs = () => useFileStatusStore(s => s.tabs);
export const useActivePath = () => useFileStatusStore(s => s.activePath);
export const useExpandedPaths = () => useFileStatusStore(s => s.expandedPaths);
export const useIsExpanded = (path: FilePath) =>
  useFileStatusStore(s => s.expandedPaths.has(path));
export const useIsDirty = (path: FilePath) =>
  useFileStatusStore(s => s.dirtyPaths.has(path));
export const useIsEditing = (path: FilePath) =>
  useFileStatusStore(s => s.editingPath === path);
export const useIsRecentlyModified = (path: FilePath) =>
  useFileStatusStore(s => s.recentlyModifiedPaths.has(path));
