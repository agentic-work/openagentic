import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useDaemonRPCContext } from '../../hooks/useDaemonRPC';

// ── Types ───────────────────────────────────────────────────────────

export interface AvailablePlugin {
  name: string;
  marketplace: string;
  description?: string;
  author?: string;
  license?: string;
  installed: boolean;
  enabled?: boolean;
  homepage?: string;
}

export interface InstalledPlugin {
  name: string;
  version?: string;
  marketplace?: string;
  enabled?: boolean;
}

export interface Marketplace {
  name: string;
  source: string;
  type: string;
  pluginCount: number;
  lastUpdated?: string;
}

export interface PluginError {
  name: string;
  marketplace?: string;
  error: string;
  timestamp?: string;
}

interface PluginsPickerProps {
  open: boolean;
  onClose: () => void;
  /**
   * Fired after a plugin mutation (install / uninstall / toggle)
   * succeeds. CodeModeChatView wires this to send the daemon's
   * `reload_plugins` control_request — without it, the running
   * session's AppState (skills / commands / agents) is stale even
   * after `installed_plugins.json` is updated on disk. This is the
   * exact mechanism openagentic TUI uses (it requires the user to
   * type `/reload-plugins` after install). We fire it automatically.
   *
   * Captured 2026-05-02 in live verify: `superpowers` was installed
   * to disk but `/skills` kept reporting the boot-time count of 17
   * until the session restarted.
   */
  onAfterMutation?: () => void;
}

type Tab = 'discover' | 'installed' | 'marketplaces' | 'errors';

const TAB_ORDER: Tab[] = ['discover', 'installed', 'marketplaces', 'errors'];

const TAB_LABEL: Record<Tab, string> = {
  discover: 'Discover',
  installed: 'Installed',
  marketplaces: 'Marketplaces',
  errors: 'Errors',
};

// ── Design tokens (match SkillsPicker / PermissionDialog / RichModals) ──

const MONO =
  'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace)';
const DIM = 'var(--cm-text-muted, #8b949e)';
const TEXT = 'var(--cm-text, #e6edf3)';
const ACCENT = 'var(--cm-accent, #58a6ff)';
const BG = 'var(--cm-bg-secondary, #161b22)';
const BORDER = 'var(--cm-border, #30363d)';
const ERROR = 'var(--cm-error, #f85149)';
const SELECTED_BG = 'rgba(88, 166, 255, 0.12)'; // accent-tinted highlight

// ── Component ───────────────────────────────────────────────────────

export const PluginsPicker: React.FC<PluginsPickerProps> = ({ open, onClose, onAfterMutation }) => {
  // Skip the context lookup entirely while closed so test harnesses
  // that mount the chat view without a DaemonRPCContext provider don't
  // explode. This component only ever needs the RPC surface when
  // `open=true`.
  if (!open) return null;
  return <PluginsPickerOpen onClose={onClose} onAfterMutation={onAfterMutation} />;
};

