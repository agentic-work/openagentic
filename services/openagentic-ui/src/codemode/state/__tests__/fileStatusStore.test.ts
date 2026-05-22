import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFileStatusStore } from '../fileStatusStore';

const STORAGE_KEY = 'codemode-file-panel-state-v1';

beforeEach(() => {
  localStorage.clear();
  vi.clearAllTimers();
});

// ---------------------------------------------------------------------------
// Tabs + MRU
// ---------------------------------------------------------------------------

describe('Tabs + MRU', () => {
  it('1. initial state: tabs=[], activePath=null', () => {
    const store = createFileStatusStore();
    const { tabs, activePath } = store.getState();
    expect(tabs).toEqual([]);
    expect(activePath).toBeNull();
  });

  it('2. openTab("/a") → tabs=[{path:"/a"}], activePath="/a"', () => {
    const store = createFileStatusStore();
    store.getState().openTab('/a');
    const { tabs, activePath } = store.getState();
    expect(tabs).toHaveLength(1);
    expect(tabs[0].path).toBe('/a');
    expect(activePath).toBe('/a');
  });

  it('3. openTab("/a"); openTab("/b") → MRU order: /b first', () => {
    const store = createFileStatusStore();
    store.getState().openTab('/a');
    store.getState().openTab('/b');
    const { tabs, activePath } = store.getState();
    expect(tabs[0].path).toBe('/b');
    expect(tabs[1].path).toBe('/a');
    expect(activePath).toBe('/b');
  });

  it('4. re-activating /a moves it to front', () => {
    const store = createFileStatusStore();
    store.getState().openTab('/a');
    store.getState().openTab('/b');
    store.getState().openTab('/a');
    const { tabs, activePath } = store.getState();
    expect(tabs[0].path).toBe('/a');
    expect(tabs[1].path).toBe('/b');
    expect(activePath).toBe('/a');
  });

  it('5. cap at 50 tabs — 51 distinct openTab calls → length===50, oldest dropped', () => {
    const store = createFileStatusStore();
    for (let i = 0; i < 51; i++) {
      store.getState().openTab(`/file-${i}`);
    }
    const { tabs } = store.getState();
    expect(tabs).toHaveLength(50);
    // /file-0 was opened first (oldest) and should be dropped
    expect(tabs.find(t => t.path === '/file-0')).toBeUndefined();
    // /file-50 (newest) should be present
    expect(tabs.find(t => t.path === '/file-50')).toBeDefined();
  });

  it('6. closeTab("/a") when active and only tab → tabs=[], activePath=null', () => {
    const store = createFileStatusStore();
    store.getState().openTab('/a');
    store.getState().closeTab('/a');
    const { tabs, activePath } = store.getState();
    expect(tabs).toEqual([]);
    expect(activePath).toBeNull();
  });

  it('7. closeTab of active when other tabs exist → next MRU becomes active', () => {
    const store = createFileStatusStore();
    store.getState().openTab('/a');
    store.getState().openTab('/b');
    // /b is active (MRU first), close it → /a should become active
    store.getState().closeTab('/b');
    const { tabs, activePath } = store.getState();
    expect(tabs).toHaveLength(1);
    expect(tabs[0].path).toBe('/a');
    expect(activePath).toBe('/a');
  });

  it('8. closeTab of non-active → tabs shrink, active unchanged', () => {
    const store = createFileStatusStore();
    store.getState().openTab('/a');
    store.getState().openTab('/b');
    // /b is active, close /a
    store.getState().closeTab('/a');
    const { tabs, activePath } = store.getState();
    expect(tabs).toHaveLength(1);
    expect(tabs[0].path).toBe('/b');
    expect(activePath).toBe('/b');
  });

  it('9. setActiveTab("/a") when /a is in tabs → bumps MRU, sets active', () => {
    const store = createFileStatusStore();
    store.getState().openTab('/a');
    store.getState().openTab('/b');
    // /b is MRU, set /a active
    const beforeTs = store.getState().tabs.find(t => t.path === '/a')!.lastActivatedMs;
    store.getState().setActiveTab('/a');
    const { tabs, activePath } = store.getState();
    expect(activePath).toBe('/a');
    expect(tabs[0].path).toBe('/a');
    expect(tabs[0].lastActivatedMs).toBeGreaterThanOrEqual(beforeTs);
  });

  it('10. setActiveTab("/missing") → throws Error', () => {
    const store = createFileStatusStore();
    expect(() => store.getState().setActiveTab('/missing')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Tree expansion
// ---------------------------------------------------------------------------

describe('Tree expansion', () => {
  it('11. toggleExpand adds, second call removes', () => {
    const store = createFileStatusStore();
    store.getState().toggleExpand('/foo');
    expect(store.getState().expandedPaths.has('/foo')).toBe(true);
    store.getState().toggleExpand('/foo');
    expect(store.getState().expandedPaths.has('/foo')).toBe(false);
  });

  it('12. setExpanded("/foo", true) twice → idempotent, still in set once', () => {
    const store = createFileStatusStore();
    store.getState().setExpanded('/foo', true);
    store.getState().setExpanded('/foo', true);
    const { expandedPaths } = store.getState();
    expect(expandedPaths.has('/foo')).toBe(true);
    expect(expandedPaths.size).toBe(1);
  });

  it('13. expandedPaths is a Set instance', () => {
    const store = createFileStatusStore();
    expect(store.getState().expandedPaths).toBeInstanceOf(Set);
  });
});

// ---------------------------------------------------------------------------
// Forward-compat
// ---------------------------------------------------------------------------

describe('Forward-compat (Phase B/C)', () => {
  it('14. markDirty("/a"); markDirty("/b") → dirtyPaths has both', () => {
    const store = createFileStatusStore();
    store.getState().markDirty('/a');
    store.getState().markDirty('/b');
    const { dirtyPaths } = store.getState();
    expect(dirtyPaths.has('/a')).toBe(true);
    expect(dirtyPaths.has('/b')).toBe(true);
  });

  it('15. closeTab("/a") clears "/a" from dirtyPaths', () => {
    const store = createFileStatusStore();
    store.getState().openTab('/a');
    store.getState().openTab('/b');
    store.getState().markDirty('/a');
    store.getState().closeTab('/a');
    expect(store.getState().dirtyPaths.has('/a')).toBe(false);
  });

  it('16. setEditingPath("/foo") → editingPath="/foo"', () => {
    const store = createFileStatusStore();
    store.getState().setEditingPath('/foo');
    expect(store.getState().editingPath).toBe('/foo');
  });

  it('17. setEditingPath(null) → clears editingPath', () => {
    const store = createFileStatusStore();
    store.getState().setEditingPath('/foo');
    store.getState().setEditingPath(null);
    expect(store.getState().editingPath).toBeNull();
  });

  it('18. markRecentlyModified("/a") → in set; advance 5001ms → cleared', () => {
    vi.useFakeTimers();
    const store = createFileStatusStore();
    store.getState().markRecentlyModified('/a');
    expect(store.getState().recentlyModifiedPaths.has('/a')).toBe(true);
    vi.advanceTimersByTime(5001);
    expect(store.getState().recentlyModifiedPaths.has('/a')).toBe(false);
    vi.useRealTimers();
  });

  it('19. markRecentlyModified("/a") twice within 3s resets timer', () => {
    vi.useFakeTimers();
    const store = createFileStatusStore();
    store.getState().markRecentlyModified('/a');
    vi.advanceTimersByTime(3000);
    // still present (timer reset on second call coming up)
    store.getState().markRecentlyModified('/a');
    // advance 5001ms from second call — should still be present just before 5s mark
    vi.advanceTimersByTime(4999);
    expect(store.getState().recentlyModifiedPaths.has('/a')).toBe(true);
    // advance the remaining 2ms → total >5s from second call
    vi.advanceTimersByTime(2);
    expect(store.getState().recentlyModifiedPaths.has('/a')).toBe(false);
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

describe('Persistence', () => {
  it('20. after openTab + setExpanded → localStorage contains tabs + activePath + expandedPaths', () => {
    const store = createFileStatusStore();
    store.getState().openTab('/a');
    store.getState().openTab('/b');
    store.getState().setExpanded('/foo', true);

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    const state = parsed.state;
    expect(state.tabs).toBeDefined();
    expect(state.activePath).toBeDefined();
    expect(state.expandedPaths).toBeDefined();
  });

  it('21. fresh store reads localStorage → tabs/active/expanded restored', () => {
    const store1 = createFileStatusStore();
    store1.getState().openTab('/a');
    store1.getState().openTab('/b');
    store1.getState().setExpanded('/foo', true);

    // Simulate fresh store load
    const store2 = createFileStatusStore();
    const { tabs, activePath, expandedPaths } = store2.getState();
    expect(tabs).toHaveLength(2);
    expect(activePath).toBe('/b');
    expect(expandedPaths.has('/foo')).toBe(true);
  });

  it('22. dirtyPaths and editingPath are NOT persisted', () => {
    const store1 = createFileStatusStore();
    store1.getState().openTab('/a');
    store1.getState().markDirty('/a');
    store1.getState().setEditingPath('/a');

    const store2 = createFileStatusStore();
    expect(store2.getState().dirtyPaths.size).toBe(0);
    expect(store2.getState().editingPath).toBeNull();
  });

  it('23. after rehydrate, if persisted activePath not in tabs → activePath becomes tabs[0].path or null', () => {
    // Manually craft a bad localStorage entry
    const badState = {
      state: {
        tabs: [{ path: '/x', lastActivatedMs: 1000 }],
        activePath: '/nonexistent',
        expandedPaths: [],
      },
      version: 0,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(badState));

    const store = createFileStatusStore();
    const { activePath, tabs } = store.getState();
    // activePath should be corrected to tabs[0].path or null
    expect(activePath).toBe('/x');
  });

  it('24. reset() clears localStorage', () => {
    const store = createFileStatusStore();
    store.getState().openTab('/a');
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    store.getState().reset();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