const PluginsPickerOpen: React.FC<{ onClose: () => void; onAfterMutation?: () => void }> = ({ onClose, onAfterMutation }) => {
  const { call } = useDaemonRPCContext();

  // Active tab + per-tab selection cursor.
  const [tab, setTab] = useState<Tab>('discover');
  const [selected, setSelected] = useState<number>(0);
  const [search, setSearch] = useState<string>('');

  // Per-tab data — `null` means loading; `[]` means loaded-empty; an
  // array means loaded.
  const [available, setAvailable] = useState<AvailablePlugin[] | null>(null);
  const [installed, setInstalled] = useState<InstalledPlugin[] | null>(null);
  const [marketplaces, setMarketplaces] = useState<Marketplace[] | null>(null);
  const [errors, setErrors] = useState<PluginError[] | null>(null);

  // Per-tab error message — surfaces RPC failures inline.
  const [tabError, setTabError] = useState<Record<Tab, string | null>>({
    discover: null,
    installed: null,
    marketplaces: null,
    errors: null,
  });

  // Add-marketplace inline form state.
  const [addOpen, setAddOpen] = useState<boolean>(false);
  const [addSource, setAddSource] = useState<string>('');
  const [addError, setAddError] = useState<string | null>(null);
  const [addBusy, setAddBusy] = useState<boolean>(false);
  const addInputRef = useRef<HTMLInputElement | null>(null);

  // Errors-tab "expand details" state — keyed by row name.
  const [expandedError, setExpandedError] = useState<string | null>(null);

  // Search input ref so `/` can focus it.
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Cancel-stale flag: each tab fetcher bumps this so a slow response
  // from a previous open or tab doesn't clobber fresh state.
  const seqRef = useRef(0);
  // Per-tab "has been fetched at least once" flag — controls the lazy
  // fetch effect below so we don't loop on a fetch that resolves into
  // an empty/error state. Refs (not state) so toggling them doesn't
  // schedule another render.
  const fetchedRef = useRef<Record<Tab, boolean>>({
    discover: false,
    installed: false,
    marketplaces: false,
    errors: false,
  });

  // ── Fetchers ──────────────────────────────────────────────────────

  const fetchAvailable = useCallback(() => {
    fetchedRef.current.discover = true;
    const seq = ++seqRef.current;
    setAvailable(null);
    setTabError((prev) => ({ ...prev, discover: null }));
    call<{ plugins: AvailablePlugin[] }>('list_available_plugins', {})
      .then((res) => {
        if (seq !== seqRef.current) return;
        setAvailable(res?.plugins ?? []);
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return;
        setAvailable([]);
        const msg = err instanceof Error ? err.message : String(err);
        setTabError((prev) => ({ ...prev, discover: msg }));
      });
  }, [call]);

  const fetchInstalled = useCallback(() => {
    fetchedRef.current.installed = true;
    const seq = ++seqRef.current;
    setInstalled(null);
    setTabError((prev) => ({ ...prev, installed: null }));
    call<{ plugins: InstalledPlugin[] }>('list_plugins')
      .then((res) => {
        if (seq !== seqRef.current) return;
        setInstalled(res?.plugins ?? []);
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return;
        setInstalled([]);
        const msg = err instanceof Error ? err.message : String(err);
        setTabError((prev) => ({ ...prev, installed: msg }));
      });
  }, [call]);

  const fetchMarketplaces = useCallback(() => {
    fetchedRef.current.marketplaces = true;
    const seq = ++seqRef.current;
    setMarketplaces(null);
    setTabError((prev) => ({ ...prev, marketplaces: null }));
    call<{ marketplaces: Marketplace[] }>('list_marketplaces')
      .then((res) => {
        if (seq !== seqRef.current) return;
        setMarketplaces(res?.marketplaces ?? []);
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return;
        setMarketplaces([]);
        const msg = err instanceof Error ? err.message : String(err);
        setTabError((prev) => ({ ...prev, marketplaces: msg }));
      });
  }, [call]);

  const fetchErrors = useCallback(() => {
    fetchedRef.current.errors = true;
    const seq = ++seqRef.current;
    setErrors(null);
    setTabError((prev) => ({ ...prev, errors: null }));
    call<{ errors: PluginError[] }>('list_plugin_errors')
      .then((res) => {
        if (seq !== seqRef.current) return;
        setErrors(res?.errors ?? []);
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return;
        setErrors([]);
        const msg = err instanceof Error ? err.message : String(err);
        setTabError((prev) => ({ ...prev, errors: msg }));
      });
  }, [call]);

  // Initial mount — Discover loads first. Other tabs fetch lazily on
  // first visit (see effect below).
  useEffect(() => {
    fetchAvailable();
    return () => {
      // Bump seq so any in-flight resolve from before unmount is dropped.
      seqRef.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lazy fetch when the user lands on a tab for the first time. The
  // fetchedRef gates this so we never re-fetch on subsequent renders
  // even if the resolve produced an empty list. Subsequent refreshes
  // are explicit (called from action handlers).
  useEffect(() => {
    if (tab === 'installed' && !fetchedRef.current.installed) {
      fetchInstalled();
    }
    if (tab === 'marketplaces' && !fetchedRef.current.marketplaces) {
      fetchMarketplaces();
    }
    if (tab === 'errors' && !fetchedRef.current.errors) {
      fetchErrors();
    }
    // discover is fetched on mount (above) — no lazy fetch needed.
  }, [tab, fetchInstalled, fetchMarketplaces, fetchErrors]);

  // Reset selection when the active tab changes — every tab starts at row 0.
  useEffect(() => {
    setSelected(0);
    // Cancel any open inline add-form on tab switch.
    setAddOpen(false);
  }, [tab]);

  // ── Derived rows for the active tab ────────────────────────────────

  const filteredAvailable = useMemo<AvailablePlugin[]>(() => {
    if (!available) return [];
    if (!search.trim()) return available;
    const needle = search.trim().toLowerCase();
    return available.filter(
      (p) =>
        p.name.toLowerCase().includes(needle) ||
        (p.description ?? '').toLowerCase().includes(needle),
    );
  }, [available, search]);

  // Clamp `selected` into bounds whenever the active list shrinks.
  useEffect(() => {
    let max = 0;
    if (tab === 'discover') max = filteredAvailable.length;
    if (tab === 'installed') max = installed?.length ?? 0;
    if (tab === 'marketplaces') max = marketplaces?.length ?? 0;
    if (tab === 'errors') max = errors?.length ?? 0;
    if (max === 0) {
      if (selected !== 0) setSelected(0);
    } else if (selected >= max) {
      setSelected(max - 1);
    }
  }, [tab, filteredAvailable, installed, marketplaces, errors, selected]);

  // ── Mutators ──────────────────────────────────────────────────────

  const installPluginRPC = useCallback(
    (name: string, marketplace?: string) => {
      // openagentic's installSelectedPlugins expects `name@marketplace`
      // qualified ids, not bare names. Without the qualifier the lookup
      // returns "Plugin not found in any marketplace" even when the
      // marketplace IS registered (observed live on chat-dev attempting
      // to install `superpowers` from `claude-plugins-official`). The
      // Discover tab knows the row's marketplace from list_available_plugins,
      // so qualify here. Both `name` and `spec` are sent for backward-compat
      // with the daemon's pre-rename arg shape; the qualified spec is
      // canonical.
      const spec = marketplace ? `${name}@${marketplace}` : name;
      call('install_plugin', { name: spec, spec })
        .then(() => {
          // 2026-05-02 live verify: install wrote to disk + the row's
          // `installed` flag flipped on Discover, but the Installed tab
          // showed stale data. Refetch BOTH tabs so the user can flip
          // to Installed and see the new entry without reopening the
          // picker.
          fetchAvailable();
          fetchInstalled();
          // Fire reload-plugins so the running session's AppState
          // (skills / commands / agents) sees the new plugin without
          // a session restart. CodeModeChatView wires this to a
          // control_request {subtype: 'reload_plugins'} that the
          // daemon's bridgeHandler routes through refreshActivePlugins.
          // Without this, /skills + agent loop keep using the stale
          // boot-time list.
          onAfterMutation?.();
        })
        .catch(() => {
          fetchAvailable();
          fetchInstalled();
        });
    },
    [call, fetchAvailable, fetchInstalled, onAfterMutation],
  );

  const uninstallPluginRPC = useCallback(
    (name: string, refreshTab: () => void) => {
      call('uninstall_plugin', { name })
        .then(() => {
          refreshTab();
          onAfterMutation?.();
        })
        .catch(() => refreshTab());
    },
    [call, onAfterMutation],
  );

  const togglePluginRPC = useCallback(
    (name: string, refreshTab: () => void) => {
      call('toggle_plugin', { name })
        .then(() => {
          refreshTab();
          onAfterMutation?.();
        })
        .catch(() => refreshTab());
    },
    [call, onAfterMutation],
  );

  const submitAddMarketplace = useCallback(() => {
    const trimmed = addSource.trim();
    if (!trimmed) return;
    if (addBusy) return;
    setAddBusy(true);
    setAddError(null);
    call<{ ok: true; name: string }>('add_marketplace', { source: trimmed })
      .then(() => {
        setAddBusy(false);
        setAddOpen(false);
        setAddSource('');
        fetchMarketplaces();
      })
      .catch((err: unknown) => {
        setAddBusy(false);
        const msg = err instanceof Error ? err.message : String(err);
        setAddError(msg);
      });
  }, [addSource, addBusy, call, fetchMarketplaces]);

  const removeMarketplaceRPC = useCallback(
    (name: string) => {
      call('remove_marketplace', { name })
        .then(() => fetchMarketplaces())
        .catch(() => fetchMarketplaces());
    },
    [call, fetchMarketplaces],
  );

  // ── Keyboard handlers ──────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inSearch = target === searchInputRef.current;
      const inAddForm = target === addInputRef.current;

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (addOpen) {
          // Closing the inline form is the priority — picker stays open.
          setAddOpen(false);
          setAddError(null);
        } else {
          onClose();
        }
        return;
      }

      // Tab / Shift-Tab cycle tabs from anywhere except inside an
      // editable input (so ⇥ in search doesn't jump tabs unexpectedly —
      // though the search input is a single line so default behaviour
      // is fine; we still preventDefault to keep parity with the TUI).
      if (e.key === 'Tab') {
        e.preventDefault();
        const idx = TAB_ORDER.indexOf(tab);
        const dir = e.shiftKey ? -1 : 1;
        const next = TAB_ORDER[(idx + dir + TAB_ORDER.length) % TAB_ORDER.length]!;
        setTab(next);
        return;
      }

      // Space-to-toggle MUST work even when search input has focus —
      // captured 2026-05-02 in live picker test. The TUI's Ink keypress
      // handler reads keys at picker level; in the browser, an HTMLInput
      // would otherwise eat Space as a literal character. Hint at the
      // bottom of the picker says "Space to toggle"; honor it.
      if (e.key === ' ' && (tab === 'discover' || tab === 'installed') && !inAddForm) {
        e.preventDefault();
        e.stopPropagation();
        if (tab === 'discover') {
          const row = filteredAvailable[selected];
          if (!row) return;
          if (row.installed) uninstallPluginRPC(row.name, fetchAvailable);
          else installPluginRPC(row.name, row.marketplace);
        } else {
          const row = installed?.[selected];
          if (!row) return;
          togglePluginRPC(row.name, fetchInstalled);
        }
        return;
      }

      // Don't claim other keys while the user is typing in a text field.
      if (inSearch || inAddForm) return;

      // Left/Right also cycle tabs.
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const idx = TAB_ORDER.indexOf(tab);
        const next = TAB_ORDER[(idx - 1 + TAB_ORDER.length) % TAB_ORDER.length]!;
        setTab(next);
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        const idx = TAB_ORDER.indexOf(tab);
        const next = TAB_ORDER[(idx + 1) % TAB_ORDER.length]!;
        setTab(next);
        return;
      }

      // ↑/↓ navigate the active list.
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const max =
          tab === 'discover'
            ? filteredAvailable.length
            : tab === 'installed'
              ? installed?.length ?? 0
              : tab === 'marketplaces'
                ? marketplaces?.length ?? 0
                : errors?.length ?? 0;
        if (max === 0) return;
        if (e.key === 'ArrowDown') {
          setSelected((i) => Math.min(max - 1, i + 1));
        } else {
          setSelected((i) => Math.max(0, i - 1));
        }
        return;
      }

      // `/` focuses the search input (Discover only).
      if (e.key === '/' && tab === 'discover') {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      // Tab-specific actions — only handled when the picker has focus.
      if (tab === 'discover') {
        if (e.key === ' ') {
          e.preventDefault();
          const row = filteredAvailable[selected];
          if (!row) return;
          if (row.installed) uninstallPluginRPC(row.name, fetchAvailable);
          else installPluginRPC(row.name, row.marketplace);
          return;
        }
        if (e.key === 'Enter') {
          // Defer details panel to a follow-up — for now Enter is a
          // no-op on Discover (matches the brief: "for now Enter =
          // no-op"). Don't preventDefault — let it bubble.
          return;
        }
      }

      if (tab === 'installed') {
        if (e.key === ' ') {
          e.preventDefault();
          const row = installed?.[selected];
          if (!row) return;
          togglePluginRPC(row.name, fetchInstalled);
          return;
        }
        if (e.key === 'u') {
          e.preventDefault();
          const row = installed?.[selected];
          if (!row) return;
          uninstallPluginRPC(row.name, fetchInstalled);
          return;
        }
      }

      if (tab === 'marketplaces') {
        if (e.key === 'a') {
          e.preventDefault();
          setAddOpen(true);
          setAddError(null);
          // Focus the input on the next tick so the form is mounted.
          setTimeout(() => addInputRef.current?.focus(), 0);
          return;
        }
        if (e.key === 'd') {
          e.preventDefault();
          const row = marketplaces?.[selected];
          if (!row) return;
          removeMarketplaceRPC(row.name);
          return;
        }
      }

      if (tab === 'errors') {
        if (e.key === 'Enter') {
          e.preventDefault();
          const row = errors?.[selected];
          if (!row) return;
          setExpandedError((cur) => (cur === row.name ? null : row.name));
          return;
        }
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [
    tab,
    selected,
    filteredAvailable,
    installed,
    marketplaces,
    errors,
    addOpen,
    onClose,
    fetchAvailable,
    fetchInstalled,
    installPluginRPC,
    uninstallPluginRPC,
    togglePluginRPC,
    removeMarketplaceRPC,
  ]);

  // ── Render ────────────────────────────────────────────────────────

  const overlay = (
    <div
      data-testid="plugins-picker"
      role="dialog"
      aria-modal="true"
      aria-label="Plugins picker"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50, // matches --cm-z-modal in codeMode.css
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.55)',
        fontFamily: MONO,
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 760,
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: BG,
          color: TEXT,
          border: `1px solid ${BORDER}`,
          borderRadius: 8,
          boxShadow: '0 12px 48px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        }}
      >
        {/* Tab bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.7ch',
            padding: '10px 16px 0',
            borderBottom: `1px solid ${BORDER}`,
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: TEXT,
              marginRight: '1ch',
            }}
          >
            Plugins
          </span>
          {TAB_ORDER.map((t) => {
            const active = t === tab;
            return (
              <button
                key={t}
                type="button"
                data-testid={`plugin-tab-${t}`}
                data-active={active ? 'true' : 'false'}
                onClick={() => setTab(t)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: active ? ACCENT : DIM,
                  fontWeight: active ? 700 : 500,
                  fontFamily: MONO,
                  fontSize: 12,
                  padding: '8px 6px',
                  borderBottom: active
                    ? `2px solid ${ACCENT}`
                    : '2px solid transparent',
                  cursor: 'pointer',
                  outline: 'none',
                  marginBottom: -1,
                }}
              >
                {TAB_LABEL[t]}
              </button>
            );
          })}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: DIM }}>
            <kbd>Esc</kbd> close
          </span>
        </div>

        {/* Body */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '8px 16px 12px',
          }}
        >
          {tab === 'discover' && (
            <DiscoverPanel
              available={available}
              filtered={filteredAvailable}
              total={available?.length ?? 0}
              selected={selected}
              setSelected={setSelected}
              search={search}
              setSearch={setSearch}
              searchInputRef={searchInputRef}
              error={tabError.discover}
              onRetry={fetchAvailable}
              onInstall={(name, marketplace) => installPluginRPC(name, marketplace)}
              onUninstall={(name) => uninstallPluginRPC(name, fetchAvailable)}
            />
          )}
          {tab === 'installed' && (
            <InstalledPanel
              rows={installed}
              selected={selected}
              setSelected={setSelected}
              error={tabError.installed}
              onRetry={fetchInstalled}
              onToggle={(name) => togglePluginRPC(name, fetchInstalled)}
            />
          )}
          {tab === 'marketplaces' && (
            <MarketplacesPanel
              rows={marketplaces}
              selected={selected}
              setSelected={setSelected}
              addOpen={addOpen}
              addSource={addSource}
              setAddSource={setAddSource}
              addBusy={addBusy}
              addError={addError}
              addInputRef={addInputRef}
              onSubmitAdd={submitAddMarketplace}
              onCancelAdd={() => {
                setAddOpen(false);
                setAddError(null);
              }}
              error={tabError.marketplaces}
              onRetry={fetchMarketplaces}
            />
          )}
          {tab === 'errors' && (
            <ErrorsPanel
              rows={errors}
              selected={selected}
              setSelected={setSelected}
              expandedName={expandedError}
              error={tabError.errors}
              onRetry={fetchErrors}
            />
          )}
        </div>

        {/* Footer hints */}
        <div
          style={{
            borderTop: `1px solid ${BORDER}`,
            padding: '8px 16px',
            color: DIM,
            fontSize: 11,
            flexShrink: 0,
            fontFamily: MONO,
          }}
        >
          {tab === 'discover' &&
            'type to search · Space to toggle · Enter to details · Esc to back'}
          {tab === 'installed' &&
            'Space to toggle · Enter to details · u to uninstall · Esc to back'}
          {tab === 'marketplaces' &&
            'Enter to view · a to add · d to delete · Esc to back'}
          {tab === 'errors' && 'Enter to view full error · Esc to back'}
        </div>

        {/* Disclaimer */}
        <div
          style={{
            padding: '4px 16px 8px',
            color: DIM,
            fontSize: 10,
            fontFamily: MONO,
            flexShrink: 0,
            opacity: 0.7,
          }}
        >
          openagentic is an independent project, not affiliated with Anthropic.
        </div>
      </div>
    </div>
  );

  // SSR guard — the chat view only mounts in the browser, but be safe.
  if (typeof document === 'undefined') return overlay;
  return createPortal(overlay, document.body);
};

// ── Discover panel ────────────────────────────────────────────────

interface DiscoverPanelProps {
  available: AvailablePlugin[] | null;
  filtered: AvailablePlugin[];
  total: number;
  selected: number;
  setSelected: (i: number) => void;
  search: string;
  setSearch: (s: string) => void;
  searchInputRef: React.MutableRefObject<HTMLInputElement | null>;
  error: string | null;
  onRetry: () => void;
  /** Install the plugin (Discover row click on `available` row). */
  onInstall: (name: string, marketplace?: string) => void;
  /** Uninstall (Discover row click on already-installed row). */
  onUninstall: (name: string) => void;
}

const DiscoverPanel: React.FC<DiscoverPanelProps> = ({
  available,
  filtered,
  total,
  selected,
  setSelected,
  search,
  setSearch,
  searchInputRef,
  error,
  onRetry,
  onInstall,
  onUninstall,
}) => {
  if (error !== null) return <ErrorState message={error} onRetry={onRetry} />;
  if (available === null) return <LoadingState label="Loading plugins…" />;

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: '0.7ch',
          marginBottom: 6,
        }}
      >
        <span style={{ fontSize: 12, color: TEXT, fontWeight: 600 }}>
          Discover plugins
        </span>
        <span style={{ fontSize: 11, color: DIM }}>
          {filtered.length} / {total}
        </span>
      </div>
      <div style={{ marginBottom: 8 }}>
        <input
          ref={searchInputRef}
          type="text"
          value={search}
          placeholder="⌕ Search…"
          aria-label="Search plugins"
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            // Let the user escape into row-navigation without un-focusing
            // the picker entirely. ↓/↑ from inside search jumps to row 0
            // and blurs the input — the global picker keydown handler
            // (which gates row navigation on `inSearch`) then takes over.
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setSelected(0);
              e.currentTarget.blur();
              return;
            }
            // Esc clears the filter first; second Esc closes the picker
            // (handled by the global keydown).
            if (e.key === 'Escape' && search) {
              e.preventDefault();
              e.stopPropagation();
              setSearch('');
              return;
            }
          }}
          style={{
            width: '100%',
            padding: '6px 10px',
            backgroundColor: 'rgba(0,0,0,0.3)',
            border: `1px solid ${BORDER}`,
            borderRadius: 4,
            color: TEXT,
            fontFamily: MONO,
            fontSize: 12,
            outline: 'none',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = ACCENT;
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = BORDER;
          }}
        />
      </div>

      {available.length === 0 ? (
        <EmptyState>
          <div>No plugins discovered.</div>
          <div style={{ fontSize: 11 }}>
            Add a marketplace under the Marketplaces tab to surface
            installable plugins here.
          </div>
        </EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState>
          <div>No plugins match “{search}”.</div>
        </EmptyState>
      ) : (
        filtered.map((p, idx) => (
          <PluginRow
            key={`${p.marketplace}::${p.name}`}
            idx={idx}
            selected={idx === selected}
            onMouseEnter={() => setSelected(idx)}
            onActivate={() => {
              setSelected(idx);
              if (p.installed) {
                onUninstall(p.name);
              } else {
                onInstall(p.name, p.marketplace);
              }
            }}
            name={p.name}
            marketplace={p.marketplace}
            description={p.description}
            author={p.author}
            license={p.license}
            status={
              p.installed
                ? p.enabled === false
                  ? 'disabled'
                  : 'enabled'
                : 'available'
            }
          />
        ))
      )}
    </>
  );
};

// ── Installed panel ───────────────────────────────────────────────

interface InstalledPanelProps {
  rows: InstalledPlugin[] | null;
  selected: number;
  setSelected: (i: number) => void;
  error: string | null;
  onRetry: () => void;
  /** Toggle enable/disable for the row's plugin. */
  onToggle: (name: string) => void;
}

const InstalledPanel: React.FC<InstalledPanelProps> = ({
  rows,
  selected,
  setSelected,
  error,
  onRetry,
  onToggle,
}) => {
  if (error !== null) return <ErrorState message={error} onRetry={onRetry} />;
  if (rows === null) return <LoadingState label="Loading installed plugins…" />;

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: '0.7ch',
          marginBottom: 6,
        }}
      >
        <span style={{ fontSize: 12, color: TEXT, fontWeight: 600 }}>
          Installed plugins
        </span>
        <span style={{ fontSize: 11, color: DIM }}>{rows.length}</span>
      </div>

      {rows.length === 0 ? (
        <EmptyState>
          <div>No plugins installed.</div>
          <div style={{ fontSize: 11 }}>
            Switch to <code style={{ color: ACCENT }}>Discover</code> to find
            something to install.
          </div>
        </EmptyState>
      ) : (
        rows.map((p, idx) => (
          <PluginRow
            key={p.name}
            idx={idx}
            selected={idx === selected}
            onMouseEnter={() => setSelected(idx)}
            onActivate={() => {
              setSelected(idx);
              onToggle(p.name);
            }}
            name={p.name}
            marketplace={p.marketplace ?? ''}
            description={p.version ? `version ${p.version}` : undefined}
            status={p.enabled === false ? 'disabled' : 'enabled'}
          />
        ))
      )}
    </>
  );
};

// ── Marketplaces panel ────────────────────────────────────────────

interface MarketplacesPanelProps {
  rows: Marketplace[] | null;
  selected: number;
  setSelected: (i: number) => void;
  addOpen: boolean;
  addSource: string;
  setAddSource: (s: string) => void;
  addBusy: boolean;
  addError: string | null;
  addInputRef: React.MutableRefObject<HTMLInputElement | null>;
  onSubmitAdd: () => void;
  onCancelAdd: () => void;
  error: string | null;
  onRetry: () => void;
}

const MarketplacesPanel: React.FC<MarketplacesPanelProps> = ({
  rows,
  selected,
  setSelected,
  addOpen,
  addSource,
  setAddSource,
  addBusy,
  addError,
  addInputRef,
  onSubmitAdd,
  onCancelAdd,
  error,
  onRetry,
}) => {
  if (error !== null) return <ErrorState message={error} onRetry={onRetry} />;
  if (rows === null) return <LoadingState label="Loading marketplaces…" />;

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: '0.7ch',
          marginBottom: 6,
        }}
      >
        <span style={{ fontSize: 12, color: TEXT, fontWeight: 600 }}>
          Marketplaces
        </span>
        <span style={{ fontSize: 11, color: DIM }}>{rows.length}</span>
      </div>

      {addOpen && (
        <div
          style={{
            border: `1px solid ${BORDER}`,
            borderRadius: 4,
            padding: 10,
            marginBottom: 10,
            backgroundColor: 'rgba(0,0,0,0.2)',
          }}
        >
          <div style={{ fontSize: 11, color: DIM, marginBottom: 6 }}>
            Add a marketplace by source URL or git ref (e.g.
            <code style={{ color: ACCENT, marginLeft: 4 }}>
              github.com/openagentic/plugins
            </code>
            ).
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.7ch',
            }}
          >
            <input
              ref={addInputRef}
              type="text"
              value={addSource}
              onChange={(e) => setAddSource(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onSubmitAdd();
                }
              }}
              placeholder="marketplace source"
              aria-label="marketplace source"
              disabled={addBusy}
              style={{
                flex: 1,
                padding: '6px 8px',
                fontFamily: MONO,
                fontSize: 12,
                color: TEXT,
                backgroundColor: 'rgba(0,0,0,0.3)',
                border: `1px solid ${BORDER}`,
                borderRadius: 4,
                outline: 'none',
              }}
            />
            <button
              type="button"
              onClick={onSubmitAdd}
              disabled={addBusy || addSource.trim().length === 0}
              style={{
                padding: '6px 14px',
                background: 'transparent',
                border: `1px solid ${ACCENT}`,
                color: ACCENT,
                borderRadius: 4,
                cursor:
                  addBusy || addSource.trim().length === 0
                    ? 'not-allowed'
                    : 'pointer',
                fontFamily: MONO,
                fontSize: 12,
                opacity: addBusy || addSource.trim().length === 0 ? 0.5 : 1,
              }}
            >
              {addBusy ? 'Adding…' : 'Add'}
            </button>
            <button
              type="button"
              onClick={onCancelAdd}
              disabled={addBusy}
              style={{
                padding: '6px 12px',
                background: 'transparent',
                border: `1px solid ${BORDER}`,
                color: DIM,
                borderRadius: 4,
                cursor: addBusy ? 'not-allowed' : 'pointer',
                fontFamily: MONO,
                fontSize: 12,
                opacity: addBusy ? 0.5 : 1,
              }}
            >
              Cancel
            </button>
          </div>
          {addError && (
            <div
              role="alert"
              style={{
                color: ERROR,
                fontSize: 11,
                marginTop: 6,
                wordBreak: 'break-word',
              }}
            >
              {addError}
            </div>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState>
          <div>No marketplaces configured.</div>
          <div style={{ fontSize: 11 }}>
            Press <code style={{ color: ACCENT }}>a</code> to add one.
          </div>
        </EmptyState>
      ) : (
        rows.map((m, idx) => {
          const sel = idx === selected;
          return (
            <div
              key={m.name}
              data-testid={`marketplace-row-${idx}`}
              data-selected={sel ? 'true' : 'false'}
              style={{
                padding: '6px 10px',
                borderRadius: 4,
                backgroundColor: sel ? SELECTED_BG : 'transparent',
                borderLeft: sel
                  ? `2px solid ${ACCENT}`
                  : '2px solid transparent',
                marginBottom: 1,
                cursor: 'pointer',
              }}
              onMouseEnter={() => setSelected(idx)}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: '0.7ch',
                  fontFamily: MONO,
                  fontSize: 12,
                }}
              >
                <span aria-hidden="true" style={{ color: sel ? ACCENT : DIM }}>
                  {sel ? '❯' : ' '}
                </span>
                <span
                  style={{
                    color: sel ? ACCENT : TEXT,
                    fontWeight: sel ? 600 : 500,
                  }}
                >
                  {m.name}
                </span>
                <span style={{ color: DIM }}>·</span>
                <span style={{ color: DIM }}>
                  {m.source} ({m.type})
                </span>
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: DIM,
                  marginTop: 2,
                  marginLeft: '2.4ch',
                }}
              >
                {m.pluginCount} plugins
                {m.lastUpdated ? ` · updated ${m.lastUpdated}` : ''}
              </div>
            </div>
          );
        })
      )}
    </>
  );
};

// ── Errors panel ──────────────────────────────────────────────────

interface ErrorsPanelProps {
  rows: PluginError[] | null;
  selected: number;
  setSelected: (i: number) => void;
  expandedName: string | null;
  error: string | null;
  onRetry: () => void;
}

const ErrorsPanel: React.FC<ErrorsPanelProps> = ({
  rows,
  selected,
  setSelected,
  expandedName,
  error,
  onRetry,
}) => {
  if (error !== null) return <ErrorState message={error} onRetry={onRetry} />;
  if (rows === null) return <LoadingState label="Loading plugin errors…" />;

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: '0.7ch',
          marginBottom: 6,
        }}
      >
        <span style={{ fontSize: 12, color: TEXT, fontWeight: 600 }}>
          Plugin errors
        </span>
        <span style={{ fontSize: 11, color: DIM }}>{rows.length}</span>
      </div>

      {rows.length === 0 ? (
        <EmptyState>
          <div>No plugin errors.</div>
        </EmptyState>
      ) : (
        rows.map((e, idx) => {
          const sel = idx === selected;
          const expanded = expandedName === e.name;
          return (
            <div
              key={`${e.marketplace ?? ''}::${e.name}`}
              data-testid={`error-row-${idx}`}
              data-selected={sel ? 'true' : 'false'}
              style={{
                padding: '6px 10px',
                borderRadius: 4,
                backgroundColor: sel ? SELECTED_BG : 'transparent',
                borderLeft: sel
                  ? `2px solid ${ERROR}`
                  : '2px solid transparent',
                marginBottom: 1,
                cursor: 'pointer',
              }}
              onMouseEnter={() => setSelected(idx)}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: '0.7ch',
                  fontFamily: MONO,
                  fontSize: 12,
                }}
              >
                <span aria-hidden="true" style={{ color: ERROR }}>
                  ✗
                </span>
                <span
                  style={{
                    color: sel ? ERROR : TEXT,
                    fontWeight: sel ? 600 : 500,
                  }}
                >
                  {e.name}
                </span>
                {e.marketplace && (
                  <span style={{ color: DIM }}>({e.marketplace})</span>
                )}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: DIM,
                  marginTop: 2,
                  marginLeft: '2.4ch',
                  whiteSpace: expanded ? 'pre-wrap' : 'nowrap',
                  overflow: expanded ? 'visible' : 'hidden',
                  textOverflow: expanded ? 'clip' : 'ellipsis',
                  wordBreak: 'break-word',
                }}
              >
                {e.error}
              </div>
              {expanded && e.timestamp && (
                <div
                  style={{
                    fontSize: 10,
                    color: DIM,
                    marginTop: 4,
                    marginLeft: '2.4ch',
                  }}
                >
                  {e.timestamp}
                </div>
              )}
            </div>
          );
        })
      )}
    </>
  );
};

// ── Plugin row (Discover + Installed) ─────────────────────────────

interface PluginRowProps {
  idx: number;
  selected: boolean;
  onMouseEnter: () => void;
  /** Click on the row body — selects + activates the row's primary action.
   * For Discover: install/uninstall toggle. For Installed: enable/disable
   * toggle. The TUI activates via Space; the browser also accepts a click
   * since the row is `cursor: pointer`. Without this users can hover/select
   * a row but have no way to act on it from the mouse, only the keyboard.
   */
  onActivate?: () => void;
  name: string;
  marketplace: string;
  description?: string;
  author?: string;
  license?: string;
  status: 'available' | 'enabled' | 'disabled' | 'error';
}

const PluginRow: React.FC<PluginRowProps> = ({
  idx,
  selected,
  onMouseEnter,
  onActivate,
  name,
  marketplace,
  description,
  author,
  license,
  status,
}) => {
  const glyph =
    status === 'available'
      ? '◯'
      : status === 'enabled'
        ? '●'
        : status === 'disabled'
          ? '◐'
          : '✗';

  return (
    <div
      data-testid={`plugin-row-${idx}`}
      data-selected={selected ? 'true' : 'false'}
      data-status={status}
      role="button"
      tabIndex={0}
      style={{
        padding: '6px 10px',
        borderRadius: 4,
        backgroundColor: selected ? SELECTED_BG : 'transparent',
        borderLeft: selected ? `2px solid ${ACCENT}` : '2px solid transparent',
        marginBottom: 1,
        cursor: onActivate ? 'pointer' : 'default',
      }}
      onMouseEnter={onMouseEnter}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (!onActivate) return;
        // Native Enter/Space when the row itself has focus (e.g. user
        // tabbed in). Stop propagation so the global picker keydown
        // handler doesn't double-fire on Space.
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          onActivate();
        }
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: '0.7ch',
          fontFamily: MONO,
          fontSize: 12,
        }}
      >
        <span aria-hidden="true" style={{ color: selected ? ACCENT : DIM }}>
          {selected ? '❯' : ' '}
        </span>
        <span
          aria-hidden="true"
          style={{
            color:
              status === 'available'
                ? DIM
                : status === 'enabled'
                  ? ACCENT
                  : status === 'disabled'
                    ? DIM
                    : ERROR,
          }}
        >
          {glyph}
        </span>
        <span
          style={{
            color: selected ? ACCENT : TEXT,
            fontWeight: selected ? 600 : 500,
          }}
        >
          {name}
        </span>
        {marketplace && (
          <>
            <span style={{ color: DIM }}>·</span>
            <span style={{ color: DIM }}>{marketplace}</span>
          </>
        )}
      </div>
      {description && (
        <div
          style={{
            fontSize: 11,
            color: DIM,
            marginTop: 2,
            marginLeft: '4ch',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {description}
        </div>
      )}
      <div
        style={{
          fontSize: 10,
          color: DIM,
          marginTop: 2,
          marginLeft: '4ch',
        }}
      >
        by {author || '(unknown author)'} ·{' '}
        {license || '(unknown license)'}
        {marketplace ? ` · ${marketplace}` : ''}
      </div>
    </div>
  );
};

// ── Shared sub-renderers ──────────────────────────────────────────

const LoadingState: React.FC<{ label?: string }> = ({ label = 'Loading…' }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '0.7ch',
      padding: '32px 0',
      color: DIM,
      fontSize: 12,
    }}
  >
    <span aria-hidden="true">⠋</span>
    <span>{label}</span>
  </div>
);

const EmptyState: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      textAlign: 'center',
      padding: '24px 0',
      color: DIM,
      fontSize: 12,
    }}
  >
    {children}
  </div>
);

const ErrorState: React.FC<{ message: string; onRetry: () => void }> = ({
  message,
  onRetry,
}) => (
  <div
    style={{
      padding: '20px 0',
      textAlign: 'center',
    }}
  >
    <div
      style={{
        color: ERROR,
        fontSize: 12,
        marginBottom: 12,
        wordBreak: 'break-word',
      }}
    >
      {message}
    </div>
    <button
      type="button"
      onClick={onRetry}
      style={{
        padding: '6px 14px',
        background: 'transparent',
        border: `1px solid ${ACCENT}`,
        color: ACCENT,
        borderRadius: 4,
        cursor: 'pointer',
        fontFamily: MONO,
        fontSize: 12,
      }}
    >
      Retry
    </button>
  </div>
);

export default PluginsPicker;
